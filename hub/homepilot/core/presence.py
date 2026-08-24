"""Anwesenheit: aus Meldungen wird ein verlässlicher Zustand.

Es gibt genau **eine** Quelle für «ist jemand da?»: die Ortsmeldung vom
Telefon (App-Geofence oder Kurzbefehl). Das WLAN zählt ausdrücklich
nicht dazu – weder für den Aufenthaltsort einer Person noch für die
Sammelfrage übers Haus.

Warum nicht, obwohl es bequem wäre: Eine WLAN-Anmeldung beantwortet
«ist dieses Gerät im Netz», nicht «ist dieser Mensch zuhause». Das
iPad liegt auch dann im Netz, wenn alle weg sind; das Telefon fällt
auch dann heraus, wenn man im Garten sitzt. Solange beides
nebeneinanderstand, zeigte die Startseite «jemand da», während die
Liste darunter niemanden führte – und man weiss nicht, welchem der
beiden man glauben soll. Eine Quelle, die manchmal irrt, ist besser
als zwei, die sich widersprechen.

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


def anyone_home_state(zustaende: Any) -> str:
    """Ist noch jemand zuhause? (rein, testbar)

    Aus den Einzelzuständen der Personen wird ein «on»/«off», auf das
    ein Ablauf hören kann. Die Regel ist bewusst vorsichtig:

    * Eine Person auf ``home`` genügt für «on».
    * ``unknown`` zählt ebenfalls als «on». Ein leerer Akku ist kein
      «niemand zuhause» - sonst fährt das Haus herunter, während jemand
      darin sitzt. Lieber einmal zu viel Licht als das.
    * Erst wenn *alle* ausdrücklich weg sind (``away`` oder an einem
      anderen Ort), wird es «off».

    Ohne Personen gibt es nichts zu entscheiden: dann «on», aus
    demselben Grund.
    """
    liste = [str(zustand or UNKNOWN).strip().lower() for zustand in (zustaende or [])]
    if not liste:
        return "on"
    if any(zustand in (HOME, "on", "true") for zustand in liste):
        return "on"
    if any(zustand in ("", UNKNOWN) for zustand in liste):
        return "on"
    return "off"


#: Wo der von Hand gesetzte Hausstandort liegt.
HOME_KEY = "home_place"


def read_home(roh: Any) -> dict[str, Any] | None:
    """Der selbst gesetzte Hausstandort – oder None (rein, testbar).

    Der Hausstandort kam bisher aus der config.yaml, und wenn dort keiner
    stand, aus einer Vorgabe im Quelltext. Beides ist eine Zahl, die
    jemand einmal eingetippt hat - und wenn sie um elf Kilometer
    danebenliegt, sagt das niemand. Man sieht nur, dass man laut Hub
    «unterwegs» ist, während man in der Stube sitzt.

    Deshalb lässt er sich aus der App setzen: Wer zuhause steht, drückt
    einen Knopf, und der Hub weiss es. Was hier steht, sticht die
    config.yaml - es ist die jüngere und die nachweislich vor Ort
    gemessene Angabe.
    """
    if isinstance(roh, list):
        roh = next((x for x in roh if isinstance(x, dict)), None)
    if not isinstance(roh, dict):
        return None
    try:
        lat = float(roh["latitude"])
        lon = float(roh["longitude"])
    except (KeyError, TypeError, ValueError):
        return None
    try:
        radius = float(roh.get("radius") or 150.0)
    except (TypeError, ValueError):
        radius = 150.0
    return {
        "latitude": lat,
        "longitude": lon,
        "radius": max(25.0, min(2000.0, radius)),
        "at": roh.get("at"),
    }


def store_home(latitude: float, longitude: float, radius: float, now: float) -> list[dict[str, Any]]:
    """Wie der Hausstandort in den Datenspeicher geht (rein, testbar)."""
    return [
        {
            "latitude": float(latitude),
            "longitude": float(longitude),
            "radius": max(25.0, min(2000.0, float(radius))),
            "at": now,
        }
    ]


def home_location(gespeichert: Any, config_location: Any) -> dict[str, Any]:
    """Welcher Standort als «Zuhause» gilt (rein, testbar).

    Reihenfolge: was jemand vor Ort gesetzt hat, dann die config.yaml,
    dann nichts. «Nichts» ist ehrlicher als eine Vorgabe aus dem
    Quelltext: Ein Haus, das der Hub am falschen Ort vermutet, ist
    schlimmer als eines, von dem er zugibt, es nicht zu kennen.
    """
    eigen = read_home(gespeichert)
    if eigen:
        return {
            "latitude": eigen["latitude"],
            "longitude": eigen["longitude"],
            "radius": eigen["radius"],
            "source": "app",
            "at": eigen.get("at"),
        }
    loc = config_location if isinstance(config_location, dict) else {}
    try:
        return {
            "latitude": float(loc["latitude"]),
            "longitude": float(loc["longitude"]),
            "radius": float(loc.get("radius") or 150.0),
            "source": "config",
            "at": None,
        }
    except (KeyError, TypeError, ValueError):
        return {"latitude": None, "longitude": None, "radius": 150.0, "source": "none", "at": None}
