"""Live-Karten auf dem iPhone-Sperrbildschirm - eine Form, viele Inhalte.

Die Haustür-Karte (liveaktivitaet.py) war die erste; hier kommen die
übrigen dazu: Küchen-Timer, laufende Waschmaschine, Grill-Temperatur,
Saugroboter, fällige Erinnerungen und die Alarmanlage. Statt je Karte
eine eigene Swift-Struktur zu bauen, gibt es **eine** generische
(HausAktivitaetAttributes in der App): Titel, Text, Symbol, wahlweise
Countdown und Fortschritt. Was auf der Karte steht, entscheidet allein
der Hub - eine neue Kartenart ist damit reiner Hub-Code.

Der Ablauf je Runde (TAKT_SEKUNDEN):

  1. Aus dem Zustand des Hauses die *gewünschten* Karten rechnen - reine
     Funktionen je Treiber, eine je Kartenart.
  2. Mit den *laufenden* Karten abgleichen: Neues starten (APNs
     «push-to-start»), Geändertes aktualisieren, Verschwundenes beenden.
  3. Merken, was läuft - samt der Aktivitäts-Tokens, die die App nach
     dem Start zurückmeldet (nur damit lässt sich aktualisieren und
     beenden).

Der Versand läuft über denselben Draht wie die Haustür-Karte
(liveaktivitaet.ApnsVersand); ohne apns-Block bleibt alles aus. Der
Profil-Schalter («Live-Aktivitäten», user_prefs.liveTuer) gilt auch
hier.
"""

from __future__ import annotations

import asyncio
import json
import logging
import time
from typing import Any
from urllib.parse import quote

from . import laufzeit, liveaktivitaet, presence

log = logging.getLogger(__name__)

TAKT_SEKUNDEN = 20.0

#: Muss wortgleich zum Strukturnamen in der App sein (modules/
#: live-aktivitaet und targets/widget) - Apple ordnet den Start-Push
#: allein über diesen Namen zu.
ATTRIBUTES_TYPE = "HausAktivitaetAttributes"

#: «push-to-start»-Tokens der Telefone für die generische Karte - ein
#: eigener Topf, denn Apple stellt sie **je Strukturtyp** aus; das
#: Haustür-Token passt hier nicht.
START_KEY = "live_start_tokens"

#: Was gerade läuft: {user, art, stand, activity_tokens, aktualisiert}.
KARTEN_KEY = "live_cards"

#: Frühestens alle so viele Sekunden ein Update je Karte - der Grill
#: meldet sonst im Sekundentakt, und Apple deckelt das Budget je
#: Aktivität ohnehin.
UPDATE_ABSTAND = 45.0


# ── Registrierung (rein, testbar) ─────────────────────────────────────────


def registrieren(rows: Any, user: str, token: str, label: str = "") -> list[dict[str, Any]]:
    """Ein Telefon für die generische Karte anmelden - ersetzt statt doppelt.

    Je Telefon und nicht je Token, aus demselben Grund wie bei der
    Haustür-Karte (liveaktivitaet.registrieren): Apple stellt das
    Start-Token immer wieder neu aus, und jede stehengebliebene Zeile
    ist später eine weitere Karte auf demselben Sperrbildschirm.

    Und wie dort: Eine Anmeldung MIT Gerätenamen räumt die namenlosen
    Zeilen desselben Kontos gleich mit weg - sie stammen aus Fassungen
    vor den Namen und sind fast sicher dasselbe Telefon von früher;
    jede war sonst eine doppelte Karte.
    """
    name = str(label or "")
    neue = [
        row
        for row in (rows or [])
        if isinstance(row, dict)
        and row.get("token") != token
        and not (
            name
            and str(row.get("user") or "") == user
            and str(row.get("label") or "") in ("", name)
        )
    ]
    neue.append({"user": user, "token": token, "label": label})
    return neue


def abmelden(rows: Any, token: str) -> list[dict[str, Any]]:
    return [
        row
        for row in (rows or [])
        if isinstance(row, dict) and row.get("token") != token
    ]


def token_merken(rows: Any, user: str, art: str, token: str) -> list[Any]:
    """Das Aktivitäts-Token einer laufenden Karte nachtragen (rein, testbar).

    Die App meldet es nach dem Start zurück; erst damit lassen sich
    Updates und das Ende schicken. Je Karte eine Liste - eine Person hat
    unter Umständen zwei Telefone, und beide zeigen dieselbe Karte.
    """
    neue = []
    for row in rows or []:
        if (
            isinstance(row, dict)
            and row.get("user") == user
            and row.get("art") == art
            and token not in (row.get("activity_tokens") or [])
        ):
            row = {**row, "activity_tokens": [*(row.get("activity_tokens") or []), token]}
        neue.append(row)
    return neue


# ── Die Treiber: aus Hauszustand werden gewünschte Karten ─────────────────
#
# Jede Karte: {"art": eindeutig, "user": Name oder None (= alle),
# "state": {titel, text, symbol, farbe?, endet?, fortschritt?, url?},
# "ende": {state?, sichtbar?}} - `ende` sagt, was beim Abräumen kurz
# stehen bleibt (die Waschmaschine darf «Fertig» sagen).


def karten_timer(timers: Any) -> list[dict[str, Any]]:
    """Je laufendem Küchen-Timer eine Karte mit Countdown."""
    karten = []
    for eintrag in timers or []:
        if not isinstance(eintrag, dict) or not eintrag.get("id"):
            continue
        karten.append(
            {
                "art": f"timer:{eintrag['id']}",
                "user": None,
                "state": {
                    "titel": "Küchen-Timer",
                    "text": str(eintrag.get("text") or ""),
                    "symbol": "timer",
                    "endet": float(eintrag.get("ends_at") or 0) or None,
                    "url": "homepilot://timer",
                },
            }
        )
    return karten


def raum_url(entity: Any) -> str | None:
    """Wohin ein Tipp auf die Geräte-Karte führt (rein, testbar).

    In den Raum des Geräts: Der Geschirrspüler steht in der Küche, die
    Waschmaschine in der Waschküche - dort ist die Kachel mit allem, was
    man nach dem Tipp wissen oder tun will. Vorher trug die Karte gar
    keine Adresse, und der Tipp öffnete bloss die Startseite.

    Ohne Raum keine Adresse: Dann bleibt es beim bisherigen Verhalten,
    statt in einen Raum zu springen, der nicht stimmt. Der Name wird
    kodiert - «Waschküche» trägt einen Umlaut, und die App entschlüsselt
    ihn wieder (decodeURIComponent im Adress-Handler).
    """
    raum = getattr(entity, "room", None)
    if not raum:
        return None
    return f"homepilot://raum/{quote(str(raum))}"


def _geraete_symbol(label: str) -> str:
    tief = label.lower()
    if "geschirr" in tief:
        return "dishwasher"
    if "trockner" in tief or "tumbler" in tief:
        return "dryer"
    return "washer"


def karten_geraete(
    entities: list[Any], cycles: Any = None, jetzt_s: float | None = None
) -> list[dict[str, Any]]:
    """Laufende Haushaltsgeräte - mit Countdown und Balken.

    Der Grill ist auch ein «appliance», bekommt aber seine eigene Karte
    (karten_grill) - erkennbar am Temperaturziel, das eine Waschmaschine
    nicht führt.

    Die Karte gab es schon, sie war aber blosser Text: «Buntwäsche · noch
    ~23 min», und diese Zahl blieb stehen, bis der nächste Push kam. Auf
    dem Sperrbildschirm, wo man im Vorbeigehen hinsieht, ist eine
    Minutenzahl von vor drei Minuten aber schlechter als keine.

    Zwei Felder, die die Karte längst kann (targets/widget/index.swift):
    ``endet`` zählt von selbst herunter - ohne einen einzigen weiteren
    Push -, und ``fortschritt`` zeigt, ob das viel oder wenig ist. Die
    Programmdauer wird dafür nicht geraten, sondern aus den letzten
    Läufen desselben Geräts geschätzt; ohne genug Läufe bleibt der
    Balken weg (core/laufzeit.py).
    """
    jetzt = time.time() if jetzt_s is None else jetzt_s
    karten = []
    for entity in entities:
        if entity.kind != "appliance" or entity.state.get("state") != "running":
            continue
        if entity.state.get("target") is not None:
            continue
        minuten = entity.state.get("minutes_left")
        programm = str(entity.state.get("program") or "läuft")
        try:
            rest = float(minuten) if minuten is not None else None
        except (TypeError, ValueError):
            rest = None
        # Mit Countdown gehört die Zahl nicht mehr in den Text: Sie
        # stünde zweimal da, einmal davon veraltet.
        text = programm if rest else (f"{programm} · noch ~{int(minuten)} min" if minuten else programm)
        anteil = laufzeit.fortschritt(rest, laufzeit.typische_dauer(cycles, entity.id))
        url = raum_url(entity)
        karten.append(
            {
                "art": f"geraet:{entity.id}",
                "user": None,
                "state": {
                    "titel": entity.label,
                    "text": text,
                    "symbol": _geraete_symbol(entity.label),
                    **({"endet": round(jetzt + rest * 60, 1)} if rest else {}),
                    **({"fortschritt": anteil} if anteil is not None else {}),
                    **({"url": url} if url else {}),
                },
                # Beim Programmende kurz «Fertig» stehen lassen - genau
                # der Moment, in dem die Karte ihren Zweck erfüllt.
                "ende": {
                    "state": {
                        "titel": entity.label,
                        "text": "Fertig - ausräumen",
                        "symbol": _geraete_symbol(entity.label),
                        # Auch auf «Fertig» führt der Tipp in den Raum -
                        # gerade dann will man zur Maschine.
                        **({"url": url} if url else {}),
                    },
                    "sichtbar": 900,
                },
            }
        )
    return karten


def karten_grill(entities: list[Any]) -> list[dict[str, Any]]:
    """Der Grill: Ist- gegen Zieltemperatur, live."""
    karten = []
    for entity in entities:
        if entity.kind != "appliance" or entity.state.get("state") != "running":
            continue
        ziel = entity.state.get("target")
        if ziel is None:
            continue
        ist = entity.state.get("temperature")
        text = f"{round(float(ist))}° → {round(float(ziel))}°" if ist is not None else f"Ziel {round(float(ziel))}°"
        url = raum_url(entity)
        karten.append(
            {
                "art": f"grill:{entity.id}",
                "user": None,
                "state": {
                    "titel": entity.label,
                    "text": text,
                    "symbol": "flame",
                    # Wie nah dran - für den Fortschrittsbalken.
                    "fortschritt": (
                        max(0.0, min(1.0, float(ist) / float(ziel)))
                        if ist is not None and float(ziel) > 0
                        else None
                    ),
                    **({"url": url} if url else {}),
                },
            }
        )
    return karten


def sauger_knoepfe(entity: Any) -> list[dict[str, Any]]:
    """Die Griffe auf der Sauger-Karte (rein, testbar).

    Pause bzw. Weiter je nach Zustand, dazu «zur Station» - und nur
    Befehle, die dieser Sauger wirklich kennt. Das Widget versteht die
    Knöpfe nicht: Es zeichnet das Symbol und ruft Pfad samt Body auf
    (targets/widget/index.swift, KartenBefehlIntent) - dieselbe
    Arbeitsteilung wie bei den Widget-Knöpfen. Alles Harmlose im Sinne
    der Sperrbildschirm-Regel (lib/mitteilungsknoepfe.ts): Wer das
    Telefon vom Tisch nimmt, kann höchstens den Sauger heimschicken.
    """
    befehle = getattr(entity, "commands", None) or []
    pfad = f"/api/entities/{entity.id}/command"

    def knopf(symbol: str, command: str) -> dict[str, Any]:
        return {"symbol": symbol, "pfad": pfad, "body": json.dumps({"command": command})}

    laeuft = entity.state.get("state") == "cleaning"
    knoepfe = []
    if laeuft and "pause" in befehle:
        knoepfe.append(knopf("pause.fill", "pause"))
    if not laeuft and "start" in befehle:
        # `start` setzt eine pausierte Reinigung fort - derselbe Befehl
        # wie in der App (VacuumHome).
        knoepfe.append(knopf("play.fill", "start"))
    if "dock" in befehle:
        knoepfe.append(knopf("house.fill", "dock"))
    return knoepfe


def karten_sauger(entities: list[Any]) -> list[dict[str, Any]]:
    """Der Saugroboter, solange er unterwegs ist.

    «cleaning» deckt seit integrations/roborock.py (zustand_name) auch
    das Reinigen einzelner Räume ab. Vorher blieb die Live-Karte beim
    Segmentreinigen ganz aus - also genau dann, wenn man den Sauger
    gezielt in die Küche geschickt hat und zusieht.

    «paused» gehört seit den Karten-Knöpfen dazu: Wer auf der Karte
    Pause drückt, soll dort auch Weiter drücken können - verschwände
    die Karte mit der Pause, nähme der eine Knopf den anderen mit.
    """
    karten = []
    for entity in entities:
        if entity.kind != "vacuum" or entity.state.get("state") not in (
            "cleaning",
            "paused",
        ):
            continue
        akku = entity.state.get("battery")
        flaeche = entity.state.get("clean_area_m2")
        teile = ["saugt" if entity.state.get("state") == "cleaning" else "pausiert"]
        if flaeche:
            teile.append(f"{flaeche} m²")
        if akku is not None:
            teile.append(f"Akku {int(akku)} %")
        url = raum_url(entity)
        knoepfe = sauger_knoepfe(entity)
        karten.append(
            {
                "art": f"sauger:{entity.id}",
                "user": None,
                "state": {
                    "titel": entity.label,
                    "text": " · ".join(teile),
                    "symbol": "fan",
                    **({"url": url} if url else {}),
                    **({"knoepfe": knoepfe} if knoepfe else {}),
                },
            }
        )
    return karten


#: Wann ein Fernseher als eingeschaltet gilt. «idle» und «standby»
#: fehlen bewusst: Ein Cast-Fernseher im Hintergrundbild ist kein
#: Fernsehabend, und eine Karte dafür wäre Dauermöblierung.
TV_AN = frozenset({"on", "playing", "paused", "buffering"})


def _tv_app(entity: Any) -> str | None:
    app = entity.state.get("app") or entity.state.get("track")
    return str(app) if app else None


def kino_knopf(szenen: list[Any]) -> dict[str, Any] | None:
    """Der Kino-Griff auf der Fernseher-Karte (rein, testbar).

    Der Fall: Der Film beginnt, das Licht ist noch hell - und die Szene
    «Kino» liegt vier Tipps tief in der App, während die Fernbedienung
    längst auf dem Sperrbildschirm liegt. Der Griff gehört daneben.

    Gefunden wird die Szene über ihren Namen: «Kino», Gross- und
    Kleinschreibung egal. Kein eigenes Einstellfeld - wer die Szene so
    nennt, hat sie für genau diesen Moment gebaut. Heisst keine so,
    gibt es keinen Knopf; heissen zwei so, auch nicht - lieber keiner
    als der falsche. Harmlos im Sinne der Sperrbildschirm-Regel
    (lib/mitteilungsknoepfe.ts): Die Szene ist ein selbst gewählter
    Lichtgriff, und der Hub prüft die Rechte ohnehin noch einmal.
    """
    treffer = [
        szene
        for szene in szenen or []
        if str(getattr(szene, "name", "") or "").strip().casefold() == "kino"
    ]
    if len(treffer) != 1:
        return None
    return {
        "symbol": "film.fill",
        "pfad": f"/api/scenes/{quote(str(treffer[0].id))}/activate",
        "body": "",
    }


def tv_auswahl(laufend: list[Any]) -> list[tuple[Any, str | None]]:
    """Je Bildschirm ein Gerät - Zwillinge zusammengelegt (rein, testbar).

    Derselbe Fernseher steht oft zweimal im Raum: als Zuspieler ohne
    Steuerkreuz (Cast, Plex) und als Android TV mit. Laufen beide, lagen
    zwei Karten für einen Bildschirm auf dem Sperrbildschirm -
    «Fernseher Wohnzimmer, eingeschaltet» über «Fernseher im Wohnzimmer,
    Plex». Genau so wurde es gemeldet.

    Dieselbe Regel wie auf der Raumkachel (app/src/lib/raumkarte.ts,
    fernbedienungFuer): Ein laufender Fernseher ohne Steuerkreuz gehört
    zum *einzigen* Steuerkreuz-Gerät seines Raums - bei zweien wird
    nicht geraten, und ohne Raum lässt sich kein Zwilling erkennen. Der
    Text des Zuspielers wandert mit: Er weiss, was läuft («Plex»), das
    Steuerkreuz-Gerät sagt oft nur «eingeschaltet».
    """
    nach_raum: dict[Any, list[Any]] = {}
    for entity in laufend:
        nach_raum.setdefault(getattr(entity, "room", None), []).append(entity)

    auswahl: list[tuple[Any, str | None]] = []
    for raum, gruppe in nach_raum.items():
        kreuze = [
            entity
            for entity in gruppe
            if "dpad_up" in (getattr(entity, "commands", None) or [])
        ]
        if raum is None or len(gruppe) == 1 or len(kreuze) != 1:
            auswahl.extend((entity, _tv_app(entity)) for entity in gruppe)
            continue
        gewinner = kreuze[0]
        app = _tv_app(gewinner)
        if not app:
            app = next(
                (
                    _tv_app(entity)
                    for entity in gruppe
                    if entity is not gewinner and _tv_app(entity)
                ),
                None,
            )
        auswahl.append((gewinner, app))
    return auswahl


def karten_tv(
    entities: list[Any],
    ohne: list[str] | None = None,
    szenen: list[Any] | None = None,
) -> list[dict[str, Any]]:
    """Der laufende Fernseher - ein Tipp öffnet seine Fernbedienung.

    Der Fall dahinter: Man sitzt vor dem Fernseher, das Telefon liegt
    daneben - und die Fernbedienung ist vier Tipps entfernt (App öffnen,
    Raum suchen, Kachel, Knopf). Solange er läuft, liegt sie jetzt einen
    Tipp weit auf dem Sperrbildschirm.

    Fernseher heisst: Medienspieler mit Bildschirm (``has_screen`` -
    dasselbe Merkmal, an dem auch die App Fernseher von Musikboxen
    trennt). Die Adresse führt zur Fernbedienung genau dieses Geräts,
    nicht in den Raum: Wer auf die Karte tippt, will umschalten, nicht
    nachsehen. Je Bildschirm eine Karte, auch wenn er zweimal im Hub
    steht (tv_auswahl).

    ``ohne`` sind die Leute, die gerade nachweislich nicht zuhause sind
    (nicht_zuhause) - für sie liegt keine Karte: Eine Fernbedienung im
    Zug ist nur eine Karte im Weg.

    ``szenen`` sind die Szenen des Hauses: Gibt es darunter genau eine
    namens «Kino», trägt die Karte deren Griff (kino_knopf).
    """
    laufend = [
        entity
        for entity in entities
        if entity.kind == "media_player"
        and entity.state.get("has_screen")
        and str(entity.state.get("state") or "") in TV_AN
    ]
    knopf = kino_knopf(szenen or [])
    karten = []
    for entity, app in tv_auswahl(laufend):
        karten.append(
            {
                "art": f"tv:{entity.id}",
                "user": None,
                **({"ohne": list(ohne)} if ohne else {}),
                "state": {
                    "titel": entity.label,
                    # Die laufende App als Text - «Netflix» sagt mehr als «an».
                    "text": app or "eingeschaltet",
                    "symbol": "tv",
                    "url": f"homepilot://fernbedienung/{quote(str(entity.id))}",
                    **({"knoepfe": [knopf]} if knopf else {}),
                },
            }
        )
    return karten


def nicht_zuhause(benutzer: list[str], zustaende: dict[str, str]) -> list[str]:
    """Wer ist nachweislich weg? (rein, testbar)

    «Weg» ist nur, wer ausdrücklich anderswo steht - ``away`` oder ein
    benannter Ort («schule»). Unbekannt zählt als zuhause: Wessen
    Telefon gerade nichts meldet (oder wer gar keine Ortung hat), soll
    die Fernseher-Karte trotzdem bekommen - dieselbe vorsichtige
    Richtung wie bei «jemand ist zuhause» (presence.anyone_home_state),
    nur dass hier im Zweifel eine Karte zu viel liegt statt das Haus
    herunterzufahren.
    """
    weg = []
    for name in benutzer:
        zustand = str(zustaende.get(name) or presence.UNKNOWN).strip().lower()
        if zustand not in (presence.HOME, "", presence.UNKNOWN):
            weg.append(name)
    return weg


def karten_erinnerungen(reminders: Any, jetzt_ms: float) -> list[dict[str, Any]]:
    """Fällige Erinnerungen - je Person, bis sie bestätigt hat.

    Dieselben Regeln wie das Vollbild in der App (lib/erinnerungen.ts):
    fällig, fürs Anzeigen bestimmt, nicht erledigt - und wer für sich
    quittiert hat, bekommt keine Karte mehr, die anderen schon. Darum
    sind das die einzigen Karten mit user=je Person statt «alle»: Die
    Empfänger stehen im Eintrag selbst (Abgleich in abgleich()).
    """
    karten = []
    for row in reminders or []:
        if not isinstance(row, dict) or not row.get("id"):
            continue
        if row.get("done") or row.get("anzeigen") is False:
            continue
        try:
            at = float(row.get("at") or 0)
        except (TypeError, ValueError):
            continue
        if not (0 < at <= jetzt_ms):
            continue
        quittiert = row.get("quittiert")
        karten.append(
            {
                "art": f"erinnerung:{row['id']}",
                "user": None,
                # Wer schon für sich bestätigt hat, fällt beim Abgleich
                # heraus - die Karte selbst ist für alle dieselbe.
                "ohne": [str(name) for name in quittiert]
                if isinstance(quittiert, list)
                else [],
                "state": {
                    "titel": "Erinnerung",
                    "text": str(row.get("text") or ""),
                    "symbol": "alarm",
                    "farbe": "orange",
                },
            }
        )
    return karten


def karten_alarm(entities: list[Any], jetzt_s: float) -> list[dict[str, Any]]:
    """Die Alarmanlage: Countdown beim Scharfschalten, Rot beim Alarm.

    Kein Dauerzustand: «scharf» bekommt bewusst keine Karte - eine
    Live-Aktivität endet nach spätestens zwölf Stunden, und eine Nacht
    ist länger. Dafür gibt es das Widget.
    """
    karten = []
    for entity in entities:
        if entity.kind != "alarm":
            continue
        zustand = str(entity.state.get("state") or "")
        if zustand == "scharfschaltend":
            rest = entity.state.get("seconds_left")
            karten.append(
                {
                    "art": f"alarm:{entity.id}",
                    "user": None,
                    "state": {
                        "titel": "Alarmanlage",
                        "text": "wird scharf",
                        "symbol": "shield",
                        "endet": (jetzt_s + float(rest)) if rest else None,
                        "url": "homepilot://alarm",
                    },
                }
            )
        elif zustand == "ausgeloest":
            karten.append(
                {
                    "art": f"alarm:{entity.id}",
                    "user": None,
                    "state": {
                        "titel": "Alarmanlage",
                        "text": "Alarm ausgelöst!",
                        "symbol": "bell.badge",
                        "farbe": "rot",
                        "url": "homepilot://alarm",
                    },
                }
            )
    return karten


# ── Der Abgleich (rein, testbar) ──────────────────────────────────────────


def _stand(state: dict[str, Any]) -> str:
    return json.dumps(state, sort_keys=True, ensure_ascii=False)


def abgleich(
    rows: Any,
    gewuenscht: list[dict[str, Any]],
    benutzer: list[str],
    jetzt_s: float,
    update_abstand: float = UPDATE_ABSTAND,
    abbestellt: dict[str, set[str]] | None = None,
) -> tuple[
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
    list[dict[str, Any]],
]:
    """Laufende Karten mit den gewünschten abgleichen (rein, testbar).

    Zurück kommen die neue Liste und drei Arbeitsaufträge:
    starten [{user, art, state}], aktualisieren [{tokens, state}],
    beenden [{tokens, state, sichtbar}].

    Updates frühestens alle `update_abstand` Sekunden je Karte - ein
    verworfenes Update geht nicht verloren, es kommt in einer späteren
    Runde, weil der gespeicherte Stand erst beim Senden nachzieht.
    """
    soll: dict[tuple[str, str], dict[str, Any]] = {}
    for karte in gewuenscht:
        empfaenger = [karte["user"]] if karte.get("user") else benutzer
        ohne = set(karte.get("ohne") or [])
        # «grill:pitboss.grill» gehört zur Kartenart «grill» - genau die
        # steht in der Abbestell-Liste der Person.
        gattung = str(karte["art"]).split(":", 1)[0]
        for name in empfaenger:
            if name in ohne:
                continue
            if gattung in (abbestellt or {}).get(name, set()):
                continue
            soll[(name, karte["art"])] = karte

    alte = {
        (str(row.get("user")), str(row.get("art"))): row
        for row in (rows or [])
        if isinstance(row, dict)
    }

    neue: list[dict[str, Any]] = []
    starten: list[dict[str, Any]] = []
    aktualisieren: list[dict[str, Any]] = []
    beenden: list[dict[str, Any]] = []

    for schluessel, karte in soll.items():
        user, art = schluessel
        stand = _stand(karte["state"])
        alt = alte.pop(schluessel, None)
        if alt is None:
            starten.append({"user": user, "art": art, "state": karte["state"]})
            neue.append(
                {
                    "user": user,
                    "art": art,
                    "stand": stand,
                    "activity_tokens": [],
                    "aktualisiert": jetzt_s,
                }
            )
            continue
        tokens = alt.get("activity_tokens") or []
        if (
            stand != alt.get("stand")
            and tokens
            and jetzt_s - float(alt.get("aktualisiert") or 0) >= update_abstand
        ):
            aktualisieren.append({"tokens": tokens, "state": karte["state"]})
            neue.append({**alt, "stand": stand, "aktualisiert": jetzt_s})
        else:
            neue.append(alt)

    for alt in alte.values():
        karte = None
        # Das Ende der Karte kennt nur der Treiber - über die Art des
        # Eintrags wiederfinden (die Waschmaschine sagt «Fertig»).
        for kandidat in gewuenscht:
            if kandidat["art"] == alt.get("art"):
                karte = kandidat
                break
        ende = (karte or {}).get("ende") or {}
        beenden.append(
            {
                "tokens": alt.get("activity_tokens") or [],
                "state": ende.get("state"),
                "sichtbar": float(ende.get("sichtbar") or 0),
            }
        )
    return neue, starten, aktualisieren, beenden


# ── Push-Inhalte (rein, testbar) ──────────────────────────────────────────


def start_payload(art: str, state: dict[str, Any], jetzt_s: float) -> dict[str, Any]:
    return {
        "aps": {
            "timestamp": int(jetzt_s),
            "event": "start",
            "content-state": state,
            "attributes-type": ATTRIBUTES_TYPE,
            "attributes": {"art": art},
            # Pflicht beim Start-Ereignis - ohne alert nimmt Apple den
            # Push an, aber iOS stellt still keine Karte auf (der Fall
            # steht ausführlich in liveaktivitaet.start_payload).
            "alert": {
                "title": str(state.get("titel") or "HomePilot"),
                "body": str(state.get("text") or ""),
            },
            "stale-date": int(
                (state.get("endet") or jetzt_s + 8 * 3600) + 300
            ),
            "relevance-score": 100 if state.get("farbe") == "rot" else 75,
        }
    }


def update_payload(state: dict[str, Any], jetzt_s: float) -> dict[str, Any]:
    return {
        "aps": {
            "timestamp": int(jetzt_s),
            "event": "update",
            "content-state": state,
            "stale-date": int((state.get("endet") or jetzt_s + 8 * 3600) + 300),
        }
    }


def ende_payload(
    state: dict[str, Any] | None, sichtbar: float, jetzt_s: float
) -> dict[str, Any]:
    aps: dict[str, Any] = {
        "timestamp": int(jetzt_s),
        "event": "end",
        # Ohne eigenes Schluss-Bild verschwindet die Karte sofort.
        "dismissal-date": int(jetzt_s + max(0.0, sichtbar)),
    }
    if state:
        aps["content-state"] = state
    return {"aps": aps}


# ── Der Takt ───────────────────────────────────────────────────────────────


async def karten_loop(hub: Any) -> None:
    config = liveaktivitaet.parse_apns(getattr(hub.config, "apns", None))
    if config is None:
        # Dieselbe Entscheidung wie bei der Haustür-Karte: Ohne
        # apns-Block ist das nicht eingerichtet, kein Fehler.
        return
    versand = liveaktivitaet.ApnsVersand(config)
    while True:
        await asyncio.sleep(TAKT_SEKUNDEN)
        try:
            await _runde(hub, versand)
        except asyncio.CancelledError:
            raise
        except Exception:
            log.exception("Live-Karten: Runde fehlgeschlagen")


def _zonen_zustaende(hub: Any, benutzer: list[str]) -> dict[str, str]:
    """Je Benutzer der Stand seiner Geofence-Zone («home», «away», Ort).

    Derselbe Weg wie bei der Haustür-Karte (liveaktivitaet._weg_stand):
    Zone über den Namen finden, Zustand am Zonen-Entity ablesen. Wer
    keine Zone hat, fehlt im Ergebnis - und zählt damit als zuhause
    (nicht_zuhause erklärt, warum das die richtige Richtung ist).
    """
    geofence = hub.integrations.get("geofence") if hub.integrations else None
    zones = getattr(geofence, "_zones", None) or {}
    namen = {
        zone_id: getattr(hub.registry.get(entity_id), "label", zone_id)
        for zone_id, entity_id in zones.items()
    }
    zustaende: dict[str, str] = {}
    for name in benutzer:
        zone_id = presence.zone_fuer(name, namen)
        if zone_id is None:
            continue
        entity = hub.registry.get(zones[zone_id])
        zustand_roh = (entity.state if entity else {}) or {}
        zustaende[name] = str(zustand_roh.get("state") or presence.UNKNOWN)
    return zustaende


def _gewuenscht(hub: Any, jetzt_s: float, benutzer: list[str]) -> list[dict[str, Any]]:
    entities = hub.registry.all()
    return [
        *karten_timer(hub.timers.list()),
        *karten_geraete(entities, hub.data.get("appliance_cycles"), jetzt_s),
        *karten_grill(entities),
        *karten_sauger(entities),
        # Die Fernbedienung nur für die, die zuhause sind - unterwegs
        # ist sie bloss eine Karte im Weg. Die Szenen für den Kino-Griff.
        *karten_tv(
            entities,
            nicht_zuhause(benutzer, _zonen_zustaende(hub, benutzer)),
            szenen=getattr(hub.scenes, "scenes", None) or [],
        ),
        *karten_erinnerungen(hub.data.get("family_reminders"), jetzt_s * 1000),
        *karten_alarm(entities, jetzt_s),
    ]


async def _runde(hub: Any, versand: liveaktivitaet.ApnsVersand) -> None:
    start_rows = hub.data.get(START_KEY)
    if not start_rows:
        return
    jetzt = time.time()
    prefs_rows = hub.data.get("user_prefs")
    gesperrt = liveaktivitaet.abgeschaltet(prefs_rows)
    benutzer = sorted(
        {
            str(row.get("user") or "")
            for row in start_rows
            if isinstance(row, dict) and str(row.get("user") or "") not in gesperrt
        }
    )
    neue, starten, aktualisieren, beenden = abgleich(
        hub.data.get(KARTEN_KEY),
        _gewuenscht(hub, jetzt, benutzer),
        benutzer,
        jetzt,
        abbestellt=liveaktivitaet.abbestellte(prefs_rows),
    )
    for auftrag in starten:
        tokens = [
            str(row.get("token"))
            for row in start_rows
            if isinstance(row, dict) and row.get("user") == auftrag["user"]
        ]
        for token in tokens:
            await versand.senden(
                token, start_payload(auftrag["art"], auftrag["state"], jetzt)
            )
        log.info(
            "Live-Karte %s für %s gestartet (%d Telefone)",
            auftrag["art"],
            auftrag["user"],
            len(tokens),
        )
    for auftrag in aktualisieren:
        for token in auftrag["tokens"]:
            await versand.senden(str(token), update_payload(auftrag["state"], jetzt))
    for auftrag in beenden:
        for token in auftrag["tokens"]:
            await versand.senden(
                str(token), ende_payload(auftrag["state"], auftrag["sichtbar"], jetzt)
            )
    if starten or aktualisieren or beenden:
        hub.data.set(KARTEN_KEY, neue)
