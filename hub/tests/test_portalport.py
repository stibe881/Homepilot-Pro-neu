"""Der Umleiter auf Port 80 - fürs Anmeldefenster des Gäste-WLANs.

UniFi lässt beim «External Portal Server» nur eine IPv4-Adresse zu, kein
«:8123». Der Controller schickt den Gast also auf Port 80; dort steht
sonst nichts, und das Anmeldefenster bleibt leer, ohne dass im Log des
Hubs auch nur eine Anfrage auftaucht.
"""

from homepilot.core.config import ConfigError, portal_port
from homepilot.core.portalport import weiterleitung


def test_the_query_survives_because_the_mac_is_in_it():
    """Pfad und Abfrage müssen unverändert ankommen.

    In der Abfrage steht die MAC des Gastgeräts (`id=…`) - ohne sie kann
    der Hub niemanden freischalten, und der ganze Weg wäre umsonst.
    """
    ziel = weiterleitung("10.10.1.13", "/guest/s/default", "id=aa:bb:cc&ssid=Gast", 8123)
    assert ziel == "http://10.10.1.13:8123/guest/s/default?id=aa:bb:cc&ssid=Gast"


def test_an_existing_port_is_replaced_not_appended():
    """Sonst entstünde «10.10.1.13:80:8123» - und der Browser käme nirgends an."""
    assert weiterleitung("10.10.1.13:80", "/gast/portal", "", 8123) == (
        "http://10.10.1.13:8123/gast/portal"
    )


def test_the_host_comes_from_the_request():
    """Der Hub weiss nicht, unter welcher seiner Adressen ihn der
    Controller nennt - eine geratene wäre für den Gast unerreichbar."""
    assert weiterleitung("hub.example.ch", "/x", "", 8123).startswith(
        "http://hub.example.ch:8123/"
    )
    # Mehrere Hosts (über einen Proxy) - der erste gilt.
    assert weiterleitung("a.example, b.example", "/x", "", 8123).startswith(
        "http://a.example:8123/"
    )


def test_ipv6_brackets_stay_intact():
    assert weiterleitung("[fe80::1]:80", "/x", "", 8123) == "http://[fe80::1]:8123/x"


def test_a_missing_host_does_not_crash_the_redirect():
    """Ein Browser ohne Host-Kopf ist selten, aber kein Absturzgrund."""
    assert weiterleitung("", "/x", "", 8123) == "http://:8123/x"


def test_the_port_setting_is_optional_and_forgiving():
    """Der Umleiter ist eine Bequemlichkeit, kein Dienst: Ein 0-Wert
    heisst «lass es bleiben», nicht «brich den Start ab»."""
    assert portal_port(80) == 80
    assert portal_port("80") == 80
    assert portal_port(None) is None
    assert portal_port(0) is None
    assert portal_port(False) is None


def test_a_nonsense_port_is_named_as_such():
    """Wer sich vertippt, soll es lesen - nicht später rätseln."""
    import pytest

    with pytest.raises(ConfigError):
        portal_port("achtzig")
    with pytest.raises(ConfigError):
        portal_port(99999)
