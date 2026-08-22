"""Aus einer Pixelmaske werden wenige Rechtecke – die Form eines Zimmers.

Die Saugerkarte kennt je Zimmer nur ein achsenparalleles Rechteck um den
Raum herum. Das genügt, um zu wissen, wo ein Zimmer ungefähr liegt, und
es reicht nicht für das, was man in der App damit tut: Tippt man auf den
Gang einer diagonal geschnittenen Wohnung, liegt der Punkt in vier
Rechtecken gleichzeitig – und die Auswahl, die danach aufleuchtet, deckt
halbe Nachbarzimmer mit ab.

Die echte Form steckt im gerenderten Kartenbild: Jedes Zimmer hat dort
seine eigene Farbe. Wer die Pixel dieser Farbe einsammelt, hat den Raum
– als Maske. Hier wird daraus etwas, das sich verschicken und zeichnen
lässt: möglichst wenige Rechtecke, die zusammen genau diese Fläche
ergeben.

Warum Rechtecke und keine Umrisslinie: Eine Kontur muss man vereinfachen,
und jede Vereinfachung schneidet irgendwo eine Ecke ab, an der jemand
tippt. Rechtecke sind exakt, in SVG billig zu zeichnen und in der App mit
zwei Vergleichen zu treffen.
"""

from __future__ import annotations


def runs_je_zeile(maske: list[list[bool]]) -> list[list[tuple[int, int]]]:
    """Je Zeile die zusammenhängenden Abschnitte (rein, testbar).

    Ein Abschnitt ist (Anfang, Ende-exklusiv). Ein Zimmer mit einer Nische
    hat in manchen Zeilen zwei davon – deshalb eine Liste je Zeile und
    kein Paar.
    """
    zeilen: list[list[tuple[int, int]]] = []
    for reihe in maske:
        abschnitte: list[tuple[int, int]] = []
        start: int | None = None
        for x, gesetzt in enumerate(reihe):
            if gesetzt and start is None:
                start = x
            elif not gesetzt and start is not None:
                abschnitte.append((start, x))
                start = None
        if start is not None:
            abschnitte.append((start, len(reihe)))
        zeilen.append(abschnitte)
    return zeilen


def rechtecke_aus_maske(maske: list[list[bool]]) -> list[tuple[int, int, int, int]]:
    """Eine Maske in möglichst wenige Rechtecke zerlegen (rein, testbar).

    Zwei Schritte: erst je Zeile die Abschnitte, dann untereinander
    liegende Abschnitte mit gleichen Rändern zu einem Rechteck
    verschmelzen. Ein rechteckiges Zimmer ergibt damit genau ein
    Rechteck, ein L-förmiges zwei – und ein völlig zerfranstes so viele,
    wie es eben braucht.

    Zurück kommt (x, y, breite, höhe) in Zellen der Maske.
    """
    zeilen = runs_je_zeile(maske)
    # Offene Rechtecke: (x0, x1) → (y-Anfang, y-Ende-exklusiv)
    offen: dict[tuple[int, int], list[int]] = {}
    fertig: list[tuple[int, int, int, int]] = []
    for y, abschnitte in enumerate(zeilen):
        jetzt = set(abschnitte)
        # Was in dieser Zeile nicht mehr vorkommt, ist abgeschlossen.
        for schluessel in list(offen):
            if schluessel not in jetzt:
                y0, y1 = offen.pop(schluessel)
                fertig.append((schluessel[0], y0, schluessel[1] - schluessel[0], y1 - y0))
        for schluessel in abschnitte:
            if schluessel in offen:
                offen[schluessel][1] = y + 1
            else:
                offen[schluessel] = [y, y + 1]
    for schluessel, (y0, y1) in offen.items():
        fertig.append((schluessel[0], y0, schluessel[1] - schluessel[0], y1 - y0))
    # Von oben nach unten, dann von links nach rechts: So sieht eine
    # Liste im Protokoll aus wie die Karte, die sie beschreibt.
    fertig.sort(key=lambda rechteck: (rechteck[1], rechteck[0]))
    return fertig


def als_anteile(
    rechtecke: list[tuple[int, int, int, int]],
    ursprung: tuple[int, int],
    zelle: tuple[float, float],
    bild: tuple[int, int],
    stellen: int = 4,
) -> list[list[float]]:
    """Zellen-Rechtecke in Bild-Anteile umrechnen (rein, testbar).

    `ursprung` ist die linke obere Ecke der Maske im Bild (Pixel),
    `zelle` die Kantenlänge einer Maskenzelle in Pixeln, `bild` die
    Bildgrösse. Zurück kommt [x, y, breite, höhe] als Anteile 0..1 – die
    App kennt das Kartenformat nicht und soll es nicht kennen müssen.
    """
    breite, hoehe = bild
    if breite <= 0 or hoehe <= 0:
        return []
    ergebnis: list[list[float]] = []
    for x, y, w, h in rechtecke:
        px = ursprung[0] + x * zelle[0]
        py = ursprung[1] + y * zelle[1]
        ergebnis.append(
            [
                round(max(0.0, px / breite), stellen),
                round(max(0.0, py / hoehe), stellen),
                round(min(1.0, w * zelle[0] / breite), stellen),
                round(min(1.0, h * zelle[1] / hoehe), stellen),
            ]
        )
    return ergebnis


def flaeche(rechtecke: list[list[float]]) -> float:
    """Wie viel Fläche die Rechtecke zusammen decken (rein, testbar).

    Dient als Notbremse: Ergibt die Farbsuche fast nichts – weil die
    Karte anders eingefärbt ist, als wir denken –, ist das Rechteck von
    vorher die ehrlichere Auskunft als eine Handvoll Krümel.
    """
    return sum(r[2] * r[3] for r in rechtecke)
