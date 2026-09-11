"""Was an einer Alarmanlage regelmässig zu tun ist - und was danach war.

Fünf Fragen, die alle dieselbe Form haben: Zeilen rein, Urteil raus.
Deshalb stehen sie hier zusammen und nicht in der Integration.

- **Der Sirenen-Selbsttest** (Punkt 481 der Werkbank). Eine Sirene, die
  seit dem Einbau nicht mehr geheult hat, heult vielleicht auch beim
  Einbruch nicht. Es gibt einen Sensortest (Punkt 403) und einen drei
  Sekunden langen Ton beim Prüfen der Aktionen - was fehlte, war der
  regelmässige Lauf, den niemand anstossen muss.

- **Der Wartungsmodus** (Punkt 489). Fensterputzen, ein Handwerker im
  Haus, ein Umzugstag: Alles steht offen, und die einzige Antwort darauf
  war «ganz unscharf». Ein befristeter Modus, der sich am Abend von
  selbst wieder scharf schaltet, ist der Unterschied zwischen einer
  Ausnahme und einer Anlage, die seit dem Küchenumbau aus ist.

- **Die Einordnung eines Alarms** (Punkt 490). Die Fehlalarm-Statistik
  riet ihn sich aus: unter sechzig Sekunden entschärft, mindestens
  dreimal. Ein echter Einbruch, den jemand schnell entschärft, zählt
  damit als Fehlalarm; ein Fehlalarm, den zehn Minuten lang niemand
  bemerkt, als echt. Die eine Frage beim Entschärfen ersetzt die ganze
  Schätzung.

Alles rein und testbar; wer schaltet, ist integrations/alarm.py.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

# ── Sirenen-Selbsttest (Punkt 481) ────────────────────────────────────────

#: Wie oft die Sirene von selbst prüft, ob sie noch kann.
#:
#: Ein Quartal: oft genug, dass eine tote Sirene nicht ein Jahr lang tot
#: bleibt, selten genug, dass die Nachbarschaft es nicht als Belästigung
#: empfindet. Vier kurze Töne im Jahr sind weniger als ein Rauchmelder
#: an leerer Batterie an einem einzigen Abend.
TEST_TAGE = 90

#: Zu welcher Stunde. Mittags: Niemand schläft, niemand ist bei der
#: Arbeit gestört, und wer zuhause ist, hört es und weiss Bescheid.
#: Nachts wäre es ein Fehlalarm, den die Anlage selbst auslöst.
TEST_STUNDE = 12


def sirenentest_faellig(
    letzte: Any, jetzt: datetime, tage: int = TEST_TAGE, stunde: int = TEST_STUNDE
) -> bool:
    """Ist der Sirenen-Selbsttest dran? (rein, testbar)

    Nur zur vollen Prüfstunde und nur, wenn die letzte lange genug her
    ist. Ohne je einen Test gilt er als fällig - eine Anlage, die seit
    dem Einbau nie geprüft wurde, ist genau der Fall, für den es das
    gibt.
    """
    if jetzt.hour != int(stunde):
        return False
    try:
        vorher = float(letzte)
    except (TypeError, ValueError):
        return True
    if vorher <= 0:
        return True
    return (jetzt.timestamp() - vorher) >= max(1, int(tage)) * 86400


def sirenentest_satz(letzte: Any, jetzt: datetime, tage: int = TEST_TAGE) -> str:
    """Wann die Sirene zuletzt geprüft wurde - als Satz (rein, testbar)."""
    try:
        vorher = float(letzte or 0)
    except (TypeError, ValueError):
        vorher = 0
    if vorher <= 0:
        return "Die Sirene wurde noch nie geprüft."
    tage_her = int((jetzt.timestamp() - vorher) // 86400)
    wann = datetime.fromtimestamp(vorher).strftime("%d.%m.%Y")
    if tage_her <= 0:
        return f"Sirene heute geprüft ({wann})."
    naechster = max(0, int(tage) - tage_her)
    return (
        f"Sirene zuletzt vor {tage_her} Tagen geprüft ({wann}), "
        f"nächste Prüfung in {naechster} Tagen."
    )


# ── Wartungsmodus (Punkt 489) ─────────────────────────────────────────────

#: So lange höchstens. Ein Wartungsmodus über Tage ist kein Modus mehr,
#: sondern eine ausgeschaltete Anlage mit einem freundlichen Namen.
WARTUNG_MAX_STUNDEN = 12.0

#: Und so lange, wenn niemand etwas sagt: ein Vormittag Fensterputzen.
WARTUNG_STUNDEN = 3.0


def wartung_setzen(stunden: Any, jetzt: float, wer: str = "") -> dict[str, Any]:
    """Den Wartungsmodus anlegen (rein, testbar).

    Geklemmt statt abgelehnt: Wer «48» tippt, meint «lange» und nicht
    «gar nicht» - und eine 422 für eine zu grosse Zahl wäre die Art
    Fehlermeldung, wegen der man den Modus gar nicht erst benutzt und
    stattdessen die Anlage ausschaltet. Genau das soll er verhindern.
    """
    try:
        dauer = float(stunden)
    except (TypeError, ValueError):
        dauer = WARTUNG_STUNDEN
    if dauer <= 0:
        dauer = WARTUNG_STUNDEN
    dauer = min(dauer, WARTUNG_MAX_STUNDEN)
    return {
        "until": jetzt + dauer * 3600,
        "by": str(wer or "").strip() or None,
        "at": jetzt,
    }


def wartung_laeuft(wartung: Any, jetzt: float) -> bool:
    """Läuft der Wartungsmodus gerade? (rein, testbar)"""
    if not isinstance(wartung, dict):
        return False
    try:
        return float(wartung.get("until") or 0) > jetzt
    except (TypeError, ValueError):
        return False


def wartung_satz(wartung: Any, jetzt: float) -> str | None:
    """Was auf der Anlagenseite steht, solange sie ruht (rein, testbar).

    ``None``, wenn sie nicht ruht - dann steht dort nichts statt einer
    Zeile, die eine Ausnahme behauptet, die vorbei ist.
    """
    if not wartung_laeuft(wartung, jetzt):
        return None
    rest = float(wartung["until"]) - jetzt
    minuten = max(1, int(rest // 60))
    wer = str(wartung.get("by") or "").strip()
    von = f" (von {wer})" if wer else ""
    if minuten < 90:
        return f"Wartung{von} – schaltet in {minuten} Minuten wieder scharf."
    return f"Wartung{von} – schaltet in {round(minuten / 60)} Stunden wieder scharf."


# ── Einen Alarm einordnen (Punkt 490) ─────────────────────────────────────

#: Die Antworten. Mehr braucht es nicht: Wer mehr Abstufungen anbietet,
#: bekommt Antworten, die niemand mehr auswerten kann.
URTEILE: tuple[str, ...] = ("echt", "fehlalarm", "test")

URTEIL_TEXT = {
    "echt": "als echt eingeordnet",
    "fehlalarm": "als Fehlalarm eingeordnet",
    "test": "als Test eingeordnet",
}


def urteil_lesen(wert: Any) -> str | None:
    """Eine Einordnung prüfen (rein, testbar) - Unbekanntes wird None."""
    text = str(wert or "").strip().lower()
    return text if text in URTEILE else None


def offener_alarm(history: Any) -> dict[str, Any] | None:
    """Der letzte Alarm, der noch keine Einordnung hat (rein, testbar).

    Nur einer, und nur der letzte: Die Frage «war das echt?» stellt man
    nach dem Entschärfen, nicht als Liste von sechs unbeantworteten
    Fragen aus dem letzten Halbjahr. Ein Alarm, der noch läuft, zählt
    nicht - erst das Entschärfen macht die Frage beantwortbar.
    """
    zeilen = [row for row in (history or []) if isinstance(row, dict)]
    ausgeloest: dict[str, Any] | None = None
    for zeile in zeilen:  # jüngste zuerst (siehe _note in der Integration)
        art = zeile.get("kind")
        if art == "urteil":
            # Ab hier ist alles Ältere eingeordnet.
            return None
        if art == "disarmed" and ausgeloest is None:
            ausgeloest = {"seit": zeile.get("at")}
            continue
        if art == "triggered":
            if ausgeloest is None:
                # Der Alarm läuft noch - erst entschärfen, dann fragen.
                return None
            return {
                "at": zeile.get("at"),
                "entity_id": zeile.get("entity_id"),
                "text": zeile.get("text"),
            }
    return None


def fehlalarm_zaehlen(history: Any) -> dict[str, dict[str, int]]:
    """Je Sensor, wie oft er echt war und wie oft nicht (rein, testbar).

    Punkt 485/490 der Werkbank: Die Statistik zählte bisher nur, *wie
    viele* Fehlalarme es gab, und riet sie sich aus der Zeit bis zum
    Entschärfen zusammen. Gezählt wird jetzt, was ein Mensch gesagt hat -
    und zwar je Sensor, denn «der Melder im Flur war fünfmal falsch» ist
    die Auskunft, aus der ein Handgriff folgt.
    """
    zeilen = list(reversed([row for row in (history or []) if isinstance(row, dict)]))
    zaehler: dict[str, dict[str, int]] = {}
    letzter: str | None = None
    for zeile in zeilen:
        art = zeile.get("kind")
        if art == "triggered":
            letzter = str(zeile.get("entity_id") or "") or None
            continue
        if art != "urteil" or letzter is None:
            continue
        urteil = urteil_lesen(zeile.get("urteil"))
        if urteil is None:
            continue
        stand = zaehler.setdefault(letzter, {"echt": 0, "fehlalarm": 0, "test": 0})
        stand[urteil] += 1
        letzter = None
    return zaehler


def auffaellige_sensoren(
    history: Any, mindest: int = 3
) -> list[dict[str, Any]]:
    """Sensoren, die von Hand oft als Fehlalarm eingeordnet wurden (rein).

    Das Gegenstück zu ``alarmbericht.fehlalarm_kandidaten``, das raten
    muss: Hier zählt nur, was jemand gesagt hat. Sortiert nach Zahl,
    damit der schlimmste zuoberst steht - das ist der, an dem man etwas
    ändert.
    """
    return [
        {"entity_id": entity_id, "fehlalarm": stand["fehlalarm"], "echt": stand["echt"]}
        for entity_id, stand in sorted(
            fehlalarm_zaehlen(history).items(),
            key=lambda kv: (-kv[1]["fehlalarm"], kv[0]),
        )
        if stand["fehlalarm"] >= max(1, int(mindest))
    ]
