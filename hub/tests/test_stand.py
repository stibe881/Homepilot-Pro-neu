"""Welcher Stand antwortet - die erste Zeile jeder Diagnose.

Der Fall, den es verhindert: Ein neuer Diagnose-Aufruf wird gebaut, im
Container läuft noch das alte Abbild, und «python -m ...» tut wortlos
nichts. Man sucht dann am falschen Ende.
"""

from homepilot import __version__
from homepilot.core.stand import stand_zeile


def test_zeile_nennt_fassung_commit_und_bauzeit(monkeypatch):
    monkeypatch.setenv("HOMEPILOT_COMMIT", "abc1234")
    monkeypatch.setenv("HOMEPILOT_BUILD_TIME", "2026-08-28T10:00:00Z")
    zeile = stand_zeile()
    assert __version__ in zeile
    assert "abc1234" in zeile
    assert "2026-08-28T10:00:00Z" in zeile


def test_ohne_umgebung_steht_unbekannt_da(monkeypatch):
    """Und nicht ein leeres Feld, das wie ein Fehler aussieht."""
    monkeypatch.delenv("HOMEPILOT_COMMIT", raising=False)
    monkeypatch.delenv("HOMEPILOT_BUILD_TIME", raising=False)
    assert "unbekannt" in stand_zeile()
