"""Tests der reinen Übersetzungslogik von UniFi, Twinkly und V-ZUG.

Die Netzwerkteile brauchen echte Geräte; hier wird geprüft, was auch ohne
Hardware verifizierbar ist: dass Geräteantworten korrekt in Entitäts-
Zustände übersetzt werden.
"""

from homepilot.core.integration import load_integration_class
from homepilot.integrations.twinkly import state_from_mode
from homepilot.integrations.unifi import normalise_mac, presence_from_clients
from homepilot.integrations.vzug import parse_device_status

ALL_INTEGRATIONS = [
    "demo",
    "meteoalarm",
    "hue",
    "mqtt",
    "homematic",
    "unifi",
    "unifi_protect",
    "hue_sync",
    "spotify",
    "roborock",
    "google_cast",
    "google_calendar",
    "androidtv",
    "ring",
    "matter",
    "weather",
    "overkiz",
    "tunein",
    "twinkly",
    "vzug",
]


def test_every_integration_is_loadable():
    """Fängt fehlendes INTEGRATION-Attribut und falsch gesetzte Namen ab."""
    for name in ALL_INTEGRATIONS:
        cls = load_integration_class(name)
        assert cls.name == name


# ── UniFi ────────────────────────────────────────────────────────────────


def test_normalise_mac():
    assert normalise_mac("AA-BB-CC-DD-EE-FF") == "aa:bb:cc:dd:ee:ff"
    assert normalise_mac("  aa:BB:cc:dd:ee:ff ") == "aa:bb:cc:dd:ee:ff"


def test_presence_from_clients():
    clients = [
        {"mac": "AA:BB:CC:DD:EE:FF", "hostname": "iphone"},
        {"mac": "99:99:99:99:99:99"},
    ]
    presence = presence_from_clients(
        clients, ["aa:bb:cc:dd:ee:ff", "11:22:33:44:55:66"]
    )
    assert presence == {"aa:bb:cc:dd:ee:ff": True, "11:22:33:44:55:66": False}


def test_presence_with_empty_client_list():
    assert presence_from_clients([], ["aa:bb:cc:dd:ee:ff"]) == {
        "aa:bb:cc:dd:ee:ff": False
    }


def test_the_same_unifi_error_does_not_fill_the_log():
    """Der gemeldete Fall: Alle 30 Sekunden dieselbe Warnung, weil der
    Controller die Anmeldeseite statt Daten schickte. Im Log war danach
    nichts anderes mehr zu finden - und gesucht wurde dort gerade ein
    Tastendruck, der nicht ankam."""
    from homepilot.integrations.unifi import KLAGE_TAKT, klage_faellig

    grund = "Der Controller hat die Anmeldeseite geschickt"
    # Der erste Fehler gehört immer ins Log.
    assert klage_faellig(None, grund, 1000.0) is True
    # Derselbe Grund kurz darauf nicht mehr.
    assert klage_faellig((grund, 1000.0), grund, 1030.0) is False
    # Nach einer halben Stunde schon: Sonst hielte man es für erledigt.
    assert klage_faellig((grund, 1000.0), grund, 1000.0 + KLAGE_TAKT) is True
    # Ein anderer Grund ist eine andere Nachricht - der wartet nicht.
    assert klage_faellig((grund, 1000.0), "Zeitüberschreitung", 1030.0) is True


# ── Twinkly ──────────────────────────────────────────────────────────────


def test_state_from_mode():
    assert state_from_mode("off") == "off"
    assert state_from_mode("movie") == "on"
    assert state_from_mode("color") == "on"
    assert state_from_mode(None) == "off"


# ── V-ZUG ────────────────────────────────────────────────────────────────


def test_parse_device_status_running():
    payload = {
        "DeviceName": "Adora",
        "Serial": "11021 123456",
        "Inactive": "false",
        "Program": "Eco",
        "Status": "Programm läuft",
        "ProgramEnd": {"End": "1h 20min", "EndType": "1"},
        "deviceUuid": "0000123456",
    }
    assert parse_device_status(payload) == {
        "state": "running",
        "program": "Eco",
        "status": "Programm läuft",
        "program_end": "1h 20min",
        "serial": "11021 123456",
        # «1h 20min» lief früher in einen ValueError - die Kachel blieb
        # ohne Restzeit, obwohl die Maschine sie meldete.
        "minutes_left": 80,
    }


def test_parse_device_status_idle():
    payload = {
        "DeviceName": "",
        "Serial": "11021 123456",
        "Inactive": "true",
        "Program": "",
        "Status": "",
        "ProgramEnd": {"End": "", "EndType": "0"},
    }
    parsed = parse_device_status(payload)
    assert parsed["state"] == "idle"
    # Leere Strings werden zu None, damit die App nichts Leeres anzeigt.
    assert parsed["program"] is None
    assert parsed["program_end"] is None


def test_parse_device_status_tolerates_missing_fields():
    assert parse_device_status({})["state"] == "idle"


# ── Cookies von einer IP-Adresse ────────────────────────────────────────
#
# Der Fall, der einen Abend gekostet hat: Der UniFi-Controller nahm die
# Anmeldung an, jede folgende Abfrage kam aber unangemeldet zurück - und
# zwar mit Status 200 und der HTML-Anmeldeseite, nicht mit 401. Im Log
# stand «unexpected mimetype: text/html», was nach einem kaputten
# Endpunkt aussieht und nicht nach einem verworfenen Cookie.
#
# Ursache: aiohttp legt Cookies von einem Host ohne Namen - also von
# einer nackten IP-Adresse, wie man eine Konsole im eigenen Netz eben
# anspricht - nur mit `unsafe=True` ab. Sonst verwirft er sie stumm.


async def test_console_session_behaelt_cookies_von_einer_ip():
    from http.cookies import SimpleCookie

    import aiohttp
    from yarl import URL

    from homepilot.core.integration import Integration

    class Dummy(Integration):
        name = "dummy"

        async def setup(self) -> None:  # pragma: no cover - hier ungenutzt
            pass

    # So, wie eine UniFi-Konsole es schickt: fürs ganze Gerät gültig.
    def token() -> SimpleCookie:
        keks: SimpleCookie = SimpleCookie()
        keks["TOKEN"] = "abc"
        keks["TOKEN"]["path"] = "/"
        return keks

    anmeldung = URL("https://10.10.1.10/api/auth/login")
    abfrage = URL("https://10.10.1.10/proxy/network/api/s/default/stat/sta")

    integration = Dummy(hub=None, config={})  # type: ignore[arg-type]
    session = integration.console_session()
    try:
        session.cookie_jar.update_cookies(token(), response_url=anmeldung)
        behalten = session.cookie_jar.filter_cookies(abfrage)
        assert behalten.get("TOKEN") is not None, (
            "Ohne dieses Cookie antwortet der Controller mit der Anmeldeseite"
        )
    finally:
        await session.close()

    # Und die Gegenprobe: Genau das kann der Vorgabe-Speicher nicht.
    schlicht = aiohttp.CookieJar()
    schlicht.update_cookies(token(), response_url=anmeldung)
    assert not schlicht.filter_cookies(abfrage)


# ── «partitioned» wirft das ganze Cookie weg ────────────────────────────
#
# Der zweite Teil derselben Geschichte, und der eigentliche Grund: Selbst
# mit einem Speicher, der Cookies von einer IP-Adresse annimmt, kam nichts
# an. UniFi OS schickt sein Anmelde-Cookie mit dem Attribut 'partitioned'
# (CHIPS), und Pythons SimpleCookie verwirft an einem unbekannten Attribut
# die ganze Zeile - ohne Fehler, ohne Warnung.
#
# Die Zeile unten stammt Wort für Wort von einer UniFi-Konsole, nur der
# Token ist gekürzt.

ECHTE_ZEILE = (
    "TOKEN=eyJhbGciOiJSUzI1NiJ9.abc.def; path=/; "
    "expires=Mon, 24 Aug 2026 16:37:59 GMT; samesite=none; secure; "
    "httponly; partitioned"
)


def test_simplecookie_scheitert_an_partitioned():
    from http.cookies import SimpleCookie

    # Kein Test unseres Codes, sondern die Festschreibung des Grundes:
    # Fällt das eines Tages weg, darf man parse_set_cookie hinterfragen.
    keks: SimpleCookie = SimpleCookie()
    keks.load(ECHTE_ZEILE)
    assert list(keks.keys()) == []


def test_parse_set_cookie_holt_den_token_trotzdem():
    from homepilot.core.integration import parse_set_cookie

    assert parse_set_cookie([ECHTE_ZEILE]) == {"TOKEN": "eyJhbGciOiJSUzI1NiJ9.abc.def"}


def test_parse_set_cookie_uebergeht_zeilen_ohne_paar():
    from homepilot.core.integration import parse_set_cookie

    assert parse_set_cookie(["", "  ", "kaputt; path=/", "A=1", "B=2; secure"]) == {
        "A": "1",
        "B": "2",
    }


def test_parse_set_cookie_behaelt_gleichheitszeichen_im_wert():
    from homepilot.core.integration import parse_set_cookie

    # Ein JWT endet gern auf Füllzeichen - der Wert darf nicht abbrechen.
    assert parse_set_cookie(["T=ab==; path=/"]) == {"T": "ab=="}


async def test_keep_cookies_legt_den_token_wirklich_ab():
    from unittest.mock import Mock

    from multidict import CIMultiDict
    from yarl import URL

    from homepilot.core.integration import Integration

    class Dummy(Integration):
        name = "dummy"

        async def setup(self) -> None:  # pragma: no cover - hier ungenutzt
            pass

    integration = Dummy(hub=None, config={})  # type: ignore[arg-type]
    session = integration.console_session()
    try:
        antwort = Mock()
        antwort.headers = CIMultiDict([("Set-Cookie", ECHTE_ZEILE)])
        integration.keep_cookies(session, antwort, "https://10.10.1.10")

        # Und zwar so, dass er bei der Netzwerk-API auch mitgeht - dort
        # lag der Fehler, nicht beim Anmelden.
        mitgeschickt = session.cookie_jar.filter_cookies(
            URL("https://10.10.1.10/proxy/network/api/s/default/stat/sta")
        )
        assert mitgeschickt.get("TOKEN") is not None
    finally:
        await session.close()


async def test_unifi_und_protect_nehmen_denselben_weg():
    # Die beiden hatten denselben Bedarf und nur eine von ihnen die
    # Lösung. Ein gemeinsamer Helfer verhindert, dass das wiederkehrt.
    import inspect

    from homepilot.integrations import unifi, unifi_protect

    for modul in (unifi, unifi_protect):
        quelle = inspect.getsource(modul)
        assert "self.console_session(" in quelle, modul.__name__
        assert "cookie_jar" not in quelle, f"{modul.__name__} baut wieder selbst"
        # Und beide legen das Anmelde-Cookie selbst ab.
        assert "self.keep_cookies(" in quelle, modul.__name__


# ── «unexpected mimetype: text/html» sagt niemandem etwas ────────────────
#
# Der Satz, an dem eine Stunde Suche hing. Eine UniFi-Konsole trägt
# mehrere Anwendungen, jede unter /proxy/<name>/. Fragt man nach einer,
# die auf DIESEM Gerät nicht läuft, kommt kein 404, sondern die
# Weboberfläche mit Status 200 - im Haus stand die Netzwerk-Anwendung
# auf dem Gateway, während 'host' auf die Protect-Konsole zeigte.


def test_html_antwort_nennt_die_gesuchte_anwendung():
    from homepilot.core.integration import console_html_hint

    hinweis = console_html_hint(
        "https://10.10.1.10/proxy/network/api/s/default/stat/sta", "text/html"
    )
    assert hinweis is not None
    # Der Name der Anwendung gehört hinein - er ist der halbe Weg zur Lösung.
    assert "«network»" in hinweis
    assert "host" in hinweis


def test_html_antwort_auch_fuer_protect():
    from homepilot.core.integration import console_html_hint

    hinweis = console_html_hint("https://10.10.1.1/proxy/protect/api/bootstrap", "text/html")
    assert hinweis is not None and "«protect»" in hinweis


def test_ohne_proxy_pfad_bleibt_es_allgemein():
    from homepilot.core.integration import console_html_hint

    hinweis = console_html_hint("https://10.10.1.10/api/login", "text/html")
    assert hinweis is not None and "«" not in hinweis


def test_echte_daten_loesen_keinen_hinweis_aus():
    from homepilot.core.integration import console_html_hint

    for typ in ("application/json", "application/json; charset=utf-8", ""):
        assert console_html_hint("https://10.10.1.1/proxy/network/api/self/sites", typ) is None
