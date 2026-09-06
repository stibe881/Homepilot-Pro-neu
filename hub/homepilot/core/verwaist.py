"""Verwaiste Abläufe: Stille sieht wie Erfolg aus (Punkt 262 der Werkbank).

Ein Ablauf, der seit Monaten nicht gefeuert hat, ist meist tot - das
Gerät wurde umbenannt, die Bedingung wird nie wahr, der Melder hängt in
einer Schublade. Niemand merkt es, weil ein toter Ablauf genauso aussieht
wie einer, der brav auf seinen seltenen Moment wartet: still.

Der Lauf-Verlauf des Motors hilft dabei nicht - er ist auf RUN_LIMIT
Einträge gedeckelt und nach jedem lebhaften Abend wieder jung. Deshalb
führt der Motor hier je Ablauf ein dauerhaftes «zuletzt gefeuert» in der
hub.data nach, dasselbe Zeilen-Muster wie core/batterie.py: Hier steht
nur das Rechnen, wo die Zeilen liegen, wissen Motor und API (STORE_KEY).

Zwei Zeitpunkte je Zeile, und beide braucht es:

* ``fired`` - wann der Ablauf zuletzt wirklich lief (nicht bloss
  ausgelöst und übersprungen wurde: «nie erfüllte Bedingung» ist genau
  eine der Arten, tot zu sein).
* ``first_seen`` - wann der Motor den Ablauf zum ersten Mal gesehen hat.
  Ein Anlagedatum führen die Abläufe nicht, und nachträglich eines zu
  erfinden wäre gelogen. Ohne dieses Datum wäre ein letzte Woche
  angelegter Ablauf sofort «seit 90 Tagen still» - dabei hatte er noch
  gar keine 90 Tage Zeit.
"""

from __future__ import annotations

from typing import Any

#: Wo die Zeilen liegen (hub.data). Der Schlüssel steht hier, weil der
#: Motor sie schreibt und die API-Route sie liest.
STORE_KEY = "automation_fired"

#: Ab so vielen Tagen Stille gilt ein Ablauf als verwaist. Die Grenze
#: definiert allein der Hub - die App bekommt `orphaned` fertig
#: mitgeliefert, damit die beiden nie zwei Meinungen haben.
TAGE = 90

#: Obergrenze, damit ein Fehler in einer Schleife die Datei nicht
#: sprengt. Mehr Abläufe hat kein Haushalt.
HOECHSTENS = 1000


def _zeilen(rows: Any) -> list[dict[str, Any]]:
    return [
        row
        for row in rows or []
        if isinstance(row, dict) and row.get("automation_id")
    ]


def _zahl(wert: Any) -> float:
    try:
        return float(wert or 0)
    except (TypeError, ValueError):
        return 0.0


def zeile(rows: Any, automation_id: str) -> dict[str, Any] | None:
    """Was zu diesem Ablauf vermerkt ist - oder nichts (rein, testbar)."""
    for row in _zeilen(rows):
        if row.get("automation_id") == automation_id:
            return row
    return None


def merke_feuer(rows: Any, automation_id: str, at: float) -> list[dict[str, Any]]:
    """Dieser Ablauf hat eben gefeuert (rein, testbar).

    ``first_seen`` bleibt stehen, wie es war - oder beginnt jetzt, falls
    der Ablauf noch keine Zeile hatte: Wer feuert, ist damit auch gesehen.
    """
    alt = zeile(rows, automation_id)
    first_seen = _zahl(alt.get("first_seen")) if alt else 0.0
    neu = {
        "automation_id": automation_id,
        "first_seen": first_seen or at,
        "fired": at,
    }
    behalten = [
        row for row in _zeilen(rows) if row.get("automation_id") != automation_id
    ]
    return [neu, *behalten][:HOECHSTENS]


def merke_gesehen(
    rows: Any, automation_ids: list[str], at: float
) -> list[dict[str, Any]] | None:
    """Alle jetzigen Abläufe haben eine Zeile - Gelöschtes fällt weg.

    (rein, testbar) Gibt None zurück, wenn nichts zu ändern war: Der
    Motor ruft das im Takt auf, und ein Schreibvorgang ohne Änderung
    wäre bei jedem Takt ein fsync für nichts.

    Zeilen zu Abläufen, die es nicht mehr gibt, werden vergessen - sonst
    wüchse die Datei mit jedem je gelöschten Ablauf weiter.
    """
    bekannt = {row.get("automation_id") for row in _zeilen(rows)}
    jetzt_da = set(automation_ids)
    if bekannt == jetzt_da:
        return None
    behalten = [
        row for row in _zeilen(rows) if row.get("automation_id") in jetzt_da
    ]
    neue = [
        {"automation_id": automation_id, "first_seen": at, "fired": 0.0}
        for automation_id in automation_ids
        if automation_id not in bekannt
    ]
    return [*behalten, *neue][:HOECHSTENS]


def letzte_feuer(rows: Any) -> dict[str, float]:
    """Ablauf → Unix-Sekunden des letzten Feuerns (rein, testbar).

    Wer nie gefeuert hat, fehlt im Ergebnis - die API macht daraus ein
    ehrliches ``null`` statt einer Null, die wie 1970 aussieht.
    """
    return {
        str(row["automation_id"]): _zahl(row.get("fired"))
        for row in _zeilen(rows)
        if _zahl(row.get("fired")) > 0
    }


def nur_von_hand(automation: Any) -> bool:
    """Startet dieser Ablauf nur von Hand? (rein, testbar)

    Ein Ablauf ohne Auslöser hat keinen eigenen Weg zu feuern - er wird
    über den Testen-Knopf oder von einem anderen Ablauf (Aktion
    ``automation``) angestossen. Wer nur von Hand startet, feuert eben
    selten; ihn als verwaist zu melden hiesse, den Babysitter-Modus
    jeden Herbst für tot zu erklären.
    """
    return not [t for t in getattr(automation, "triggers", None) or [] if isinstance(t, dict)]


def verwaiste(
    rows: Any, automations: Any, now: float, tage: int = TAGE
) -> list[dict[str, Any]]:
    """Welche aktiven Abläufe seit `tage` Tagen nicht gefeuert haben.

    (rein, testbar) Je Treffer die Kennung, der Name und wann er zuletzt
    gefeuert hat (0 = noch nie). Nicht dabei sind:

    * Ausgeschaltete und ruhende (``quiet_until`` in der Zukunft) - wer
      einen Ablauf absichtlich stilllegt, braucht keine Meldung, dass er
      still ist.
    * Abläufe, die nur von Hand starten (siehe ``nur_von_hand``).
    * Abläufe, die jünger sind als `tage`: Massgebend ist ``first_seen``
      aus den Zeilen, weil es kein Anlagedatum gibt - ein letzte Woche
      angelegter Ablauf hatte schlicht noch keine `tage` Tage Zeit.
      Ohne Zeile hat die Uhr noch gar nicht begonnen (der Motor legt sie
      im nächsten Takt an), also auch kein Urteil.
    """
    grenze = now - tage * 24 * 3600
    tote: list[dict[str, Any]] = []
    for automation in automations or []:
        if not getattr(automation, "enabled", True):
            continue
        quiet_until = getattr(automation, "quiet_until", None)
        if quiet_until and _zahl(quiet_until) > now:
            continue
        if nur_von_hand(automation):
            continue
        automation_id = str(getattr(automation, "id", "") or "")
        row = zeile(rows, automation_id)
        if row is None:
            continue
        first_seen = _zahl(row.get("first_seen"))
        if not first_seen or first_seen > grenze:
            continue
        fired = _zahl(row.get("fired"))
        if fired > grenze:
            continue
        tote.append(
            {
                "id": automation_id,
                "alias": str(getattr(automation, "alias", "") or automation_id),
                "last_fired": fired or None,
            }
        )
    return tote


def hinweis(tote: list[dict[str, Any]], tage: int = TAGE) -> tuple[str, str]:
    """Titel und Text des Sammel-Hinweises (rein, testbar).

    Eine Nachricht für alle statt einer je Ablauf: Wer drei tote Abläufe
    hat, soll einmal aufräumen, nicht dreimal aufschrecken. Bei vielen
    werden nur die ersten Namen genannt - eine Push ist kein Bericht.
    """
    namen = [str(row.get("alias") or row.get("id") or "?") for row in tote]
    if len(tote) == 1:
        titel = "Ein Ablauf ist womöglich verwaist"
        text = (
            f"«{namen[0]}» hat seit über {tage} Tagen nicht gefeuert. "
            "Umbenanntes Gerät, nie erfüllte Bedingung? "
            "«Hätte gefeuert» im Editor hilft beim Prüfen."
        )
        return titel, text
    titel = f"{len(tote)} Abläufe haben lange nicht gefeuert"
    gezeigt = "', '".join(namen[:4])
    rest = f" und {len(namen) - 4} weitere" if len(namen) > 4 else ""
    text = (
        f"Seit über {tage} Tagen still: '{gezeigt}'{rest}. "
        "«Hätte gefeuert» im Editor hilft beim Prüfen."
    )
    return titel, text
