"""Das Gerüst-Skript für neue Integrationen (Punkt 503 der Werkbank).

Ein Generator, der kaputten Code erzeugt, ist schlimmer als keiner: Wer
ihn benutzt, sucht den Fehler in seiner eigenen Arbeit. Darum prüfen
diese Tests nicht die Formulierungen, sondern das, was zählt - dass jede
Sorte gültiges Python ergibt, dass der Name zum Modulnamen taugt und
dass die Zeile in `SCAN_INTERVALS` an ihrem alphabetischen Platz landet.
"""

import ast
import importlib.util
from pathlib import Path

import pytest

WURZEL = Path(__file__).resolve().parent.parent


def _geruest():
    """Das Skript liegt in tools/ und ist kein Paket - also über den Pfad."""
    pfad = WURZEL / "tools" / "neue_integration.py"
    spec = importlib.util.spec_from_file_location("neue_integration", pfad)
    assert spec is not None and spec.loader is not None
    modul = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(modul)
    return modul


geruest = _geruest()


@pytest.mark.parametrize("art", sorted(geruest.ARTEN))
def test_jede_sorte_ergibt_gueltiges_python(art):
    """Der Fall, für den es das Skript gibt: Man legt an und arbeitet
    weiter - ein Syntaxfehler im Gerüst fiele erst beim Start auf, und
    dort sieht er aus wie ein eigener."""
    ast.parse(geruest.modul_text("waschturm", art))
    ast.parse(geruest.test_text("waschturm", art))


@pytest.mark.parametrize("art", sorted(geruest.ARTEN))
def test_jede_sorte_traegt_ihr_integration_attribut(art):
    """Ohne `INTEGRATION` findet der Hub die Klasse nie - und meldet
    dabei nur, die Integration exportiere kein Attribut. Wer das zum
    ersten Mal liest, sucht lange."""
    text = geruest.modul_text("waschturm", art)
    assert "INTEGRATION = WaschturmIntegration" in text
    assert 'name = "waschturm"' in text


def test_eine_sorte_ohne_befehle_bekommt_kein_handle_command():
    """Sonst stünden `Entity` und `Any` ungenutzt im Kopf, und ruff
    machte das Gerüst schon beim Anlegen rot."""
    text = geruest.modul_text("wetterstation", "sensor")
    assert "handle_command" not in text
    assert "from typing import Any" not in text
    assert "commands=" not in text


def test_der_name_muss_zum_modulnamen_taugen():
    """Ein Bindestrich fällt sonst erst beim Start auf - als «Integration
    nicht gefunden», was in die Irre führt."""
    assert geruest.gueltig("vzug_backofen") == "vzug_backofen"
    for daneben in ("Vzug", "v-zug", "2000er", "vzug backofen", ""):
        with pytest.raises(SystemExit):
            geruest.gueltig(daneben)


def test_aus_dem_modulnamen_wird_die_klasse():
    assert geruest.klassenname("hue") == "HueIntegration"
    assert geruest.klassenname("vzug_backofen") == "VzugBackofenIntegration"


def test_der_takt_landet_an_seinem_alphabetischen_platz():
    """Angehängt findet ihn beim nächsten Mal niemand - und dann steht
    die Zahl ein zweites Mal im Modul, genau der Zustand, den die
    Tabelle beendet hat."""
    text = "SCAN_INTERVALS: dict[str, float] = {\n    \"hue\": 300,\n    \"nuki\": 60,\n}\n"
    neu, geaendert = geruest.takt_eintragen(text, "meteoalarm", 900)
    assert geaendert
    assert neu.index('"meteoalarm"') > neu.index('"hue"')
    assert neu.index('"meteoalarm"') < neu.index('"nuki"')
    assert '"meteoalarm": 900,' in neu


def test_ein_takt_der_schon_dasteht_wird_nicht_verdoppelt():
    text = "SCAN_INTERVALS: dict[str, float] = {\n    \"hue\": 300,\n}\n"
    neu, geaendert = geruest.takt_eintragen(text, "hue", 42)
    assert not geaendert and neu == text


def test_der_echte_takt_der_tabelle_bleibt_lesbar():
    """Gegen die richtige Datei, nicht gegen ein Muster: Wer die Tabelle
    umformatiert, soll es hier merken und nicht im Haus."""
    quelle = (WURZEL / "homepilot" / "core" / "integration.py").read_text(
        encoding="utf-8"
    )
    neu, geaendert = geruest.takt_eintragen(quelle, "waschturm", 60)
    assert geaendert
    # Sie muss nach dem Einfügen noch gültiges Python sein - und die
    # Tabelle selbst noch eine Tabelle. Ausführen lässt sich die Datei
    # hier nicht (relative Importe), also über den Syntaxbaum.
    baum = ast.parse(neu)
    tabelle = None
    for knoten in ast.walk(baum):
        if isinstance(knoten, ast.AnnAssign) and isinstance(knoten.target, ast.Name):
            if knoten.target.id == "SCAN_INTERVALS" and knoten.value is not None:
                tabelle = ast.literal_eval(knoten.value)
    assert isinstance(tabelle, dict)
    assert tabelle["waschturm"] == 60
    # Und alphabetisch geblieben, sonst war die Einfügung nur zufällig richtig.
    schluessel = list(tabelle)
    assert schluessel == sorted(schluessel)
