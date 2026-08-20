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
