"""Jedes Extra muss auch im Abbild stehen.

Der Fall, wegen dem es diesen Test gibt, kam aus dem Haus: Auf der
Systemseite stand «Gutschein-Belege lesen fehlt», dazu ein Befehl zum
Nachinstallieren. Der lief auf dem Docker-Host - dort gibt es kein pip,
und der Hub wohnt dort auch nicht. Die Ursache lag eine Ebene tiefer:
Das Extra `beleg` war in `core/extras.py` und in der `pyproject.toml`
angemeldet, aber nie in die Installationszeile des Dockerfiles
aufgenommen worden. Auf einem Abbild-Hub war es damit nicht «noch nicht
installiert», sondern grundsätzlich nicht da.

Zwei Listen für dieselbe Sache, an zwei Orten, ohne etwas dazwischen -
das ist die Sorte Fehler, die dieses Repo an mehreren Stellen schon
einmal hatte. Hier steht das Bindeglied.

Der Test liest das Dockerfile als Text und nicht das gebaute Abbild:
Er soll ohne Docker und ohne Netz laufen, wie alles andere hier auch.
"""

from __future__ import annotations

import re
from pathlib import Path

from homepilot.core.extras import EXTRAS

DOCKERFILE = Path(__file__).resolve().parents[1] / "Dockerfile"
PYPROJECT = Path(__file__).resolve().parents[1] / "pyproject.toml"


def abbild_extras() -> set[str]:
    """Welche Extras die Installationszeile des Dockerfiles nennt (rein)."""
    treffer = re.search(
        r'pip install[^"\n]*"\.\[([^\]]+)\]"', DOCKERFILE.read_text(encoding="utf-8")
    )
    assert treffer, "Im Dockerfile steht keine Zeile «pip install \".[…]\"» mehr"
    return {teil.strip() for teil in treffer.group(1).split(",") if teil.strip()}


def pyproject_extras() -> set[str]:
    """Welche Extras die pyproject.toml anbietet (rein)."""
    text = PYPROJECT.read_text(encoding="utf-8")
    block = text.split("[project.optional-dependencies]", 1)
    assert len(block) == 2, "In der pyproject.toml fehlt der Extras-Block"
    namen = set()
    for zeile in block[1].splitlines():
        if zeile.startswith("["):
            break
        treffer = re.match(r"^([A-Za-z0-9_-]+)\s*=", zeile)
        if treffer:
            namen.add(treffer.group(1))
    return namen


def test_jedes_extra_steckt_im_abbild() -> None:
    """Sonst steht im Haus «fehlt» neben etwas, das dort nie ankommen
    kann - und der Befehl daneben führt ins Leere."""
    gemeldet = {str(extra["key"]) for extra in EXTRAS}
    fehlen = sorted(gemeldet - abbild_extras())
    assert not fehlen, (
        f"Diese Extras meldet die Systemseite, das Abbild kennt sie aber nicht: {fehlen}. "
        "In hub/Dockerfile in die pip-install-Zeile aufnehmen."
    )


def test_das_abbild_kennt_keine_erfundenen_extras() -> None:
    """Die andere Richtung: Ein Tippfehler in der Dockerfile-Zeile
    lässt den Bau mit «unknown extra» durchlaufen, ohne dass jemand es
    merkt - installiert wird dann schlicht nichts."""
    unbekannt = sorted(abbild_extras() - pyproject_extras())
    assert not unbekannt, f"Im Dockerfile stehen Extras, die es nicht gibt: {unbekannt}"


def test_jedes_gemeldete_extra_gibt_es_auch_wirklich() -> None:
    """Ein Extra, das die Systemseite kennt und die pyproject.toml
    nicht, wäre ein Befehl zum Abtippen, der mit «unknown extra»
    scheitert."""
    gemeldet = {str(extra["key"]) for extra in EXTRAS}
    erfunden = sorted(gemeldet - pyproject_extras())
    assert not erfunden, f"Extras ohne Eintrag in der pyproject.toml: {erfunden}"


def test_im_container_zeigt_der_befehl_auf_den_container() -> None:
    """Der Fehlerbericht wörtlich: «pip install -e '.[beleg]'» auf dem
    Docker-Host antwortete «Command 'pip' not found». Der Hub wohnt dort
    gar nicht."""
    from homepilot.core.extras import CONTAINER, befehl

    zeilen = [
        {"key": "beleg", "title": "Belege", "detail": "", "installed": False, "needed": True}
    ]
    im_container = befehl(zeilen, abbild=True)
    assert im_container is not None
    assert im_container.startswith(f"docker exec -u root {CONTAINER} ")
    # `-u root`, weil der Hub als eigener Benutzer läuft (Dockerfile) und
    # pip sonst nicht schreiben darf.
    assert "-u root" in im_container


def test_ohne_container_bleibt_es_beim_pip_befehl() -> None:
    from homepilot.core.extras import befehl

    zeilen = [
        {"key": "beleg", "title": "Belege", "detail": "", "installed": False, "needed": True}
    ]
    assert befehl(zeilen, abbild=False) == "pip install -e '.[beleg]'"


def test_ohne_luecke_kein_befehl_und_kein_hinweis() -> None:
    """Die Karte soll schweigen, wenn alles da ist."""
    from homepilot.core.extras import befehl, hinweis

    zeilen = [
        {"key": "beleg", "title": "Belege", "detail": "", "installed": True, "needed": True}
    ]
    assert befehl(zeilen, abbild=True) is None
    assert hinweis(zeilen, abbild=True) is None


def test_der_hinweis_sagt_dass_es_das_update_nicht_ueberlebt() -> None:
    """Wer das nicht weiss, installiert dasselbe alle paar Wochen neu
    und hält den Hub für kaputt."""
    from homepilot.core.extras import hinweis

    zeilen = [
        {"key": "beleg", "title": "Belege", "detail": "", "installed": False, "needed": True}
    ]
    text = hinweis(zeilen, abbild=True)
    assert text is not None
    assert "Dockerfile" in text
    # Ausserhalb eines Containers gibt es nichts zu warnen.
    assert hinweis(zeilen, abbild=False) is None
