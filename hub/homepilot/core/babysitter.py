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

**Die Frist kommt aus dem früheren Gästemodus.** Den gab es daneben,
für «Besuch kommt», und er tat fast dasselbe - nur gröber: Er pausierte
*alle* Abläufe, auch die ausdrücklich freigegebenen, und zwar still.
Zwei Modi für einen Fall («es ist jemand da, den die Anwesenheit nicht
kennt») waren zwei Stellen zum Nachsehen und eine zum Vergessen. Was
er wirklich konnte, steht jetzt hier: Mit Frist endet der Modus von
selbst, denn an dem Abend, an dem er läuft, denkt garantiert niemand
ans Ausschalten. Ohne Frist läuft er wie bisher, bis ihn jemand
abschaltet - für den Babysitter-Abend, an dem man ans Ausschalten
denkt, ist das richtig.

Ein «Empfangslicht» (Lampen, die beim Einschalten angehen und am Ende
wieder wie vorher stehen) gab es hier eine Weile auch - es wurde nicht
gebraucht und ist zurückgebaut. Ein alter Eintrag mit ``undo`` im
Datenspeicher stört nicht: ``read`` liest nur, was es kennt.
"""

from __future__ import annotations

import logging
from typing import Any

log = logging.getLogger(__name__)

#: Wo der Zustand liegt.
KEY = "babysitter"

#: Wie lange ein Besuch dauert, wenn jemand eine Frist will, aber keine
#: nennt. Vier Stunden decken einen Abend ab; wer länger bleibt,
#: verlängert mit einem zweiten Druck.
STUNDEN_VORGABE = 4.0
#: Länger als einen Tag ist kein Besuch mehr, sondern ein Umzug - und
#: eine Frist, die man vergisst, ist keine Frist.
MAX_STUNDEN = 24.0


def stunden_pruefen(wert: Any) -> float:
    """Eine brauchbare Dauer daraus machen (rein, testbar)."""
    try:
        stunden = float(wert)
    except (TypeError, ValueError):
        return STUNDEN_VORGABE
    if stunden <= 0:
        return STUNDEN_VORGABE
    return min(stunden, MAX_STUNDEN)


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
    leer = {"active": False, "allow": [], "since": None, "until": None}
    if isinstance(roh, list):
        roh = next((x for x in roh if isinstance(x, dict)), None)
    if not isinstance(roh, dict):
        return leer
    allow = roh.get("allow")
    roh_bis = roh.get("until")
    try:
        bis = float(roh_bis) if roh_bis is not None else None
    except (TypeError, ValueError):
        bis = None
    return {
        "active": bool(roh.get("active")),
        "allow": sorted({str(x) for x in allow if str(x)}) if isinstance(allow, list) else [],
        "since": roh.get("since"),
        # Ohne Frist läuft er, bis jemand ausschaltet - das ist der
        # Babysitter-Abend. Mit Frist endet er von selbst.
        "until": bis,
    }


def laeuft(roh: Any, jetzt: float) -> bool:
    """Läuft der Modus gerade? (rein, testbar)

    Die Frist sticht den Schalter: Ein Eintrag, dessen Zeit abgelaufen
    ist, gilt als aus, auch wenn ihn noch niemand aufgeräumt hat. Sonst
    hinge das ganze Haus an einer Aufräumrunde, die aus irgendeinem
    Grund nicht lief.
    """
    stand = read(roh)
    if not stand["active"]:
        return False
    return stand["until"] is None or stand["until"] > jetzt


def restminuten(roh: Any, jetzt: float) -> int:
    """Wie lange noch – aufgerundet auf Minuten (rein, testbar).

    ``0`` heisst «keine Frist» genauso wie «vorbei». Wer die Zahl
    anzeigt, fragt vorher ``laeuft``.
    """
    stand = read(roh)
    if not laeuft(roh, jetzt) or stand["until"] is None:
        return 0
    return max(1, int((stand["until"] - jetzt + 59) // 60))


def is_allowed(roh: Any, automation_id: str) -> bool:
    """Darf dieser Ablauf im Modus laufen? (rein, testbar)"""
    return str(automation_id) in read(roh)["allow"]


def blocks(roh: Any, automation_id: str, jetzt: float) -> bool:
    """Hält der Modus diesen Ablauf gerade zurück? (rein, testbar)

    Ist der Modus aus oder abgelaufen, hält er nichts zurück - dann
    spielt die Liste keine Rolle, und ein Haken bleibt trotzdem stehen.
    Wer den Modus abends wieder einschaltet, muss nicht neu anhaken.
    """
    if not laeuft(roh, jetzt):
        return False
    return str(automation_id) not in read(roh)["allow"]


def toggle(roh: Any, automation_id: str, on: bool) -> dict[str, Any]:
    """Einen Ablauf frei- oder zurückgeben (rein, testbar)."""
    stand = read(roh)
    erlaubt = set(stand["allow"])
    if on:
        erlaubt.add(str(automation_id))
    else:
        erlaubt.discard(str(automation_id))
    return {**stand, "allow": sorted(erlaubt)}


def starten(
    roh: Any,
    jetzt: float,
    *,
    stunden: Any = None,
) -> dict[str, Any]:
    """Den Modus einschalten (rein, testbar).

    ``stunden`` ist freiwillig: Ohne läuft er, bis jemand ausschaltet.
    Der Zeitstempel ist keine Zierde - «seit 19:40» beantwortet am
    nächsten Morgen die Frage, ob jemand vergessen hat auszuschalten.

    Die Freigabeliste überlebt das Ein- und Ausschalten: Wer einmal
    angehakt hat, soll das nicht jeden Abend wiederholen.
    """
    stand = read(roh)
    return {
        **stand,
        "active": True,
        "since": jetzt,
        "until": jetzt + stunden_pruefen(stunden) * 3600 if stunden is not None else None,
    }


def beenden(roh: Any) -> dict[str, Any]:
    """Aus – ohne Rest, an dem später jemand hängenbliebe (rein, testbar).

    Nur die Freigabeliste bleibt: Sie gehört zum Haus, nicht zum Abend.
    """
    return {**read(roh), "active": False, "since": None, "until": None}


def set_active(roh: Any, active: bool, *, now: float | None = None) -> dict[str, Any]:
    """Der alte Weg: ein- oder ausschalten, ohne Frist und ohne Licht.

    Bleibt, weil der Schalter in den Abläufen genau das tut - und weil
    ein Aufrufer, der keine Frist will, keine nennen können muss.
    """
    if active:
        return starten(roh, now if now is not None else 0.0)
    return beenden(roh)


def summary(roh: Any, automation_ids: list[str], jetzt: float) -> dict[str, Any]:
    """Was die App über den Modus wissen will (rein, testbar).

    ``paused`` ist die Zahl, die vor dem Einschalten zählt: «17 Abläufe
    ruhen dann» ist die Auskunft, die man braucht, bevor man drückt.
    """
    stand = read(roh)
    an = laeuft(roh, jetzt)
    erlaubt = [x for x in automation_ids if x in stand["allow"]]
    return {
        "active": an,
        "since": stand["since"] if an else None,
        "until": stand["until"] if an else None,
        "minutes_left": restminuten(roh, jetzt),
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


async def beenden_ausfuehren(hub: Any, grund: str) -> dict[str, Any]:
    """Den Modus beenden - die Abläufe greifen wieder.

    Aufgerufen von der Route (jemand drückt «beenden») und vom Wächter
    (die Frist ist um); beide sollen dasselbe tun, also steht es einmal
    da.
    """
    import time

    hub.data.set(KEY, store(beenden(hub.data.get(KEY))))
    log.info("Babysitter-Modus beendet (%s)", grund)
    return summary(
        hub.data.get(KEY),
        [a.id for a in hub.automations.automations],
        time.time(),
    )
