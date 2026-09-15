"""Der wöchentliche Gesundheitscheck des Hubs (Punkt 667 der Werkbank).

``core/metrics.py`` kennt Speicher, Prozessorzeit und Zähler längst -
aber nur auf Zuruf: ``homepilot.status`` liest niemand, der nicht gerade
einen Verdacht hat. Ein langsam wachsender Speicherverbrauch fällt damit
erst auf, wenn der Rechner schon stockt, und «wie viele Befehle laufen
hier eigentlich pro Stunde?» blieb unbeantwortet, bis jemand fragte.

Anders als der Morgenbericht (``core/morgen.py``), der nur meldet, wenn
etwas ansteht, kommt dieser hier *immer* an seinem Tag - «läuft seit 12
Tagen, nichts auffällig» ist selbst die Auskunft, die man einmal die
Woche will. Wer sie nicht will, bestellt die Kategorie ab wie jede
andere Push-Nachricht auch.

Die Zahlen gelten seit dem letzten Neustart, nicht seit einer Woche -
``core/metrics.py`` zählt bewusst nur im Arbeitsspeicher (siehe dort).
Nach einem frischen Neustart steht darum «seit 3 Stunden» im Bericht,
nicht «seit 7 Tagen» - das ist die ehrliche Zahl, keine erfundene.
"""

from __future__ import annotations

import time


def faellig(wochentag: int, stunde: int, jetzt: float | None = None) -> bool:
    """Ist heute der Melde-Tag und die Melde-Stunde erreicht? (rein, testbar)

    ``wochentag`` zählt wie ``datetime.weekday()``: 0 = Montag, 6 = Sonntag.
    """
    stand = time.localtime(jetzt) if jetzt is not None else time.localtime()
    return stand.tm_wday == max(0, min(6, int(wochentag))) and stand.tm_hour == max(
        0, min(23, int(stunde))
    )


def uptime_text(sekunden: float) -> str:
    """«seit 3 Stunden» oder «seit 12 Tagen» (rein, testbar).

    Unter einem Tag in Stunden, sonst in Tagen - eine Zahl im
    zweistelligen Stundenbereich liest sich als Tagesangabe klarer.
    """
    stunden = max(0.0, sekunden) / 3600
    if stunden < 24:
        anzahl = max(1, round(stunden))
        return f"seit {anzahl} Stunde" + ("" if anzahl == 1 else "n")
    tage = round(stunden / 24)
    return f"seit {tage} Tag" + ("" if tage == 1 else "en")


def zeilen(
    *,
    laufzeit_sekunden: float,
    memory_mb: float | None,
    disk_percent: int | None,
    commands_pro_stunde: float,
    automations_pro_stunde: float,
    ausgefallene_integrationen: list[str],
) -> list[str]:
    """Die Zeilen des Berichts (rein, testbar).

    Anders als beim Morgenbericht fällt keine Zeile weg, nur weil sie
    unauffällig ist - die erste Zeile steht immer da, auch ohne
    Auffälligkeiten. Nur was der Hub gerade nicht messen kann (kein
    ``/proc`` ausserhalb von Linux, keine Ausfälle), fehlt.
    """
    raus = [f"Läuft {uptime_text(laufzeit_sekunden)}"]
    if memory_mb is not None:
        raus.append(f"Speicher: {memory_mb:.0f} MB")
    if disk_percent is not None:
        raus.append(f"Datenträger zu {disk_percent} % belegt")
    raus.append(
        f"{commands_pro_stunde:.0f} Befehle, {automations_pro_stunde:.0f} Abläufe pro Stunde"
    )
    if ausgefallene_integrationen:
        raus.append("Ausgefallen: " + ", ".join(sorted(ausgefallene_integrationen)))
    return raus


def satz(zeilen_liste: list[str]) -> tuple[str, str]:
    """Titel und Text (rein, testbar).

    Anders als ``morgen.satz`` gibt es hier kein ``None`` - der Bericht
    kommt immer, das ist sein Zweck.
    """
    return "Wochenbericht", "\n".join(f"· {zeile}" for zeile in zeilen_liste)
