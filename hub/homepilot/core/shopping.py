"""Erinnerung im Laden: «Du wolltest noch etwas.»

Der Fall, für den es das gibt: Man steht wegen einer Sache im Coop, und
die drei anderen von der Liste fallen einem im Auto wieder ein. Eine
Nachricht beim Betreten wäre zu früh - man ist vielleicht nur
vorbeigefahren -, eine beim Verlassen zu spät. Also nach ein paar
Minuten: Wer so lange dort steht, kauft auch ein.

Woher der Hub weiss, dass jemand im Laden ist: aus einer Geofence-Zone,
die das Telefon meldet (siehe integrations/geofence.py). Der Laden trägt
die Kennung dieser Zone bei sich. Ohne Zone keine Erinnerung - der Laden
funktioniert trotzdem, er sortiert dann nur die Liste.
"""

from __future__ import annotations

from typing import Any

# Wie lange jemand dort sein muss. Vier Minuten sind lang genug, um an
# einer Ampel davor nicht zu zählen, und kurz genug, um noch im Laden
# anzukommen.
STAY_SECONDS = 4 * 60


def open_items(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Was noch fehlt – Erledigtes zählt nicht (rein, testbar)."""
    return [row for row in rows if isinstance(row, dict) and not row.get("done")]


def due_reminders(
    shops: list[dict[str, Any]],
    zones: dict[str, dict[str, Any]],
    offen: int,
    now: float,
    schon_erinnert: dict[str, float],
) -> list[dict[str, Any]]:
    """Für welche Läden jetzt eine Erinnerung fällig ist (rein, testbar).

    `zones` bildet die Zonenkennung auf ihren Zustand ab, so wie die
    Geofence-Integration ihn führt: `state` und `changed_at`.

    `schon_erinnert` merkt sich je Zone, für welchen Aufenthalt bereits
    erinnert wurde - verglichen wird der Zeitpunkt des Betretens. Beim
    nächsten Besuch ist der ein anderer, und die Erinnerung kommt wieder.
    Ohne das käme sie jede Minute erneut, und man schaltete sie ab.
    """
    if offen <= 0:
        return []
    faellig = []
    for shop in shops:
        if not isinstance(shop, dict):
            continue
        zone = str(shop.get("zone") or "").strip()
        if not zone:
            continue
        stand = zones.get(zone)
        if not stand or stand.get("state") != "home":
            continue
        seit = stand.get("changed_at")
        if not isinstance(seit, (int, float)):
            continue
        if now - seit < STAY_SECONDS:
            continue
        if schon_erinnert.get(zone) == seit:
            continue
        faellig.append(shop)
    return faellig


def describe(shop: dict[str, Any], offen: list[dict[str, Any]]) -> tuple[str, str]:
    """Titel und Text der Nachricht (rein, testbar).

    Die ersten Einträge stehen darin, nicht bloss die Anzahl: «5 Einträge»
    zwingt zum Nachsehen, «Milch, Brot, Rüebli …» beantwortet die Frage
    oft schon auf dem Sperrbildschirm.
    """
    name = str(shop.get("name") or "Laden")
    texte = [str(row.get("text") or "").strip() for row in offen]
    texte = [text for text in texte if text]
    kopf = ", ".join(texte[:4])
    if len(texte) > 4:
        kopf += f" und {len(texte) - 4} weitere"
    return (f"Du bist im {name}", kopf or f"{len(offen)} Einträge auf der Liste")
