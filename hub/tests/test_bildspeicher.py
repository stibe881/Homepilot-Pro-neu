"""Der Vorrat für teuer geholte Bilder – vor allem die Saugerkarte."""

from homepilot.core.bildspeicher import Bildspeicher


def test_a_freshly_stored_picture_comes_back():
    speicher = Bildspeicher()
    speicher.lege("sauger", 100.0, b"PNG")
    assert speicher.hole("sauger", 100.5, 30.0) == b"PNG"


def test_nothing_stored_means_nothing_returned():
    assert Bildspeicher().hole("sauger", 100.0, 30.0) is None


def test_a_picture_older_than_allowed_is_refused():
    speicher = Bildspeicher()
    speicher.lege("sauger", 100.0, b"PNG")
    assert speicher.hole("sauger", 131.0, 30.0) is None
    # Genau auf der Grenze zählt es noch als frisch.
    assert speicher.hole("sauger", 130.0, 30.0) == b"PNG"


def test_a_maximum_age_of_zero_switches_the_store_off():
    # Damit der Aufrufer nicht verzweigen muss, wenn er wirklich das
    # Neueste braucht.
    speicher = Bildspeicher()
    speicher.lege("sauger", 100.0, b"PNG")
    assert speicher.hole("sauger", 100.0, 0.0) is None


def test_each_device_keeps_its_own_picture():
    speicher = Bildspeicher()
    speicher.lege("oben", 100.0, b"A")
    speicher.lege("unten", 100.0, b"B")
    assert speicher.hole("oben", 100.0, 30.0) == b"A"
    assert speicher.hole("unten", 100.0, 30.0) == b"B"


def test_a_failed_fetch_does_not_freeze_the_old_picture():
    # Sonst zeigte die App nach einem Fehler stundenlang denselben Stand,
    # ohne dass jemand merkt, dass nichts mehr nachkommt.
    speicher = Bildspeicher()
    speicher.lege("sauger", 100.0, b"PNG")
    speicher.lege("sauger", 105.0, None)
    assert speicher.hole("sauger", 105.0, 30.0) is None


def test_a_clock_running_backwards_makes_the_picture_old():
    # Wanduhr gestellt, Sommerzeit, NTP-Sprung: Ein negatives Alter darf
    # nicht als «ganz frisch» durchgehen und den Stand einfrieren.
    speicher = Bildspeicher()
    speicher.lege("sauger", 100.0, b"PNG")
    assert speicher.hole("sauger", 90.0, 30.0) is None


def test_forgetting_after_a_command_clears_the_store():
    speicher = Bildspeicher()
    speicher.lege("sauger", 100.0, b"PNG")
    speicher.vergiss("sauger")
    assert speicher.hole("sauger", 100.0, 30.0) is None
    # Und ein zweites Vergessen ist kein Fehler.
    speicher.vergiss("sauger")


def test_the_age_is_readable_for_the_log():
    speicher = Bildspeicher()
    assert speicher.alter("sauger", 100.0) is None
    speicher.lege("sauger", 100.0, b"PNG")
    assert speicher.alter("sauger", 112.0) == 12.0
