"""Babysitter-Modus: jemand ist da, den die Anwesenheit nicht kennt.

Der Hub schliesst aus «kein Telefon zuhause» auf «niemand zuhause», und
das ist fast immer richtig. Nicht aber an dem Abend, an dem die Eltern
weg sind und der Babysitter im Wohnzimmer sitzt: Dann fährt «alles aus»
die Storen herunter, löscht das Licht und schaltet die Alarmanlage
scharf, während jemand darin sitzt und die Kinder schlafen.

Ihn deswegen ein Telefon anmelden zu lassen, hilft nicht - es ist genau
der Abend, an dem niemand Lust auf Einrichtung hat. Deshalb ein
Schalter: Solange der Modus läuft, ruhen alle Abläufe ausser den
ausdrücklich freigegebenen.

Freigegeben wird je Ablauf und unabhängig davon, wo er herkommt: Auch
ein Ablauf aus der config.yaml lässt sich anhaken, ohne die Datei
anzufassen. Die Liste liegt darum neben den Abläufen, nicht in ihnen.

Was der Modus *nicht* anfasst: alles, was nicht über Abläufe geht.
Wasser- und Rauchmelder, die Alarmanlage selbst und die Meldungen des
Wächters laufen weiter - sie sind kein Komfort, den man abschaltet.
"""

from __future__ import annotations

from typing import Any

#: Wo der Zustand liegt.
KEY = "babysitter"


def read(roh: Any) -> dict[str, Any]:
    """Den gespeicherten Zustand lesen (rein, testbar).

    Der Datenspeicher hält Listen - ein einzelner Zustand liegt deshalb
    als Liste mit einem Eintrag darin. Beides wird gelesen, damit ein
    von Hand geschriebener Eintrag nicht stillschweigend verfällt.

    Nachsichtig gegen alles, was da stehen könnte: Ein fehlender oder
    kaputter Eintrag heisst «Modus aus», nicht «Absturz». Ein Ablauf,
    der wegen eines Tippfehlers in einer Datei nicht mehr läuft, wäre
    die schlechtere Antwort.
    """
    if isinstance(roh, list):
        roh = next((x for x in roh if isinstance(x, dict)), None)
    if not isinstance(roh, dict):
        return {"active": False, "allow": [], "since": None}
    allow = roh.get("allow")
    return {
        "active": bool(roh.get("active")),
        "allow": sorted({str(x) for x in allow if str(x)}) if isinstance(allow, list) else [],
        "since": roh.get("since"),
    }


def is_allowed(roh: Any, automation_id: str) -> bool:
    """Darf dieser Ablauf im Modus laufen? (rein, testbar)"""
    return str(automation_id) in read(roh)["allow"]


def blocks(roh: Any, automation_id: str) -> bool:
    """Hält der Modus diesen Ablauf gerade zurück? (rein, testbar)

    Ist der Modus aus, hält er nichts zurück - dann spielt die Liste
    keine Rolle, und ein Haken bleibt trotzdem stehen. Wer den Modus
    abends wieder einschaltet, muss nicht neu anhaken.
    """
    stand = read(roh)
    return stand["active"] and str(automation_id) not in stand["allow"]


def toggle(roh: Any, automation_id: str, on: bool) -> dict[str, Any]:
    """Einen Ablauf frei- oder zurückgeben (rein, testbar)."""
    stand = read(roh)
    erlaubt = set(stand["allow"])
    if on:
        erlaubt.add(str(automation_id))
    else:
        erlaubt.discard(str(automation_id))
    return {**stand, "allow": sorted(erlaubt)}


def set_active(roh: Any, active: bool, *, now: float | None = None) -> dict[str, Any]:
    """Den Modus ein- oder ausschalten (rein, testbar).

    Der Zeitstempel ist keine Zierde: «seit 19:40» beantwortet am
    nächsten Morgen die Frage, ob jemand vergessen hat auszuschalten.
    """
    stand = read(roh)
    return {**stand, "active": bool(active), "since": now if active else None}


def summary(roh: Any, automation_ids: list[str]) -> dict[str, Any]:
    """Was die App über den Modus wissen will (rein, testbar).

    ``paused`` ist die Zahl, die vor dem Einschalten zählt: «17 Abläufe
    ruhen dann» ist die Auskunft, die man braucht, bevor man drückt.
    """
    stand = read(roh)
    erlaubt = [x for x in automation_ids if x in stand["allow"]]
    return {
        "active": stand["active"],
        "since": stand["since"],
        "allow": stand["allow"],
        "running": len(erlaubt),
        "paused": len(automation_ids) - len(erlaubt),
    }


def store(stand: dict[str, Any]) -> list[dict[str, Any]]:
    """Wie der Zustand in den Datenspeicher geht (rein, testbar).

    Der hält Listen; ein Zustand als blosses dict käme dort als Liste
    seiner Schlüssel wieder heraus.
    """
    return [stand]
