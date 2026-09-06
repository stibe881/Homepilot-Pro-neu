"""Die Dienst-Verbindungen des Hauses - Kalender, Spotify, Google Home.

Die Seite «Verbindungen» in der App zeigte bisher nur Adresse und Token
dieses einen Geräts. Die Anbindungen an fremde Dienste - der
Google-Kalender mit seinen Mail-Adressen, Spotify, die Cast-Boxen -
standen dagegen nur in der config.yaml, und wer eine Kalender-Adresse
ändern wollte, musste YAML lesen.

Hier steht die entscheidbare Hälfte davon: welcher Dienst wie heisst,
was aus einem Konfigurationsblock anzuzeigen ist und welcher Stand sich
aus «eingerichtet / eingeschaltet / geladen / erreichbar» ergibt. Die
Routen (api/routes/verbindungen.py) reichen nur Daten hinein und
schreiben die Änderungen über core/config_edit zurück.

Geheimnisse (client_id, client_secret) verlassen den Hub nie: Nach
aussen geht nur, *ob* sie gesetzt sind. Neue landen in der secrets.env
neben der config.yaml - nie im Repository (siehe CLAUDE.md), und in der
config.yaml steht nur der Verweis `${NAME}`.
"""

from __future__ import annotations

import re
from typing import Any

# Ein Eintrag je Dienst, in der Reihenfolge der Seite. `token_name` ist
# der Name der Token-Datei (core/tokenstore), wenn der Dienst eine
# Anmeldung braucht; `secret_prefix` benennt die Variablen in der
# secrets.env (GOOGLE_CLIENT_ID, SPOTIFY_CLIENT_SECRET, ...).
KATALOG: list[dict[str, Any]] = [
    {
        "key": "kalender",
        "integration": "google_calendar",
        "label": "Kalender",
        "kurz": "Termine und Geburtstage aus dem Google-Konto",
        "token_name": "google",
        "secret_prefix": "GOOGLE",
        "anmelde_befehl": (
            "docker exec -it homepilot-hub "
            "python -m homepilot.integrations.google_calendar -c config.yaml"
        ),
    },
    {
        "key": "spotify",
        "integration": "spotify",
        "label": "Spotify",
        "kurz": "Was gerade läuft, Playlisten und Wiedergabe",
        "token_name": "spotify",
        "secret_prefix": "SPOTIFY",
        "anmelde_befehl": (
            "docker exec -it homepilot-hub "
            "python -m homepilot.integrations.spotify -c config.yaml"
        ),
    },
    {
        "key": "googlehome",
        "integration": "google_cast",
        "label": "Google Home",
        "kurz": "Lautsprecher, Chromecasts und Bildschirme im Netz",
        "token_name": None,
        "secret_prefix": None,
        "anmelde_befehl": None,
    },
]


def dienst(key: str) -> dict[str, Any] | None:
    """Den Katalogeintrag zu diesem Schlüssel (rein)."""
    return next((eintrag for eintrag in KATALOG if eintrag["key"] == key), None)


def status_von(
    eingerichtet: bool,
    enabled: bool,
    geladen: bool,
    verfuegbar: bool | None,
    zugang: bool | None,
    angemeldet: bool | None,
    fehler: str | None = None,
) -> dict[str, str]:
    """Der eine Satz über den Stand eines Dienstes (rein, testbar).

    Die Reihenfolge ist die des Einrichtens: Erst muss der Block da sein,
    dann eingeschaltet, dann die Zugangsdaten, dann die Anmeldung - und
    erst zum Schluss zählt, ob der Dienst gerade antwortet. So nennt der
    Satz immer den *nächsten* Schritt, nicht irgendeinen.

    `None` heisst jeweils: Für diesen Dienst stellt sich die Frage nicht
    (Google Home braucht keine Anmeldung).
    """
    if not eingerichtet:
        return {"text": "Nicht eingerichtet", "ton": "neutral"}
    if not enabled:
        return {"text": "Ausgeschaltet", "ton": "aus"}
    if zugang is False:
        return {"text": "Zugangsdaten fehlen", "ton": "warnung"}
    if angemeldet is False:
        return {"text": "Anmeldung fehlt", "ton": "warnung"}
    if not geladen:
        # Zwei verschiedene Lagen: Der Start ist nachweislich gescheitert
        # (der Hub führt den Fehler), oder die Änderung ist schlicht noch
        # nicht in Betrieb. Wer sie verwechselt, startet vergeblich neu.
        if fehler:
            return {"text": "Start fehlgeschlagen", "ton": "warnung"}
        return {"text": "Erst nach dem Neustart aktiv", "ton": "warnung"}
    if verfuegbar is False:
        return {"text": "Eingerichtet, aber nicht erreichbar", "ton": "warnung"}
    return {"text": "Verbunden", "ton": "gut"}


def _gesetzt(block: dict[str, Any] | None, key: str) -> bool:
    """Steht dieser Wert im Block - egal ob direkt oder als ${VERWEIS}?"""
    if not isinstance(block, dict):
        return False
    return bool(str(block.get(key) or "").strip())


def zugang_da(block: dict[str, Any] | None) -> bool:
    """Sind client_id und client_secret eingetragen? (rein, testbar)

    Gelesen wird der rohe Block, nicht der aufgelöste: Der Wert selbst
    geht die App nichts an, und ein `${VERWEIS}` zählt als gesetzt - ob
    er auflöst, zeigt sich daran, ob der Hub den Dienst geladen hat.
    """
    return _gesetzt(block, "client_id") and _gesetzt(block, "client_secret")


def kalender_werte(block: dict[str, Any] | None) -> dict[str, Any]:
    """Was die Kalender-Karte zeigt (rein, testbar)."""
    block = block if isinstance(block, dict) else {}
    roh = block.get("calendar_ids")
    if not isinstance(roh, list):
        einzeln = str(block.get("calendar_id") or "").strip()
        roh = [einzeln] if einzeln else ["primary"]
    ids = [str(eintrag).strip() for eintrag in roh if str(eintrag).strip()]
    try:
        remind = int(block.get("remind_minutes", 0))
    except (TypeError, ValueError):
        remind = 0
    return {"calendar_ids": ids, "remind_minutes": remind}


def cast_geraete(
    block: dict[str, Any] | None, erreichbar: dict[str, bool]
) -> list[dict[str, Any]]:
    """Die Boxen aus dem Block, samt «antwortet gerade» (rein, testbar).

    `erreichbar` bildet die Entitäts-Kennung (ohne Präfix, also
    `10_10_1_20` bzw. `10_10_1_20_32187`) auf die Verfügbarkeit ab -
    genau die Kennung, die google_cast.cast_object_id vergibt.
    """
    geraete: list[dict[str, Any]] = []
    for eintrag in (block or {}).get("devices") or []:
        if not isinstance(eintrag, dict):
            continue
        host = str(eintrag.get("host") or "").strip()
        if not host:
            continue
        try:
            port = int(eintrag.get("port") or 8009)
        except (TypeError, ValueError):
            port = 8009
        kennung = host.replace(".", "_") + (f"_{port}" if port != 8009 else "")
        geraete.append(
            {
                "name": str(eintrag.get("name") or host),
                "host": host,
                "port": port,
                "erreichbar": erreichbar.get(kennung),
            }
        )
    return geraete


# Eine Kalender-Adresse ist «primary», eine Mail-Adresse oder eine
# Google-Kennung wie addressbook#contacts@group.v.calendar.google.com -
# gemeinsam ist ihnen: keine Leerzeichen, keine YAML-Fallen.
_KALENDER_ID = re.compile(r"^[A-Za-z0-9._#@+-]+$")


def gueltige_kalender_id(text: str) -> bool:
    """Taugt das als Kalender-Adresse? (rein, testbar)"""
    return bool(_KALENDER_ID.fullmatch(text.strip()))


_HOST = re.compile(r"^[A-Za-z0-9.-]+$")


def gueltiger_host(text: str) -> bool:
    """Taugt das als Geräteadresse? (rein, testbar)"""
    text = text.strip()
    return bool(text) and bool(_HOST.fullmatch(text))


def secrets_zeile_setzen(text: str, name: str, wert: str) -> str:
    """NAME=WERT in der secrets.env setzen oder ergänzen (rein, testbar).

    Die Datei ist bewusst anspruchslos (core/config.read_secrets liest
    sie): eine Zeile je Geheimnis, Kommentare bleiben stehen. Eine
    bestehende Zeile wird ersetzt, sonst kommt sie ans Ende.
    """
    zeilen = text.splitlines()
    neu = f"{name}={wert}"
    for index, zeile in enumerate(zeilen):
        kern = zeile.strip()
        if kern.startswith("#") or "=" not in kern:
            continue
        if kern.partition("=")[0].strip() == name:
            zeilen[index] = neu
            return "\n".join(zeilen) + "\n"
    zeilen.append(neu)
    # Eine frische Datei beginnt mit dem Satz, der erklärt, was sie ist -
    # wer sie auf dem Hub findet, soll wissen, dass sie nie ins
    # Repository gehört.
    if not text.strip():
        zeilen = ["# Geheimnisse neben der config.yaml - nie einchecken.", neu]
    return "\n".join(zeilen) + "\n"
