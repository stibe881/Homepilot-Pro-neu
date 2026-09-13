"""Jeder Gast-Bereich des Hubs braucht ein Wort in der App.

Fehler aus der Runde 579 der Werkbank: Der Hub kannte «klingel»
(core/users.py: GUEST_FEATURES), FEATURE_LABELS in UsersScreen.tsx nicht.
Nur der Babysitter-Weg setzte es, und ein so angelegter Gast zeigte in
der Benutzerliste das rohe Wort.

Gelesen wird die App-Datei als Text, wie bei test_extras_abbild.py: Zwei
Listen für dieselbe Sache an zwei Orten, und hier steht das Bindeglied.
"""

from __future__ import annotations

import re
from pathlib import Path

import pytest

from homepilot.core.users import GUEST_FEATURES

USERS_SCREEN = Path(__file__).resolve().parents[2] / "app" / "src" / "screens" / "UsersScreen.tsx"


def app_labels() -> dict[str, str]:
    """Die Schlüssel und Wörter aus FEATURE_LABELS (rein)."""
    if not USERS_SCREEN.is_file():
        pytest.skip("Die App liegt nicht neben dem Hub")
    text = USERS_SCREEN.read_text(encoding="utf-8")
    block = re.search(r"FEATURE_LABELS[^=]*=\s*\{(.*?)\n\};", text, re.DOTALL)
    assert block, "In UsersScreen.tsx fehlt FEATURE_LABELS"
    return dict(re.findall(r"^\s*([a-z_]+):\s*'([^']+)'", block.group(1), re.MULTILINE))


def test_jeder_gastbereich_hat_ein_wort_in_der_app() -> None:
    fehlend = sorted(set(GUEST_FEATURES) - set(app_labels()))
    assert not fehlend, (
        f"Diese Gast-Bereiche kennt der Hub, die App zeigt sie roh: {fehlend}. "
        "In app/src/screens/UsersScreen.tsx in FEATURE_LABELS aufnehmen."
    )


def test_die_app_erfindet_keine_bereiche() -> None:
    """Die andere Richtung: Ein Bereich, den der Hub nicht kennt, wird
    beim Anlegen mit «Unbekannte Bereiche» abgewiesen."""
    erfunden = sorted(set(app_labels()) - set(GUEST_FEATURES))
    assert not erfunden, f"FEATURE_LABELS nennt Bereiche, die es im Hub nicht gibt: {erfunden}"


def test_die_klingel_heisst_in_beiden_gleich() -> None:
    assert app_labels()["klingel"] == GUEST_FEATURES["klingel"]
