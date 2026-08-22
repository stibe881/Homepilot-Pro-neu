"""Rezept-Import aus einer Web-Seite (Punkt 136 der Werkbank).

Die grösste Hürde des Rezeptbuchs war das Abtippen. Dabei tragen
praktisch alle Rezeptseiten (Betty Bossi, Fooby, Chefkoch, Swissmilk …)
ihr Rezept maschinenlesbar im Seitenkopf: als JSON-LD nach
``schema.org/Recipe`` - dasselbe Format, aus dem auch die Suchmaschinen
ihre Rezept-Kärtchen bauen.

Hier steht nur das Lesen: reine Funktionen über den HTML-Text, ohne
Netz, damit sich jede Eigenheit mit einer gespeicherten Beispielseite
testen lässt. Das Holen der Seite macht die Route.
"""

from __future__ import annotations

import html as html_lib
import json
import re
from typing import Any

# JSON-LD-Blöcke im Seitenkopf. Attribute in beliebiger Reihenfolge -
# «type» steht selten allein im script-Tag.
_JSONLD = re.compile(
    r"<script[^>]*type\s*=\s*[\"']application/ld\+json[\"'][^>]*>(.*?)</script>",
    re.S | re.I,
)
_TAGS = re.compile(r"<[^>]+>")
_ISO_DAUER = re.compile(
    r"P(?:(?P<tage>\d+)D)?T?(?:(?P<stunden>\d+)H)?(?:(?P<minuten>\d+)M)?", re.I
)
_ERSTE_ZAHL = re.compile(r"\d+")


def _klartext(value: Any) -> str:
    """HTML-Reste raus, Entities auflösen, Weissraum glätten (rein)."""
    # Tags werden zu Leerzeichen (ein <br> trennt Wörter), aber vor
    # Satzzeichen bleibt dadurch keines stehen: «anbraten .» liest sich
    # wie ein Tippfehler.
    text = _TAGS.sub(" ", str(value or ""))
    text = html_lib.unescape(text)
    text = re.sub(r"\s+", " ", text).strip()
    return re.sub(r"\s+([.,;:!?])", r"\1", text)


def _liste(value: Any) -> list[Any]:
    if value is None:
        return []
    return value if isinstance(value, list) else [value]


def iso_minuten(value: Any) -> int | None:
    """ISO-8601-Dauer («PT1H30M») in Minuten (rein, testbar)."""
    treffer = _ISO_DAUER.match(str(value or "").strip())
    if not treffer or not any(treffer.groupdict().values()):
        return None
    tage = int(treffer.group("tage") or 0)
    stunden = int(treffer.group("stunden") or 0)
    minuten = int(treffer.group("minuten") or 0)
    gesamt = tage * 24 * 60 + stunden * 60 + minuten
    return gesamt or None


def _portionen(value: Any) -> int | None:
    """recipeYield: «4», 4, «4 Portionen», ["4 Portionen"] → 4."""
    for kandidat in _liste(value):
        treffer = _ERSTE_ZAHL.search(str(kandidat or ""))
        if treffer:
            zahl = int(treffer.group())
            # «650 g» als Ausbeute ist keine Portionenzahl.
            if 1 <= zahl <= 48:
                return zahl
    return None


def _bild(value: Any) -> str | None:
    """image: Adresse, Liste von Adressen oder ImageObject."""
    for kandidat in _liste(value):
        if isinstance(kandidat, str) and kandidat.startswith("http"):
            return kandidat
        if isinstance(kandidat, dict):
            url = kandidat.get("url")
            if isinstance(url, str) and url.startswith("http"):
                return url
    return None


def _schritte(value: Any) -> list[str]:
    """recipeInstructions: Text, HowToStep oder HowToSection - alles flach."""
    schritte: list[str] = []
    for eintrag in _liste(value):
        if isinstance(eintrag, str):
            text = _klartext(eintrag)
            if text:
                schritte.append(text)
        elif isinstance(eintrag, dict):
            # Abschnitte («Für den Teig») schachteln ihre Schritte.
            if eintrag.get("itemListElement"):
                schritte.extend(_schritte(eintrag["itemListElement"]))
            else:
                text = _klartext(eintrag.get("text") or eintrag.get("name"))
                if text:
                    schritte.append(text)
    return schritte


def _ist_rezept(objekt: Any) -> bool:
    if not isinstance(objekt, dict):
        return False
    typen = [str(t).lower() for t in _liste(objekt.get("@type"))]
    return "recipe" in typen


def _rezept_objekt(daten: Any) -> dict[str, Any] | None:
    """Das Recipe-Objekt finden - direkt, in einer Liste oder im @graph."""
    if _ist_rezept(daten):
        return daten
    if isinstance(daten, dict):
        return _rezept_objekt(daten.get("@graph"))
    if isinstance(daten, list):
        for eintrag in daten:
            gefunden = _rezept_objekt(eintrag)
            if gefunden is not None:
                return gefunden
    return None


def _als_felder(rezept: dict[str, Any]) -> dict[str, Any]:
    """Vom schema.org-Vokabular in unsere Rezeptfelder (rein)."""
    tags = [
        _klartext(tag)
        for roh in _liste(rezept.get("keywords"))
        for tag in (str(roh).split(",") if isinstance(roh, str) else [roh])
        if _klartext(tag)
    ]
    prep = iso_minuten(rezept.get("prepTime"))
    cook = iso_minuten(rezept.get("cookTime"))
    if prep is None and cook is None:
        # Nur eine Gesamtzeit? Dann wenigstens die - als Kochzeit, damit
        # die Kachel eine Dauer zeigt.
        cook = iso_minuten(rezept.get("totalTime"))
    kategorie = next(
        (k for k in (_klartext(v) for v in _liste(rezept.get("recipeCategory"))) if k),
        "",
    )
    return {
        "text": _klartext(rezept.get("name")),
        "description": _klartext(rezept.get("description")),
        "category": kategorie,
        "tags": tags[:8],
        "servings": _portionen(rezept.get("recipeYield")),
        "prep_time": prep,
        "cook_time": cook,
        "image_url": _bild(rezept.get("image")),
        # Als blosse Zeilen: Das Formular der App parst sie mit derselben
        # Funktion wie von Hand Getipptes - eine Mengenlogik, nicht zwei.
        "ingredients": [
            _klartext(zeile)
            for zeile in _liste(rezept.get("recipeIngredient"))
            if _klartext(zeile)
        ],
        "instructions": _schritte(rezept.get("recipeInstructions")),
    }


def recipe_from_html(seite: str) -> dict[str, Any] | None:
    """Das erste brauchbare Rezept einer Seite (rein, testbar).

    ``None`` heisst ehrlich: Da ist keines - nicht «leeres Rezept».
    Kaputte JSON-Blöcke (die gibt es draussen reichlich) werden
    übersprungen statt alles scheitern zu lassen.
    """
    for treffer in _JSONLD.finditer(seite):
        try:
            daten = json.loads(treffer.group(1).strip())
        except ValueError:
            continue
        rezept = _rezept_objekt(daten)
        if rezept is None:
            continue
        felder = _als_felder(rezept)
        # Ohne Titel und ohne Zutaten wäre das Formular leerer als von
        # Hand - dann lieber weitersuchen.
        if felder["text"] and felder["ingredients"]:
            return felder
    return None
