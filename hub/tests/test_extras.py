"""Was der Hub kann - und was ihm dafür fehlt.

Der Anlass: «Dieser Knopf funktioniert nicht.» Es war der Knopf für eine
eigene Durchsage, und dem Hub fehlte gTTS. Erfahren hat man das erst
beim Scheitern.
"""

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core import extras
from homepilot.core.hub import Hub

from .conftest import make_config


def zeilen(**echt: bool):
    """Der Stand, aber mit gesetzten Installationsflaggen.

    Was auf diesem Rechner tatsächlich installiert ist, darf den Test
    nicht bestimmen - sonst prüft er die Entwicklungsumgebung.
    """
    stand = extras.stand({"google_cast", "roborock"})
    for zeile in stand:
        zeile["installed"] = echt.get(zeile["key"], True)
    return stand


def test_nur_was_angebunden_ist_wird_vermisst():
    """Ein fehlendes Pit-Boss-Paket ist keine Meldung wert, wenn niemand
    einen Pelletgrill hat."""
    stand = {zeile["key"]: zeile["needed"] for zeile in extras.stand({"roborock"})}
    assert stand["roborock"]
    assert not stand["pitboss"]
    assert not stand["cast"]


def test_die_sprachausgabe_haengt_an_den_boxen():
    """Ohne Cast-Boxen gibt es nichts, worauf eine Durchsage landen
    könnte."""
    assert not {z["key"]: z["needed"] for z in extras.stand(set())}["speech"]
    assert {z["key"]: z["needed"] for z in extras.stand({"google_cast"})}["speech"]


def test_die_live_aktivitaet_haengt_an_der_konfiguration():
    ohne = {z["key"]: z["needed"] for z in extras.stand(set(), apns=False)}
    mit = {z["key"]: z["needed"] for z in extras.stand(set(), apns=True)}
    assert not ohne["apns"]
    assert mit["apns"]


def test_ein_unbekanntes_modul_gilt_als_nicht_da_statt_zu_werfen():
    """`find_spec` wirft bei einem fehlenden Elternpaket - das darf die
    Systemseite nicht zu Fall bringen."""
    assert not extras.vorhanden("gibtesnicht.und.auch.nicht")


def test_ein_vorhandenes_modul_wird_erkannt():
    assert extras.vorhanden("json")


def test_vollstaendig_heisst_ein_satz_und_kein_befehl():
    """Der Normalfall - und genau dann soll man die Liste nicht
    durchlesen müssen."""
    stand = zeilen()
    assert extras.fehlend(stand) == []
    assert extras.satz(stand) == "Alles da, was hier gebraucht wird."
    assert extras.befehl(stand) is None


def test_ein_fehlendes_teil_wird_beim_namen_genannt():
    stand = zeilen(speech=False)
    assert extras.satz(stand) == "Sprachausgabe fehlt - dieser Teil bleibt still."
    assert extras.befehl(stand) == "pip install -e '.[speech]'"


def test_mehrere_luecken_kommen_in_einem_befehl():
    stand = zeilen(speech=False, roborock=False)
    assert "2 Teile fehlen" in extras.satz(stand)
    assert extras.befehl(stand) == "pip install -e '.[speech,roborock]'"


def test_was_niemand_braucht_steht_in_keinem_befehl():
    stand = zeilen(pitboss=False)
    assert extras.befehl(stand) is None


def test_die_systemseite_bekommt_liste_satz_und_befehl():
    hub = Hub(make_config())
    with TestClient(create_app(hub)) as client:
        antwort = client.get("/api/system/extras").json()
        keys = {zeile["key"] for zeile in antwort["extras"]}
        assert "speech" in keys
        assert isinstance(antwort["summary"], str)
        # Die Demo bindet nichts an, was ein Extra bräuchte - also fehlt
        # auch nichts, und es gibt nichts nachzuinstallieren.
        assert antwort["command"] is None
