"""Was der Hub über sich selbst weiss.

Der Plattenplatz wurde überwacht, alles andere nicht - ein langsam
wachsender Speicherverbrauch fiel deshalb erst auf, wenn der Rechner
stand.
"""

import sys

from homepilot.core.metrics import Counters, process_stats


def test_counters_count():
    zaehler = Counters()
    assert zaehler.as_dict() == {}
    zaehler.zaehle("commands")
    zaehler.zaehle("commands", 4)
    zaehler.zaehle("errors")
    assert zaehler.as_dict() == {"commands": 5, "errors": 1}


def test_rate_stays_quiet_in_the_first_minute():
    """Direkt nach dem Start ergäbe ein Befehl «3600 pro Stunde».

    Das liest sich wie ein Problem, wo keines ist - deshalb erst ab einer
    Minute Laufzeit.
    """
    zaehler = Counters()
    zaehler.started_at = 1000.0
    zaehler.zaehle("commands")
    assert zaehler.pro_stunde("commands", jetzt=1030.0) == 0.0
    # Nach einer Stunde mit sechs Befehlen: sechs pro Stunde.
    zaehler._counts["commands"] = 6
    assert zaehler.pro_stunde("commands", jetzt=1000.0 + 3600) == 6.0
    # Was nie gezählt wurde, ist null und kein Fehler.
    assert zaehler.pro_stunde("gibtsnicht", jetzt=1000.0 + 3600) == 0.0


def test_process_stats_reads_the_real_process():
    werte = process_stats()
    if sys.platform != "linux":
        # Ohne /proc lieber nichts behaupten als eine Zahl erfinden.
        assert werte == {}
        return
    assert werte["memory_mb"] > 0
    assert werte["threads"] >= 1
    assert werte["cpu_seconds"] >= 0


def test_process_stats_says_nothing_about_a_process_that_is_gone():
    # Eine Kennung, die es sicher nicht gibt.
    assert process_stats(pid=99999999) == {}
