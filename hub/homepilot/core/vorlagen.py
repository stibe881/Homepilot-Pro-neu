"""Eigene Ablauf-Vorlagen - und die eingebauten, die niemand braucht.

Die Vorlagen unter «Abläufe» sind fertige Anfänge: einmal antippen, und
der Editor steht vorbefüllt da. Bisher kamen sie ausschliesslich aus dem
Gerätebestand - der Hub schlug vor, was er anbieten konnte, und man
konnte weder etwas dazutun noch etwas wegnehmen. In einem Haushalt, der
seine drei immer gleichen Abläufe kennt, ist das die falsche Richtung:
Die Liste wird länger, nicht nützlicher.

Deshalb liegt hier beides:

  - **Eigene Vorlagen.** Ein Ablauf, den man so oder ähnlich immer
    wieder baut, wird einmal als Vorlage gesichert und steht danach in
    der Liste. Der Entwurf ist das, was die App im Editor anzeigt - der
    Hub reicht ihn unverändert durch. Er kennt die Form nicht und soll
    sie nicht kennen: Sonst müsste jede Änderung am Editor hier
    nachgezogen werden.
  - **Ausgeblendete eingebaute.** Die eingebauten stehen im Code der App
    und lassen sich nicht löschen. Ausblenden lässt sich jede - gemerkt
    wird ihre Beschriftung, denn eine andere Kennung haben sie nicht.

Gemeinsam für den Haushalt, nicht je Person: Vorlagen sind eine
Einrichtung des Hauses wie die Abläufe selbst.
"""

from __future__ import annotations

import secrets
from typing import Any

#: Wo die Vorlagen liegen.
KEY = "automation_templates"

#: So beginnt die Kennung einer ausgeblendeten eingebauten Vorlage.
BUILTIN = "builtin:"


def neue_id() -> str:
    return f"vorlage_{secrets.token_hex(4)}"


def read(roh: Any) -> list[dict[str, Any]]:
    """Die gespeicherten Einträge (rein, testbar).

    Nachsichtig: Was keine Kennung hat, fällt weg. Ein kaputter Eintrag
    soll die Liste nicht mitreissen - im schlimmsten Fall fehlt eine
    Vorlage, und das merkt man beim nächsten Blick.
    """
    eintraege = []
    for eintrag in roh or []:
        if not isinstance(eintrag, dict):
            continue
        kennung = str(eintrag.get("id") or "")
        if not kennung:
            continue
        eintraege.append(
            {
                "id": kennung,
                "label": str(eintrag.get("label") or ""),
                "icon": str(eintrag.get("icon") or "flash-outline"),
                "draft": eintrag.get("draft") if isinstance(eintrag.get("draft"), dict) else {},
                "hidden": bool(eintrag.get("hidden")),
                "by": str(eintrag.get("by") or ""),
                "at": eintrag.get("at"),
            }
        )
    return eintraege


def eigene(roh: Any) -> list[dict[str, Any]]:
    """Nur die selbst angelegten - die ausgeblendeten sind keine Vorlagen."""
    return [eintrag for eintrag in read(roh) if not eintrag["hidden"]]


def versteckte(roh: Any) -> list[str]:
    """Beschriftungen der ausgeblendeten eingebauten Vorlagen (rein)."""
    return sorted(
        eintrag["label"] for eintrag in read(roh) if eintrag["hidden"] and eintrag["label"]
    )


def speichern(
    roh: Any,
    entwurf: dict[str, Any],
    kennung: str | None = None,
    by: str = "",
    now: float | None = None,
) -> tuple[list[dict[str, Any]], str]:
    """Eine eigene Vorlage anlegen oder ändern (rein, testbar).

    Gibt die neue Liste und die Kennung zurück. Ohne Kennung entsteht
    eine neue; eine unbekannte Kennung legt ebenfalls an, statt still
    nichts zu tun - eine Vorlage, die nach dem Sichern fehlt, ist der
    ärgerlichere Fehler.
    """
    eintraege = read(roh)
    label = str(entwurf.get("alias") or "").strip() or "Ohne Namen"
    icon = str(entwurf.get("icon") or "flash-outline")
    ziel = kennung or neue_id()
    neu = {
        "id": ziel,
        "label": label,
        "icon": icon,
        # Der Entwurf, wie die App ihn schickt - ohne die Kennung der
        # Vorlage selbst, sonst überschriebe ein daraus gebauter Ablauf
        # später seine eigene Vorlage.
        "draft": {
            schluessel: wert
            for schluessel, wert in entwurf.items()
            if schluessel not in {"templateId", "icon", "id"}
        },
        "hidden": False,
        "by": by,
        "at": now,
    }
    ersetzt = False
    for index, eintrag in enumerate(eintraege):
        if eintrag["id"] == ziel:
            eintraege[index] = neu
            ersetzt = True
            break
    if not ersetzt:
        eintraege.append(neu)
    return eintraege, ziel


def entfernen(roh: Any, kennung: str) -> list[dict[str, Any]]:
    """Eine eigene Vorlage löschen (rein, testbar)."""
    return [eintrag for eintrag in read(roh) if eintrag["id"] != kennung]


def ausblenden(roh: Any, label: str, on: bool = True) -> list[dict[str, Any]]:
    """Eine eingebaute Vorlage ausblenden oder wieder zeigen (rein, testbar).

    Gemerkt wird die Beschriftung: Die eingebauten stehen im Code der App
    und haben keine andere Kennung. Verschwindet eine davon in einer
    späteren Fassung, bleibt hier ein Eintrag stehen, der nichts mehr
    versteckt - er stört nicht und lässt sich nicht von einer Vorlage
    unterscheiden, die es gerade nur nicht gibt (kein Bewegungsmelder
    angeschlossen, also keine Vorlage dafür).
    """
    sauber = " ".join(str(label or "").split())
    if not sauber:
        return read(roh)
    kennung = f"{BUILTIN}{sauber}"
    eintraege = [eintrag for eintrag in read(roh) if eintrag["id"] != kennung]
    if on:
        eintraege.append(
            {
                "id": kennung,
                "label": sauber,
                "icon": "",
                "draft": {},
                "hidden": True,
                "by": "",
                "at": None,
            }
        )
    return eintraege
