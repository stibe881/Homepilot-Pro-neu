"""Familie und Freunde: alle Menschen, die der Hub kennt – an einem Ort.

Bis hierher waren die Leute über drei Listen verteilt, die einander nicht
kannten: die Benutzer (wer darf hinein), die Ortungszonen (wessen Telefon
meldet sich) und die Life360-Mitglieder (wen sieht der Hub, ohne dass er
ihm gehört). Wer wissen wollte, wo Maja gerade ist und ob ihr leerer Akku
melden soll, brauchte zwei Bildschirme und ein Stück Konfigurationsdatei.

Hier kommt beides zusammen: eine Zeile je Mensch, mit Aufenthaltsort und
den Schaltern für das, was über ihn gemeldet wird.

Warum die Schalter an der **Zone** hängen und nicht am Benutzer: Gemeldet
wird über ein Telefon, und das Telefon ist die Zone. Maja hat keinen
Zugang zum Hub und trotzdem ein Telefon; ein Benutzer ohne Zone hat
nichts, worüber zu melden wäre.
"""

from __future__ import annotations

from typing import Any

# Was der Hub über eine einzelne Person melden kann, und wie es heisst.
# Reihenfolge ist Absicht: Was von selbst passiert, steht oben; was man
# ausdrücklich haben will, unten.
MELDUNGEN: dict[str, str] = {
    "battery": "Telefon fast leer",
    "silence": "Meldet sich nicht mehr",
    "arrive": "Kommt zuhause an",
    "leave": "Geht aus dem Haus",
}

# Was gilt, solange niemand etwas eingestellt hat.
#
# Kommen und Gehen sind bewusst aus: In einem Haushalt zu viert wären das
# an einem Werktag ein Dutzend Nachrichten, und nach der dritten schaltet
# man alle ab – auch die beiden, die man gebraucht hätte.
STANDARD: dict[str, bool] = {
    "battery": True,
    "silence": True,
    "arrive": False,
    "leave": False,
}

#: Schlüssel, unter dem die Einstellungen in hub.data liegen.
LADE = "person_prefs"


def bekannt(key: str) -> bool:
    """Gibt es diese Meldungsart? (rein, testbar)"""
    return key in MELDUNGEN


def fuer(rows: Any, zone: str) -> dict[str, bool]:
    """Die vollständigen Schalter einer Zone (rein, testbar).

    Vollständig heisst: Auch was nie eingestellt wurde, steht drin – mit
    seinem Standardwert. Die App soll nicht dieselben Vorgaben noch
    einmal kennen müssen; sonst stünde die Antwort auf «was gilt hier
    eigentlich» an zwei Orten und irgendwann verschieden.
    """
    gespeichert: dict[str, bool] = {}
    for zeile in rows or []:
        if isinstance(zeile, dict) and str(zeile.get("zone") or "") == zone:
            roh = zeile.get("meldungen")
            if isinstance(roh, dict):
                gespeichert = {
                    str(k): bool(v) for k, v in roh.items() if bekannt(str(k))
                }
            break
    return {**STANDARD, **gespeichert}


def an(rows: Any, zone: str, key: str) -> bool:
    """Soll diese Meldung für diese Person raus? (rein, testbar)

    Die eine Stelle, an der das geprüft wird – wie bei den
    Push-Kategorien. Zwei Stellen, und eine Meldungsart übergeht die
    Einstellung irgendwann versehentlich.
    """
    return fuer(rows, zone).get(key, True)


def setzen(rows: Any, zone: str, key: str, wert: bool) -> list[dict[str, Any]]:
    """Einen Schalter umlegen und die neue Liste zurückgeben (rein, testbar).

    Gespeichert wird die ganze Karte, nicht nur die Abweichung: Ändert
    sich später ein Standardwert, soll er nicht rückwirkend das
    umstellen, was jemand bewusst so gelassen hat.
    """
    if not bekannt(key):
        raise ValueError(f"Unbekannte Meldung: {key}")
    neu = {**fuer(rows, zone), key: bool(wert)}
    behalten = [
        dict(zeile)
        for zeile in (rows or [])
        if isinstance(zeile, dict) and str(zeile.get("zone") or "") != zone
    ]
    behalten.append({"zone": zone, "meldungen": neu})
    return behalten


def aufraeumen(rows: Any, zonen: list[str]) -> list[dict[str, Any]]:
    """Einstellungen zu Zonen, die es nicht mehr gibt, wegwerfen (rein,
    testbar).

    Sonst wächst die Datei mit jedem Umzug und jedem Tippfehler in der
    config.yaml, und niemand sieht je nach.
    """
    erlaubt = set(zonen)
    return [
        dict(zeile)
        for zeile in (rows or [])
        if isinstance(zeile, dict) and str(zeile.get("zone") or "") in erlaubt
    ]


def aufenthalt(zustand: dict[str, Any]) -> str:
    """Wo ist dieser Mensch gerade, in einem Satzstück (rein, testbar).

    Die Frage, wegen der man die Seite überhaupt öffnet. Der Klarname des
    Ortes schlägt alles andere – «bei Tanners Home» sagt mehr als
    «unterwegs», und genau dafür holt der Hub die Orte aus Life360.
    """
    state = str(zustand.get("state") or "")
    if state == "unknown":
        return "unbekannt"
    if state == "home":
        return "zuhause"
    name = zustand.get("place_name") or zustand.get("place")
    if name and str(name) not in ("home", ""):
        return f"bei {name}"
    return "unterwegs"


def zusammenfuehren(
    benutzer: list[dict[str, Any]], zonen: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Benutzer und Ortungszonen zu einer Liste von Menschen (rein, testbar).

    Drei Fälle, und alle drei kommen im Haus vor:

    * Benutzer **mit** Zone – ein Haushaltsmitglied, dessen Telefon
      meldet. Beides gehört in dieselbe Zeile.
    * Benutzer **ohne** Zone – hat Zugang, aber keine Ortung. Er steht
      dabei, denn sonst sucht man ihn; die Schalter fehlen ihm, weil es
      nichts zu melden gibt.
    * Zone **ohne** Benutzer – jemand, den der Hub sieht, ohne dass er
      ihm gehört: die Kinder über Life360. Genau die fehlten bisher in
      jeder Liste.

    Zugeordnet wird über die Zone, die der Aufrufer je Benutzer schon
    ausgerechnet hat (``presence.zone_fuer``) – hier wird nicht ein
    zweites Mal geraten.
    """
    leute: list[dict[str, Any]] = []
    vergeben: set[str] = set()
    for user in benutzer:
        zone_id = user.get("zone")
        passend = next(
            (z for z in zonen if zone_id and str(z.get("zone")) == str(zone_id)),
            None,
        )
        if passend is not None:
            vergeben.add(str(passend.get("zone")))
        leute.append(
            {
                # Auch ohne Zone dieselbe Form: Die App soll nicht zwei
                # Sorten Zeile auseinanderhalten müssen, nur weil bei
                # einem Wandtablet nichts zu orten ist.
                "where": "unbekannt",
                "state": "unknown",
                "source": "none",
                "battery": None,
                "since": None,
                "meldungen": dict(STANDARD),
                **(passend or {}),
                "name": user.get("name"),
                "zone": str(passend.get("zone")) if passend else None,
                "role": user.get("role"),
                "household": True,
            }
        )
    for zone in zonen:
        zone_id = str(zone.get("zone") or "")
        if zone_id in vergeben:
            continue
        leute.append(
            {
                **zone,
                "name": zone.get("name") or zone_id,
                "zone": zone_id,
                "role": None,
                # Kein Zugang zum Hub – nur jemand, dessen Telefon meldet.
                "household": False,
            }
        )
    return leute
