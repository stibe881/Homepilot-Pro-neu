"""Das Haus auf einem Blatt – für die Ferienvertretung.

Wer zwei Wochen giesst und die Katze füttert, bekommt sonst die App in
die Hand gedrückt und darf sich alles selbst zusammensuchen. Was er
wirklich braucht, passt auf eine Seite: welche Räume es gibt, was die
Szenen tun, und vor allem – was von selbst passiert. Ein Licht, das um
22 Uhr von allein ausgeht, erschreckt jemanden, der es nicht weiss.

Bewusst Text und kein PDF: Text lässt sich drucken, verschicken,
vorlesen und in eine Nachricht kopieren. Ein PDF könnte man nur drucken,
und dafür bräuchte es eine Bibliothek mehr.

Die Zusammenstellung ist rein und getestet – sie ist die Stelle, an der
etwas Wichtiges fehlen kann.
"""

from __future__ import annotations

from typing import Any

# Gerätearten, die auf dem Blatt nichts verloren haben. Ein Messwert ist
# nichts, was die Vertretung bedient, und dreissig Sensoren machen aus
# einer Seite drei.
NUR_ANZEIGE = frozenset({"sensor", "binary_sensor", "camera", "calendar", "weather"})

# Auslöserarten in Worten. Was hier fehlt, steht als roher Typ da – das
# ist hässlich, aber ehrlicher als es wegzulassen.
AUSLOESER = {
    "time": "zu einer festen Uhrzeit",
    "sun": "nach dem Sonnenstand",
    "state": "wenn ein Gerät sich ändert",
    "numeric_state": "wenn ein Messwert eine Schwelle überschreitet",
    "interval": "in festen Abständen",
    "event": "auf ein Ereignis hin",
}


def _zeile(text: str) -> str:
    return text.rstrip()


def hausblatt(
    *,
    haus: str,
    raeume: dict[str, list[dict[str, Any]]],
    szenen: list[dict[str, Any]],
    ablaeufe: list[dict[str, Any]],
    hinweise: list[str] | None = None,
) -> str:
    """Das Blatt als Text (rein, testbar).

    `raeume` bildet Raumname → Entitäten ab (schon gefiltert auf das, was
    die Person sehen darf). Reihenfolge wie hereingereicht: Sie kommt aus
    der config.yaml und ist die Reihenfolge, in der jemand durchs Haus
    geht.
    """
    zeilen: list[str] = [haus, "=" * len(haus), ""]

    zeilen.append("Räume und Geräte")
    zeilen.append("-" * 16)
    etwas_da = False
    for raum, entities in raeume.items():
        bedienbar = [
            entity
            for entity in entities
            if entity.get("kind") not in NUR_ANZEIGE and entity.get("commands")
        ]
        if not bedienbar:
            continue
        etwas_da = True
        namen = ", ".join(sorted(str(entity.get("name") or "") for entity in bedienbar))
        zeilen.append(_zeile(f"  {raum}: {namen}"))
    if not etwas_da:
        zeilen.append("  (nichts eingerichtet)")
    zeilen.append("")

    zeilen.append("Szenen – ein Tipp, mehrere Geräte")
    zeilen.append("-" * 33)
    if szenen:
        for szene in szenen:
            anzahl = len(szene.get("actions") or [])
            wo = f" ({szene['room']})" if szene.get("room") else ""
            zeilen.append(
                _zeile(f"  {szene.get('name', 'Ohne Namen')}{wo}: schaltet {anzahl} Gerät(e)")
            )
    else:
        zeilen.append("  (keine)")
    zeilen.append("")

    zeilen.append("Was von selbst passiert")
    zeilen.append("-" * 23)
    laufende = [a for a in ablaeufe if a.get("enabled", True)]
    if laufende:
        for ablauf in laufende:
            arten = []
            for trigger in ablauf.get("triggers") or []:
                wort = AUSLOESER.get(str(trigger.get("type")), str(trigger.get("type")))
                if wort not in arten:
                    arten.append(wort)
            zeilen.append(
                _zeile(f"  {ablauf.get('alias', 'Ablauf')} – {' und '.join(arten) or 'auf Zuruf'}")
            )
    else:
        zeilen.append("  (nichts)")
    zeilen.append("")

    if hinweise:
        zeilen.append("Gut zu wissen")
        zeilen.append("-" * 13)
        for hinweis in hinweise:
            zeilen.append(_zeile(f"  · {hinweis}"))
        zeilen.append("")

    return "\n".join(zeilen).rstrip() + "\n"
