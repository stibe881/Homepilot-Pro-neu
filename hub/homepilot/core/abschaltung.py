"""Wann ein Gerät von selbst wieder ausgeht - und wer es sehen soll.

Ein Ablauf schaltet das Licht ein und nach dreissig Minuten wieder aus.
Der Hub weiss das die ganze Zeit; im Haus wusste es niemand. Man stand
im Kinderzimmer und riet: Geht es gleich aus oder erst in einer halben
Stunde? Wer nicht warten wollte, schaltete von Hand - und damit den
Ablauf gleich mit ins Leere.

Der Ablauf trägt darum einen Schalter «Restzeit anzeigen» (Automation.
countdown). Ist er an, schreibt die Ablauf-Maschine den Zeitpunkt des
geplanten Ausschaltens als ``off_at`` in den Zustand der Entität - eine
Unix-Sekunde, kein Text und kein Takt: Die App zählt selbst herunter,
und der Hub schickt nur zweimal etwas, beim Setzen und beim Löschen.

Bewusst im Zustand und nicht in einer eigenen Liste: So reist die
Auskunft denselben Weg wie alles andere (Schnappschuss, state_changed,
Zwischenspeicher der App) und steht damit überall dort, wo das Gerät
ohnehin schon steht - auf der Kachel, in der Raumkarte, im
«Lichter an»-Blatt. Eine eigene Liste hätte drei neue Wege gebraucht
und wäre an der ersten Stelle, die jemand vergisst, stumm geblieben.

Hier steht die entscheidbare Hälfte; das Setzen und Löschen wohnt in
core/automation.py.
"""

from __future__ import annotations

from typing import Any

#: Das Feld im Zustand der Entität. Unix-Sekunden, ``None`` heisst:
#: nichts geplant (und muss ausdrücklich gesetzt werden, sonst klebt der
#: alte Wert fest - siehe core/registry.update_state).
FELD = "off_at"

#: Schritte, die eine Wartezeit sind. Nach der ersten davon hört die
#: Vorschau auf: Was danach kommt, ist der nächste Abschnitt und nicht
#: mehr das, worauf gerade gewartet wird.
_WARTEN = ("delay", "wait_until", "fade")


def ziele_nach(actions: list[dict[str, Any]], index: int) -> list[str]:
    """Welche Geräte nach dieser Wartezeit ausgehen (rein, testbar).

    Gelesen wird nur bis zur nächsten Wartezeit: «an - 30 Min warten -
    aus - 10 Min warten - Nachricht» hat zwei Abschnitte, und während
    der ersten halben Stunde stimmt nur der erste.

    Bewusst eng: nur das ausdrückliche Ausschalten (``turn_off``). Was
    eine Szene oder ein «gemeinsam umschalten» am Ende tut, hängt vom
    Zustand in dreissig Minuten ab - eine Restzeit, die sich als falsch
    herausstellt, ist schlimmer als keine.
    """
    ziele: list[str] = []
    for action in actions[index + 1 :]:
        if not isinstance(action, dict):
            continue
        art = str(action.get("type") or "command")
        if art in _WARTEN:
            break
        if art != "command" or str(action.get("command") or "") != "turn_off":
            continue
        entity_id = str(action.get("entity_id") or "").strip()
        if entity_id and entity_id not in ziele:
            ziele.append(entity_id)
    return ziele


def rest(off_at: Any, jetzt: float) -> float | None:
    """Wie viele Sekunden noch (rein, testbar).

    ``None`` bei allem, was keine Zahl ist oder in der Vergangenheit
    liegt: Ein abgelaufener Zeitpunkt ist keine Restzeit, sondern ein
    Rest, den jemand zu löschen vergessen hat.
    """
    if not isinstance(off_at, (int, float)) or isinstance(off_at, bool):
        return None
    uebrig = float(off_at) - jetzt
    return uebrig if uebrig > 0 else None
