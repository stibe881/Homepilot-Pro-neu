"""Der Update-Dienst, der auf dem Docker-Host neben dem Hub läuft.

Er gehört nicht zum Paket – er liegt unter deploy/ und wird auf den Host
kopiert. Getestet wird er hier trotzdem: Seine Auskunft darüber, was er
kann und ob der Zugang zu EAS bereitliegt, ist das, worauf sich der Hub
verlässt, bevor er einen iOS-Build anstösst. Stimmt sie nicht, baut das
Haus zwar weiter, aber in TestFlight kommt stillschweigend nichts an –
und genau das hat schon einmal einen Abend gekostet.
"""

import importlib.util
from pathlib import Path

import pytest

LISTENER = Path(__file__).resolve().parents[2] / "deploy" / "update-listener.py"


def load_listener(monkeypatch, credentials: Path | None, env_token: str | None):
    """Das Skript frisch laden – es liest seine Umgebung beim Import."""
    monkeypatch.setenv("UPDATE_SECRET", "egal")
    if credentials is None:
        monkeypatch.delenv("UPDATE_CREDENTIALS", raising=False)
    else:
        monkeypatch.setenv("UPDATE_CREDENTIALS", str(credentials))
    if env_token is None:
        monkeypatch.delenv("EXPO_TOKEN", raising=False)
    else:
        monkeypatch.setenv("EXPO_TOKEN", env_token)

    spec = importlib.util.spec_from_file_location("homepilot_update_listener", LISTENER)
    assert spec is not None and spec.loader is not None
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


@pytest.fixture
def credentials(tmp_path):
    return tmp_path / "github-credentials.env"


def test_the_listener_says_it_understands_the_ios_switch(monkeypatch, credentials):
    """Woran der Hub eine veraltete Fassung erkennt: Sie zählt «ios» nicht
    mit auf. Verschwindet dieser Eintrag, laufen iOS-Builds wieder ins
    Leere, ohne dass es jemandem auffällt."""
    listener = load_listener(monkeypatch, credentials, None)
    assert "ios" in listener.FEATURES
    assert "status" in listener.FEATURES


def test_expo_token_is_found_in_the_credentials_file(monkeypatch, credentials):
    """Der Bau liest die Zugangsdatei selbst ein. Also muss der Dienst dort
    ebenfalls nachsehen – sonst meldete er «fehlt», sobald jemand den
    Token einträgt, ohne den Dienst neu zu starten, und der Hub verweigerte
    einen Build, der längst möglich wäre."""
    credentials.write_text(
        "GITHUB_USER=stibe881\nEXPO_TOKEN=abc123\nUPDATE_SECRET=x\n",
        encoding="utf-8",
    )
    listener = load_listener(monkeypatch, credentials, None)
    assert listener.has_expo_token() is True


def test_expo_token_missing_or_empty_counts_as_missing(monkeypatch, credentials):
    """Eine leere Zeile ist kein Token – sonst hiesse es «da», und der Bau
    überspränge den iOS-Teil trotzdem."""
    credentials.write_text("EXPO_TOKEN=\nGITHUB_USER=stibe881\n", encoding="utf-8")
    assert load_listener(monkeypatch, credentials, None).has_expo_token() is False

    # Gar keine Zeile, und die Datei fehlt ganz: beides «fehlt», kein Fehler.
    credentials.write_text("GITHUB_USER=stibe881\n", encoding="utf-8")
    assert load_listener(monkeypatch, credentials, None).has_expo_token() is False
    assert (
        load_listener(monkeypatch, credentials.parent / "gibtsnicht", None)
        .has_expo_token()
        is False
    )


def test_expo_token_from_the_environment_counts_too(monkeypatch, credentials):
    """systemd reicht die Zugangsdatei als Umgebung herein – dann steht der
    Token dort und nicht unbedingt in einer Datei, die dieser Dienst sieht."""
    listener = load_listener(monkeypatch, credentials, "aus-der-umgebung")
    assert listener.has_expo_token() is True


def test_the_token_itself_never_leaves_the_host(monkeypatch, credentials):
    """Nur ja/nein geht an den Hub. Ein Zugangs-Token, der über die
    Schnittstelle wandert, steht am Ende in einem Protokoll."""
    credentials.write_text("EXPO_TOKEN=streng-geheim\n", encoding="utf-8")
    listener = load_listener(monkeypatch, credentials, None)
    assert listener.has_expo_token() is True
    assert "streng-geheim" not in str(listener.FEATURES)


def test_a_second_build_is_refused_out_loud(monkeypatch, credentials):
    """Der Kern des Ärgers: Läuft schon ein Bau, wurde der zweite Aufruf
    verworfen - beantwortet aber mit «Bau gestartet». Wer während der
    Wartezeit auf Portainer nochmals drückte, sah eine Bestätigung und
    bekam nichts. Die Sperre hält jetzt der Aufrufer, damit er es sagen
    kann."""
    listener = load_listener(monkeypatch, credentials, None)
    assert listener._running.acquire(blocking=False) is True
    try:
        # Solange gebaut wird, ist die Sperre belegt - genau daran erkennt
        # do_POST, dass es 409 statt 202 antworten muss.
        assert listener._running.acquire(blocking=False) is False
    finally:
        listener._running.release()
    # Danach ist wieder frei.
    assert listener._running.acquire(blocking=False) is True
    listener._running.release()


def test_a_warning_keeps_the_lines_that_say_what_to_do(monkeypatch, credentials):
    """Die Abhilfe steht unter der Warnung, nicht in ihr.

    rebuild-hub.sh schreibt «⚠ iOS-Build liess sich nicht anstossen» und
    darunter eingerückt die Schritte im Apple-Portal. Fielen die weg,
    stünde in der App nur, dass etwas schiefging – und die Anleitung läge
    im Journal auf dem Host, wo sie niemand sucht.
    """
    listener = load_listener(monkeypatch, credentials, None)
    for zeile in (
        "⚠ iOS-Build liess sich nicht anstossen - das Hub-Update selbst",
        "  ist davon unberührt.",
        "  Es fehlt die App-Gruppe im Apple-Portal. Einmalig:",
        "  1. developer.apple.com → Identifiers → App Groups → +",
    ):
        listener._handle_line(zeile)

    assert len(listener._status["warnings"]) == 1
    warnung = listener._status["warnings"][0]
    assert warnung.startswith("iOS-Build liess sich nicht anstossen")
    assert "Es fehlt die App-Gruppe im Apple-Portal" in warnung
    assert "developer.apple.com" in warnung


def test_indented_lines_elsewhere_do_not_land_in_the_warning(monkeypatch, credentials):
    """Eingerückt ist im Bau-Protokoll vieles – die Platz-Notiz etwa.

    Nur was direkt unter einer Warnung steht, gehört zu ihr. Sonst
    sammelte eine einzige Warnung nach und nach den halben Lauf ein.
    """
    listener = load_listener(monkeypatch, credentials, None)
    listener._handle_line("⚠ Web-Bau fehlgeschlagen")
    listener._handle_line("  die alte Fassung bleibt online.")
    listener._handle_line("→ Platz:")
    listener._handle_line("  frei: 12G")

    assert len(listener._status["warnings"]) == 1
    assert "die alte Fassung bleibt online." in listener._status["warnings"][0]
    assert "frei: 12G" not in listener._status["warnings"][0]


def test_a_new_run_starts_without_the_previous_warning_open(monkeypatch, credentials):
    """Zwei Läufe hintereinander: Der zweite beginnt mit leerer Liste.

    Bliebe die Sammelstelle des ersten offen, liefe die erste eingerückte
    Zeile des zweiten Laufs in eine Warnung, die es nicht mehr gibt.
    """
    listener = load_listener(monkeypatch, credentials, None)
    listener._handle_line("⚠ Etwas ging schief")
    listener._warn_open = False  # was build() beim Start ohnehin tut
    listener._status["warnings"] = []
    listener._handle_line("  eine eingerückte Zeile")

    assert listener._status["warnings"] == []


# ── Das Gedächtnis für den letzten Lauf ──────────────────────────────────
#
# Der Dienst startet sich nach einem Update selbst neu, und damit war der
# Ausgang des Laufs bisher weg. Wer danach in die App schaute, sah «nichts
# los» - auch nach einem Lauf, der mitten im Ausrollen gescheitert war.


def test_a_run_survives_a_restart_of_the_service(monkeypatch, tmp_path):
    modul = load_listener(monkeypatch, None, None)
    datei = tmp_path / "update-status.json"
    stand = {
        "state": "error",
        "stage": "deploy_wait",
        "message": "Portainer hat den Container nicht gewechselt",
        "detail": "Re-pull image ist im Stack an.",
        "warnings": [],
        "started_at": 1.0,
        "finished_at": 2.0,
        "ios": False,
    }
    assert modul.letzter_lauf_schreiben(str(datei), stand) is True
    assert modul.letzter_lauf_lesen(str(datei)) == stand


def test_a_broken_memory_does_not_stop_the_service(monkeypatch, tmp_path):
    # Halb geschriebene oder von Hand verbogene Datei: Der Dienst muss
    # trotzdem starten, sonst nimmt ein kaputtes Nebenzimmer das ganze
    # Haus mit.
    modul = load_listener(monkeypatch, None, None)
    kaputt = tmp_path / "update-status.json"
    kaputt.write_text("{ das ist kein json", encoding="utf-8")
    assert modul.letzter_lauf_lesen(str(kaputt)) is None
    assert modul.letzter_lauf_lesen(str(tmp_path / "gibt-es-nicht.json")) is None
    # Eine Liste ist gültiges JSON, aber kein Stand.
    kaputt.write_text("[1, 2, 3]", encoding="utf-8")
    assert modul.letzter_lauf_lesen(str(kaputt)) is None


def test_an_unwritable_place_is_reported_not_raised(monkeypatch, tmp_path):
    # Fehlt das Verzeichnis, ist das eine Meldung wert - aber kein Grund,
    # den gerade beendeten Bau nachträglich scheitern zu lassen.
    modul = load_listener(monkeypatch, None, None)
    ziel = tmp_path / "gibt-es-nicht" / "update-status.json"
    assert modul.letzter_lauf_schreiben(str(ziel), {"state": "ok"}) is False


def test_the_service_announces_that_it_remembers(monkeypatch):
    # Der Hub fragt die Fähigkeiten ab, bevor er etwas anzeigt, das
    # ältere Dienste nicht liefern.
    modul = load_listener(monkeypatch, None, None)
    assert "last_run" in modul.FEATURES
