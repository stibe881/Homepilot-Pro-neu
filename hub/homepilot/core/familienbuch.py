"""Die Familiendaten als Seite, die man auch ohne HomePilot noch lesen kann.

Kontakte, Rezepte samt Fotos, das Notfallblatt, der Dokumentsafe – das
alles liegt in `hub.data` und damit in genau einer Datei auf genau einem
Rechner. Es gibt eine Sicherung; was fehlte, ist ein Ausdruck: eine
Seite, die ein Browser öffnet, wenn der Hub schon lange nicht mehr
läuft. Kein JSON, das man interpretieren muss, sondern etwas, das man
liest, druckt und verschenkt.

Rein und ohne Netz: hinein kommt der Datenbestand, heraus eine
HTML-Seite. Wer sie schreibt, ist die Sicherung (persistence.py) oder
die Route in api/routes/family.py.
"""

from __future__ import annotations

import html
from typing import Any

# Welche Listen ins Buch kommen und wie sie darin heissen. Bewusst
# ausgewählt: Aufgaben von letzter Woche will niemand ausgedruckt haben,
# die Nummer der Kinderärztin schon.
SECTIONS: list[tuple[str, str]] = [
    ("emergency", "Notfallblatt"),
    ("contacts", "Kontakte"),
    ("recipes", "Rezepte"),
    ("documents", "Dokumente"),
    ("medications", "Medikamente"),
    ("staples", "Standardartikel"),
    ("routines", "Routinen"),
    ("shops", "Läden"),
]

# Felder, die in keinen Ausdruck gehören - sie sind Technik, kein Inhalt.
SKIP = frozenset({"id", "created", "author", "done_at", "image_url", "recipe_id"})


def _text(value: Any) -> str:
    return html.escape(str(value), quote=True)


def _zeile(key: str, value: Any) -> str:
    if isinstance(value, list):
        inhalt = ", ".join(_text(x) for x in value if str(x).strip())
    elif isinstance(value, dict):
        inhalt = ", ".join(f"{_text(k)}: {_text(v)}" for k, v in value.items())
    else:
        inhalt = _text(value).replace("\n", "<br>")
    if not inhalt:
        return ""
    return f'<div class="f"><span class="k">{_text(key)}</span>{inhalt}</div>'


def _eintrag(row: dict[str, Any]) -> str:
    titel = str(row.get("text") or row.get("name") or row.get("title") or "")
    bild = str(row.get("image_url") or "")
    teile = [f"<h3>{_text(titel) or '(ohne Titel)'}</h3>"]
    # Nur eingebettete Bilder: Eine Adresse auf den Hub wäre in genau dem
    # Fall tot, für den das Buch gedacht ist.
    if bild.startswith("data:image/"):
        teile.append(f'<img src="{_text(bild)}" alt="">')
    for key, value in row.items():
        if key in SKIP or key in ("text", "name", "title"):
            continue
        if value in (None, "", [], {}):
            continue
        teile.append(_zeile(key, value))
    return '<article>' + "".join(teile) + "</article>"


STYLE = """
:root { color-scheme: light dark; }
body { font: 16px/1.55 Georgia, 'Times New Roman', serif; margin: 0 auto;
       max-width: 46rem; padding: 2rem 1.2rem 4rem; }
h1 { font-size: 1.9rem; margin: 0 0 .2rem; }
h2 { font-size: 1.25rem; margin: 2.4rem 0 .6rem; border-bottom: 2px solid;
     padding-bottom: .2rem; }
h3 { font-size: 1.02rem; margin: 0 0 .3rem; }
article { break-inside: avoid; margin: 0 0 1.1rem; padding: 0 0 .6rem;
          border-bottom: 1px dotted rgba(128,128,128,.5); }
.f { font-size: .92rem; }
.k { display: inline-block; min-width: 8.5rem; opacity: .65; }
img { max-width: 100%; border-radius: 6px; margin: .3rem 0 .5rem; }
.stand { opacity: .6; font-size: .88rem; }
@media print { body { max-width: none; } h2 { break-after: avoid; } }
"""


def render(data: dict[str, Any], stand: str) -> str:
    """Die Familiendaten als eigenständige HTML-Seite (rein, testbar).

    Alles in einer Datei, nichts nachzuladen: Sie soll auf einem
    beliebigen Rechner in zehn Jahren noch aufgehen.
    """
    teile = [
        "<!doctype html><html lang='de'><head><meta charset='utf-8'>",
        "<meta name='viewport' content='width=device-width, initial-scale=1'>",
        "<title>Familienbuch</title>",
        f"<style>{STYLE}</style></head><body>",
        "<h1>Familienbuch</h1>",
        f'<p class="stand">Stand {_text(stand)} · aus HomePilot Pro</p>',
    ]
    leer = True
    for key, titel in SECTIONS:
        rows = [row for row in data.get(f"family_{key}") or [] if isinstance(row, dict)]
        if not rows:
            continue
        leer = False
        teile.append(f"<h2>{_text(titel)} <small>({len(rows)})</small></h2>")
        teile.extend(_eintrag(row) for row in rows)
    if leer:
        teile.append("<p>Noch nichts eingetragen.</p>")
    teile.append("</body></html>")
    return "".join(teile)
