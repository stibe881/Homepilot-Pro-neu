"""Wirkte der Ablauf? – nachsehen statt annehmen.

Im Lauf-Verlauf steht bisher «ausgeführt». Das heisst: Der Hub hat die
Befehle abgeschickt. Ob das Licht danach brannte, steht dort nicht – und
genau das ist die Frage, mit der man hinschaut. Ein Funkbefehl, der
nicht ankommt; eine Bridge, die gerade neu startet; eine Steckdose, die
jemand von Hand ausgeschaltet hat: Alle drei sehen im Protokoll aus wie
ein gelungener Lauf.

Ein paar Sekunden nach dem Lauf wird deshalb nachgesehen, ob am Gerät
auch anliegt, was der Befehl aus ihm machen sollte. Was ein Befehl
bewirken müsste, sagt ``szenenrueckweg.zielzustand`` – dieselbe Frage
wie beim Rückweg einer Szene, also dieselbe Antwort. Alles, was sich
nicht vorhersagen lässt («umschalten», eine Durchsage, ein
Wartezeit-Schritt), fällt dabei heraus: Bleibt nichts Prüfbares übrig,
gibt es kein Urteil. Lieber keine Auskunft als eine geratene.

Hier steht nur das Rechnen. Wer nachsieht, ist der AutomationManager.

Punkt 596 der Werkbank: Wissen allein half nicht - «wirkungslos» stand
im aufgeklappten Verlauf, den nachts niemand liest. Seither wird für
genau die Geräte, die fehlten, der Befehl noch einmal geschickt und
erneut nachgesehen (``nachfass_aktionen``); bleibt es dabei, geht eine
Meldung über den Weg von Punkt 465, einmal täglich je Ablauf.
"""

from __future__ import annotations

from typing import Any

from .szenenrueckweg import stimmt_ueberein, zielzustand

#: Felder, bei denen ein Prozentpunkt Abweichung kein Fehlschlag ist:
#: Dimmer runden, und Storen kommen selten genau auf dem Wert zum Stehen.
ZAHLENFELDER = frozenset({"brightness", "position", "volume"})
TOLERANZ = 2


def _zahl(wert: Any) -> int | None:
    try:
        return round(float(wert))
    except (TypeError, ValueError):
        return None


def pruefpunkte(actions: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Was sich nach dem Lauf nachprüfen lässt (rein, testbar).

    Je Gerät ein Punkt, und bei mehreren Befehlen an dasselbe Gerät zählt
    der letzte: Ein Ablauf, der das Licht einschaltet und am Ende wieder
    aus, soll hinterher ein dunkles Licht vorfinden und nicht bemängeln.
    """
    punkte: dict[str, dict[str, Any]] = {}
    for action in actions:
        entity_id = str(action.get("entity_id") or "")
        if not entity_id:
            continue
        ziel = {
            feld: wert
            for feld, wert in zielzustand(action).items()
            if wert is not None
        }
        if not ziel:
            continue
        # Zusammenlegen statt ersetzen: «einschalten» und danach «auf 40%»
        # sind zusammen der Zustand, den man erwartet.
        punkte[entity_id] = {**punkte.get(entity_id, {}), **ziel}
    return [
        {"entity_id": entity_id, "ziel": ziel} for entity_id, ziel in punkte.items()
    ]


def abgleich(
    punkte: list[dict[str, Any]], stand: dict[str, dict[str, Any]]
) -> dict[str, list[str]]:
    """Was danach wirklich anlag (rein, testbar).

    ``stand`` bildet Entitäts-ID auf den Zustand *nach* dem Lauf ab. Ein
    Gerät, das der Hub nicht mehr kennt, kommt in keiner der beiden
    Listen vor: Darüber lässt sich nichts sagen.

    Der Vergleich selbst ist derselbe wie beim Rückweg einer Szene
    (``stimmt_ueberein`` statt eines blossen Stringvergleichs) - eine
    ruhende Cast-Box zeigt «idle» oder «standby», nie wörtlich «paused»
    oder «off» (Punkt 650/653 der Werkbank). Ohne die Gleichsetzung
    meldete ein Ablauf, der eine solche Box pausiert oder ausschaltet,
    stets «wirkungslos» - auch dann, wenn genau dieselbe Aktion, als Teil
    einer Szene, bereits richtig als «gilt noch» galt (Punkt 740).
    """
    gewirkt: list[str] = []
    fehlt: list[str] = []
    for punkt in punkte:
        entity_id = str(punkt.get("entity_id") or "")
        zustand = stand.get(entity_id)
        if zustand is None:
            continue
        passt = True
        for feld, soll in (punkt.get("ziel") or {}).items():
            ist = zustand.get(feld)
            if feld in ZAHLENFELDER:
                ist_zahl = _zahl(ist)
                soll_zahl = _zahl(soll)
                if (
                    ist_zahl is None
                    or soll_zahl is None
                    or abs(ist_zahl - soll_zahl) > TOLERANZ
                ):
                    passt = False
            elif not stimmt_ueberein(feld, soll, ist):
                passt = False
            if not passt:
                break
        (gewirkt if passt else fehlt).append(entity_id)
    return {"ok": gewirkt, "fehlt": fehlt}


def urteil(ergebnis: dict[str, list[str]]) -> str | None:
    """«gewirkt», «teilweise», «wirkungslos» – oder gar nichts (rein).

    None heisst: Es gab nichts Prüfbares. Das ist keine schlechte
    Nachricht, sondern gar keine – und soll deshalb auch nicht als eine
    angezeigt werden.
    """
    ok = list(ergebnis.get("ok") or [])
    fehlt = list(ergebnis.get("fehlt") or [])
    if not ok and not fehlt:
        return None
    if not fehlt:
        return "gewirkt"
    if not ok:
        return "wirkungslos"
    return "teilweise"


def nachfass_aktionen(
    actions: list[dict[str, Any]], fehlt: list[str]
) -> list[dict[str, Any]]:
    """Welche Schritte noch einmal geschickt werden (rein, testbar).

    Je fehlendem Gerät der *letzte* Schritt, der ihm einen Zielzustand
    gab - derselbe, den ``pruefpunkte`` zusammengerechnet hat. Nur der
    letzte: Ein Ablauf «an, dann aus» soll beim Nachfassen ausschalten,
    nicht erst wieder ein. Wartezeiten, Durchsagen und alles ohne
    Zielzustand bleiben aussen vor - sie sind nicht das, was fehlte.
    """
    gesucht = set(fehlt)
    letzter: dict[str, dict[str, Any]] = {}
    for action in actions:
        entity_id = str(action.get("entity_id") or "")
        if entity_id not in gesucht:
            continue
        if not any(wert is not None for wert in zielzustand(action).values()):
            continue
        letzter[entity_id] = action
    return [letzter[entity_id] for entity_id in fehlt if entity_id in letzter]


def blieb_satz(ziel: dict[str, Any]) -> str:
    """«blieb an», «blieb aus», «blieb offen» … (rein, testbar).

    Der Satz in der Meldung soll sagen, was man im Zimmer sieht - nicht,
    welcher Befehl fehlschlug.
    """
    soll = str(ziel.get("state") or "")
    return {
        "off": "blieb an",
        "on": "blieb aus",
        "open": "blieb zu",
        "closed": "blieb offen",
        "locked": "blieb offen",
        "unlocked": "blieb verriegelt",
        "playing": "blieb still",
        "paused": "spielte weiter",
    }.get(soll, "folgte nicht")


def meldung(
    alias: str,
    punkte: list[dict[str, Any]],
    fehlt: list[str],
    name_of: Any,
) -> tuple[str, str]:
    """Titel und Text der Push-Meldung «Ablauf ohne Wirkung» (rein, testbar)."""
    ziele = {str(p.get("entity_id") or ""): p.get("ziel") or {} for p in punkte}
    teile = [f"{name_of(entity_id)} {blieb_satz(ziele.get(entity_id, {}))}" for entity_id in fehlt]
    return "Ablauf ohne Wirkung", f"{alias}: {', '.join(teile)}"
