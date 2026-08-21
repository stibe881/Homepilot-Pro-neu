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

import re
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


# So viele Namen merkt sich der Hub für die Vervollständigung. Zweihundert
# decken einen Haushalt mit Abstand ab; die Grenze steht nur da, damit die
# Liste nach Jahren nicht unbemerkt wächst.
KNOWN_LIMIT = 200


def remember(known: list[Any], text: str, limit: int = KNOWN_LIMIT) -> list[str]:
    """Einen eingekauften Artikel ins Gedächtnis aufnehmen (rein, testbar).

    Wozu: Wer «Milch» zum zwanzigsten Mal einträgt, soll ihn nicht zum
    zwanzigsten Mal ausschreiben müssen. Erledigte Einträge werden
    irgendwann entfernt - die Liste selbst taugt deshalb nicht als
    Gedächtnis.

    Der zuletzt benutzte Name steht vorn: Ein Vorschlag ist umso besser,
    je frischer er ist. Gross-/Kleinschreibung unterscheidet nicht -
    «milch» und «Milch» sind derselbe Posten, und behalten wird die
    zuletzt getippte Schreibweise. Leeres wird nicht gemerkt.
    """
    name = str(text or "").strip()
    if not name:
        return [str(entry) for entry in known if str(entry).strip()]
    unten = name.lower()
    rest = [
        str(entry)
        for entry in known
        if str(entry).strip() and str(entry).strip().lower() != unten
    ]
    return [name, *rest][: max(1, limit)]


# Woran ein Wort endet: Leerzeichen und die Zeichen, die in Artikelnamen
# tatsächlich vorkommen («H-Milch», «Reis/Nudeln», «Brot, dunkel»).
WORD_BREAK = re.compile(r"[\s\-/,.;:()\[\]&+]+")


def words(name: str) -> list[str]:
    """Die Wörter eines Artikelnamens, kleingeschrieben (rein, testbar)."""
    return [teil for teil in WORD_BREAK.split(str(name).lower()) if teil]


def suggestions(known: list[Any], query: str, limit: int = 8) -> list[str]:
    """Vorschläge zu einem angetippten Anfang (rein, testbar).

    Verglichen wird an Wortanfängen, nicht irgendwo im Namen: Wer «mi»
    tippt, meint «Milch», und «Salami» als Vorschlag zu bekommen, weil
    das Wort zufällig so endet, hilft niemandem. «H-Milch» und «Bio
    Milch» kommen dagegen mit - dort fängt ein Wort so an.

    Der Anfang des ganzen Namens schlägt den eines späteren Wortes:
    «Milch» steht vor «H-Milch». Ohne Eingabe kommen die zuletzt
    benutzten Namen; das ist beim leeren Feld der nützlichste Anfang,
    denn eingekauft wird meistens dasselbe.
    """
    namen = [str(entry) for entry in known if str(entry).strip()]
    suche = str(query or "").strip().lower()
    if not suche:
        return namen[:limit]
    vorn = [name for name in namen if name.lower().startswith(suche)]
    spaeter = [
        name
        for name in namen
        if name not in vorn and any(wort.startswith(suche) for wort in words(name))
    ]
    return [*vorn, *spaeter][:limit]
