"""Szenen rückgängig machen – und zwar nur das, was sie geändert haben.

Eine Szene «Kino» schaltet Musik ein, das Licht aus und den Fernseher
aus. Der zweite Druck soll das zurücknehmen. Der Reiz liegt im Detail:

  * War der Fernseher vorher **an**, gehört er beim Rückgängigmachen
    wieder an.
  * War er vorher schon **aus**, hat die Szene an ihm nichts geändert –
    dann darf der Rückweg ihn auch nicht einschalten. Sonst geht beim
    zweiten Druck ein Gerät an, das den ganzen Abend aus war.

Deshalb wird nicht der Vorzustand aller beteiligten Geräte gespeichert,
sondern nur der jener, die sich durch die Szene tatsächlich verändert
haben. Was gleich blieb, taucht im Rückweg gar nicht erst auf.

Hier steht nur das Rechnen: Zustand rein, Befehle raus. Wer sie
ausführt, ist der SceneManager.
"""

from __future__ import annotations

from typing import Any

#: Gerätearten, die kein Rückgängig kennen. Eine Alarmanlage schaltet
#: man nicht aus Versehen scharf und wieder unscharf, und ein
#: Saugroboter, der mitten im Raum umkehrt, hilft niemandem.
OHNE_RUECKWEG = frozenset({"alarm", "vacuum", "camera"})


def _zahl(wert: Any) -> int | None:
    try:
        return round(float(wert))
    except (TypeError, ValueError):
        return None


def zielzustand(action: dict[str, Any]) -> dict[str, Any]:
    """Was diese Aktion aus dem Gerät macht (rein, testbar).

    Gibt die Felder zurück, die sich danach am Gerät ablesen lassen
    müssten - genau die werden später verglichen. Ein leeres Ergebnis
    heisst «lässt sich nicht vorhersagen» (etwa `toggle`), und dann wird
    das Gerät vom Rückweg ausgenommen: Raten wäre hier schlimmer als
    nichts tun.
    """
    command = str(action.get("command") or "")
    data = action.get("data") or {}
    if command == "turn_on":
        return {"state": "on"}
    if command == "turn_off":
        return {"state": "off"}
    if command == "set_brightness":
        hell = _zahl(data.get("brightness"))
        return {"state": "off" if hell == 0 else "on", "brightness": hell}
    if command == "set_position":
        return {"position": _zahl(data.get("position"))}
    if command == "open":
        return {"position": 100, "state": "open"}
    if command == "close":
        return {"position": 0, "state": "closed"}
    if command == "lock":
        return {"state": "locked"}
    if command in ("unlock", "unlatch", "open_door"):
        return {"state": "unlocked"}
    if command in ("play", "play_playlist", "play_url"):
        return {"state": "playing"}
    if command == "pause":
        return {"state": "paused"}
    if command == "set_volume":
        return {"volume": _zahl(data.get("volume"))}
    return {}


def hat_sich_geaendert(vorher: dict[str, Any], ziel: dict[str, Any]) -> bool:
    """Ändert die Aktion am Gerät überhaupt etwas? (rein, testbar)

    Der Fernseher, der schon aus war, ist der ganze Punkt: An ihm hat die
    Szene nichts getan, also gibt es an ihm auch nichts rückgängig zu
    machen.
    """
    if not ziel:
        # Nicht vorhersagbar (z.B. «umschalten») - dann lieber nicht raten.
        return False
    for feld, wert in ziel.items():
        if wert is None:
            continue
        alt = vorher.get(feld)
        if feld in ("brightness", "position", "volume"):
            alt_zahl = _zahl(alt)
            # Ein Licht, das aus war, hat keine Helligkeit im heutigen
            # Sinn - dass die Szene eine setzt, ist eine Änderung.
            if alt_zahl is None or alt_zahl != wert:
                return True
            continue
        if str(alt or "") != str(wert):
            return True
    return False


def rueckbefehl(
    kind: str, commands: list[str], vorher: dict[str, Any]
) -> dict[str, Any] | None:
    """Der Befehl, der den Zustand von vorher wiederherstellt (rein, testbar).

    None heisst «lässt sich nicht wiederherstellen» - dann bleibt das
    Gerät beim Rückgängigmachen unangetastet. Auch das ist eine Antwort:
    Ein halb zurückgesetzter Raum ist schlimmer als einer, bei dem man
    weiss, was fehlt.
    """
    if kind in OHNE_RUECKWEG:
        return None
    zustand = str(vorher.get("state") or "")

    if kind == "cover":
        position = _zahl(vorher.get("position"))
        if position is not None and "set_position" in commands:
            return {"command": "set_position", "data": {"position": position}}
        if zustand == "open" and "open" in commands:
            return {"command": "open"}
        if zustand == "closed" and "close" in commands:
            return {"command": "close"}
        return None

    if kind == "lock":
        # Nur zuschliessen, nie aufschliessen: Eine Türe, die sich beim
        # Rückgängigmachen öffnet, ist ein Sicherheitsloch.
        if zustand == "locked" and "lock" in commands:
            return {"command": "lock"}
        return None

    if kind == "media_player":
        if zustand == "playing" and "play" in commands:
            return {"command": "play"}
        if zustand in ("paused", "idle") and "pause" in commands:
            return {"command": "pause"}
        if zustand == "on" and "turn_on" in commands:
            return {"command": "turn_on"}
        if zustand == "off" and "turn_off" in commands:
            return {"command": "turn_off"}
        return None

    if zustand == "on":
        hell = _zahl(vorher.get("brightness"))
        if hell is not None and hell > 0 and "set_brightness" in commands:
            return {"command": "set_brightness", "data": {"brightness": hell}}
        if "turn_on" in commands:
            return {"command": "turn_on"}
        return None
    if zustand == "off" and "turn_off" in commands:
        return {"command": "turn_off"}
    return None


def plane_rueckweg(
    actions: list[dict[str, Any]], geraete: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """Der Rückweg zu einer Szene (rein, testbar).

    ``geraete`` bildet Entitäts-ID auf {kind, commands, state} ab - den
    Stand *vor* dem Auslösen. Zurück kommen die Befehle, die ihn
    wiederherstellen, und zwar nur für Geräte, an denen die Szene
    wirklich etwas verändert hat.

    Die Reihenfolge ist umgekehrt zur Szene: Was zuletzt geschaltet
    wurde, wird zuerst zurückgenommen. Bei Geräten, die voneinander
    abhängen (erst Fernseher an, dann App starten), ist das die
    richtige.
    """
    gesehen: set[str] = set()
    befehle: list[dict[str, Any]] = []
    for action in actions:
        entity_id = str(action.get("entity_id") or "")
        if not entity_id or entity_id in gesehen:
            # Nur die erste Aktion je Gerät: Ihr Vorzustand ist der, den
            # es wiederherzustellen gilt.
            continue
        gesehen.add(entity_id)
        info = geraete.get(entity_id)
        if not info:
            continue
        vorher = dict(info.get("state") or {})
        if not hat_sich_geaendert(vorher, zielzustand(action)):
            continue
        befehl = rueckbefehl(
            str(info.get("kind") or ""), list(info.get("commands") or []), vorher
        )
        if befehl is None:
            continue
        befehle.append({"entity_id": entity_id, **befehl})
    return list(reversed(befehle))


def szene_gilt_noch(
    actions: list[dict[str, Any]], geraete: dict[str, dict[str, Any]]
) -> bool:
    """Steht der Raum noch so, wie die Szene ihn hinterlassen hat? (rein)

    Danach entscheidet sich, ob der Knopf gefüllt aussieht. Wer nach der
    Szene das Licht von Hand wieder anschaltet, hat sie verlassen - dann
    wäre ein leuchtender Knopf eine Lüge, und der zweite Druck darauf
    eine Überraschung.

    Aktionen, deren Wirkung sich nicht ablesen lässt, zählen nicht mit.
    Bleibt gar nichts Prüfbares übrig, gilt die Szene als nicht aktiv:
    Lieber ein Knopf, der nicht leuchtet, als einer, der immer leuchtet.
    """
    geprueft = 0
    for action in actions:
        ziel = zielzustand(action)
        if not ziel:
            continue
        info = geraete.get(str(action.get("entity_id") or ""))
        if not info:
            continue
        zustand = dict(info.get("state") or {})
        for feld, wert in ziel.items():
            if wert is None:
                continue
            geprueft += 1
            if feld in ("brightness", "position", "volume"):
                ist = _zahl(zustand.get(feld))
                # Ein Prozentpunkt Abweichung ist kein Verlassen der
                # Szene: Dimmer runden, und Storen kommen selten genau
                # auf dem Wert zum Stehen.
                if ist is None or abs(ist - wert) > 2:
                    return False
            elif str(zustand.get(feld) or "") != str(wert):
                return False
    return geprueft > 0


def aus_befehle(
    entity_ids: list[str], geraete: dict[str, dict[str, Any]]
) -> list[dict[str, Any]]:
    """Die Aus-Befehle für die Geräte, die eine Szene verändert hat
    (rein, testbar).

    Für die Selbst-Ausschalt-Uhr der Szenen: Nach der Frist soll alles
    *aus*, was die Szene angefasst hat - nicht zurück in den vorherigen
    Zustand. Der Sternenhimmel um 19:30 soll um 20:15 dunkel sein, auch
    wenn das Licht vor der Szene an war: «vorher» ist nach einer Stunde
    kein Zustand mehr, den jemand zurückwill.

    Je Gerät der passende Aus-Befehl: turn_off, sonst pause (eine Box),
    sonst stop (eine Store hält wenigstens an). Kennt ein Gerät keinen
    davon, bleibt es unangetastet - lieber ein Licht zu viel an als ein
    Befehl, den es nicht gibt.
    """
    befehle: list[dict[str, Any]] = []
    gesehen: set[str] = set()
    for entity_id in entity_ids:
        if not entity_id or entity_id in gesehen:
            continue
        gesehen.add(entity_id)
        commands = (geraete.get(entity_id) or {}).get("commands") or []
        aus = next(
            (name for name in ("turn_off", "pause", "stop") if name in commands), None
        )
        if aus is not None:
            befehle.append({"entity_id": entity_id, "command": aus})
    return befehle

