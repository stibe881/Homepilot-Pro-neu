"""Bluetooth-Anhänger: wo liegt der Schlüssel?

**Zuerst das, was nicht geht: AirTags.** Ein AirTag lässt sich nicht
anbinden, und das ist kein Mangel des Hubs. Er sendet seine Kennung
verschlüsselt und wechselt sie ständig; wiedererkennen kann ihn nur, wer
den privaten Schlüssel des Besitzers hat, und den hält Apple im Telefon.
Eine öffentliche Schnittstelle zu «Wo ist?» gibt es nicht. Alles, was
trotzdem damit wirbt, meldet sich mit dem Apple-Konto an einem
undokumentierten Dienst an - das fliegt beim nächsten Umbau auf, und
das Konto ist dabei im Spiel. Dafür ist die Frage «wo liegt der
Schlüssel?» zu klein.

**Was geht: Anhänger mit fester Kennung.** iBeacon- und
Eddystone-Anhänger senden dieselbe Kennung an jeden, der zuhört. Wer im
Haus ein paar Empfänger verteilt (ESPresense auf ESP32, Theengs
Gateway), bekommt je Zimmer eine Entfernungsschätzung über MQTT. Aus
diesen Meldungen wird hier das Zimmer gerechnet, in dem der Anhänger
gerade liegt.

Zwei Entscheidungen:

*Das nächste Zimmer, nicht das lauteste.* Gerechnet wird über die
gemeldete Entfernung, nicht über die Signalstärke - die schwankt mit
jeder Wand.

*Ein Zimmer wechselt erst, wenn es deutlich näher ist.* Ohne diese
Schwelle springt ein Anhänger auf dem Küchentisch die halbe Nacht
zwischen Küche und Wohnzimmer hin und her, weil zwei Empfänger fast
gleich weit weg sind. Beide Zimmer wären richtig; der Wechsel ist es
nicht.

Hier steht nur das Rechnen. Wer die Meldungen holt, ist
integrations/bletags.py.
"""

from __future__ import annotations

from typing import Any

#: So lange gilt eine Zimmer-Meldung. Danach zählt sie nicht mehr: Ein
#: Empfänger, der seit fünf Minuten schweigt, sagt nichts darüber, wo
#: der Anhänger *jetzt* liegt.
FRIST = 120.0

#: Um so viel näher muss ein anderes Zimmer sein, damit gewechselt wird.
#: Ein halber Meter Unterschied zwischen zwei Empfängern ist Rauschen,
#: kein Umzug.
WECHSEL_MARGE = 1.0


def thema_lesen(topic: str, basis: str = "espresense") -> tuple[str, str] | None:
    """«espresense/devices/apple:123/Buero» → (Kennung, Zimmer) (rein).

    None für alles andere - Telemetrie, Einstellungen, fremde Themen.
    """
    teile = [teil for teil in str(topic or "").split("/") if teil]
    if len(teile) != 4:
        return None
    wurzel, art, kennung, zimmer = teile
    if wurzel != basis or art != "devices" or not kennung or not zimmer:
        return None
    return kennung, zimmer


def abstand(payload: Any) -> float | None:
    """Die gemeldete Entfernung in Metern (rein, testbar).

    ESPresense schickt ``distance``; fehlt sie, ist die Meldung für uns
    wertlos - aus der blossen Signalstärke ohne Kalibrierung eine
    Entfernung zu raten wäre eine erfundene Zahl.
    """
    if not isinstance(payload, dict):
        return None
    try:
        meter = float(payload.get("distance"))
    except (TypeError, ValueError):
        return None
    if meter < 0 or meter > 100:
        return None
    return round(meter, 1)


def melden(
    meldungen: Any, zimmer: str, meter: float, jetzt: float
) -> dict[str, dict[str, Any]]:
    """Eine Zimmer-Meldung eintragen (rein, testbar).

    Je Zimmer die letzte: Zwei Empfänger im selben Zimmer gibt es nicht,
    und die jüngere Meldung ist die richtige.
    """
    stand = {
        name: eintrag
        for name, eintrag in (meldungen or {}).items()
        if isinstance(eintrag, dict)
    }
    stand[str(zimmer)] = {"distance": float(meter), "at": float(jetzt)}
    return stand


def zustand(
    meldungen: Any, jetzt: float, bisher: str | None = None, frist: float = FRIST
) -> dict[str, Any]:
    """Wo der Anhänger liegt (rein, testbar).

    ``bisher`` ist das zuletzt gemeldete Zimmer - es bleibt stehen,
    solange kein anderes deutlich näher ist (WECHSEL_MARGE). Ohne
    frische Meldung heisst es «weg»: Ein Anhänger, den kein Empfänger
    mehr hört, ist nicht im letzten Zimmer, sondern ausser Haus.
    """
    frisch = {
        name: eintrag
        for name, eintrag in (meldungen or {}).items()
        if isinstance(eintrag, dict) and jetzt - float(eintrag.get("at") or 0) <= frist
    }
    if not frisch:
        return {"state": "weg", "room": None, "distance": None}
    naechstes = min(frisch.items(), key=lambda paar: float(paar[1].get("distance") or 999))
    name, eintrag = naechstes
    alt = frisch.get(str(bisher or ""))
    if (
        bisher
        and alt is not None
        and float(alt.get("distance") or 999)
        <= float(eintrag.get("distance") or 999) + WECHSEL_MARGE
    ):
        # Das bisherige Zimmer ist nicht deutlich weiter weg - dann
        # bleibt es. Sonst springt der Schlüssel auf dem Küchentisch die
        # halbe Nacht zwischen Küche und Wohnzimmer.
        name, eintrag = str(bisher), alt
    return {
        "state": name,
        "room": name,
        "distance": round(float(eintrag.get("distance") or 0), 1),
    }
