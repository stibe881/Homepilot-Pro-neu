"""Ob ein Ablauf aus bekannten Bausteinen besteht (rein, testbar).

Punkt 378 der Werkbank. Ein unbekannter Aktions- oder Bedingungstyp lief
bisher nur in ein ``log.warning`` (core/automation.py) - und zwar erst
beim *Ausführen*, still, ohne dass die App je etwas davon erfuhr. Ein
Tippfehler im Aktionstyp («nofify» statt «notify») ergab einen Ablauf,
der sich speichern liess, lief und nichts tat - bis jemand zufällig den
Log las.

Hier wird beim *Speichern* geprüft, in `api/routes/automations.py`
gerufen. Die Wortlisten stehen bewusst hier und nicht als Ableitung aus
der Ausführung selbst: Eine automatisch aus den ``elif``-Zweigen
abgeleitete Liste würde bei jedem neuen Aktionstyp stillschweigend
mitwachsen - und genau den Tippfehler nicht mehr melden, den sie melden
soll, wenn er zufällig wie ein alter Zweig aussieht.

Geprüft werden Aktionen (auch verschachtelt in ``if``/``repeat``) und
Bedingungen (auch verschachtelt in ``group``). Auslöser bleiben aussen
vor: Ihre Formen sind über weit mehr Stellen verteilt (state, threshold,
interval, time, sun, calendar, geofence, presence, weather_warning,
power_restore, availability, dazu die Sonderfälle Wandtaster und
Ereignis-Marken) - eine unvollständige Liste dort risikiert, echte
Auslöser als «unbekannt» abzuweisen, und das wäre schlimmer als die
Lücke, die diese Prüfung schliessen soll.
"""

from __future__ import annotations

from typing import Any

#: Dieselben Wörter wie in core/automation.py:_execute_action.
ACTION_TYPES: frozenset[str] = frozenset(
    {
        "command",
        "delay",
        "light",
        "toggle_all",
        "wait_until",
        "fade",
        "scene",
        "hue_scene",
        "automation",
        "if",
        "repeat",
        "notify",
        "broadcast",
        "presence",
        "music",
    }
)

#: Dieselben Wörter wie in core/automation.py:_check_condition.
CONDITION_TYPES: frozenset[str] = frozenset({"group", "state", "time", "sun"})


def _aktionen_pruefen(actions: Any, pfad: str, fehler: list[str]) -> None:
    if not isinstance(actions, list):
        return
    for index, action in enumerate(actions):
        if not isinstance(action, dict):
            continue
        # Wie in _execute_action: ohne Angabe gilt "command".
        atype = str(action.get("type") or "command")
        stelle = f"{pfad}[{index}]"
        if atype not in ACTION_TYPES:
            fehler.append(f"Unbekannter Aktionstyp «{atype}» ({stelle})")
            continue
        if atype == "if":
            _bedingung_pruefen(action.get("condition"), f"{stelle}.condition", fehler)
            _aktionen_pruefen(action.get("then"), f"{stelle}.then", fehler)
            _aktionen_pruefen(action.get("else"), f"{stelle}.else", fehler)
        elif atype == "repeat":
            _aktionen_pruefen(action.get("actions"), f"{stelle}.actions", fehler)


def _bedingung_pruefen(condition: Any, pfad: str, fehler: list[str]) -> None:
    if not isinstance(condition, dict):
        return
    # Wie in _check_condition: ohne Angabe gilt "state".
    ctype = str(condition.get("type") or "state")
    if ctype not in CONDITION_TYPES:
        fehler.append(f"Unbekannter Bedingungstyp «{ctype}» ({pfad})")
        return
    if ctype == "group":
        for index, teil in enumerate(condition.get("conditions") or []):
            _bedingung_pruefen(teil, f"{pfad}.conditions[{index}]", fehler)


def pruefen(entry: dict[str, Any]) -> list[str]:
    """Alle unbekannten Bausteine eines Ablaufs (rein, testbar).

    Leer, wenn alles bekannt ist - der Regelfall. Prüft ``action`` und
    ``otherwise`` (die Aktionslisten) sowie ``condition`` (eine flache
    Liste am Ablauf, wie sie `automation.conditions` hält).
    """
    fehler: list[str] = []
    _aktionen_pruefen(entry.get("action"), "action", fehler)
    _aktionen_pruefen(entry.get("otherwise"), "otherwise", fehler)
    for index, teil in enumerate(entry.get("condition") or []):
        _bedingung_pruefen(teil, f"condition[{index}]", fehler)
    return fehler
