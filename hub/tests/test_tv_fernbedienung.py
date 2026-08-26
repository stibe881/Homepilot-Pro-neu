"""Eine Taste, die nicht ankommt, muss sagen warum.

Der Fall aus dem Haus: «Die Fernbedienung reagiert nicht.» Sie reagierte
sehr wohl – die App schickte jede Taste, der Hub lehnte jede ab, und die
Absage war entweder Englisch aus der Bibliothek («Called send_key_command
after disconnect») oder wurde von der Fernbedienung selbst verdeckt.

Hier steht die Hub-Hälfte: dass eine Absage kommt, und dass sie den
nächsten Schritt nennt. Dass man sie auch sieht, ist Sache der App.
"""

import pytest

from homepilot.core.entity import Entity, EntityKind
from homepilot.integrations.androidtv import (
    NICHT_ERREICHBAR,
    NICHT_GEKOPPELT,
    SLEEP_MINUTES,
    AndroidTvIntegration,
    absage,
)


class ConnectionClosed(Exception):
    pass


class StummeFernbedienung:
    """Eine, deren Verbindung weg ist – wie nach einem Stromausfall.

    ``send_key_command`` blockiert nicht: Es legt die Taste in den Puffer.
    Ist die Verbindung weg, wirft es. Der Hub erkennt das am Namen der
    Ausnahme, nicht an ihrer Herkunft – die Bibliothek wird erst beim
    Verbinden importiert, damit der Hub auch ohne sie startet. Deshalb
    genügt hier eine gleichnamige eigene.
    """

    is_on = True

    def __init__(self) -> None:
        self.gesendet: list[str] = []

    def send_key_command(self, key: str) -> None:
        raise ConnectionClosed("Called send_key_command after disconnect")


class OffeneFernbedienung:
    is_on = True

    def __init__(self) -> None:
        self.gesendet: list[str] = []

    def send_key_command(self, key: str) -> None:
        self.gesendet.append(key)


async def _aufbau(hub) -> tuple[AndroidTvIntegration, Entity]:
    """Integration ohne echtes Gerät – wie in test_tv_timer.py."""
    integration = AndroidTvIntegration(hub, {})
    integration._remotes = {}
    integration._gekoppelt = {}
    integration._sleep = {}
    integration._timer_of = {}
    integration._tv_of = {}
    tv = await integration.add_entity(
        "10_0_0_5",
        EntityKind.MEDIA_PLAYER,
        "Fernseher Wohnzimmer",
        state={"state": "on", "sleep_until": None, "sleep_minutes": SLEEP_MINUTES},
        commands=["dpad_up", "ok", "toggle"],
    )
    return integration, tv


# ── Der Satz für sich ──────────────────────────────────────────────────


def test_die_absage_nennt_den_naechsten_schritt():
    """Zwei Fälle, zwei ganz verschiedene nächste Schritte."""
    # Gekoppelt, aber gerade nicht da: Strom und Netz prüfen.
    assert absage(True) == NICHT_ERREICHBAR
    assert "Netz" in absage(True)
    # Nie gekoppelt: Da muss jemand vor den Fernseher.
    assert absage(False) == NICHT_GEKOPPELT
    assert "gekoppelt" in absage(False)
    # Und beides ist Deutsch – es steht in der Fernbedienung.
    assert "disconnect" not in absage(True).lower()


# ── Der ganze Weg ──────────────────────────────────────────────────────


async def test_ohne_verbindung_kommt_eine_absage_und_kein_schweigen(hub):
    """Der eigentliche Fehler: Die Fernbedienung stand in `_remotes`,
    bevor sie verbunden war – die Prüfung darunter lief ins Leere."""
    integration, tv = await _aufbau(hub)
    # Nie verbunden, also gar nicht erst eingetragen.
    with pytest.raises(ConnectionError) as absage_:
        await integration.handle_command(tv, "dpad_up", {})
    assert str(absage_.value) == NICHT_ERREICHBAR


async def test_ein_nie_gekoppelter_fernseher_schickt_zum_geraet(hub):
    integration, tv = await _aufbau(hub)
    integration._gekoppelt[tv.id] = False
    with pytest.raises(ConnectionError) as absage_:
        await integration.handle_command(tv, "ok", {})
    assert str(absage_.value) == NICHT_GEKOPPELT


async def test_eine_abgerissene_verbindung_wird_uebersetzt(hub):
    """Die Bibliothek sagt es auf Englisch – das steht sonst in der App."""
    integration, tv = await _aufbau(hub)
    integration._remotes[tv.id] = StummeFernbedienung()
    integration._gekoppelt[tv.id] = True
    with pytest.raises(ConnectionError) as absage_:
        await integration.handle_command(tv, "dpad_up", {})
    assert str(absage_.value) == NICHT_ERREICHBAR


async def test_eine_stehende_verbindung_schickt_die_taste(hub):
    """Die Gegenprobe: Es soll ja weiterhin etwas ankommen."""
    integration, tv = await _aufbau(hub)
    remote = OffeneFernbedienung()
    integration._remotes[tv.id] = remote
    integration._gekoppelt[tv.id] = True
    await integration.handle_command(tv, "dpad_up", {})
    await integration.handle_command(tv, "ok", {})
    assert remote.gesendet == ["KEYCODE_DPAD_UP", "KEYCODE_DPAD_CENTER"]


async def test_auch_die_timer_kachel_sagt_warum(hub):
    """Sie hatte dieselbe englische Absage – derselbe Satz gehört hin."""
    integration, tv = await _aufbau(hub)
    timer = await integration.add_entity(
        "10_0_0_5_timer",
        EntityKind.TIMER,
        "Fernseher Wohnzimmer Timer",
        state={"state": "off", "sleep_until": None, "sleep_minutes": SLEEP_MINUTES},
        commands=["sleep_timer"],
    )
    integration._timer_of[tv.id] = timer.id
    integration._tv_of[timer.id] = tv.id
    with pytest.raises(ConnectionError) as absage_:
        await integration.handle_command(timer, "sleep_timer", {"minutes": 30})
    assert str(absage_.value) == NICHT_ERREICHBAR
