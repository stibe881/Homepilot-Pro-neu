"""Erinnerungen: Der Hub schickt den Push - und nur er.

Die Bildschirm-Fälligkeit rechnen die Geräte selbst; hier steht die
Logik, die entscheidet, wer wann eine Push-Nachricht bekommt und was
danach in der Liste steht.
"""

import time

from homepilot.core.erinnerungen import empfaenger, nach_versand, zu_pushen


def test_gepusht_wird_was_faellig_ist_und_push_traegt():
    rows = [
        {"id": "a", "at": 1000, "push": True},
        {"id": "b", "at": 1000},                      # nur Bildschirm
        {"id": "c", "at": 5000, "push": True},        # noch nicht so weit
        {"id": "d", "at": 1000, "push": True, "done": True},
        {"id": "e", "at": 1000, "push": True, "pushed": True},
        {"id": "f", "at": "kaputt", "push": True},
    ]
    assert [row["id"] for row in zu_pushen(rows, 2000)] == ["a"]


def test_leere_und_fremde_zeilen_stoeren_nicht():
    assert zu_pushen(None, 1) == []
    assert zu_pushen([{"push": True, "at": 0}, "unsinn", {}], 1) == []


def test_empfaenger_sind_die_gewaehlten_namen():
    assert empfaenger({"push_an": ["Stefan", " Bine ", ""]}) == ["Stefan", "Bine"]
    # Leer heisst «alle» - die Entscheidung trifft der Versand.
    assert empfaenger({}) == []
    assert empfaenger({"push_an": "Stefan"}) == []


def test_nach_dem_versand_ist_nur_push_erledigt():
    rows = [
        # Push und Bildschirm: bleibt offen, bis jemand bestätigt.
        {"id": "a", "at": 1, "push": True, "anzeigen": True},
        # Nur Push: erledigt - es gibt keinen Schirm, der bestätigen könnte.
        {"id": "b", "at": 1, "push": True, "anzeigen": False},
        # Ohne Angabe gilt anzeigen - alte Einträge kennen das Feld nicht.
        {"id": "c", "at": 1, "push": True},
        {"id": "d", "at": 9, "push": True},  # nicht dabei
    ]
    neue = nach_versand(rows, {"a", "b", "c"})
    je_id = {row["id"]: row for row in neue}
    assert je_id["a"]["pushed"] is True and "done" not in je_id["a"]
    assert je_id["b"]["done"] is True
    assert je_id["c"].get("done") is None or "done" not in je_id["c"]
    assert "pushed" not in je_id["d"]


def test_quittieren_traegt_den_namen_einmal_ein():
    """Punkt 606: «Erledigt» von der Sperrbildschirm-Karte - idempotent,
    ein zweiter Tipp verdoppelt den Namen nicht."""
    from homepilot.core.erinnerungen import quittieren

    rows = [{"id": "a", "quittiert": ["Bine"]}, {"id": "b"}]
    neue, gefunden = quittieren(rows, "a", "Stefan")
    assert gefunden and neue[0]["quittiert"] == ["Bine", "Stefan"]
    neue, _ = quittieren(neue, "a", "Stefan")
    assert neue[0]["quittiert"] == ["Bine", "Stefan"]
    assert neue[1] == {"id": "b"}
    _, gefunden = quittieren(rows, "gibt-es-nicht", "Stefan")
    assert gefunden is False


def test_spaeter_stellt_die_erinnerung_frisch_nach_hinten():
    from homepilot.core.erinnerungen import verschieben

    rows = [{"id": "a", "at": 1000, "quittiert": ["Bine"], "pushed": True}]
    neue, gefunden = verschieben(rows, "a", 5000, 30)
    assert gefunden
    assert neue[0]["at"] == 5000 + 30 * 60_000
    # Frisch: niemand hat sie gesehen, der Push geht wieder raus.
    assert neue[0]["quittiert"] == [] and neue[0]["pushed"] is False


def test_benutzer_umbenennen_zieht_empfaenger_und_quittierungen_mit():
    """Ein Push an den alten Namen erreicht niemanden, und eine schon
    weggedrückte Erinnerung erschiene wieder - beides zieht mit um."""
    from homepilot.core.erinnerungen import benutzer_umbenennen

    rows = [
        {"id": "a", "push_an": ["Stefan", "Bine"], "quittiert": ["Stefan"]},
        {"id": "b", "push_an": ["Bine"]},
        "kaputt",
    ]
    neu = benutzer_umbenennen(rows, "Stefan", "Stefano")
    assert neu[0]["push_an"] == ["Stefano", "Bine"]
    assert neu[0]["quittiert"] == ["Stefano"]
    assert neu[1]["push_an"] == ["Bine"]
    assert neu[2] == "kaputt"
    # Die Eingabe bleibt unangetastet - der Aufrufer speichert das Ergebnis.
    assert rows[0]["push_an"] == ["Stefan", "Bine"]


def test_naechste_faelligkeit_ueberspringt_verpasstes_und_kennt_den_kalender():
    """Das Spiegelbild der App-Funktion - beide Seiten müssen denselben
    Termin ausrechnen, sonst stellt der Hub anders weiter als die App."""
    from datetime import datetime

    from homepilot.core.erinnerungen import naechste_faelligkeit

    def um(j, m, t, h=7):
        return datetime(j, m, t, h).timestamp() * 1000

    # Dienstag 7:00, erst am Freitagmittag bestätigt: Samstag 7:00 -
    # nicht drei nachgeholte auf einmal.
    assert naechste_faelligkeit(um(2026, 8, 25), "daily", um(2026, 8, 28, 12)) == um(
        2026, 8, 29
    )
    # Der 31. rutscht im Februar auf den 28. und kehrt danach zurück.
    assert naechste_faelligkeit(um(2026, 1, 31), "monthly", um(2026, 1, 31)) == um(
        2026, 2, 28
    )
    assert naechste_faelligkeit(um(2026, 1, 31), "monthly", um(2026, 2, 28, 8)) == um(
        2026, 3, 31
    )
    assert naechste_faelligkeit(um(2028, 2, 29), "yearly", um(2028, 2, 29)) == um(
        2029, 2, 28
    )
    # Unbekannte Wiederholung oder kaputter Zeitpunkt: kein Termin.
    assert naechste_faelligkeit(um(2026, 8, 25), "none", 0) is None
    assert naechste_faelligkeit("quatsch", "daily", 0) is None


def test_eine_wiederkehrende_nur_push_erinnerung_stellt_sich_selbst_weiter():
    """Ohne Bildschirm bestätigt niemand - nach dem Versand stellt der
    Hub selbst weiter, frisch, damit der nächste Push wieder rausgeht."""
    from datetime import datetime

    from homepilot.core.erinnerungen import nach_versand

    jetzt = datetime(2026, 8, 27, 8).timestamp() * 1000
    rows = [
        {
            "id": "a",
            "at": datetime(2026, 8, 27, 7).timestamp() * 1000,
            "anzeigen": False,
            "push": True,
            "repeat": "daily",
            "quittiert": ["Stefan"],
        },
        # Mit Bildschirm: nur pushed - weitergestellt wird beim Bestätigen.
        {
            "id": "b",
            "at": 1000.0,
            "anzeigen": True,
            "push": True,
            "repeat": "daily",
        },
    ]
    neu = nach_versand(rows, {"a", "b"}, jetzt_ms=jetzt)
    assert neu[0]["at"] == datetime(2026, 8, 28, 7).timestamp() * 1000
    assert neu[0]["pushed"] is False
    assert neu[0]["quittiert"] == []
    assert "done" not in neu[0]
    assert neu[1] == {**rows[1], "pushed": True}


async def test_zwei_gleichzeitig_faellige_geben_zwei_getrennte_pushes():
    """Zwei Erinnerungen zur selben Minute sind zwei Nachrichten - keine
    Sammelmeldung «2 Erinnerungen»: Jede trägt ihren eigenen Satz, und
    auf dem Sperrbildschirm sollen beide einzeln stehen (und einzeln
    weggewischt werden können)."""
    from homepilot.core import erinnerungen as modul
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t"}],
            integrations=[{"integration": "demo"}],
        )
    )
    await hub.start()
    try:
        hub.push.register("ExponentPushToken[x]", "Stefan")
        jetzt_ms = time.time() * 1000
        hub.data.set(
            "family_reminders",
            [
                {"id": "a", "text": "Zahnarzt anrufen", "at": jetzt_ms - 1000, "push": True},
                {"id": "b", "text": "Pflanzen giessen", "at": jetzt_ms - 500, "push": True},
            ],
        )
        gesendet: list[tuple[str, str]] = []

        async def fake_send(tokens, title, body, data=None, **_):
            gesendet.append((title, body))

            class R:
                accepted = len(tokens)
                errors: list[str] = []
                ticket_ids: list[str] = []

            return R()

        hub.push.send = fake_send  # type: ignore[assignment]
        await modul._runde(hub)
        assert [body for _, body in gesendet] == [
            "Zahnarzt anrufen",
            "Pflanzen giessen",
        ]
    finally:
        await hub.stop()


async def test_der_erinnerungs_push_traegt_kategorie_und_ziel():
    """Punkt 603: Ohne Kategorie lief die Erinnerung an allem vorbei, was
    Push kann - kein «Später», kein Ziel, keine Zeile in den
    Einstellungen. Jetzt geht sie als «reminder» mit dem Sprung zur
    Liste und ihrer eigenen Kennung."""
    from homepilot.core import erinnerungen as modul
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t"}],
            integrations=[{"integration": "demo"}],
        )
    )
    await hub.start()
    try:
        hub.push.register("ExponentPushToken[x]", "Stefan")
        hub.data.set(
            "family_reminders",
            [{"id": "a", "text": "Zahnarzt anrufen", "at": time.time() * 1000 - 1000, "push": True}],
        )
        gesendet: list[dict] = []

        async def fake_send(tokens, title, body, data=None, category=None, **_):
            gesendet.append({"tokens": tokens, "data": data, "category": category})

            class R:
                accepted = len(tokens)

            return R()

        hub.push.send = fake_send  # type: ignore[assignment]
        await modul._runde(hub)
        assert gesendet[0]["category"] == "reminder"
        assert gesendet[0]["data"] == {"ziel": "familie:reminders", "reminder_id": "a"}
        assert gesendet[0]["tokens"] == ["ExponentPushToken[x]"]
    finally:
        await hub.stop()


async def test_wer_erinnerungen_abbestellt_hat_bekommt_keine():
    """Die Zeile in den Push-Einstellungen, die es vorher nicht gab."""
    from homepilot.core import erinnerungen as modul
    from homepilot.core.hub import Hub

    from .conftest import make_config

    hub = Hub(
        make_config(
            users=[{"name": "Stefan", "role": "besitzer", "token": "t"}],
            integrations=[{"integration": "demo"}],
        )
    )
    await hub.start()
    try:
        hub.push.register("ExponentPushToken[x]", "Stefan")
        hub.push.muted = {"Stefan": {"reminder"}}
        hub.data.set(
            "family_reminders",
            [{"id": "a", "text": "Zahnarzt anrufen", "at": time.time() * 1000 - 1000, "push": True}],
        )
        gesendet: list[list[str]] = []

        async def fake_send(tokens, title, body, **_):
            gesendet.append(tokens)

            class R:
                accepted = 0

            return R()

        hub.push.send = fake_send  # type: ignore[assignment]
        await modul._runde(hub)
        assert gesendet == [[]]
    finally:
        await hub.stop()
