"""Eine Nachricht statt sieben - wenn eine Runde mehrere gleiche ergibt.

Der Fall stand im Haus: An einem Morgen kamen alle Meldungen des
Saugroboters und seiner Station auf einmal. Die Ursache dahinter ist
behoben (core/watchrules.py), aber die Form des Fehlers bleibt: Der
Wächter läuft einmal je Minute und prüft in dieser einen Runde alles auf
einmal. Sind in dieser Runde drei Fenster offen, sind es drei
Nachrichten - drei Vibrationen, drei Sperrbildschirm-Zeilen, und die
dritte liest niemand mehr.

Deshalb sammelt der Wächter, was eine Runde ergibt, und schickt es am
Ende der Runde. Eine Runde ist der richtige Rahmen: Sie dauert
Millisekunden, es wird also nichts verzögert; und was in derselben Runde
entsteht, gehört auch inhaltlich zusammen - es beschreibt denselben
Augenblick des Hauses.

Zwei Dinge fallen dabei bewusst weg:

- **Knöpfe.** «Passt so» unter einer Sammelmeldung würde eine von drei
  Öffnungen quittieren, und niemand wüsste welche. Die Sammelmeldung
  führt in die App, dort steht jede einzeln.
- **Das Gerät.** Ein Bündel hat keines, also führt der Tipp zum Ort der
  Kategorie statt zu einem der drei Fenster.

Wer nur eine Meldung hat, bekommt sie unverändert. Das ist der
Normalfall, und ein «1 Meldung: …» wäre eine Verschlechterung um der
Regelmässigkeit willen.

Reines Rechnen über Listen; wer schickt, ist der Wächter.
"""

from __future__ import annotations

from typing import Any

from . import push

#: Kategorien, bei denen mehrere Meldungen in einer Runde zusammen
#: gehören.
#:
#: Der Massstab: Liest sich «3 × davon» besser als dreimal einzeln?
#: Bei offenen Fenstern ja - das ist ein Rundgang. Bei der Türklingel
#: nein: Zweimal klingeln in einer Minute sind zwei Besucher, und «2
#: Meldungen: Es klingelt» sagt einem nicht, dass man zweimal aufmachen
#: muss. Aufgezählt statt abgeleitet, damit eine neue Kategorie einzeln
#: bleibt, bis jemand hinsieht.
BUENDELBAR: frozenset[str] = frozenset(
    {
        "open",
        "battery",
        "device_down",
        "outage",
        "flattern",
        "maintenance",
        "vacuum",
        "appliance",
        "shopping",
        "tasks",
        "heat_covers",
        "storm_covers",
    }
)

#: So viele Zeilen stehen im Text, danach eine Zählung. Vier passen auf
#: einen aufgeklappten Sperrbildschirm; was darunter stünde, liest man
#: ohnehin erst in der App.
ZEILEN = 4


def buendelbar(category: str | None) -> bool:
    """Darf diese Kategorie gesammelt werden? (rein, testbar)

    Meldungen aus selbst gebauten Abläufen nicht: Sie sind
    Einzelstücke, die jemand genau so formuliert hat.
    """
    return bool(category) and str(category) in BUENDELBAR


def _schlange(meldung: dict[str, Any]) -> tuple[str, str]:
    """Was zusammengehört: gleiche Kategorie *und* gleiche Empfänger.

    Ohne den Empfänger würde die Erinnerung an Linas Medikament mit der
    von Bine in einer Nachricht landen - an beide.
    """
    return (
        str(meldung.get("category") or ""),
        str(meldung.get("to") or "all"),
    )


def sammeltext(category: str, meldungen: list[dict[str, Any]]) -> tuple[str, str]:
    """Titel und Text einer Sammelmeldung (rein, testbar).

    Der Titel sagt, wie viele und wovon; die Einzeltitel bilden den Text.
    Umgekehrt wäre es falsch herum: Auf dem Sperrbildschirm ist der Titel
    das, was man in der halben Sekunde liest, und «wie viele wovon» ist
    genau die Auskunft, wegen der gebündelt wird.
    """
    anzahl = len(meldungen)
    was = push.CATEGORIES.get(category, "Meldungen")
    titel = f"{anzahl} × {was}"
    zeilen = [str(eintrag.get("title") or "").strip() for eintrag in meldungen]
    zeilen = [zeile for zeile in zeilen if zeile]
    if len(zeilen) > ZEILEN:
        rest = len(zeilen) - ZEILEN
        zeilen = [*zeilen[:ZEILEN], f"… und {rest} weitere"]
    return titel, "\n".join(zeilen)


def buendeln(meldungen: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Eine Runde Meldungen zu dem machen, was rausgeht (rein, testbar).

    Die Reihenfolge bleibt: Was zuerst entstand, geht zuerst raus - und
    ein Bündel steht dort, wo seine erste Meldung stand. Sonst käme die
    Sammelmeldung über die offenen Fenster nach der einen über den
    Wasserschaden, bloss weil dort mehr zusammenkam.
    """
    gruppen: dict[tuple[str, str], list[dict[str, Any]]] = {}
    for meldung in meldungen:
        category = str(meldung.get("category") or "")
        if not buendelbar(category):
            continue
        gruppen.setdefault(_schlange(meldung), []).append(meldung)

    # Nur was wirklich mehrfach vorkam, wird gebündelt.
    zu_buendeln = {key: gruppe for key, gruppe in gruppen.items() if len(gruppe) > 1}
    erledigt: set[tuple[str, str]] = set()

    raus: list[dict[str, Any]] = []
    for meldung in meldungen:
        key = _schlange(meldung)
        gruppe = zu_buendeln.get(key)
        if gruppe is None:
            raus.append(meldung)
            continue
        if key in erledigt:
            continue
        erledigt.add(key)
        category = key[0]
        titel, text = sammeltext(category, gruppe)
        raus.append(
            {
                "title": titel,
                "body": text,
                "category": category,
                "to": meldung.get("to"),
                # Kein Gerät und keine Knöpfe: Ein Bündel führt in die
                # App, wo die einzelnen Meldungen stehen. Warum, steht im
                # Kopf dieser Datei.
                "data": {"gebuendelt": len(gruppe)},
                "entity_id": None,
            }
        )
    return raus
