"""Rezept-Import: schema.org/Recipe aus dem Seitenkopf lesen.

Kein Netz - die Beispielseiten stehen hier als Zeichenketten, in den
Formen, die draussen wirklich vorkommen: JSON-LD direkt, als Liste, im
@graph, mit HowToStep-Schritten und mit kaputtem JSON davor.
"""

import json

from homepilot.core.rezeptimport import iso_minuten, recipe_from_html


def _seite(*bloecke: str) -> str:
    scripts = "".join(
        f'<script type="application/ld+json">{block}</script>' for block in bloecke
    )
    return f"<html><head>{scripts}</head><body>Rezept</body></html>"


REZEPT = {
    "@context": "https://schema.org",
    "@type": "Recipe",
    "name": "Zürcher Geschnetzeltes",
    "description": "Der Klassiker mit R&ouml;sti.",
    "image": ["https://example.ch/bild.jpg"],
    "recipeYield": "4 Portionen",
    "prepTime": "PT20M",
    "cookTime": "PT1H10M",
    "recipeCategory": ["Hauptgericht"],
    "keywords": "Schweiz, Klassiker",
    "recipeIngredient": ["600 g Kalbfleisch", "2 dl Rahm"],
    "recipeInstructions": [
        {"@type": "HowToStep", "text": "Fleisch <b>anbraten</b>."},
        {"@type": "HowToStep", "text": "Rahm dazugiessen."},
    ],
}


def test_a_plain_jsonld_recipe_is_read_completely():
    rezept = recipe_from_html(_seite(json.dumps(REZEPT)))
    assert rezept is not None
    assert rezept["text"] == "Zürcher Geschnetzeltes"
    # Entities aufgelöst, Tags entfernt.
    assert rezept["description"] == "Der Klassiker mit Rösti."
    assert rezept["servings"] == 4
    assert rezept["prep_time"] == 20
    assert rezept["cook_time"] == 70
    assert rezept["category"] == "Hauptgericht"
    assert rezept["tags"] == ["Schweiz", "Klassiker"]
    assert rezept["image_url"] == "https://example.ch/bild.jpg"
    assert rezept["ingredients"] == ["600 g Kalbfleisch", "2 dl Rahm"]
    assert rezept["instructions"] == ["Fleisch anbraten.", "Rahm dazugiessen."]


def test_a_recipe_inside_a_graph_is_found():
    """Wordpress-Seiten packen alles in @graph - der häufigste Fall."""
    graph = {"@context": "https://schema.org", "@graph": [{"@type": "WebPage"}, REZEPT]}
    rezept = recipe_from_html(_seite(json.dumps(graph)))
    assert rezept is not None and rezept["text"] == "Zürcher Geschnetzeltes"


def test_broken_json_blocks_are_skipped_not_fatal():
    """Draussen gibt es reichlich kaputte Blöcke - die dürfen den einen
    guten nicht mitreissen."""
    rezept = recipe_from_html(_seite("{kaputt,,,", json.dumps(REZEPT)))
    assert rezept is not None and rezept["text"] == "Zürcher Geschnetzeltes"


def test_sections_with_nested_steps_are_flattened():
    verschachtelt = dict(
        REZEPT,
        recipeInstructions=[
            {
                "@type": "HowToSection",
                "name": "Für den Teig",
                "itemListElement": [{"@type": "HowToStep", "text": "Kneten."}],
            },
            "Backen.",
        ],
    )
    rezept = recipe_from_html(_seite(json.dumps(verschachtelt)))
    assert rezept is not None
    assert rezept["instructions"] == ["Kneten.", "Backen."]


def test_total_time_fills_in_when_prep_and_cook_are_missing():
    nur_gesamt = dict(REZEPT, prepTime=None, cookTime=None, totalTime="PT45M")
    rezept = recipe_from_html(_seite(json.dumps(nur_gesamt)))
    assert rezept is not None
    assert rezept["prep_time"] is None
    assert rezept["cook_time"] == 45


def test_a_page_without_a_recipe_says_so():
    """None heisst ehrlich «keins da», nicht «leeres Rezept»."""
    assert recipe_from_html("<html><body>Blog über Katzen</body></html>") is None
    kein_titel = dict(REZEPT, name="")
    assert recipe_from_html(_seite(json.dumps(kein_titel))) is None


def test_iso_durations_in_all_shapes():
    assert iso_minuten("PT30M") == 30
    assert iso_minuten("PT1H") == 60
    assert iso_minuten("PT1H30M") == 90
    assert iso_minuten("P1DT2H") == 26 * 60
    assert iso_minuten("") is None
    assert iso_minuten("gleich") is None
