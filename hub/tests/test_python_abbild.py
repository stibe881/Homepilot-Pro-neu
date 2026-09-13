"""Der Interpreter im Haus muss einer sein, den die Prüfung gesehen hat.

Fehler aus der Runde 579 der Werkbank: pruefung.yml und pyproject.toml
sagten 3.11, das Dockerfile sagte python:3.12-slim. Die 620 Tests hatten
den Interpreter, der im Haus läuft, nie gesehen. Zwei Listen für
dieselbe Sache, an zwei Orten, ohne etwas dazwischen - dasselbe Muster
wie bei den Extras (test_extras_abbild.py), und hier steht das
Bindeglied.

Gelesen wird als Text, wie dort: ohne Docker, ohne Netz, ohne GitHub.
"""

from __future__ import annotations

import re
import sys
from pathlib import Path

HUB = Path(__file__).resolve().parents[1]
DOCKERFILE = HUB / "Dockerfile"
PYPROJECT = HUB / "pyproject.toml"
WORKFLOW = HUB.parent / ".github" / "workflows" / "pruefung.yml"


def abbild_python() -> str:
    """«3.12» aus `FROM python:3.12-slim` (rein)."""
    treffer = re.search(
        r"^FROM\s+python:(\d+\.\d+)", DOCKERFILE.read_text(encoding="utf-8"), re.MULTILINE
    )
    assert treffer, "Im Dockerfile steht keine Zeile «FROM python:<version>» mehr"
    return treffer.group(1)


def geprueft_python() -> set[str]:
    """Welche Interpreter der Hub-Prüflauf durchläuft (rein)."""
    text = WORKFLOW.read_text(encoding="utf-8")
    treffer = re.search(r"python:\s*\[([^\]]+)\]", text)
    assert treffer, "In pruefung.yml fehlt die Matrix «python: ['…']» des Hub-Jobs"
    return {teil.strip().strip("'\"") for teil in treffer.group(1).split(",") if teil.strip()}


def untergrenze() -> str:
    treffer = re.search(r'requires-python\s*=\s*">=(\d+\.\d+)"', PYPROJECT.read_text(encoding="utf-8"))
    assert treffer, "In der pyproject.toml fehlt requires-python"
    return treffer.group(1)


def test_das_abbild_laeuft_auf_einem_gepruefen_interpreter() -> None:
    """Sonst sehen die Tests nie den Interpreter, der im Haus läuft."""
    assert abbild_python() in geprueft_python(), (
        f"hub/Dockerfile baut mit Python {abbild_python()}, geprüft werden "
        f"{sorted(geprueft_python())}. In .github/workflows/pruefung.yml in die Matrix aufnehmen."
    )


def test_die_untergrenze_wird_ebenfalls_geprueft() -> None:
    """pyproject.toml verspricht «ab 3.11» - dann muss 3.11 auch laufen."""
    assert untergrenze() in geprueft_python()


def test_mypy_prueft_gegen_die_untergrenze() -> None:
    """Die Typprüfung gegen die älteste versprochene Fassung: Was dort
    durchgeht, geht auch auf dem neueren Abbild durch - umgekehrt nicht."""
    treffer = re.search(r'python_version\s*=\s*"(\d+\.\d+)"', PYPROJECT.read_text(encoding="utf-8"))
    assert treffer and treffer.group(1) == untergrenze()


def test_dieser_lauf_ist_einer_der_gepruefen() -> None:
    """Wer die Tests lokal auf einem dritten Interpreter laufen lässt,
    soll das wenigstens wissen."""
    hier = f"{sys.version_info.major}.{sys.version_info.minor}"
    if hier not in geprueft_python():
        import pytest

        pytest.skip(f"Python {hier} ist kein geprüfter Interpreter ({sorted(geprueft_python())})")
