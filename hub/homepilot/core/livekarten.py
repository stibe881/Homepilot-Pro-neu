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

from . import laufzeit, liveaktivitaet

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


def karten_sauger(entities: list[Any]) -> list[dict[str, Any]]:
    """Der Saugroboter, solange er unterwegs ist.

    «cleaning» deckt seit integrations/roborock.py (zustand_name) auch
    das Reinigen einzelner Räume ab. Vorher blieb die Live-Karte beim
    Segmentreinigen ganz aus - also genau dann, wenn man den Sauger
    gezielt in die Küche geschickt hat und zusieht.
    """
    karten = []
    for entity in entities:
        if entity.kind != "vacuum" or entity.state.get("state") != "cleaning":
            continue
        akku = entity.state.get("battery")
        flaeche = entity.state.get("clean_area_m2")
        teile = ["saugt"]
        if flaeche:
            teile.append(f"{flaeche} m²")
        if akku is not None:
            teile.append(f"Akku {int(akku)} %")
        url = raum_url(entity)
        karten.append(
            {
                "art": f"sauger:{entity.id}",
                "user": None,
                "state": {
                    "titel": entity.label,
                    "text": " · ".join(teile),
                    "symbol": "fan",
                    **({"url": url} if url else {}),
                },
            }
        )
    return karten


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


def _gewuenscht(hub: Any, jetzt_s: float) -> list[dict[str, Any]]:
    entities = hub.registry.all()
    return [
        *karten_timer(hub.timers.list()),
        *karten_geraete(entities, hub.data.get("appliance_cycles"), jetzt_s),
        *karten_grill(entities),
        *karten_sauger(entities),
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
        _gewuenscht(hub, jetzt),
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
