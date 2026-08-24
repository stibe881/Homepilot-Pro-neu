"""Einen Ort finden, ohne davorzustehen.

Vor dem Laden zu stehen und einen Knopf zu drücken ist der genaueste
Weg, einen Ort anzulegen - aber nicht der einzige, den man braucht. Wer
am Küchentisch fünf Läden erfassen will, fährt dafür nicht fünfmal los.

Zwei Wege führen hier hinein:

  * **Adresse oder Name.** Der Hub fragt Nominatim (OpenStreetMap) -
    frei nutzbar, ohne Schlüssel. Die Antwort ist eine Liste von
    Vorschlägen mit Klarnamen; ausgewählt wird in der App, denn welcher
    der drei «Coop Willisau» der richtige ist, weiss nur ein Mensch.

  * **Koordinaten aus der Zwischenablage.** Wer in Google Maps lange auf
    einen Punkt tippt, bekommt «47.13844, 7.92059» zum Kopieren - und
    genau das darf man hier einfügen. Auch die Adresszeile einer
    Maps-URL wird verstanden, weil das der zweite Griff ist, den jeder
    macht.

Nominatim erwartet eine ehrliche Kennung im User-Agent und keine
Massenabfragen. Beides hält sich hier von selbst ein: Es fragt ein
Mensch, der einen Laden erfasst.
"""

from __future__ import annotations

import re
from typing import Any

NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"
USER_AGENT = "HomePilot/1.0 (Hausautomation, Eigengebrauch)"

#: Mehr Vorschläge helfen niemandem - man erkennt den richtigen an der
#: Adresse, und zehn Zeilen liest keiner durch.
MAX_TREFFER = 6

#: Ein Breitengrad geht von -90 bis 90, ein Längengrad von -180 bis 180.
#: Alles andere ist keine Koordinate, sondern ein Tippfehler.
_ZAHL = r"[-+]?\d{1,3}(?:[.,]\d+)?"
_PAAR = re.compile(rf"({_ZAHL})\s*[,;/ ]\s*({_ZAHL})")


def koordinaten_aus_text(text: str) -> tuple[float, float] | None:
    """«47.13844, 7.92059» oder eine Maps-URL zu Zahlen (rein, testbar).

    Zurück kommt (Breite, Länge) - oder None, wenn darin keine
    brauchbaren Koordinaten stecken. Lieber nichts als eine Zahl, die
    zufällig im Text stand: Ein Ort an der falschen Stelle meldet sich
    nie, und niemand sucht den Fehler dort.
    """
    roh = str(text or "")
    # In einer Maps-URL steht das Paar hinter «@» oder «!3d…!4d…»; der
    # Rest der Adresse enthält weitere Zahlen, die keine Koordinaten sind.
    at = re.search(rf"@({_ZAHL}),({_ZAHL})", roh)
    if at:
        roh = f"{at.group(1)},{at.group(2)}"
    else:
        drei_vier = re.search(rf"!3d({_ZAHL})!4d({_ZAHL})", roh)
        if drei_vier:
            roh = f"{drei_vier.group(1)},{drei_vier.group(2)}"
    treffer = _PAAR.search(roh)
    if not treffer:
        return None
    try:
        lat = float(treffer.group(1).replace(",", "."))
        lon = float(treffer.group(2).replace(",", "."))
    except ValueError:
        return None
    if not (-90.0 <= lat <= 90.0) or not (-180.0 <= lon <= 180.0):
        return None
    return lat, lon


def treffer(rohdaten: Any) -> list[dict[str, Any]]:
    """Die Antwort von Nominatim in etwas Lesbares (rein, testbar).

    Der `display_name` ist die volle Adresse und damit das, woran ein
    Mensch den richtigen von drei gleichnamigen Läden unterscheidet. Der
    kurze Name steht zusätzlich da, weil er als Ortsname taugt.
    """
    ergebnis: list[dict[str, Any]] = []
    for eintrag in rohdaten if isinstance(rohdaten, list) else []:
        if not isinstance(eintrag, dict):
            continue
        try:
            lat = float(eintrag["lat"])
            lon = float(eintrag["lon"])
        except (KeyError, TypeError, ValueError):
            continue
        voll = str(eintrag.get("display_name") or "").strip()
        kurz = str(eintrag.get("name") or "").strip() or voll.split(",")[0].strip()
        if not voll and not kurz:
            continue
        ergebnis.append(
            {
                "name": kurz or voll,
                "address": voll or kurz,
                "latitude": lat,
                "longitude": lon,
            }
        )
        if len(ergebnis) >= MAX_TREFFER:
            break
    return ergebnis


def anfrage(text: str, land: str = "ch") -> dict[str, str]:
    """Die Abfrageparameter für Nominatim (rein, testbar).

    Auf ein Land eingegrenzt: «Coop» gibt es weltweit, gemeint ist fast
    immer der um die Ecke. Wer über die Grenze einkauft, schreibt das
    Land dazu - dann fällt die Eingrenzung weg.
    """
    suche = str(text or "").strip()
    parameter = {
        "q": suche,
        "format": "jsonv2",
        "limit": str(MAX_TREFFER),
        "addressdetails": "1",
    }
    if land and not _nennt_ein_land(suche):
        parameter["countrycodes"] = land
    return parameter


#: Nachbarländer, über deren Grenze man zum Einkaufen fährt. Steht eines
#: davon in der Suche, ist die Eingrenzung auf die Schweiz falsch.
_LAENDER = ("deutschland", "germany", "österreich", "austria", "frankreich",
            "france", "italien", "italy", "liechtenstein")


def _nennt_ein_land(text: str) -> bool:
    klein = text.lower()
    return any(land in klein for land in _LAENDER)
