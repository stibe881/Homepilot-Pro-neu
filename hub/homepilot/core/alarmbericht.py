"""Was war das gerade? - der Nachbericht zu einem Alarm.

Ein ausgelöster Alarm hinterlässt im Haus ein Durcheinander: Die Sirene
war an, das Licht ging an, jemand hat auf dem Telefon herumgetippt, und
zehn Minuten später steht man in der Küche und weiss nicht, was
eigentlich passiert ist. Die einzelnen Zeilen stehen im Verlauf - aber
der Verlauf ist eine Liste, und eine Liste beantwortet die Frage nicht,
die man stellt: *Was war zuerst, was folgte, und wer hat es beendet?*

Der Bericht macht daraus einen Absatz. Er entsteht beim Unscharfschalten
nach einem Alarm, also genau dann, wenn die Frage gestellt wird - nicht
als Karte, die man irgendwo suchen müsste.

Was drinsteht und warum:

- **Was zuerst auslöste.** Nicht «Bewegung im Flur», sondern der erste
  Sensor: Die Reihenfolge sagt, von wo jemand kam.
- **Was danach kam.** Alles Weitere in der Reihenfolge - daran sieht
  man einen Weg durchs Haus, und daran sieht man auch, dass eine
  einzelne Meldung ohne Fortsetzung meist eine Katze war.
- **Wie lange es dauerte.** Vom Auslösen bis zum Unscharfschalten.
- **Wer beendet hat.** Steht dort «automatisch», hat niemand
  hingeschaut - und das ist die wichtigste Zeile des Berichts.
- **Was aufgezeichnet wurde.** Damit man weiss, ob es etwas zu sehen
  gibt, bevor man sucht.

Reines Rechnen über den Verlauf; wer schickt, ist die Integration.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

#: Die Zeilenarten des Verlaufs, die in einen Bericht gehören.
#:
#: «armed» und «test» bewusst nicht: Ein Bericht über einen Alarm soll
#: den Alarm beschreiben, nicht die Woche davor.
ANLASS = "triggered"
ENDE = "disarmed"
DABEI = frozenset(
    {"triggered", "entry", "verdacht", "motion", "camera", "escalation", "clip"}
)

#: Höchstens so viele Zwischenschritte - mehr liest niemand in einer
#: Nachricht, und der ganze Verlauf steht ohnehin daneben.
SCHRITTE = 5


def _zeit(at: Any) -> str:
    try:
        return datetime.fromtimestamp(float(at)).strftime("%H:%M")
    except (TypeError, ValueError, OSError):
        return ""


def dauer(sekunden: float) -> str:
    """«4 Minuten» statt «238.7» (rein, testbar).

    Unter einer Minute in Sekunden: Bei einem Alarm, der nach zwanzig
    Sekunden endete, ist genau diese Zahl die Auskunft - jemand war
    schon an der Türe.
    """
    sekunden = max(0.0, float(sekunden))
    if sekunden < 60:
        return f"{round(sekunden)} Sekunden"
    minuten = round(sekunden / 60)
    return "eine Minute" if minuten == 1 else f"{minuten} Minuten"


def vorfall(history: Any, bis: float) -> list[dict[str, Any]]:
    """Die Zeilen des letzten Vorfalls, älteste zuerst (rein, testbar).

    Der Verlauf steht jüngste zuerst (``alarm._note`` schiebt vorn ein).
    Gesucht ist der Abschnitt vom jüngsten «ausgelöst» bis zum Ende -
    alles davor gehört zu einem anderen Abend.
    """
    zeilen = [zeile for zeile in (history or []) if isinstance(zeile, dict)]
    gesammelt: list[dict[str, Any]] = []
    for zeile in zeilen:
        at = float(zeile.get("at") or 0)
        if at > bis:
            # Was nach dem Ende kam, gehört nicht dazu.
            continue
        gesammelt.append(zeile)
        if str(zeile.get("kind")) == ANLASS:
            break
    if not gesammelt or str(gesammelt[-1].get("kind")) != ANLASS:
        # Ohne Auslöser gibt es keinen Vorfall zu berichten - etwa beim
        # gewöhnlichen Unscharfschalten am Morgen.
        return []
    return list(reversed(gesammelt))


def bericht(history: Any, beendet_von: str, bis: float) -> tuple[str, str] | None:
    """Titel und Text zum letzten Vorfall (rein, testbar).

    ``None``, wenn es nichts zu berichten gibt: Das ist der Normalfall -
    die Anlage wird viel häufiger unscharf geschaltet, als sie auslöst,
    und ein Nachbericht über nichts wäre eine Nachricht, die man
    abbestellt.
    """
    zeilen = vorfall(history, bis)
    if not zeilen:
        return None

    anlass = zeilen[0]
    begann = float(anlass.get("at") or 0)
    weiter = [
        zeile
        for zeile in zeilen[1:]
        if str(zeile.get("kind")) in DABEI
    ]

    saetze = [f"{_zeit(begann)} {anlass.get('text') or 'Alarm ausgelöst'}."]
    for zeile in weiter[:SCHRITTE]:
        saetze.append(f"{_zeit(zeile.get('at'))} {zeile.get('text') or ''}".strip())
    rest = len(weiter) - SCHRITTE
    if rest > 0:
        saetze.append(f"… und {rest} weitere Meldungen.")

    # Wer beendet hat, steht am Schluss und ausgeschrieben. «automatisch»
    # heisst: Niemand hat hingeschaut - und das ist die Zeile, wegen der
    # es den Bericht gibt.
    wer = str(beendet_von or "").strip()
    saetze.append(
        f"Nach {dauer(bis - begann)} beendet"
        + (f" von {wer}." if wer and wer != "automatisch" else " – von selbst, ohne dass jemand hinsah.")
    )

    titel = "Was war: " + str(anlass.get("text") or "Alarm").replace("Alarm ausgelöst: ", "")
    return titel, " ".join(satz for satz in saetze if satz)


#: Innert so vielen Sekunden entschärft und ohne dass die Eskalation je
#: lief, zählt ein Auslösen als «schnell weggedrückt» - meist kein
#: Einbruch, sondern ein Melder, der zu empfindlich sitzt.
FEHLALARM_SCHWELLE = 60.0

#: Erst ab so vielen Malen wird daraus ein Kandidat. Ein einzelnes
#: schnelles Entschärfen ist der Normalfall (man steht selbst an der
#: Tür), nicht das Muster, das die Statistik finden soll.
FEHLALARM_MINDEST = 3


def fehlalarm_kandidaten(
    history: Any,
    schwelle: float = FEHLALARM_SCHWELLE,
    mindest: int = FEHLALARM_MINDEST,
) -> list[dict[str, Any]]:
    """Sensoren, die auffällig oft schnell und ohne Eskalation entschärft
    wurden (rein, testbar) - Punkt 407 der Werkbank.

    Der Verlauf ist eine flache Liste aller Zeilenarten, jüngste zuerst
    (siehe ``_note`` in der Integration); hier wird sie chronologisch
    durchgegangen und je Auslösen mit dem nächsten Entschärfen gepaart.
    Lief dazwischen die Eskalation, zählt es nicht - dann hat die Anlage
    ihre Zeit bekommen, und ein spätes Entschärfen sagt nichts über den
    Sensor.
    """
    zeilen = list(reversed([row for row in (history or []) if isinstance(row, dict)]))
    offen: dict[str, Any] | None = None
    zaehler: dict[str, int] = {}
    for zeile in zeilen:
        art = zeile.get("kind")
        if art == "triggered":
            entity_id = str(zeile.get("entity_id") or "")
            offen = (
                {"entity_id": entity_id, "at": zeile.get("at"), "eskaliert": False}
                if entity_id
                else None
            )
            continue
        if art == "escalated":
            if offen is not None:
                offen["eskaliert"] = True
            continue
        if art == "disarmed":
            if offen is not None and not offen["eskaliert"]:
                ende = zeile.get("at")
                anfang = offen.get("at")
                dauer_s = (
                    float(ende) - float(anfang)
                    if isinstance(ende, (int, float)) and isinstance(anfang, (int, float))
                    else None
                )
                if dauer_s is not None and 0 <= dauer_s <= schwelle:
                    eid = offen["entity_id"]
                    zaehler[eid] = zaehler.get(eid, 0) + 1
            offen = None
    return [
        {"entity_id": entity_id, "anzahl": anzahl}
        for entity_id, anzahl in sorted(zaehler.items(), key=lambda kv: (-kv[1], kv[0]))
        if anzahl >= mindest
    ]


# ── Das Blatt für Polizei und Versicherung (Punkt 484 der Werkbank) ────────
#
# Der Nachbericht oben ist ein Absatz für das Telefon: «Was war das
# gerade?» Was fehlte, ist dasselbe als Blatt - mit Zeiten, Sensoren und
# dem Hinweis auf die Aufnahmen, in der Stunde danach und nicht drei Tage
# später aus der Erinnerung.
#
# Bewusst Text und kein PDF: Ein Blatt, das man weiterschickt, muss
# überall lesbar sein - im Mailfenster einer Versicherung ebenso wie
# ausgedruckt am Schalter. Dieselbe Entscheidung wie beim Hausblatt
# (core/hausblatt.py).

#: So weit reicht ein Blatt zurück. Ein Alarm dauert Minuten; alles, was
#: eine Stunde davor lag, gehört zu einem anderen Vorfall.
BLATT_FENSTER = 3600.0


def _blattzeit(at: Any) -> str:
    try:
        return datetime.fromtimestamp(float(at)).strftime("%d.%m.%Y %H:%M:%S")
    except (TypeError, ValueError, OSError):
        return "?"


def vorfall_zeilen(history: Any, at: Any = None) -> list[dict[str, Any]]:
    """Die Verlaufszeilen eines einzelnen Alarms (rein, testbar).

    ``at`` ist der Zeitpunkt des Auslösens; ohne Angabe der jüngste
    Alarm. Zurück kommt alles von diesem Auslösen bis zum
    Unscharfschalten, in zeitlicher Reihenfolge - so, wie es passiert
    ist und wie man es einem Dritten erzählt.
    """
    zeilen = list(reversed([row for row in (history or []) if isinstance(row, dict)]))
    anfang: int | None = None
    for index, zeile in enumerate(zeilen):
        if zeile.get("kind") != ANLASS:
            continue
        if at is None or str(zeile.get("at")) == str(at):
            anfang = index
            if at is not None:
                break
    if anfang is None:
        return []
    raus = []
    for zeile in zeilen[anfang:]:
        raus.append(zeile)
        if zeile.get("kind") == ENDE:
            break
    return raus


def blatt(
    history: Any,
    at: Any = None,
    *,
    haus: str = "",
    name_von: Any = None,
) -> str:
    """Ein Alarm als Blatt zum Weitergeben (rein, testbar).

    ``name_von`` bildet eine Gerätekennung auf den Anzeigenamen ab -
    «hm.fenster_kueche» sagt einem Polizisten nichts, «Fenster Küche»
    schon. Ohne die Funktion steht die Kennung da; das ist immer noch
    besser als eine Lücke.
    """
    zeilen = vorfall_zeilen(history, at)
    if not zeilen:
        return "Kein Alarm gefunden."

    def benannt(entity_id: Any) -> str:
        kennung = str(entity_id or "")
        if not kennung:
            return ""
        if callable(name_von):
            return str(name_von(kennung) or kennung)
        return kennung

    anlass = zeilen[0]
    kopf = ["Alarmprotokoll HomePilot"]
    if haus:
        kopf.append(haus)
    kopf.append(f"Ausgelöst: {_blattzeit(anlass.get('at'))}")
    ausloeser = benannt(anlass.get("entity_id"))
    if ausloeser:
        kopf.append(f"Ausgelöst durch: {ausloeser}")

    ende = next((z for z in reversed(zeilen) if z.get("kind") == ENDE), None)
    if ende is not None:
        wer = str(ende.get("by") or "").strip()
        kopf.append(
            f"Beendet: {_blattzeit(ende.get('at'))}"
            + (f" von {wer}" if wer and wer != "automatisch" else " (automatisch)")
        )
        try:
            kopf.append(
                "Dauer: " + dauer(float(ende["at"]) - float(anlass["at"]))
            )
        except (TypeError, ValueError, KeyError):
            pass
    else:
        kopf.append("Beendet: noch nicht")

    ablauf = ["", "Ablauf:"]
    for zeile in zeilen:
        text = str(zeile.get("text") or zeile.get("kind") or "").strip()
        gerät = benannt(zeile.get("entity_id"))
        zusatz = f" [{gerät}]" if gerät and gerät not in text else ""
        ablauf.append(f"  {_blattzeit(zeile.get('at'))}  {text}{zusatz}")

    urteil = next(
        (z for z in reversed(zeilen) if z.get("kind") == "urteil"), None
    )
    schluss = [""]
    if urteil is not None:
        wer = str(urteil.get("by") or "").strip()
        schluss.append(
            "Einordnung: "
            + str(urteil.get("text") or "")
            + (f" ({wer})" if wer else "")
        )
    # Ehrlich benannt: Das Blatt ist eine Abschrift des Hub-Protokolls,
    # kein amtlicher Nachweis. Wer es weitergibt, soll das nicht
    # behaupten müssen und nicht dabei ertappt werden.
    schluss.append(
        "Dieses Blatt ist eine Abschrift des HomePilot-Protokolls. "
        "Aufnahmen liegen, soweit vorhanden, im Clip-Archiv des Hubs."
    )
    return "\n".join([*kopf, *ablauf, *schluss])
