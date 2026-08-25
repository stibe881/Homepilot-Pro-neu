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

import math
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
    # Orte, die der Hub nicht kennt – die gespeicherten Orte von Life360.
    # Sie standen bisher hinten und verloren damit gegen *jede* eigene
    # Zone. Das machte «Quartier» zum Sieger über «Tanners Home»: Die
    # Vorlaufzone ist drei Kilometer weit und verschluckte damit jeden
    # benannten Ort im Dorf. Ein Name, den jemand vergeben hat, sagt mehr
    # als «irgendwo im Umkreis».
    fremd = [ort_id for ort_id in inside if ort_id not in reihenfolge]
    # «Zuhause» sticht alles - nicht nur, wenn es zufällig der engste
    # eigene Ort ist. Daran hängen Alarmanlage und Abläufe, und sie
    # sollen nicht an einem Namen aus einer fremden App hängen.
    #
    # Der Unterschied wurde erst wichtig, als die Orte von Life360 zu
    # gewöhnlichen Orten des Hubs wurden: Vorher standen sie ausserhalb
    # der Reihenfolge, und die Prüfung «ist zuhause der engste eigene
    # Ort?» genügte. Seither sortieren sie mit - und ein Ort mit 80 m
    # Radius, der auf demselben Haus liegt, verdrängte «zuhause».
    if HOME in inside:
        geordnet = [HOME, *fremd, *[ort_id for ort_id in drin if ort_id != HOME]]
    else:
        geordnet = [*fremd, *drin]
    engster = geordnet[0]
    return (HOME if engster == HOME else engster), engster


def abstand_meter(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Abstand zweier Punkte in Metern (rein, testbar).

    Haversine statt flacher Näherung: Auf den Kilometern, um die es hier
    geht, wäre beides gleich – aber die Näherung fällt jenseits des 180.
    Längengrads auseinander, und das zu wissen und trotzdem falsch zu
    rechnen, lohnt die zehn Zeilen nicht.

    Stand bis Fassung 0.7 in `integrations/life360.py`. Sie gehört
    hierher, seit auch die Ortsmeldung des Telefons mit Koordinaten
    kommt: Zwei Rechnungen für denselben Abstand wären zwei Stellen, an
    denen sich ein Vorzeichen verstecken kann.
    """
    r = 6_371_000.0
    rad = math.pi / 180.0
    d_lat = (lat2 - lat1) * rad
    d_lon = (lon2 - lon1) * rad
    a = (
        math.sin(d_lat / 2) ** 2
        + math.cos(lat1 * rad) * math.cos(lat2 * rad) * math.sin(d_lon / 2) ** 2
    )
    return 2 * r * math.asin(min(1.0, math.sqrt(a)))


def orte_fuer_position(
    places: list[dict[str, Any]],
    latitude: float,
    longitude: float,
    accuracy: float = 0.0,
) -> tuple[list[str], list[str]]:
    """Welche Orte umschliessen diesen Punkt – und welche sind unklar?

    (rein, testbar)

    Zurück kommen zwei Listen: die Orte, in denen der Punkt sicher
    steckt, und die, über die er nichts aussagt.

    Die zweite ist der Grund, warum es diese Funktion gibt. Ein Fix, der
    das Haus um 180 Meter verfehlt, aber selbst 70 Meter Streuung hat,
    sagt nicht «draussen» – er sagt «weiss nicht». Bisher wurde daraus
    ein entschiedenes «weg», und «weg» ist keine harmlose Antwort: Daran
    hängen Alarmanlage und «alles aus».

    Beim Ankommen bleibt es beim gemessenen Punkt. Ein «drin» schaltet
    nichts scharf, und wer es ebenso streng fasste, käme nie an.
    """
    streuung = 0.0
    try:
        wert = float(accuracy)
        if wert > 0:
            streuung = wert
    except (TypeError, ValueError):
        streuung = 0.0
    drin: list[str] = []
    unklar: list[str] = []
    for ort in places or []:
        try:
            meter = abstand_meter(
                float(latitude),
                float(longitude),
                float(ort["latitude"]),
                float(ort["longitude"]),
            )
            radius = float(ort.get("radius") or 0)
        except (KeyError, TypeError, ValueError):
            continue
        ort_id = str(ort.get("id") or "")
        if not ort_id:
            continue
        if meter <= radius:
            drin.append(ort_id)
        elif meter <= radius + streuung:
            unklar.append(ort_id)
    return drin, unklar


def inside_aus_position(
    vorher: list[str],
    places: list[dict[str, Any]],
    latitude: float,
    longitude: float,
    accuracy: float = 0.0,
) -> list[str]:
    """Die neue Ortsliste einer Person aus einer Positionsmeldung.

    (rein, testbar)

    Der Unterschied zur Flankenmeldung, und der ganze Grund für den
    Umbau: Eine Position beschreibt den **ganzen** Zustand. Was hier
    herauskommt, ersetzt die alte Liste vollständig – eine verlorene
    Meldung von vorhin heilt damit von selbst, sobald die nächste kommt.
    Bei enter/leave blieb ein verpasstes «enter» liegen, bis die Person
    das nächste Mal dieselbe Grenze kreuzte.

    Zwei Dinge überleben die Ersetzung:

    * **Unklare Orte** behalten, was der Hub vorher wusste. Sonst würde
      aus einem ungenauen Fix ein «weg».
    * **Fremde Orte** – die von Life360 benannten wie «Tanners Home» –
      stehen nicht in `places`, also kann diese Messung nichts über sie
      sagen. Sie wegzuwerfen hiesse, die eine Quelle mit der anderen zu
      löschen; Life360 meldet ihr Ende selbst.
    """
    drin, unklar = orte_fuer_position(places, latitude, longitude, accuracy)
    bekannt = {str(ort.get("id") or "") for ort in places or []}
    behalten = [
        ort_id
        for ort_id in vorher or []
        if ort_id not in drin and (ort_id in unklar or ort_id not in bekannt)
    ]
    return [*drin, *behalten]


def zuletzt_gehoert(state: dict[str, Any]) -> float:
    """Wann kam die letzte Meldung? (rein, testbar)

    Nicht dasselbe wie `changed_at`, und die Verwechslung war ein Fehler
    mit Folgen: Life360 meldet jede Minute, meist ohne Änderung. Solange
    beides dasselbe Feld war, sprang `changed_at` bei jeder Abfrage
    weiter. Damit konnte `settle` nie greifen – ein eingefrorenes «weg»
    blieb für immer «weg» –, und in der Diagnose stand «Meldet sich
    regelmässig» neben einer Position von vorgestern.

    Fehlt `last_seen`, gilt `changed_at`: Zustände, die vor dem Umbau
    gespeichert wurden, kennen das Feld nicht.
    """
    for schluessel in ("last_seen", "changed_at"):
        try:
            wert = float(state.get(schluessel) or 0)
        except (TypeError, ValueError):
            continue
        if wert > 0:
            return wert
    return 0.0


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

    Gemessen wird an der letzten *Meldung*, nicht an der letzten
    *Änderung*: Wer seit drei Tagen zuhause sitzt und sich dabei jede
    Minute meldet, ist nicht verstummt.
    """
    if not is_stale(zuletzt_gehoert(state), now, hours):
        return dict(state)
    # Auch der Name muss weg, nicht nur die Kennung: Sonst stünde
    # «Tanners Home» neben einem Zustand, der «weiss ich nicht» heisst.
    return {**state, "state": UNKNOWN, "stale": True, "place": None, "place_name": None}


def merke_stand(
    rows: list[dict[str, Any]], zone: str, stand: dict[str, Any]
) -> list[dict[str, Any]]:
    """Den letzten bekannten Zustand einer Zone festhalten (rein, testbar).

    Warum es das braucht: Ein Neustart des Hubs ändert nichts daran, wo
    jemand ist – das Telefon meldet aber nur Übertritte. Ohne dieses
    Gedächtnis stand nach jedem Update und jedem Neustart wieder «Hat
    sich noch nie gemeldet», bis die Person das nächste Mal eine
    Zonengrenze kreuzte. Wer zuhause sitzt, tut das nicht, und das Haus
    hielt ihn stundenlang für verschollen.

    Je Zone eine Zeile, die neueste ersetzt die alte: Das hier ist ein
    Gedächtnis, kein Verlauf – für das Kommen und Gehen gibt es
    `remember`.
    """
    andere = [
        row
        for row in rows or []
        if isinstance(row, dict) and row.get("zone") != zone
    ]
    return [{**stand, "zone": zone}, *andere]


def wieder_aufnehmen(
    rows: list[dict[str, Any]], zone: str, now: float, hours: float = STALE_HOURS
) -> dict[str, Any]:
    """Womit eine Zone nach dem Neustart beginnt (rein, testbar).

    Zurück kommt der Zustand, mit dem die Entität angelegt wird. Drei
    Fälle führen zum ehrlichen «unbekannt»: nie etwas gemerkt, damals
    schon unbekannt, oder die Meldung ist inzwischen zu alt. Der letzte
    ist der wichtigste – ein Hub, der eine Woche stand, soll nicht
    behaupten, jemand sei noch zuhause.
    """
    leer = {
        "state": UNKNOWN,
        "device_class": "presence",
        "source": "none",
        "place": None,
    }
    gemerkt = next(
        (
            row
            for row in rows or []
            if isinstance(row, dict) and row.get("zone") == zone
        ),
        None,
    )
    if not gemerkt:
        return leer
    try:
        changed = float(gemerkt.get("changed_at") or 0)
    except (TypeError, ValueError):
        return leer
    zustand = str(gemerkt.get("state") or "")
    if not changed or not zustand or zustand == UNKNOWN:
        return leer
    # Gemessen an der letzten Meldung, nicht an der letzten Änderung: Wer
    # eine Woche zuhause war und sich dabei durchgehend gemeldet hat, ist
    # nach dem Neustart nicht verschollen.
    gehoert = zuletzt_gehoert(gemerkt) or changed
    if is_stale(gehoert, now, hours):
        return leer
    return {
        "state": zustand,
        "device_class": "presence",
        "source": str(gemerkt.get("source") or "none"),
        "place": gemerkt.get("place"),
        "place_name": gemerkt.get("place_name"),
        "changed_at": changed,
        "last_seen": gehoert,
        "battery": gemerkt.get("battery"),
        "stale": False,
    }


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
    # «Wann kam zuletzt etwas an» ist die Frage, wegen der man hier
    # hinschaut - nicht «wann hat sich etwas geändert». Wer seit gestern
    # zuhause ist, hat sich seither nicht geändert und trotzdem hundertmal
    # gemeldet.
    changed = zuletzt_gehoert(state)
    alter = (now - changed) if changed else None
    quelle = str(state.get("source") or "unbekannt")
    stumm = is_stale(changed, now)
    # «none» ist der Vermerk, den die Geofence-Integration einer frisch
    # angelegten Zone mitgibt: hier kam noch nie etwas an. Ohne die
    # zweite Bedingung stand in der Diagnose «Meldet sich regelmässig»
    # neben «Quelle: none» - eine Zeile, die sich selbst widerspricht,
    # und zwar bei genau der Person, bei der nichts ankam.
    #
    # Nur «none», nicht auch «unbekannt»: Fehlt der Vermerk ganz, ist
    # das eine Meldung alter Bauart und keine ausgebliebene.
    if not changed or quelle == "none":
        text = (
            "Hat sich noch nie gemeldet – Ortung in der App einschalten "
            "und «Jetzt melden» drücken (oder den Kurzbefehl einrichten)."
        )
    elif stumm:
        stunden = int(alter // 3600) if alter else 0
        text = f"Seit {stunden} Stunden Funkstille – Akku, Flugmodus oder Kurzbefehl weg?"
    elif quelle == "life360":
        # Die einzige Quelle, die wirklich im Takt meldet - hier darf
        # der Satz das auch behaupten.
        text = "Meldet sich regelmässig (über Life360)."
    else:
        # Telefon-Meldungen kommen NUR beim Übertreten einer Grenze. Hier
        # stand «Meldet sich regelmässig» - und genau dieser Satz hat in
        # die Irre geführt, als eine Ankunft verlorenging: Die letzte
        # Meldung war 83 Minuten alt und sagte «weg», die Person sass
        # längst im Haus, und die Diagnose klang nach «alles in Ordnung».
        # iOS weckt die App beim Grenzübertritt nicht zuverlässig; eine
        # ausgebliebene Meldung sieht von aussen aus wie eine Person, die
        # einfach dortgeblieben ist.
        minuten = int(alter // 60) if alter else 0
        wann = (
            f"vor {minuten} Min."
            if minuten < 120
            else f"vor {minuten // 60} Std."
        )
        text = (
            f"Letzte Meldung {wann} ({'weg' if state.get('state') == AWAY else 'da'}). "
            "Das Telefon meldet nur beim Kommen und Gehen - stimmt der "
            "Zustand nicht, hat iOS die App nicht geweckt: App öffnen und "
            "«Jetzt melden» drücken. Passiert es öfter, ist Life360 die "
            "verlässlichere Quelle (docs/geofence.md)."
        )
    return {
        "person": person,
        "state": str(state.get("state") or UNKNOWN),
        "place": state.get("place"),
        # Ohne den Klarnamen stünde in der Diagnose die Kennung
        # `tanners_home` – oder gar nichts, und dann fehlt genau die
        # Antwort, wegen der man hinschaut: Wo ist die Person gerade?
        "place_name": state.get("place_name"),
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


# ── Orte, die in der App entstehen ───────────────────────────────────────
#
# Orte gab es bisher nur in der config.yaml. Für das Zuhause geht das
# gerade noch, für Läden nicht: Wer beim Coop steht und merkt, dass die
# Erinnerung fehlt, wird nicht per SSH eine Datei bearbeiten. Deshalb
# lassen sich Orte hier ablegen - gesetzt wird einer, indem man davor
# steht und einen Knopf drückt, genau wie beim Zuhause.

PLACES_KEY = "extra_places"

#: Enger als 50 m taugt ein Geofence nicht (GPS-Streuung), weiter als
#: 2 km ist kein Laden mehr, sondern ein Dorf.
ORT_MIN_RADIUS = 50.0
ORT_MAX_RADIUS = 2000.0


def ort_kennung(name: str) -> str:
    """Aus einem Ladennamen eine Kennung machen (rein, testbar).

    «Coop Willisau» → `coop_willisau`. Die Kennung steht später im
    Zustand der Person («Stefan ist bei coop_willisau»), deshalb ohne
    Umlaute und Sonderzeichen.
    """
    umschrift = {"ä": "ae", "ö": "oe", "ü": "ue", "ß": "ss"}
    text = "".join(umschrift.get(z, z) for z in str(name or "").strip().lower())
    kennung = "".join(z if z.isalnum() else "_" for z in text)
    while "__" in kennung:
        kennung = kennung.replace("__", "_")
    return kennung.strip("_")


def ort_setzen(
    gespeichert: Any,
    ort_id: str,
    name: str,
    latitude: float,
    longitude: float,
    radius: float = 150.0,
) -> list[dict[str, Any]]:
    """Einen Ort anlegen oder verschieben (rein, testbar).

    Gleiche Kennung heisst: derselbe Ort, neu vermessen. So kann man vor
    dem Laden stehen und den Ort geraderücken, ohne ihn erst zu löschen.
    """
    kennung = ort_kennung(ort_id) or ort_kennung(name)
    if not kennung:
        raise ValueError("Ein Ort braucht einen Namen")
    eintrag = {
        "id": kennung,
        "name": str(name or kennung),
        "latitude": float(latitude),
        "longitude": float(longitude),
        "radius": max(ORT_MIN_RADIUS, min(ORT_MAX_RADIUS, float(radius))),
    }
    behalten = [
        ort
        for ort in parse_places(gespeichert)
        if ort["id"] != kennung
    ]
    return [*behalten, eintrag]


def ort_entfernen(gespeichert: Any, ort_id: str) -> list[dict[str, Any]]:
    """Einen Ort löschen (rein, testbar)."""
    kennung = ort_kennung(ort_id)
    return [ort for ort in parse_places(gespeichert) if ort["id"] != kennung]


def meldung_annehmen(
    quelle: str, beansprucht: dict[str, str], zone: str
) -> bool:
    """Darf diese Quelle für diese Person melden? (rein, testbar)

    Zwei Quellen auf dieselbe Frage widersprechen sich früher oder
    später, und dann weiss niemand, welcher zu glauben ist. Genau daran
    ist die WLAN-Anwesenheit gescheitert - und danach noch einmal an
    einer Kombination, die niemand beabsichtigt hatte: Life360 meldete
    «zuhause», während auf einem Telefon die Ortung der App weiterlief
    und aus dem Hintergrund «weg» nachschob. Auf dem Schirm stand dann
    «unterwegs», während die Person in der Küche stand.

    Also führt der Geofence, wer eine Person beansprucht. Wer das nicht
    ist, wird überhört - stumm bleibt es nicht, aber es ändert nichts.
    Ein vergessener Schalter auf einem alten Telefon kann damit nichts
    mehr kaputtmachen.

    Ohne Anspruch gilt wie bisher: Wer meldet, meldet.
    """
    inhaber = beansprucht.get(zone)
    return inhaber is None or inhaber == quelle


def orte_ergaenzen(
    vorhanden: list[dict[str, Any]], weitere: list[dict[str, Any]], quelle: str
) -> list[dict[str, Any]]:
    """Orte aus einer fremden Quelle anhängen (rein, testbar).

    Für die gespeicherten Orte von Life360. Sie kommen zuletzt: Was in
    der config.yaml steht oder was jemand in der App vor Ort angelegt
    hat, ist die Absicht dieses Haushalts - ein gleichnamiger Eintrag
    drüben darf sie nicht überschreiben.

    Sortiert wird am Ende wieder nach Radius, weil `place_state` daran
    ablesen soll, welcher Ort der engste ist. Ohne das gewönne die weite
    Vorlaufzone gegen den benannten Ort, in dem jemand tatsächlich steht.
    """
    zusammen = list(vorhanden)
    bekannt = {ort["id"] for ort in zusammen}
    for ort in weitere:
        if ort["id"] in bekannt:
            continue
        zusammen.append({**ort, "source": quelle})
        bekannt.add(ort["id"])
    zusammen.sort(key=lambda ort: ort["radius"])
    return zusammen


def alle_orte(
    aus_config: list[dict[str, Any]], gespeichert: Any
) -> list[dict[str, Any]]:
    """Config-Orte und in der App angelegte zu einer Liste (rein, testbar).

    Die config.yaml sticht: Wer dort einen Ort von Hand gepflegt hat, will
    ihn nicht von einem versehentlichen Knopfdruck überschrieben haben.
    Jeder Eintrag sagt, woher er kommt - sonst bietet die App an, einen
    Ort zu löschen, den sie gar nicht löschen kann.
    """
    zusammen = [{**ort, "source": "config"} for ort in aus_config]
    bekannt = {ort["id"] for ort in zusammen}
    for ort in parse_places(gespeichert):
        if ort["id"] in bekannt:
            continue
        zusammen.append({**ort, "source": "app"})
        bekannt.add(ort["id"])
    zusammen.sort(key=lambda ort: ort["radius"])
    return zusammen
