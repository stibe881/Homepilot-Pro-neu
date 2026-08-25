"""Ring: der Weg, auf dem ein Klingeln hereinkommt.

Die übrigen Ring-Prüfungen stehen in test_new_integrations.py; hier
steht, was den Unterschied zwischen «sofort» und «zehn Sekunden später»
ausmacht - und warum man ihn von aussen bisher nicht sah.
"""

def test_ein_kanal_ueber_den_nichts_kommt_ist_keiner():
    """Der unangenehmste Fall: Alles sieht gut aus, und es klingelt zu spät.

    Die Anmeldung ging durch, der Push-Client sagt «läuft» - und trotzdem
    kommt jedes Klingeln erst über die Abfrage, also zehn Sekunden
    später. Bisher stand daneben «Klingeln kommt sofort an», und man
    suchte den Fehler überall ausser dort.
    """
    from homepilot.integrations.ring import health_detail, kanal_taub

    # Eine einzelne Meldung über die Abfrage ist normal - der Push kann
    # in dem Moment gerade unterwegs sein.
    assert kanal_taub(["push", "abfrage"]) is False
    assert kanal_taub(["abfrage"]) is False
    assert kanal_taub([]) is False
    # Zwei von vier: Der Kanal trägt nicht mehr.
    assert kanal_taub(["push", "abfrage", "abfrage"]) is True
    assert kanal_taub(["abfrage", "abfrage", "abfrage", "abfrage"]) is True
    # Und er erholt sich wieder.
    assert kanal_taub(["abfrage", "abfrage", "push", "push", "push", "push"]) is False

    text = health_detail(True, None, quellen=["abfrage", "abfrage"])
    assert "taub" in text
    assert "Abfrage" in text
    assert health_detail(True, None, quellen=["push", "push"]) == (
        "Ereigniskanal verbunden – Klingeln kommt sofort an"
    )


def test_nach_dem_neuladen_sagt_der_hub_nicht_kaputt():
    """Der Knopf lädt die Integration neu, der Kanal braucht Sekunden.

    «Nicht verbunden» wäre in diesem Moment wahr und trotzdem
    irreführend: Es sieht aus, als hätte das Neuladen ihn zerstört.
    """
    from homepilot.integrations.ring import health_detail

    text = health_detail(False, "Verbindung abgerissen", anlauf=True)
    assert "startet gerade" in text
    assert "nicht verbunden" not in text


# ── «Startet gerade» darf irgendwann aufhören ────────────────────────────
# Der Fall aus dem Betrieb: Im System-Bildschirm stand über Tage
# «Ereigniskanal startet gerade – in ein paar Sekunden steht fest, ob er
# hält». Es stand nie etwas fest. Jeder neue Anlauf setzte die Uhr
# zurück, und ein Kanal, der im Kreis lief, sah für immer aus wie einer,
# der gerade hochkommt.

import asyncio
import types


def _integration(**felder):
    """Eine Ring-Integration, gerade so weit gebaut wie nötig."""
    from homepilot.integrations.ring import RingIntegration

    integration = object.__new__(RingIntegration)
    integration._events_abgeschaltet = False
    integration._quellen = []
    integration._last_event = None
    integration._listen_error = None
    integration._listener = None
    integration._stored = {}
    integration._neu_registriert = False
    integration.log = types.SimpleNamespace(
        debug=lambda *a, **k: None,
        info=lambda *a, **k: None,
        warning=lambda *a, **k: None,
    )
    for name, wert in felder.items():
        setattr(integration, name, wert)
    return integration


def test_ein_anlauf_der_nicht_traegt_hoert_auf_startet_gerade_zu_sagen():
    import time

    jetzt = time.time()
    # Der allererste Anlauf darf es sagen.
    erster = _integration(_anlaeufe=0, _abbrueche=0, _anlauf_seit=jetzt)
    assert "startet gerade" in erster.health()["detail"]
    # Der zweite nicht mehr – auch wenn er gerade eben begonnen hat.
    zweiter = _integration(_anlaeufe=1, _abbrueche=0, _anlauf_seit=jetzt)
    text = zweiter.health()["detail"]
    assert "startet gerade" not in text
    assert zweiter.health()["ok"] is False


def test_wiederholte_anlaeufe_stehen_im_klartext():
    from homepilot.integrations.ring import health_detail

    text = health_detail(
        False,
        "mtalk.google.com:5228 ist vom Hub aus gesperrt – Firewall, Pi-hole oder VLAN?",
        anlaeufe=4,
    )
    assert "4 Anläufe" in text
    assert "5228" in text
    assert "startet gerade" not in text


# ── «Angemeldet» ist nicht «verbunden» ───────────────────────────────────
# start() meldet Erfolg, sobald die Anmeldung bei Ring durch ist. Ob
# darunter je eine Dauerverbindung zu Google zustande kommt, entscheidet
# sich erst danach – und genau die trägt das Klingeln.


class _Empfaenger:
    def __init__(self, laeuft: bool) -> None:
        self._laeuft = laeuft

    def is_started(self) -> bool:
        return self._laeuft


class _Zuhoerer:
    def __init__(self, laeuft: bool) -> None:
        self.started = True
        self._receiver = _Empfaenger(laeuft)


def _begleiten(integration, monkeypatch):
    async def sofort(_sekunden):
        return None

    from homepilot.integrations import ring as modul

    monkeypatch.setattr(modul.asyncio, "sleep", sofort)
    return asyncio.run(integration._kanal_begleiten())


def test_eine_anmeldung_ohne_dauerverbindung_gilt_nicht_als_verbunden(monkeypatch):
    integration = _integration(
        _anlaeufe=0, _abbrueche=0, _anlauf_seit=None, _events_ok=False
    )
    integration._listener = _Zuhoerer(laeuft=False)
    assert _begleiten(integration, monkeypatch) is False
    assert integration._events_ok is False
    # Und die Auskunft sagt nicht «verbunden».
    integration._anlaeufe = 1
    assert "verbunden – Klingeln kommt sofort" not in integration.health()["detail"]


def test_ein_kanal_der_wirklich_einloggt_gilt_als_verbunden(monkeypatch):
    integration = _integration(
        _anlaeufe=3, _abbrueche=0, _anlauf_seit=None, _events_ok=False
    )
    zuhoerer = _Zuhoerer(laeuft=True)
    integration._listener = zuhoerer

    from homepilot.integrations import ring as modul

    blicke = [0]

    async def sofort(_sekunden):
        blicke[0] += 1
        # Nach ein paar Blicken stirbt er – sonst liefe die Schleife ewig.
        if blicke[0] >= 3:
            zuhoerer._receiver = _Empfaenger(False)

    monkeypatch.setattr(modul.asyncio, "sleep", sofort)
    assert asyncio.run(integration._kanal_begleiten()) is True
    # Ein Kanal, der wirklich stand, setzt den Anlaufzähler zurück.
    assert integration._anlaeufe == 0
    # Und nach dem Abriss steht er nicht mehr.
    assert integration._events_ok is False


class _Genug(Exception):
    """Bricht die Endlosschleife des Zuhörers kontrolliert ab."""


def test_ein_durchlauf_ohne_dauerverbindung_meldet_nicht_verbunden(monkeypatch):
    """Der ganze Weg, so wie er im Haus abläuft.

    Ring nimmt die Anmeldung an, der Push-Client darunter kommt nie zu
    seiner Dauerverbindung – weil mtalk.google.com:5228 gesperrt ist,
    zum Beispiel. Bisher stand danach «Ereigniskanal verbunden» da: Der
    Erfolg der Anmeldung wurde für den Erfolg des Kanals gehalten.
    """
    from homepilot.integrations import ring as modul

    integration = _integration(
        _anlaeufe=0, _abbrueche=0, _anlauf_seit=None, _events_ok=False
    )

    async def try_listen(on_event, credentials):
        integration._listener = _Zuhoerer(laeuft=False)
        return True

    async def reachable():
        return {
            "android.clients.google.com": True,
            "fcm.googleapis.com": True,
            "mtalk.google.com": False,
        }

    async def stop_listener():
        integration._listener = None

    integration._try_listen = try_listen
    integration._reachable = reachable
    integration._stop_listener = stop_listener
    integration._handle_event = lambda *a, **k: None

    schlaefe = [0]

    async def sofort(_sekunden):
        schlaefe[0] += 1
        # Anlaufzeit + drei tote Blicke + Wartezeit vor dem nächsten
        # Anlauf: Danach ist alles passiert, worum es hier geht.
        if schlaefe[0] > modul.TOT_BESTAETIGUNGEN + 1:
            raise _Genug

    monkeypatch.setattr(modul.asyncio, "sleep", sofort)
    try:
        asyncio.run(integration._listen_loop())
    except _Genug:
        pass

    assert integration._events_ok is False
    assert integration._anlaeufe == 1
    text = integration.health()["detail"]
    assert "verbunden – Klingeln kommt sofort an" not in text
    assert "startet gerade" not in text
    # Und der Grund benennt den gesperrten Weg, nicht bloss «Fehler».
    assert "mtalk.google.com:5228" in text
    assert integration.health()["ok"] is False


# ── Die Gegensprechanlage hat jetzt auch ein Netz ────────────────────────
#
# Der gemeldete Fall: «Wenn jemand an der Haustüre klingelt, kommt gar
# keine Push mehr.» Die Klingel ist ein Ring Intercom, und der hängt in
# Rings API an einer eigenen Adressfamilie - in der Liste der aktiven
# Meldungen taucht er nicht auf. Fiel der Ereigniskanal aus, kam von ihm
# deshalb nicht etwa verspätet etwas, sondern gar nichts. Ausgerechnet
# an der Türe, an der es zählt.

from homepilot.integrations.ring import (
    INTERCOM_FRIST,
    INTERCOM_POLL_SECONDS,
    verlauf_dings,
    verlauf_hinweis,
)

JETZT = 1_700_000_000.0


def test_a_fresh_ding_from_the_history_counts():
    verlauf = [
        {"id": 77, "kind": "ding", "created_at": "2023-11-14T22:13:00+00:00"},
    ]
    frisch, gesehen = verlauf_dings(verlauf, set(), JETZT)
    assert [eintrag["id"] for eintrag in frisch] == [77]
    assert 77 in gesehen


def test_the_same_ding_is_reported_once():
    """Sonst käme dasselbe Klingeln alle fünf Sekunden erneut."""
    verlauf = [{"id": 77, "kind": "ding", "created_at": JETZT - 5}]
    frisch, gesehen = verlauf_dings(verlauf, set(), JETZT)
    assert len(frisch) == 1
    nochmal, _ = verlauf_dings(verlauf, gesehen, JETZT)
    assert nochmal == []


def test_yesterdays_ding_stays_quiet():
    """Beim Start des Hubs soll nicht das Klingeln von gestern eine
    Nachricht auslösen - gemerkt wird es trotzdem."""
    verlauf = [{"id": 77, "kind": "ding", "created_at": JETZT - INTERCOM_FRIST - 60}]
    frisch, gesehen = verlauf_dings(verlauf, set(), JETZT)
    assert frisch == []
    assert 77 in gesehen


def test_only_dings_not_every_entry():
    verlauf = [
        {"id": 1, "kind": "motion", "created_at": JETZT - 5},
        {"id": 2, "kind": "on_demand", "created_at": JETZT - 5},
        {"id": 3, "kind": "ding", "created_at": JETZT - 5},
    ]
    frisch, _ = verlauf_dings(verlauf, set(), JETZT)
    assert [eintrag["id"] for eintrag in frisch] == [3]


def test_the_history_survives_whatever_the_library_hands_over():
    """Je nach Fassung kommen Objekte statt dicts, und der Zeitstempel
    als Text, als Zahl oder gar nicht."""
    from datetime import UTC, datetime

    class Eintrag:
        def __init__(self, id, kind, created_at):
            self.id = id
            self.kind = kind
            self.created_at = created_at

    verlauf = [
        Eintrag(1, "ding", datetime.fromtimestamp(JETZT - 5, UTC)),
        Eintrag(2, "ding", JETZT - 5),
        Eintrag(3, "ding", "kein Datum"),
        Eintrag(4, "ding", None),
        "gar kein Eintrag",
    ]
    frisch, gesehen = verlauf_dings(verlauf, set(), JETZT)
    assert [eintrag["id"] for eintrag in frisch] == [1, 2]
    # Auch die unbrauchbaren sind gemerkt: Sonst würden sie bei jedem
    # Durchgang erneut geprüft.
    assert {1, 2, 3, 4} <= gesehen
    assert verlauf_dings(None, set(), JETZT) == ([], set())


def test_the_system_screen_says_the_intercom_is_covered():
    satz = verlauf_hinweis(["Haustüre"])
    assert "Haustüre" in satz
    assert f"{INTERCOM_POLL_SECONDS} s" in satz
    assert "ohne Ereigniskanal" in satz
    # Ohne Gegensprechanlage kein Zusatz - der wäre nur Lärm.
    assert verlauf_hinweis([]) == ""
