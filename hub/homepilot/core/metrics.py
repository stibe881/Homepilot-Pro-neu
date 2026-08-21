"""Was der Hub über sich selbst weiss – und bisher für sich behielt.

Der Plattenplatz wurde überwacht, alles andere nicht. Ein langsam
wachsender Speicherverbrauch fiel deshalb erst auf, wenn der Pi stand,
und «wie viele Befehle laufen hier eigentlich pro Stunde?» liess sich
nicht beantworten.

Bewusst schlicht: Zähler im Arbeitsspeicher, zurückgesetzt beim Neustart,
und Speicher-/Prozessorwerte direkt aus ``/proc``. Kein Prometheus, keine
zusätzliche Abhängigkeit – für einen Haushalt zählt, dass die Zahlen da
sind, nicht dass sie ein Dashboard füllen.

Die Werte aus ``/proc`` gibt es nur unter Linux. Auf allem anderen fehlen
sie schlicht; das ist kein Fehler, sondern der Rechner des Entwicklers.
"""

from __future__ import annotations

import os
import time
from typing import Any


class Counters:
    """Mitzählen, was der Hub tut.

    Absichtlich ohne Sperre: Alles läuft in einer Ereignisschleife, und
    ein verlorener Zähler wäre ohnehin die harmloseste Folge eines
    Nebenläufigkeitsfehlers, den es hier nicht gibt.
    """

    def __init__(self) -> None:
        self._counts: dict[str, int] = {}
        self.started_at = time.time()

    def zaehle(self, name: str, um: int = 1) -> None:
        self._counts[name] = self._counts.get(name, 0) + um

    def as_dict(self) -> dict[str, int]:
        return dict(sorted(self._counts.items()))

    def pro_stunde(self, name: str, jetzt: float | None = None) -> float:
        """Auf die Stunde hochgerechnet (rein genug, testbar).

        Erst ab einer Minute Laufzeit: Direkt nach dem Start ergäbe ein
        einzelner Befehl sonst «3600 pro Stunde», und das liest sich wie
        ein Problem, wo keines ist.
        """
        laufzeit = (jetzt or time.time()) - self.started_at
        if laufzeit < 60:
            return 0.0
        return round(self._counts.get(name, 0) * 3600 / laufzeit, 1)


def process_stats(pid: int | None = None) -> dict[str, Any]:
    """Speicher und Prozessorzeit dieses Prozesses (Linux).

    ``VmRSS`` ist der Speicher, der wirklich im RAM liegt – die Zahl, die
    auf einem Raspberry Pi mit einem Gigabyte zählt. Die Prozessorzeit
    kommt aus ``/proc/self/stat`` und ist kumulativ; interessant ist ihr
    Zuwachs zwischen zwei Abrufen, nicht der Absolutwert.

    Fehlt ``/proc``, kommt ein leeres Wörterbuch zurück. Lieber nichts
    behaupten als eine Zahl erfinden.
    """
    basis = f"/proc/{pid}" if pid else "/proc/self"
    werte: dict[str, Any] = {}
    try:
        with open(f"{basis}/status", encoding="utf-8") as datei:
            for zeile in datei:
                if zeile.startswith("VmRSS:"):
                    werte["memory_mb"] = round(int(zeile.split()[1]) / 1024, 1)
                elif zeile.startswith("Threads:"):
                    werte["threads"] = int(zeile.split()[1])
    except (OSError, ValueError, IndexError):
        return {}
    try:
        with open(f"{basis}/stat", encoding="utf-8") as datei:
            felder = datei.read().rsplit(") ", 1)[-1].split()
        takte = os.sysconf("SC_CLK_TCK")
        # utime (14) und stime (15) im Handbuch, nach dem Klammerfeld also
        # Index 11 und 12.
        werte["cpu_seconds"] = round((int(felder[11]) + int(felder[12])) / takte, 1)
    except (OSError, ValueError, IndexError):
        pass
    try:
        werte["open_files"] = len(os.listdir(f"{basis}/fd"))
    except OSError:
        pass
    return werte
