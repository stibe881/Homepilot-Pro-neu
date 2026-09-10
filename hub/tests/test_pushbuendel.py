"""Eine Nachricht statt sieben - was eine Wächter-Runde zusammenfasst.

Der Anlass steht im Haus: An einem Morgen kamen alle Meldungen des
Saugroboters auf einmal. Die Ursache ist behoben, die Form des Fehlers
bleibt - eine Runde prüft alles auf einmal, und drei offene Fenster sind
drei Vibrationen hintereinander.
"""

from __future__ import annotations

from homepilot.core import pushbuendel
from homepilot.core.push import CATEGORIES


def fenster(raum: str) -> dict:
    return {
        "title": f"Fenster {raum} steht offen",
        "body": "Seit 2 Stunden offen.",
        "category": "open",
        "to": None,
        "entity_id": f"hm.fenster_{raum.lower()}",
    }


def test_eine_meldung_bleibt_wie_sie_war() -> None:
    """Der Normalfall. «1 × Fenster/Tür steht offen» wäre eine
    Verschlechterung um der Regelmässigkeit willen."""
    eine = [fenster("Bad")]
    assert pushbuendel.buendeln(eine) == eine


def test_drei_fenster_werden_eine_nachricht() -> None:
    raus = pushbuendel.buendeln([fenster("Bad"), fenster("Küche"), fenster("WC")])
    assert len(raus) == 1
    assert raus[0]["title"] == "3 × Fenster/Tür steht offen"
    assert "Fenster Bad steht offen" in raus[0]["body"]
    assert "Fenster WC steht offen" in raus[0]["body"]


def test_ein_buendel_fuehrt_nicht_an_ein_geraet() -> None:
    """Es hat keines: «Passt so» würde eine von drei Öffnungen
    quittieren, und niemand wüsste welche."""
    raus = pushbuendel.buendeln([fenster("Bad"), fenster("Küche")])
    assert raus[0]["entity_id"] is None
    assert raus[0]["data"] == {"gebuendelt": 2}


def test_die_klingel_wird_nie_gebuendelt() -> None:
    """Zweimal klingeln in einer Minute sind zwei Besucher - und «2
    Meldungen: Es klingelt» sagt einem nicht, dass man zweimal
    aufmachen muss."""
    zweimal = [
        {"title": "Es klingelt", "body": "", "category": "doorbell", "to": None},
        {"title": "Es klingelt", "body": "", "category": "doorbell", "to": None},
    ]
    assert pushbuendel.buendeln(zweimal) == zweimal


def test_verschiedene_empfaenger_bleiben_getrennt() -> None:
    """Sonst landete Linas Erinnerung in einer Nachricht mit Bines - an
    beide."""
    raus = pushbuendel.buendeln(
        [
            {"title": "Ämtli A", "body": "", "category": "tasks", "to": "Lina"},
            {"title": "Ämtli B", "body": "", "category": "tasks", "to": "Lina"},
            {"title": "Ämtli C", "body": "", "category": "tasks", "to": "Bine"},
        ]
    )
    assert len(raus) == 2
    assert raus[0]["title"] == "2 × Fällige Aufgaben"
    assert raus[1]["title"] == "Ämtli C"


def test_die_reihenfolge_bleibt() -> None:
    """Das Bündel steht dort, wo seine erste Meldung stand - sonst käme
    die Sammelmeldung über die Fenster nach der einen über das Wasser,
    bloss weil dort mehr zusammenkam."""
    raus = pushbuendel.buendeln(
        [
            fenster("Bad"),
            {"title": "Wasser gemeldet", "body": "", "category": "leak", "to": None},
            fenster("Küche"),
        ]
    )
    assert [zeile["title"] for zeile in raus] == [
        "2 × Fenster/Tür steht offen",
        "Wasser gemeldet",
    ]


def test_lange_listen_werden_gezaehlt_statt_aufgezaehlt() -> None:
    raus = pushbuendel.buendeln([fenster(f"R{n}") for n in range(9)])
    assert raus[0]["title"] == "9 × Fenster/Tür steht offen"
    assert raus[0]["body"].endswith("… und 5 weitere")
    assert raus[0]["body"].count("\n") == pushbuendel.ZEILEN


def test_buendelbar_kennt_nur_echte_kategorien() -> None:
    assert set(CATEGORIES) >= pushbuendel.BUENDELBAR


def test_ein_ablauf_bleibt_ein_einzelstueck() -> None:
    """Seinen Text hat jemand genau so formuliert."""
    assert not pushbuendel.buendelbar("automation:gefriertruhe")


async def test_der_waechter_buendelt_eine_ganze_runde(hub) -> None:
    """Der eigentliche Fall: In einer Runde fällt mehreres derselben Art
    an, und daraus wird eine Nachricht statt drei.

    Über `check()` und nicht über `buendeln()` allein - der Eimer und
    sein Leeren gehören zur Zusage, und genau dort kann man sie
    verlieren (etwa, wenn eine Prüfung dazwischen stolpert).
    """
    gesendet: list[str] = []

    async def sammeln(tokens, title, body, data=None, **_):
        gesendet.append(title)

    hub.push.send = sammeln
    waechter = hub.watchdog

    async def drei_fenster() -> None:
        for raum in ("Bad", "Küche", "WC"):
            await waechter._notify(
                f"Fenster {raum} steht offen", "Seit 2 Stunden.", category="open"
            )

    waechter._runde = drei_fenster
    await waechter.check()

    assert gesendet == ["3 × Fenster/Tür steht offen"]


async def test_der_eimer_wird_auch_nach_einem_fehler_geleert(hub) -> None:
    """Sonst hinge die Meldung über den Wasserschaden an einem Fehler in
    der Gutschein-Erinnerung."""
    gesendet: list[str] = []

    async def sammeln(tokens, title, body, data=None, **_):
        gesendet.append(title)

    hub.push.send = sammeln
    waechter = hub.watchdog

    async def stolpern() -> None:
        await waechter._notify("Wasser gemeldet", "Waschküche", category="leak")
        raise RuntimeError("die Gutschein-Erinnerung fällt um")

    waechter._runde = stolpern
    try:
        await waechter.check()
    except RuntimeError:
        pass

    assert gesendet == ["Wasser gemeldet"]
