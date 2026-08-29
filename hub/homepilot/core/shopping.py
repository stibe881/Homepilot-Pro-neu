"""Erinnerung im Laden: «Du wolltest noch etwas.»

Der Fall, für den es das gibt: Man steht wegen einer Sache im Coop, und
die drei anderen von der Liste fallen einem im Auto wieder ein. Eine
Nachricht beim Betreten wäre zu früh - man ist vielleicht nur
vorbeigefahren -, eine beim Verlassen zu spät. Also nach ein paar
Minuten: Wer so lange dort steht, kauft auch ein.

Woher der Hub weiss, dass jemand im Laden ist: Der Laden zeigt auf einen
Ort, und das Telefon meldet Orte ohnehin (siehe integrations/geofence.py)
- der Zustand der Person IST dann dieser Ort. Angelegt wird er in der App:
davorstehen, «ich stehe jetzt hier» drücken. Ohne Ort keine Erinnerung -
der Laden funktioniert trotzdem, er sortiert dann nur die Liste.

Der alte Weg bleibt gültig: eine eigene Geofence-Zone je Laden, die von
aussen auf «home» gesetzt wird (iOS-Kurzbefehl, Tasker). Wer sich das
gebaut hat, soll es behalten dürfen.
"""

from __future__ import annotations

from typing import Any

# Wie lange jemand dort sein muss. Vier Minuten sind lang genug, um an
# einer Ampel davor nicht zu zählen, und kurz genug, um noch im Laden
# anzukommen.
STAY_SECONDS = 4 * 60

#: Der Zustand einer eigenen Laden-Zone, wenn jemand drin ist. Eine Zone
#: ohne eigenen Ort meldet «home» - siehe geofence.report().
HOME_STATE = "home"


def open_items(rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Was noch fehlt – Erledigtes zählt nicht (rein, testbar)."""
    return [row for row in rows if isinstance(row, dict) and not row.get("done")]


def due_reminders(
    shops: list[dict[str, Any]],
    zones: dict[str, dict[str, Any]],
    offen: int,
    now: float,
    schon_erinnert: dict[str, float],
) -> list[dict[str, Any]]:
    """Für welche Läden jetzt eine Erinnerung fällig ist (rein, testbar).

    `zones` bildet die Zonenkennung auf ihren Zustand ab, so wie die
    Geofence-Integration ihn führt: `state` und `changed_at`.

    `schon_erinnert` merkt sich je Zone, für welchen Aufenthalt bereits
    erinnert wurde - verglichen wird der Zeitpunkt des Betretens. Beim
    nächsten Besuch ist der ein anderer, und die Erinnerung kommt wieder.
    Ohne das käme sie jede Minute erneut, und man schaltete sie ab.
    """
    if offen <= 0:
        return []
    faellig = []
    for shop in shops:
        if not isinstance(shop, dict):
            continue
        _, stand, marke = wer_steht_dort(shop, zones)
        if stand is None:
            continue
        seit = stand.get("changed_at")
        if not isinstance(seit, (int, float)):
            continue
        if now - seit < STAY_SECONDS:
            continue
        if schon_erinnert.get(marke) == seit:
            continue
        faellig.append(shop)
    return faellig


def marke_fuer(shop: dict[str, Any]) -> str:
    """Unter welchem Schlüssel gemerkt wird, dass schon erinnert wurde.

    Der Ort, wenn es einen gibt, sonst die alte Zonenkennung - damit ein
    Laden nach dem Umstellen nicht doppelt erinnert.
    """
    return str(shop.get("place") or shop.get("zone") or "").strip()


def wo_man_steht(
    shop: dict[str, Any], zones: dict[str, dict[str, Any]]
) -> tuple[dict[str, Any] | None, str]:
    """Steht gerade jemand in diesem Laden? Nur der Zustand (rein, testbar).

    Bequemer Zugang zu :func:`wer_steht_dort` für alle, die nicht wissen
    müssen, wer es ist.
    """
    _, stand, marke = wer_steht_dort(shop, zones)
    return stand, marke


def wer_steht_dort(
    shop: dict[str, Any], zones: dict[str, dict[str, Any]]
) -> tuple[str | None, dict[str, Any] | None, str]:
    """Wer steht gerade in diesem Laden? (rein, testbar)

    Zurück kommt die Kennung der Zone - also der Person -, ihr Zustand
    und die Marke, unter der gemerkt wird, dass schon erinnert wurde.

    Die Zone gehört zur Nachricht, nicht nur zur Erinnerungssperre: Sie
    heisst «Du bist im Märt» und ging trotzdem an alle. Wer im Büro sass,
    während jemand anders einkaufte, bekam sie auch - und wusste weder,
    dass sie nicht ihm galt, noch wem.

    Zwei Wege, historisch gewachsen und beide gültig:

      * `place` – die Kennung eines Ortes mit Koordinaten. Das Telefon
        meldet ihn beim Betreten, und der Zustand der Person IST dann
        dieser Ort. Das ist der Weg, den die App geht: Ort in der App
        anlegen, Laden darauf zeigen lassen, fertig.
      * `zone` – eine eigene Geofence-Zone je Laden, die von aussen auf
        «home» gesetzt wird (iOS-Kurzbefehl, Tasker). So ging es früher,
        und wer es so eingerichtet hat, soll es behalten dürfen.

    Genommen wird, wer am längsten dort steht - sonst käme die
    Erinnerung erneut, sobald der Zweite hereinkommt.
    """
    ort = str(shop.get("place") or "").strip()
    if ort:
        treffer = [
            (zone_id, stand)
            for zone_id, stand in zones.items()
            if isinstance(stand, dict) and stand.get("state") == ort
        ]
        if not treffer:
            return None, None, ort
        zone_id, stand = min(treffer, key=lambda eintrag: eintrag[1].get("changed_at") or 0)
        return zone_id, stand, ort
    zone = str(shop.get("zone") or "").strip()
    if not zone:
        return None, None, ""
    stand = zones.get(zone)
    if not stand or stand.get("state") != HOME_STATE:
        return None, None, zone
    return zone, stand, zone


def describe(shop: dict[str, Any], offen: list[dict[str, Any]]) -> tuple[str, str]:
    """Titel und Text der Nachricht (rein, testbar).

    Die ersten Einträge stehen darin, nicht bloss die Anzahl: «5 Einträge»
    zwingt zum Nachsehen, «Milch, Brot, Rüebli …» beantwortet die Frage
    oft schon auf dem Sperrbildschirm.
    """
    name = str(shop.get("name") or "Laden")
    texte = [str(row.get("text") or "").strip() for row in offen]
    texte = [text for text in texte if text]
    kopf = ", ".join(texte[:4])
    if len(texte) > 4:
        kopf += f" und {len(texte) - 4} weitere"
    return (f"Du bist im {name}", kopf or f"{len(offen)} Einträge auf der Liste")


# So viele Namen merkt sich der Hub für die Vervollständigung. Zweihundert
# decken einen Haushalt mit Abstand ab; die Grenze steht nur da, damit die
# Liste nach Jahren nicht unbemerkt wächst.
KNOWN_LIMIT = 200


def remember(known: list[Any], text: str, limit: int = KNOWN_LIMIT) -> list[str]:
    """Einen eingekauften Artikel ins Gedächtnis aufnehmen (rein, testbar).

    Wozu: Wer «Milch» zum zwanzigsten Mal einträgt, soll ihn nicht zum
    zwanzigsten Mal ausschreiben müssen. Erledigte Einträge werden
    irgendwann entfernt - die Liste selbst taugt deshalb nicht als
    Gedächtnis.

    Der zuletzt benutzte Name steht vorn: Ein Vorschlag ist umso besser,
    je frischer er ist. Gross-/Kleinschreibung unterscheidet nicht -
    «milch» und «Milch» sind derselbe Posten, und behalten wird die
    zuletzt getippte Schreibweise. Leeres wird nicht gemerkt.
    """
    name = str(text or "").strip()
    if not name:
        return [str(entry) for entry in known if str(entry).strip()]
    unten = name.lower()
    rest = [
        str(entry)
        for entry in known
        if str(entry).strip() and str(entry).strip().lower() != unten
    ]
    return [name, *rest][: max(1, limit)]


def suggestions(known: list[Any], query: str, limit: int = 8) -> list[str]:
    """Vorschläge zu einem angetippten Anfang (rein, testbar).

    Wer «mi» tippt, meint eher «Milch» als «Salami» - was vorn beginnt,
    steht deshalb vor dem, was das Gesuchte bloss enthält. Ohne Eingabe
    kommen die zuletzt benutzten Namen; das ist beim leeren Feld der
    nützlichste Anfang, denn eingekauft wird meistens dasselbe.
    """
    namen = [str(entry) for entry in known if str(entry).strip()]
    suche = str(query or "").strip().lower()
    if not suche:
        return namen[:limit]
    vorn = [name for name in namen if name.lower().startswith(suche)]
    drin = [
        name
        for name in namen
        if suche in name.lower() and not name.lower().startswith(suche)
    ]
    return [*vorn, *drin][:limit]


# ── Was jede Woche fehlt (Punkt 176) ─────────────────────────────────────
#
# Die Standardartikel muss man von Hand pflegen - und tut es nie. Der Hub
# weiss es besser: Er sieht seit Monaten, was wie oft auf der Liste
# landete. Daraus wird ein Vorschlag, kein Eintrag: Wer die Milch selbst
# holt, will sie nicht jede Woche wegwischen müssen.

# So lange bleibt ein Eintrag im Gedächtnis. Ein halbes Jahr reicht für
# einen Rhythmus und ist kurz genug, dass ausgelaufene Gewohnheiten
# («Babybrei») von selbst verschwinden.
LOG_DAYS = 180
LOG_LIMIT = 1000
# So oft muss ein Posten dagewesen sein, bevor daraus ein Rhythmus wird.
# Zweimal ist Zufall, dreimal ist eine Gewohnheit.
MIN_TIMES = 3
# Erst ab diesem Anteil des üblichen Abstands wird vorgeschlagen. Etwas
# früher als der Durchschnitt, weil man auch etwas früher einkauft.
DUE_SHARE = 0.85


def log_item(rows: list[dict[str, Any]], text: str, at: float) -> list[dict[str, Any]]:
    """Einen eingetragenen Posten mitschreiben (rein, testbar).

    Nur der Name und wann - kein Preis, keine Menge, keine Person: Für
    den Rhythmus braucht es nicht mehr, und was nicht da ist, kann auch
    nicht in eine Sicherung wandern.
    """
    name = str(text or "").strip()
    if not name:
        return list(rows or [])
    neu = [{"name": name.lower(), "label": name, "at": float(at)}, *(rows or [])]
    grenze = at - LOG_DAYS * 24 * 3600
    frisch = [
        row
        for row in neu
        if isinstance(row, dict) and float(row.get("at") or 0) >= grenze
    ]
    return frisch[:LOG_LIMIT]


def rhythm(rows: list[dict[str, Any]], now: float) -> list[dict[str, Any]]:
    """Was nach dem üblichen Abstand wieder fällig wäre (rein, testbar).

    «Milch stand zuletzt vor 9 Tagen drauf, sonst alle 7» ist ein
    brauchbarer Vorschlag beim Öffnen der leeren Liste. Gerechnet wird
    aus den Abständen zwischen den Einträgen, nicht aus einem
    eingestellten Wert - dann stimmt es auch für den Haushalt, der alle
    zehn Tage gross einkauft.
    """
    nach_namen: dict[str, list[float]] = {}
    beschriftung: dict[str, str] = {}
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        name = str(row.get("name") or "").strip().lower()
        if not name:
            continue
        try:
            wann = float(row.get("at") or 0)
        except (TypeError, ValueError):
            continue
        nach_namen.setdefault(name, []).append(wann)
        beschriftung.setdefault(name, str(row.get("label") or name))

    faellig = []
    for name, zeiten in nach_namen.items():
        zeiten.sort(reverse=True)
        if len(zeiten) < MIN_TIMES:
            continue
        abstaende = [
            (zeiten[i] - zeiten[i + 1]) / 86400.0 for i in range(len(zeiten) - 1)
        ]
        abstaende = [tage for tage in abstaende if tage >= 0.5]
        if not abstaende:
            continue
        schnitt = sum(abstaende) / len(abstaende)
        her = (now - zeiten[0]) / 86400.0
        if her < schnitt * DUE_SHARE:
            continue
        faellig.append(
            {
                "text": beschriftung[name],
                "days_since": round(her),
                "interval": round(schnitt),
                "times": len(zeiten),
            }
        )
    # Das am längsten Überfällige zuerst.
    faellig.sort(key=lambda row: row["days_since"] - row["interval"], reverse=True)
    return faellig
