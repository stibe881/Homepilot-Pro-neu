"""Anwesenheit: aus Meldungen wird ein verlässlicher Zustand.

Der Hub hat zwei Quellen für dieselbe Frage «ist jemand da?» – die
WLAN-Anmeldung über UniFi und die Zonenmeldung vom Telefon. Sie sind
unterschiedlich schnell und unterschiedlich verlässlich: Das Telefon
bucht sich aus, wenn es im Garten liegt; die Zonenmeldung sagt «weg»,
während das Gerät längst wieder im Netz ist. Wer beides ungeprüft
nebeneinanderstellt, bekommt eine Alarmanlage, die scharf schaltet,
während jemand im Haus sitzt.

Hier steht nur das Rechnen – ohne Hub, ohne Netz, ohne Uhr ausser der,
die hineingereicht wird. Wer meldet, ist die Geofence-Integration; wer
daraus Nachrichten macht, ist der Wächter.
"""

from __future__ import annotations

from typing import Any

# Zustände, die eine Person haben kann.
HOME = "home"
AWAY = "away"
UNKNOWN = "unknown"

# So lange gilt eine WLAN-Anmeldung als frisch genug, um die
# Zonenmeldung zu schlagen. Fünf Minuten: So lange braucht ein Telefon,
# das im Haus wieder aufwacht, um sich einzubuchen.
WIFI_FRESH = 300.0

# Ab wann Funkstille kein «weg» mehr ist, sondern ein Nichtwissen.
# Zwölf Stunden decken eine Nacht mit leerem Akku ab und sind kurz
# genug, dass ein gelöschter Kurzbefehl am nächsten Tag auffällt.
STALE_HOURS = 12.0

# So lange bleibt ein Kommen und Gehen im Verlauf stehen. Nützlich ist
# davon nur das Jüngste («seit wann weg», «wann angekommen»); alles
# ältere wäre ein Bewegungsprofil in einer Datei, die in die Sicherung
# wandert.
HISTORY_DAYS = 7
HISTORY_LIMIT = 500

# Unter diesem Stand kündigt sich der Ausfall der Ortung an.
BATTERY_LOW = 15


def zone_fuer(name: str, zonen: dict[str, str]) -> str | None:
    """Welche Geofence-Zone gehört zu diesem Benutzer? (rein, testbar)

    Die Anwesenheitsliste steht für die Benutzer des Hubs, nicht für die
    Zonen der config.yaml: Wer «wer ist da?» fragt, meint die Leute, die
    hier wohnen – nicht die Einträge, die jemand einmal angelegt hat.

    Zusammengeführt wird über den Namen, denn eine Zone trägt den Namen
    der Person («- id: stefan / name: Stefan»). Gross- und Kleinschreibung
    und Leerzeichen zählen nicht mit; findet sich über den Namen nichts,
    gilt die Kennung. So passt «Stefan» auf `id: stefan` auch dann, wenn
    niemand einen Namen dazugeschrieben hat.

    `zonen` bildet Kennung → Anzeigename ab. Ohne Treffer: None, und der
    Benutzer steht mit «meldet sich nicht» in der Liste – ehrlicher als
    ihn wegzulassen, denn genau dann fehlt die Einrichtung.
    """
    gesucht = " ".join(str(name or "").split()).casefold()
    if not gesucht:
        return None
    for zone_id, zone_name in zonen.items():
        if " ".join(str(zone_name or "").split()).casefold() == gesucht:
            return zone_id
    for zone_id in zonen:
        if str(zone_id).strip().casefold() == gesucht:
            return zone_id
    return None


def parse_places(raw: Any) -> list[dict[str, Any]]:
    """Orte mit Koordinaten einlesen (rein, testbar).

    Ein Ort ohne Koordinaten ist für das Telefon wertlos – es soll ihn
    ja selbst überwachen –, darum fällt er weg statt halb zu gelten.
    Sortiert nach Radius: Der engste Ort gewinnt später, sonst stünde
    «Quartier», während jemand in der Stube sitzt.
    """
    orte: list[dict[str, Any]] = []
    for entry in raw or []:
        if not isinstance(entry, dict):
            continue
        ort_id = str(entry.get("id") or "").strip()
        if not ort_id:
            continue
        try:
            lat = float(entry["latitude"])
            lon = float(entry["longitude"])
        except (KeyError, TypeError, ValueError):
            continue
        radius = entry.get("radius")
        try:
            meter = float(radius) if radius is not None else 150.0
        except (TypeError, ValueError):
            meter = 150.0
        orte.append(
            {
                "id": ort_id,
                "name": str(entry.get("name") or ort_id),
                "latitude": lat,
                "longitude": lon,
                "radius": max(50.0, meter),
            }
        )
    orte.sort(key=lambda ort: ort["radius"])
    return orte


def place_state(inside: list[str], places: list[dict[str, Any]]) -> tuple[str, str | None]:
    """Aus den Orten, in denen jemand steckt, Zustand und Ort ableiten.

    (rein, testbar)

    «home» bleibt «home»: Abläufe, Alarmanlage und die alte
    Kurzbefehl-Einrichtung kennen genau diese zwei Wörter, und die
    sollen weiter stimmen. Jeder andere Ort erscheint zusätzlich als
    eigener Zustand – «Livia: Schule» ist die Antwort, die man wollte.

    Steckt jemand in mehreren Orten (Quartier *und* Zuhause), gewinnt
    der engste: Die weite Zone ist der Vorlauf, nicht das Ziel.
    """
    if not inside:
        return AWAY, None
    reihenfolge = [ort["id"] for ort in places]
    drin = [ort_id for ort_id in reihenfolge if ort_id in inside]
    # Orte, die in der Konfiguration fehlen, hinten anstellen statt
    # verwerfen: Meldet ein altes Telefon einen unbekannten Namen, ist
    # das eine Information, keine Störung.
    drin += [ort_id for ort_id in inside if ort_id not in reihenfolge]
    engster = drin[0]
    return (HOME if engster == HOME else engster), engster


def merge_presence(
    geo: dict[str, Any] | None,
    wifi: dict[str, Any] | None,
    now: float,
    fresh: float = WIFI_FRESH,
) -> dict[str, Any]:
    """Die zwei Quellen zu einer Anwesenheit zusammenführen (rein, testbar).

    Regel, bewusst einfach: **WLAN schlägt Geofence, solange es frisch
    ist.** Ein Telefon, das gerade im Netz ist, ist im Haus – da hilft
    keine Zonenmeldung dagegen. Ist die WLAN-Angabe älter als `fresh`
    oder sagt sie «nicht verbunden», entscheidet die Zone.

    Zurück kommt immer auch, woher der Wert stammt: Eine Anwesenheit,
    der man nicht ansieht, warum sie so ist, ist im Streitfall wertlos.
    """
    geo_state = str((geo or {}).get("state") or UNKNOWN)
    geo_at = float((geo or {}).get("changed_at") or 0)
    wifi_state = str((wifi or {}).get("state") or "")
    wifi_at = float((wifi or {}).get("changed_at") or 0)

    wifi_frisch = bool(wifi) and (now - wifi_at) <= fresh
    if wifi_frisch and wifi_state in ("on", HOME, "true"):
        return {
            "state": HOME,
            "source": "wifi",
            "changed_at": wifi_at,
            "place": HOME,
        }
    if geo_state in (HOME, AWAY) or geo_state not in ("", UNKNOWN):
        return {
            "state": geo_state,
            "source": "geofence",
            "changed_at": geo_at,
            "place": (geo or {}).get("place"),
        }
    if wifi_frisch:
        # WLAN sagt «nicht verbunden» und sonst weiss es niemand: Das ist
        # ein Hinweis auf «weg», aber kein Beweis - das Telefon kann im
        # Flugmodus auf dem Küchentisch liegen.
        return {"state": UNKNOWN, "source": "wifi", "changed_at": wifi_at, "place": None}
    return {"state": UNKNOWN, "source": "none", "changed_at": 0.0, "place": None}


def is_stale(changed_at: Any, now: float, hours: float = STALE_HOURS) -> bool:
    """Hat sich diese Person zu lange nicht gemeldet? (rein, testbar)

    Ohne je eine Meldung gilt sie nicht als verstummt, sondern als noch
    nie gehört - beides führt zu «unbekannt», aber nur das eine ist ein
    Ausfall.
    """
    try:
        moment = float(changed_at or 0)
    except (TypeError, ValueError):
        return False
    if moment <= 0:
        return False
    return (now - moment) > hours * 3600


def settle(state: dict[str, Any], now: float, hours: float = STALE_HOURS) -> dict[str, Any]:
    """«away» in «unbekannt» wandeln, wenn nichts mehr kommt (rein, testbar).

    Dieselbe Falle wie beim Geschirrspüler, nur mit grösseren Folgen:
    Bleibt der letzte Zustand «weg» für immer stehen, schaltet «alles
    aus, wenn niemand da» irgendwann das Haus ab, während jemand darin
    sitzt. Wer sich zwölf Stunden nicht gemeldet hat, gilt darum als
    unbekannt – und Abläufe, die auf Abwesenheit hören, laufen nicht.
    """
    if not is_stale(state.get("changed_at"), now, hours):
        return dict(state)
    return {**state, "state": UNKNOWN, "stale": True, "place": None}


def remember(
    rows: list[dict[str, Any]],
    person: str,
    state: str,
    at: float,
    place: str | None = None,
) -> list[dict[str, Any]]:
    """Einen Wechsel in den Verlauf legen (rein, testbar).

    Nur echte Wechsel: Ein Kurzbefehl, der beim Ankommen dreimal
    auslöst, soll nicht drei Zeilen erzeugen.
    """
    letzter = next((row for row in rows if row.get("person") == person), None)
    if letzter and letzter.get("state") == state and letzter.get("place") == place:
        return list(rows)
    neu = [{"person": person, "state": state, "place": place, "at": at}, *rows]
    return trim_history(neu, at)


def trim_history(
    rows: list[dict[str, Any]], now: float, days: int = HISTORY_DAYS
) -> list[dict[str, Any]]:
    """Alten Verlauf wegwerfen (rein, testbar).

    Kein Verzicht, sondern eine Entscheidung, die man einmal trifft
    statt nie: Was älter als eine Woche ist, beantwortet keine Frage
    mehr, die jemand stellt.
    """
    grenze = now - days * 24 * 3600
    frisch = [
        row
        for row in rows or []
        if isinstance(row, dict) and float(row.get("at") or 0) >= grenze
    ]
    return frisch[:HISTORY_LIMIT]


def since(rows: list[dict[str, Any]], person: str) -> float | None:
    """Seit wann ist diese Person im jetzigen Zustand? (rein, testbar)"""
    for row in rows or []:
        if row.get("person") == person:
            try:
                return float(row.get("at") or 0) or None
            except (TypeError, ValueError):
                return None
    return None


def diagnose(person: str, state: dict[str, Any], now: float) -> dict[str, Any]:
    """Warum steht da, was da steht? (rein, testbar)

    Das Gegenstück zur Ablauf-Diagnose. Der halbe Support-Fall «die
    Ortung spinnt» beantwortet sich damit selbst: Wann kam die letzte
    Meldung, über welchen Weg, und sieht das nach Funkstille aus?
    """
    changed = float(state.get("changed_at") or 0)
    alter = (now - changed) if changed else None
    quelle = str(state.get("source") or "unbekannt")
    stumm = is_stale(changed, now)
    if not changed:
        text = "Hat sich noch nie gemeldet – ist der Kurzbefehl eingerichtet?"
    elif stumm:
        stunden = int(alter // 3600) if alter else 0
        text = f"Seit {stunden} Stunden Funkstille – Akku, Flugmodus oder Kurzbefehl weg?"
    else:
        text = "Meldet sich regelmässig."
    return {
        "person": person,
        "state": str(state.get("state") or UNKNOWN),
        "place": state.get("place"),
        "source": quelle,
        "last_seen": changed or None,
        "age_seconds": round(alter) if alter is not None else None,
        "silent": stumm,
        "battery": state.get("battery"),
        "hint": text,
    }


def battery_alert(
    person: str, battery: Any, grenze: int = BATTERY_LOW
) -> str | None:
    """Warnen, bevor die Ortung mangels Strom ausfällt (rein, testbar).

    Die häufigste Ursache für eine tote Ortung ist ein leeres Telefon –
    und das kündigt sich an. Passt zu `settle`, das den Ausfall danach
    ehrlich macht, aber eben erst danach.
    """
    try:
        stand = int(battery)
    except (TypeError, ValueError):
        return None
    if stand < 0 or stand > grenze:
        return None
    return f"{person}s Telefon hat noch {stand} % – die Ortung fällt gleich aus."


def holiday_question(
    states: list[dict[str, Any]], sim_on: bool, now: float, hours: float = 24.0
) -> bool:
    """Sind alle lange genug weg, um nach dem Ferienmodus zu fragen?

    (rein, testbar)

    Eine Frage, keine Automatik: Wer nur ein Wochenende weg ist, wischt
    sie weg. Und niemals, wenn die Simulation ohnehin läuft oder wenn
    auch nur eine Person als «unbekannt» geführt wird – dann weiss der
    Hub es nicht gut genug für eine Frage.
    """
    if sim_on or not states:
        return False
    for state in states:
        if str(state.get("state")) != AWAY:
            return False
        changed = float(state.get("changed_at") or 0)
        if not changed or (now - changed) < hours * 3600:
            return False
    return True
