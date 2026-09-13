"""Die PlayStation ohne Bibliothek und ohne Konsole (Punkt 643).

Zustand und Wecken laufen über das Discovery-Protokoll (DDP) - eigener
Code, damit sie auch dann gehen, wenn ``pyremoteplay`` fehlt. Die
Textteile davon sind reine Funktionen; die Geräteschleife läuft hier
gegen einen gefälschten UDP-Kanal.
"""

from __future__ import annotations

import pytest

from homepilot.integrations import playstation
from homepilot.integrations.playstation import (
    BIBLIOTHEK_FEHLT,
    COMMANDS,
    NICHT_ERREICHBAR,
    NICHT_GEKOPPELT,
    NICHT_REGISTRIERT,
    PlaystationIntegration,
    absage,
    ddp_antwort,
    ddp_ports,
    ddp_suche,
    ddp_wecken,
    konsolenzustand,
    konto_aus_antwort,
    pin_pruefen,
    redirect_pruefen,
    regist_key_zahl,
    registriert,
    taste,
    weck_kennung,
)

ANTWORT_AN = (
    b"HTTP/1.1 200 Ok\n"
    b"host-id:0123456789ab\n"
    b"host-type:PS5\n"
    b"host-name:Wohnzimmer-PS5\n"
    b"host-request-port:997\n"
    b"running-app-name:Ratchet & Clank: Rift Apart\n"
    b"running-app-titleid:PPSA01503_00\n"
    b"device-discovery-protocol-version:00030010\n"
    b"system-version:09020000\n"
)
ANTWORT_RUHE = (
    b"HTTP/1.1 620 Server Standby\n"
    b"host-id:0123456789ab\n"
    b"host-type:PS5\n"
    b"host-name:Wohnzimmer-PS5\n"
    b"device-discovery-protocol-version:00030010\n"
)


# ── Das Protokoll ──────────────────────────────────────────────────────


def test_die_statusanfrage_traegt_die_protokollversion():
    """Ohne die Versionszeile antwortet die Konsole gar nicht."""
    nachricht = ddp_suche().decode()
    assert nachricht.startswith("SRCH * HTTP/1.1\n")
    assert "device-discovery-protocol-version:00030010\n" in nachricht


def test_die_weck_nachricht_traegt_die_kennung():
    nachricht = ddp_wecken("12345").decode()
    assert nachricht.startswith("WAKEUP * HTTP/1.1\n")
    assert "user-credential:12345\n" in nachricht
    # Die Begleitfelder der Remote-Play-App - ohne sie fliegt das Paket weg.
    assert "client-type:vr\n" in nachricht and "auth-type:R\n" in nachricht


def test_eine_antwort_wird_gelesen_auch_mit_doppelpunkt_im_spielnamen():
    daten = ddp_antwort(ANTWORT_AN)
    assert daten["status_code"] == 200 and daten["status"] == "Ok"
    assert daten["host-type"] == "PS5" and daten["host-id"] == "0123456789ab"
    # Getrennt wird nur am ersten Doppelpunkt - «Ratchet & Clank: Rift
    # Apart» ist ein Name, kein zweites Feld.
    assert daten["running-app-name"] == "Ratchet & Clank: Rift Apart"
    assert daten["running-app-titleid"] == "PPSA01503_00"


def test_die_laufende_konsole_meldet_spiel_und_bauart():
    zustand = konsolenzustand(ddp_antwort(ANTWORT_AN))
    assert zustand["state"] == "on" and zustand["standby"] is False
    assert zustand["app"] == "Ratchet & Clank: Rift Apart"
    assert zustand["title_id"] == "PPSA01503_00"
    # Die Media-Player-Kachel zeigt `track` als Hauptzeile.
    assert zustand["track"] == zustand["app"]
    assert zustand["konsole"] == "PS5"


def test_ruhemodus_ist_aus_aber_weckbar():
    """Standby ist «off» (so greifen Karte und Kachel wie beim Fernseher),
    trägt aber `standby`: Nur daraus lässt sich die Konsole wecken."""
    zustand = konsolenzustand(ddp_antwort(ANTWORT_RUHE))
    assert zustand["state"] == "off" and zustand["standby"] is True
    assert zustand["app"] is None and zustand["title_id"] is None


def test_kaputte_bytes_sind_keine_antwort():
    assert ddp_antwort(b"\xff\xfe") == {}
    assert ddp_antwort("") == {}
    assert ddp_antwort("SRCH * HTTP/1.1\n") == {}


def test_ports_je_bauart():
    """Solange die Bauart unbekannt ist, wird an beide Ports geklopft."""
    assert ddp_ports("PS5") == [9302]
    assert ddp_ports("ps4") == [987]
    assert ddp_ports(None) == [9302, 987]


# ── Tasten ─────────────────────────────────────────────────────────────


def test_tasten_und_aliasse():
    """`ok`, `back` und `home` sind Kreuz, Kreis und PS-Taste - so
    funktioniert die bestehende Fernbedienung der App ohne Änderung."""
    assert taste("ok") == "CROSS"
    assert taste("back") == "CIRCLE"
    assert taste("home") == "PS"
    assert taste("dpad_up") == "UP" and taste("options") == "OPTIONS"
    assert taste("turn_on") is None


def test_jedes_kommando_des_vertrags_ist_eine_taste_oder_ein_schalter():
    for command in COMMANDS:
        if command in ("turn_on", "turn_off", "toggle"):
            continue
        assert taste(command), command


# ── Kennungen ──────────────────────────────────────────────────────────


def test_regist_key_zahl_rechnet_wie_die_bibliothek():
    """Doppelt hex-kodiert: aussen die Bytes einer Hex-Zeichenkette,
    innen die acht Bytes des Schlüssels."""
    innen = "0123456789abcdef"
    schluessel = innen.encode("ascii").hex()
    erwartet = str(int.from_bytes(bytes.fromhex(innen), "big"))
    assert regist_key_zahl(schluessel) == erwartet
    pytest.importorskip("pyremoteplay")
    from pyremoteplay.util import format_regist_key

    assert regist_key_zahl(schluessel) == format_regist_key(schluessel)


PROFILE = {
    "stibe": {
        "id": "AAAA",
        "hosts": {"0123456789ab": {"data": {"RegistKey": "3031323334353637"}, "type": "PS5"}},
    }
}
KONTO = {"user_rpid": "AAAA", "user_id": "1", "online_id": "stibe", "credentials": "deadbeef"}


def test_weck_kennung_bevorzugt_den_regist_key():
    assert weck_kennung(PROFILE, "stibe", "0123456789ab", KONTO) == regist_key_zahl(
        "3031323334353637"
    )
    # Ohne Registrierung bleibt die Konto-Kennung - so weckt die
    # zweite Bildschirm-App eine PS4.
    assert weck_kennung({}, "stibe", "0123456789ab", KONTO) == "deadbeef"
    assert weck_kennung(PROFILE, "stibe", None, KONTO) == "deadbeef"
    assert weck_kennung({}, None, None, None) is None


def test_registriert_kennt_die_profildatei():
    assert registriert(PROFILE, "stibe", "0123456789ab") is True
    assert registriert(PROFILE, "stibe", "ffffffffffff") is False
    assert registriert(PROFILE, "andere", "0123456789ab") is False
    # Solange die Konsole nie geantwortet hat, zählt, ob das Konto
    # überhaupt eine kennt.
    assert registriert(PROFILE, "stibe", None) is True
    assert registriert({}, "stibe", None) is False


def test_konto_aus_antwort_behaelt_nur_die_kennungen():
    konto = konto_aus_antwort({**KONTO, "access_token": "geheim"})
    assert konto == KONTO
    with pytest.raises(ValueError):
        konto_aus_antwort(None)
    with pytest.raises(ValueError):
        konto_aus_antwort({"online_id": "stibe"})


def test_redirect_pruefen_erkennt_die_falsche_seite():
    """Der häufigste Fehler: die Anmeldeseite kopiert statt der danach."""
    with pytest.raises(ValueError) as absage_:
        redirect_pruefen("https://auth.api.sonyentertainmentnetwork.com/2.0/oauth/authorize?x")
    assert "redirect" in str(absage_.value)
    with pytest.raises(ValueError):
        redirect_pruefen("https://remoteplay.dl.playstation.net/remoteplay/redirect")
    ok = " https://remoteplay.dl.playstation.net/remoteplay/redirect?code=abc&cid=1 "
    assert redirect_pruefen(ok) == ok.strip()


def test_pin_pruefen_nimmt_die_zwei_vierergruppen():
    assert pin_pruefen("1234 5678") == "12345678"
    assert pin_pruefen("1234-5678") == "12345678"
    for daneben in ("1234", "abcdefgh", "", None, "123456789"):
        with pytest.raises(ValueError):
            pin_pruefen(daneben)


def test_die_absage_nennt_genau_einen_naechsten_schritt():
    assert absage(False, False) == NICHT_ERREICHBAR
    assert absage(True, False) == NICHT_GEKOPPELT
    assert absage(True, True, False, False) == BIBLIOTHEK_FEHLT
    assert absage(True, True, False, True) == NICHT_REGISTRIERT
    assert absage(True, True, True, True) is None
    assert 'pip install "homepilot[playstation]"' in BIBLIOTHEK_FEHLT


# ── Die Geräteschleife gegen einen gefälschten Kanal ───────────────────


class FakeKanal:
    """Der UDP-Kanal, nur dass die Antwort hier vorgegeben wird."""

    def __init__(self):
        self.antwort = None
        self.gesendet = []

    async def anfragen(self, host, ports, nachricht, timeout=2.0):
        self.gesendet.append(("anfrage", host, tuple(ports)))
        return self.antwort

    def senden(self, host, port, nachricht):
        self.gesendet.append(("senden", host, port, nachricht))

    def schliessen(self):
        pass


async def aufbau(hub, tmp_path, monkeypatch) -> tuple[PlaystationIntegration, FakeKanal]:
    """Die Integration wie setup() sie anlegt - nur ohne Netz.

    Die Geräteschleife wird nicht gestartet; die Tests rufen ihre Runde
    (`_refresh`) selbst, damit nichts nebenher läuft.
    """
    integration = PlaystationIntegration(
        hub,
        {
            "devices": [{"host": "10.0.0.60", "name": "PlayStation 5"}],
            "token_file": str(tmp_path / "playstation-token.json"),
            "profile_file": str(tmp_path / "playstation-profile.json"),
        },
    )
    kanal = FakeKanal()
    integration._ddp = kanal
    monkeypatch.setattr(integration, "_starte_loop", lambda entity_id: None)
    await integration.setup()
    return integration, kanal


async def test_die_kachel_traegt_die_felder_des_vertrags(hub, tmp_path, monkeypatch):
    integration, _ = await aufbau(hub, tmp_path, monkeypatch)
    entity = hub.registry.get("playstation.10_0_0_60")
    assert entity is not None and entity.kind == "media_player"
    assert entity.integration == "playstation"
    assert entity.label == "PlayStation 5"
    assert entity.state["has_screen"] is True and entity.state["apps"] == []
    assert entity.state["paired"] is False
    assert entity.state["konsole"] == "PS5"
    assert isinstance(entity.state["remote_play"], bool)
    assert entity.commands == COMMANDS
    assert entity.available is False
    await integration.teardown()


async def test_die_geraeteschleife_fuehrt_zustand_und_spiel_nach(hub, tmp_path, monkeypatch):
    integration, kanal = await aufbau(hub, tmp_path, monkeypatch)
    entity = hub.registry.get("playstation.10_0_0_60")

    # Solange die Bauart unbekannt ist, geht die Anfrage an beide Ports.
    kanal.antwort = ANTWORT_AN
    await integration._refresh(entity.id)
    assert kanal.gesendet[-1] == ("anfrage", "10.0.0.60", (9302, 987))
    assert entity.available is True
    assert entity.state["state"] == "on"
    assert entity.state["app"] == "Ratchet & Clank: Rift Apart"
    assert entity.state["title_id"] == "PPSA01503_00"
    assert entity.state["konsole"] == "PS5"
    # Die Kennung der Konsole bleibt hängen - sie braucht die Registrierung.
    assert integration._geraete[entity.id]["host_id"] == "0123456789ab"

    # Ab jetzt nur noch der Port der PS5.
    kanal.antwort = ANTWORT_RUHE
    await integration._refresh(entity.id)
    assert kanal.gesendet[-1] == ("anfrage", "10.0.0.60", (9302,))
    assert entity.available is True
    assert entity.state["state"] == "off" and entity.state["standby"] is True
    assert entity.state["app"] is None

    # Schweigt sie, ist sie nicht erreichbar - und nicht bloss aus.
    kanal.antwort = None
    await integration._refresh(entity.id)
    assert entity.available is False
    assert entity.state["state"] == "off" and entity.state["standby"] is False
    await integration.teardown()


async def test_wecken_braucht_konto_und_erreichbarkeit(hub, tmp_path, monkeypatch):
    integration, kanal = await aufbau(hub, tmp_path, monkeypatch)
    entity = hub.registry.get("playstation.10_0_0_60")

    with pytest.raises(ConnectionError) as ohne_netz:
        await integration.handle_command(entity, "turn_on", {})
    assert str(ohne_netz.value) == NICHT_ERREICHBAR

    kanal.antwort = ANTWORT_RUHE
    await integration._refresh(entity.id)
    with pytest.raises(ConnectionError) as ohne_konto:
        await integration.handle_command(entity, "turn_on", {})
    assert str(ohne_konto.value) == NICHT_GEKOPPELT
    assert not [s for s in kanal.gesendet if s[0] == "senden"]
    await integration.teardown()


async def test_wecken_geht_ohne_bibliothek_mit_der_konto_kennung(hub, tmp_path, monkeypatch):
    """Schritt 1 der Kopplung genügt zum Wecken - die zweite Bildschirm-App
    macht es genauso. Mit Registrierung zählt der RegistKey."""
    monkeypatch.setattr(playstation, "remote_play_verfuegbar", lambda: False)
    integration, kanal = await aufbau(hub, tmp_path, monkeypatch)
    entity = hub.registry.get("playstation.10_0_0_60")
    kanal.antwort = ANTWORT_RUHE
    await integration._refresh(entity.id)

    integration._konto = dict(KONTO)
    await integration.handle_command(entity, "toggle", {})
    pakete = [s for s in kanal.gesendet if s[0] == "senden"]
    assert pakete == [("senden", "10.0.0.60", 9302, ddp_wecken("deadbeef"))]

    integration._profile = PROFILE
    await integration.handle_command(entity, "turn_on", {})
    pakete = [s for s in kanal.gesendet if s[0] == "senden"]
    assert pakete[-1][3] == ddp_wecken(regist_key_zahl("3031323334353637"))
    await integration.teardown()


async def test_ohne_bibliothek_sagen_tasten_und_standby_was_fehlt(hub, tmp_path, monkeypatch):
    monkeypatch.setattr(playstation, "remote_play_verfuegbar", lambda: False)
    integration, kanal = await aufbau(hub, tmp_path, monkeypatch)
    entity = hub.registry.get("playstation.10_0_0_60")
    kanal.antwort = ANTWORT_AN
    await integration._refresh(entity.id)
    integration._konto = dict(KONTO)

    with pytest.raises(ConnectionError) as taste_:
        await integration.handle_command(entity, "ok", {})
    assert str(taste_.value) == BIBLIOTHEK_FEHLT
    with pytest.raises(ConnectionError) as aus:
        await integration.handle_command(entity, "turn_off", {})
    assert str(aus.value) == BIBLIOTHEK_FEHLT
    # Ein unbekanntes Kommando ist ein Fehler der Gegenseite, keine Absage.
    with pytest.raises(ValueError):
        await integration.handle_command(entity, "launch_app", {})
    await integration.teardown()


async def test_eine_ruhende_konsole_auszuschalten_gilt_als_erledigt(hub, tmp_path, monkeypatch):
    """Wie beim Fernseher: «Niemand mehr zuhause» darf nicht an einer
    Konsole hängen bleiben, die längst ruht."""
    monkeypatch.setattr(playstation, "remote_play_verfuegbar", lambda: False)
    integration, kanal = await aufbau(hub, tmp_path, monkeypatch)
    entity = hub.registry.get("playstation.10_0_0_60")
    kanal.antwort = ANTWORT_RUHE
    await integration._refresh(entity.id)
    await integration.handle_command(entity, "turn_off", {})
    # Und einschalten, wenn sie schon läuft, tut nichts.
    kanal.antwort = ANTWORT_AN
    await integration._refresh(entity.id)
    await integration.handle_command(entity, "turn_on", {})
    assert not [s for s in kanal.gesendet if s[0] == "senden"]
    await integration.teardown()


async def test_der_kopplungsstand_fuer_die_verbindungen_seite(hub, tmp_path, monkeypatch):
    monkeypatch.setattr(playstation, "remote_play_verfuegbar", lambda: True)
    integration, _ = await aufbau(hub, tmp_path, monkeypatch)
    entity_id = "playstation.10_0_0_60"
    assert integration.playstation_id(entity_id) == entity_id
    assert integration.playstation_id("demo.light_livingroom") is None
    assert integration.pair_stand(entity_id) == {
        "account": False,
        "paired": False,
        "online_id": None,
        "remote_play": True,
    }
    integration._konto = dict(KONTO)
    integration._profile = PROFILE
    stand = integration.pair_stand(entity_id)
    assert stand["account"] is True and stand["online_id"] == "stibe"
    # Registriert für irgendeine Konsole - die Kennung dieser hier kennt
    # der Hub noch nicht, also gilt das Konto als gekoppelt.
    assert stand["paired"] is True
    await integration.teardown()
