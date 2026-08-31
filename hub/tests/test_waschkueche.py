"""Nachhaken, bis jemand in der Waschküche war.

Die Wäsche lag über Nacht in der Trommel: Die Meldung «noch voll» kam
genau einmal, am Abend, und danach nie wieder. Wiederholen darf man sie
nur, wenn es ein Zeichen gibt, das sie beendet - hier die Türe.
"""

import time
from types import SimpleNamespace

import pytest

from homepilot.core import waschkueche
from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub


def kontakt(eid, label, *, klasse="door", zustand="off", raum=None):
    return SimpleNamespace(
        id=eid,
        label=label,
        name=label,
        kind="binary_sensor",
        integration="zigbee2mqtt",
        available=True,
        room=raum,
        state={"device_class": klasse, "state": zustand},
    )


def tag(stunde: int, minute: int = 0, tag_im_monat: int = 12) -> float:
    """Ein Zeitpunkt im März 2026 - Ortszeit, wie der Wächter rechnet."""
    return time.mktime((2026, 3, tag_im_monat, stunde, minute, 0, 0, 0, -1))


# ── Welche Türe ──────────────────────────────────────────────────────────


def test_der_kontakt_im_raum_waschkueche_wird_von_selbst_gefunden():
    entities = [
        kontakt("z.a", "Kontakt 1", raum="Küche"),
        kontakt("z.b", "Kontakt 2", raum="Waschküche"),
    ]
    assert waschkueche.raten(entities) == "z.b"


def test_ohne_raum_entscheidet_der_geraetename():
    entities = [kontakt("z.a", "Küchenfenster"), kontakt("z.b", "Tür Waschküche")]
    assert waschkueche.raten(entities) == "z.b"


def test_ein_keller_ist_noch_keine_waschkueche():
    """Im Keller hängt auch die Aussentüre - die geht auf, ohne dass
    jemand an der Wäsche war."""
    assert waschkueche.raten([kontakt("z.a", "Kellertüre", raum="Keller")]) is None


def test_bewegungsmelder_stehen_nicht_zur_wahl():
    melder = SimpleNamespace(
        id="z.m",
        label="Bewegung Waschküche",
        kind="binary_sensor",
        room="Waschküche",
        state={"device_class": "motion", "state": "off"},
    )
    assert waschkueche.kandidaten([melder]) == []
    assert waschkueche.raten([melder]) is None


def test_die_gewaehlte_tuere_sticht_die_geratene():
    entities = [kontakt("z.a", "Vorratsraum"), kontakt("z.b", "Waschküche")]
    assert waschkueche.tuer(entities, "z.a").id == "z.a"


def test_eine_verschwundene_wahl_faellt_auf_die_vermutung_zurueck():
    """Nach einem Batteriewechsel kann ein Zigbee-Gerät eine neue Id
    bekommen. Dann hörte das Nachhaken sonst stillschweigend auf."""
    entities = [kontakt("z.neu", "Waschküche")]
    assert waschkueche.tuer(entities, "z.alt").id == "z.neu"


def test_ohne_kandidaten_gibt_es_keine_tuere():
    assert waschkueche.tuer([], "z.a") is None


# ── Wann gemahnt wird ────────────────────────────────────────────────────


def test_die_erste_mahnung_kommt_nach_der_eingestellten_zeit():
    fertig = tag(14)
    assert not waschkueche.faellig(fertig, 0, tag(15), 2, nachhaken=True)
    assert waschkueche.faellig(fertig, 0, tag(16), 2, nachhaken=True)


def test_danach_wird_im_stundentakt_nachgehakt():
    fertig = tag(13)
    # Erste um 15 Uhr, zweite um 16 Uhr - dazwischen ist nichts fällig.
    assert not waschkueche.faellig(fertig, 1, tag(15, 30), 2, nachhaken=True)
    assert waschkueche.faellig(fertig, 1, tag(16), 2, nachhaken=True)


def test_ohne_tuere_bleibt_es_bei_der_einen_nachricht():
    """Eine Erinnerung, die sich nicht beenden lässt, schaltet man ganz
    ab - und dann fehlt auch die erste."""
    fertig = tag(13)
    assert waschkueche.faellig(fertig, 0, tag(15), 2, nachhaken=False)
    assert not waschkueche.faellig(fertig, 1, tag(17), 2, nachhaken=False)


def test_irgendwann_ist_auch_mit_tuere_schluss():
    fertig = tag(9)
    assert not waschkueche.faellig(fertig, waschkueche.HOECHSTENS, tag(20), 2, True)


def test_nachts_kommt_gar_nichts():
    """Auch die erste Nachricht nicht.

    Lange ging sie trotzdem raus. Aber nachts wäscht in diesem Haushalt
    niemand: Was um halb zwölf ankommt, weckt jemanden und ändert
    nichts - die Trommel räumt um zwei Uhr keiner aus.
    """
    assert not waschkueche.faellig(tag(21), 0, tag(23), 2, nachhaken=True)
    assert not waschkueche.faellig(tag(20), 1, tag(6, 0, 13), 2, nachhaken=True)


def test_am_morgen_steht_sie_dann_da():
    """Still heisst nicht weg: Um acht ist die Nachricht fällig, und sie
    rechnet die Stunden seit dem Programmende."""
    assert not waschkueche.faellig(tag(21), 0, tag(7, 30, 13), 2, nachhaken=True)
    assert waschkueche.faellig(tag(21), 0, tag(8, 5, 13), 2, nachhaken=True)
    _, text = waschkueche.mahnsatz("Tumbler", tag(21), tag(8, 5, 13), 0)
    assert "11 Stunden" in text


def test_nach_der_nacht_kommen_nicht_alle_mahnungen_auf_einmal():
    """Der Abstand zählt ab der letzten Mahnung.

    Ab dem Programmende gerechnet wären um acht Uhr alle vier
    liegengebliebenen Mahnungen fällig - das Telefon klingelte viermal
    innert vier Minuten.
    """
    fertig, letzte = tag(20), tag(21)
    assert not waschkueche.faellig(
        fertig, 1, tag(8, 5, 13), 2, nachhaken=True, zuletzt=tag(8, 0, 13)
    )
    assert waschkueche.faellig(
        fertig, 1, tag(9, 5, 13), 2, nachhaken=True, zuletzt=tag(8, 0, 13)
    )
    # Ohne diesen Zeitpunkt bleibt es bei der alten Rechnung.
    assert waschkueche.faellig(fertig, 1, tag(8, 5, 13), 2, nachhaken=True)
    assert letzte < tag(8, 0, 13)


def test_das_fenster_laesst_sich_verstellen_und_abschalten():
    """Beide Zahlen stehen in der Push-Regel.

    Gleiche Werte heben die Nachtruhe auf - sonst hiesse «ab 22 bis 22
    Uhr» rund um die Uhr still, und niemand fände heraus, warum nichts
    mehr kommt.
    """
    assert waschkueche.ruhezeit(tag(23), 22, 8)
    assert not waschkueche.ruhezeit(tag(9), 22, 8)
    # Ein Fenster ohne Mitternacht darin: «ab 0 bis 8» wäre mit dem
    # Oder-Vergleich rund um die Uhr still - jede Stunde ist >= 0.
    assert waschkueche.ruhezeit(tag(3), 0, 8)
    assert not waschkueche.ruhezeit(tag(23), 0, 8)
    assert not waschkueche.ruhezeit(tag(3), 22, 22)
    assert waschkueche.faellig(tag(21), 0, tag(23), 2, True, ruhe_von=0, ruhe_bis=0)


# ── Was drinsteht ────────────────────────────────────────────────────────


def test_die_erste_nachricht_nennt_die_dauer():
    titel, text = waschkueche.mahnsatz("Waschmaschine", tag(14), tag(16), 0)
    assert titel == "Waschmaschine ist noch voll"
    assert "2 Stunden" in text


def test_die_wiederholung_sagt_auch_warum_sie_wiederkommt():
    """Sonst liest sie sich wie ein Fehler der App."""
    titel, text = waschkueche.mahnsatz("Tumbler", tag(14), tag(17), 1)
    assert titel == "Tumbler ist immer noch voll"
    assert "niemand in der Waschküche" in text


def test_eine_stunde_bleibt_einzahl():
    _, text = waschkueche.mahnsatz("Waschmaschine", tag(14), tag(15), 0)
    assert "1 Stunde " in text


# ── Die Türe selbst ──────────────────────────────────────────────────────


def test_offen_ist_offen():
    assert waschkueche.ist_offen(kontakt("z.a", "Waschküche", zustand="on"))
    assert not waschkueche.ist_offen(kontakt("z.a", "Waschküche"))
    assert not waschkueche.ist_offen(None)


# ── Und im Wächter ───────────────────────────────────────────────────────


def maschine():
    return type(
        "E",
        (),
        {
            "id": "vzug.waschmaschine",
            "name": "Waschmaschine",
            "label": "Waschmaschine",
            "kind": "appliance",
            "integration": "vzug",
            "available": True,
            "room": "Waschküche",
            "state": {"state": "running"},
        },
    )()


@pytest.fixture
def tagsueber(monkeypatch):
    """Die Nachtruhe aushängen.

    Die Prüfung läuft, wann sie läuft - um 23 Uhr käme gar keine
    Nachricht mehr, und der Test schlüge nur nachts fehl. Gehängt wird
    an ``ruhezeit`` selbst und nicht an die beiden Zahlen: Die stehen
    inzwischen in der Push-Regel, und ein Test, der die eine Quelle
    verstellt, während der Wächter aus der anderen liest, prüft nichts.
    Das Zeitfenster selbst prüfen die Tests weiter oben.
    """
    monkeypatch.setattr(waschkueche, "ruhezeit", lambda *_, **__: False)


def zeit_vor(hub, entity_id: str, sekunden: float) -> None:
    """Den Programmlauf um so viele Sekunden nach hinten schieben.

    Der Test hat keine Uhr, die er stellen kann, und schiebt stattdessen
    das Programmende. Alles, was auf diesen Lauf zeigt, muss mitwandern -
    sonst prüft der Test einen Fall, den es im Haus nicht gibt: Der
    Wächter setzt diese Zeitpunkte einmal und rührt sie danach nicht
    mehr an. Das gilt für die Übernahme («Bine räumt aus») ebenso wie
    für den Zeitpunkt der letzten Mahnung, an dem der Abstand hängt.
    """
    hub.watchdog._finished_at[entity_id] -= sekunden
    if entity_id in hub.watchdog._gemahnt_at:
        hub.watchdog._gemahnt_at[entity_id] -= sekunden
    eintraege = hub.data.get("laundry_claims")
    for eintrag in eintraege:
        if eintrag.get("entity_id") == entity_id:
            eintrag["seit"] -= sekunden
    hub.data.set("laundry_claims", eintraege)


async def _hub_mit(entities, sent):
    hub = Hub(HubConfig(api=ApiConfig(), integrations=[{"integration": "demo"}]))
    await hub.start()

    async def fake_send(tokens, title, body, data=None, **_):
        sent.append(title)
        return len(tokens)

    hub.push.send = fake_send  # type: ignore[assignment]
    hub.push.register("ExponentPushToken[x]", "Stefan")
    hub.registry.all = lambda: entities  # type: ignore[assignment]
    return hub


async def test_ohne_tuere_bleibt_es_beim_einen_hinweis(tagsueber):
    """So war es immer - und ohne ein Zeichen, dass jemand da war, darf
    es auch nicht mehr werden."""
    sent: list[str] = []
    wm = maschine()
    hub = await _hub_mit([wm], sent)
    try:
        await hub.watchdog.check()
        wm.state = {"state": "idle"}
        await hub.watchdog.check()
        for _ in range(4):
            zeit_vor(hub, "vzug.waschmaschine", 2 * 3600)
            await hub.watchdog.check()
        assert len([t for t in sent if "voll" in t]) == 1
    finally:
        await hub.stop()


async def test_mit_tuere_wird_nachgehakt(tagsueber):
    sent: list[str] = []
    wm = maschine()
    tuere = kontakt("z.wk", "Waschküche", raum="Waschküche")
    hub = await _hub_mit([wm, tuere], sent)
    try:
        await hub.watchdog.check()
        wm.state = {"state": "idle"}
        await hub.watchdog.check()
        zeit_vor(hub, "vzug.waschmaschine", 2 * 3600)
        await hub.watchdog.check()
        zeit_vor(hub, "vzug.waschmaschine", 3600)
        await hub.watchdog.check()
        assert [t for t in sent if "voll" in t] == [
            "Waschmaschine ist noch voll",
            "Waschmaschine ist immer noch voll",
        ]
    finally:
        await hub.stop()


async def test_wer_in_der_waschkueche_war_hoert_nichts_mehr(tagsueber):
    sent: list[str] = []
    wm = maschine()
    tuere = kontakt("z.wk", "Waschküche", raum="Waschküche")
    hub = await _hub_mit([wm, tuere], sent)
    try:
        await hub.watchdog.check()
        wm.state = {"state": "idle"}
        await hub.watchdog.check()
        zeit_vor(hub, "vzug.waschmaschine", 2 * 3600)
        await hub.watchdog.check()
        before = len(sent)

        # Jemand geht hinein.
        tuere.state = {"device_class": "door", "state": "on"}
        await hub.watchdog.check()
        tuere.state = {"device_class": "door", "state": "off"}
        for _ in range(3):
            await hub.watchdog.check()
        assert len(sent) == before
    finally:
        await hub.stop()


async def test_eine_offen_stehende_tuere_zaehlt_nur_einmal(tagsueber):
    """Sonst hiesse jede Runde «war jemand da», und das Nachhaken wäre
    tot, sobald jemand die Türe offen lässt."""
    sent: list[str] = []
    wm = maschine()
    tuere = kontakt("z.wk", "Waschküche", raum="Waschküche", zustand="on")
    hub = await _hub_mit([wm, tuere], sent)
    try:
        await hub.watchdog.check()
        wm.state = {"state": "idle"}
        await hub.watchdog.check()
        zeit_vor(hub, "vzug.waschmaschine", 2 * 3600)
        await hub.watchdog.check()
        assert any("voll" in t for t in sent)
    finally:
        await hub.stop()


async def test_die_gewaehlte_tuere_gilt_auch_im_waechter(tagsueber):
    sent: list[str] = []
    wm = maschine()
    falsch = kontakt("z.wk", "Waschküche", raum="Waschküche")
    richtig = kontakt("z.tuer", "Kellerabgang", raum="Keller")
    hub = await _hub_mit([wm, falsch, richtig], sent)
    try:
        hub.data.set("laundry", [{"door": "z.tuer"}])
        await hub.watchdog.check()
        wm.state = {"state": "idle"}
        await hub.watchdog.check()
        zeit_vor(hub, "vzug.waschmaschine", 2 * 3600)
        await hub.watchdog.check()
        before = len(sent)

        # Die geratene Türe zählt nicht mehr ...
        falsch.state = {"device_class": "door", "state": "on"}
        zeit_vor(hub, "vzug.waschmaschine", 3600)
        await hub.watchdog.check()
        assert len(sent) > before

        # ... die gewählte schon.
        before = len(sent)
        richtig.state = {"device_class": "door", "state": "on"}
        await hub.watchdog.check()
        for _ in range(3):
            await hub.watchdog.check()
        assert len(sent) == before
    finally:
        await hub.stop()


# ── «Ich mach's» ─────────────────────────────────────────────────────────


def test_die_uebernahme_gehoert_zu_einem_lauf_und_nicht_zum_geraet():
    """Sonst hätte ein «Ich mach's» von letzter Woche die Erinnerungen
    für immer abgestellt."""
    eintrag = {"name": "Bine", "seit": 1000.0}
    assert waschkueche.uebernahme_gilt(eintrag, 1000.0)
    assert not waschkueche.uebernahme_gilt(eintrag, 2000.0)
    assert not waschkueche.uebernahme_gilt(eintrag, None)
    assert not waschkueche.uebernahme_gilt(None, 1000.0)
    assert not waschkueche.uebernahme_gilt({"name": "Bine"}, 1000.0)


def test_am_geraet_steht_ein_name_und_kein_haken():
    # Die Frage im Kopf ist «muss ich?», und darauf antwortet nur ein Name.
    assert waschkueche.uebernahmesatz("Bine") == "Bine räumt aus"
    assert waschkueche.uebernahmesatz("  ") == "Jemand räumt aus"


async def test_wer_uebernimmt_hoert_nichts_mehr(tagsueber):
    sent: list[str] = []
    wm = maschine()
    tuere = kontakt("z.wk", "Waschküche", raum="Waschküche")
    hub = await _hub_mit([wm, tuere], sent)
    try:
        await hub.watchdog.check()
        wm.state = {"state": "idle"}
        await hub.watchdog.check()
        zeit_vor(hub, "vzug.waschmaschine", 2 * 3600)
        await hub.watchdog.check()
        assert len([t for t in sent if "voll" in t]) == 1

        assert await hub.watchdog.uebernehmen("vzug.waschmaschine", "Bine")
        for _ in range(4):
            zeit_vor(hub, "vzug.waschmaschine", 3600)
            await hub.watchdog.check()
        # Nachzuhaken hiesse, ihr zu misstrauen.
        assert len([t for t in sent if "voll" in t]) == 1
    finally:
        await hub.stop()


async def test_die_naechste_ladung_faengt_wieder_bei_null_an(tagsueber):
    sent: list[str] = []
    wm = maschine()
    tuere = kontakt("z.wk", "Waschküche", raum="Waschküche")
    hub = await _hub_mit([wm, tuere], sent)
    try:
        await hub.watchdog.check()
        wm.state = {"state": "idle"}
        await hub.watchdog.check()
        zeit_vor(hub, "vzug.waschmaschine", 2 * 3600)
        await hub.watchdog.check()
        await hub.watchdog.uebernehmen("vzug.waschmaschine", "Bine")

        # Die Maschine läuft wieder - die Übernahme von vorhin ist damit
        # erledigt und darf die nächste Ladung nicht mit abdecken.
        wm.state = {"state": "running"}
        await hub.watchdog.check()
        assert hub.data.get("laundry_claims") == []
        wm.state = {"state": "idle"}
        await hub.watchdog.check()
        zeit_vor(hub, "vzug.waschmaschine", 2 * 3600)
        await hub.watchdog.check()
        assert len([t for t in sent if "voll" in t]) == 2
    finally:
        await hub.stop()


async def test_wer_unten_war_beendet_auch_die_uebernahme(tagsueber):
    """«Bine räumt aus» am Gerät stehen zu lassen, nachdem sie
    ausgeräumt hat, wäre eine Auskunft von gestern."""
    sent: list[str] = []
    wm = maschine()
    tuere = kontakt("z.wk", "Waschküche", raum="Waschküche")
    hub = await _hub_mit([wm, tuere], sent)
    try:
        await hub.watchdog.check()
        wm.state = {"state": "idle"}
        await hub.watchdog.check()
        zeit_vor(hub, "vzug.waschmaschine", 2 * 3600)
        await hub.watchdog.check()
        await hub.watchdog.uebernehmen("vzug.waschmaschine", "Bine")
        assert hub.data.get("laundry_claims") != []

        tuere.state = {"device_class": "door", "state": "on"}
        await hub.watchdog.check()
        assert hub.data.get("laundry_claims") == []
    finally:
        await hub.stop()


async def test_nichts_zu_uebernehmen_ist_kein_fehler():
    """Der Normalfall bei einem späten Druck auf eine überholte
    Nachricht: Die Maschine läuft wieder, oder jemand war schon unten.
    Dann soll nichts gemerkt werden, was gleich falsch wäre."""
    sent: list[str] = []
    hub = await _hub_mit([maschine()], sent)
    try:
        assert not await hub.watchdog.uebernehmen("vzug.waschmaschine", "Bine")
        assert hub.data.get("laundry_claims") == []
    finally:
        await hub.stop()
