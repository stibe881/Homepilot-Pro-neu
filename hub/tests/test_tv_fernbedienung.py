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
    leitung_offen,
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


# ── Ausschalten, was schon aus ist ─────────────────────────────────────


async def test_ein_nicht_erreichbarer_fernseher_gilt_als_ausgeschaltet(hub):
    """«Niemand mehr zuhause» schaltet zwei Fernseher und ein Dutzend
    Boxen ab und schliesst zuletzt die Türe. Ein Gerät, das ohnehin schon
    vom Netz war, brachte den ganzen Ablauf zum Stehen."""
    integration, tv = await _aufbau(hub)
    integration._gekoppelt[tv.id] = True
    # Keine Fernbedienung im Fach: Der Fernseher ist nicht erreichbar.
    await integration.handle_command(tv, "turn_off", {})
    await integration.handle_command(tv, "pause", {})


async def test_einschalten_sagt_weiterhin_dass_niemand_da_ist(hub):
    """Die umgekehrte Richtung: Wer einschalten will, muss erfahren, dass
    es nicht ging - sonst sucht er den Fehler beim Fernseher."""
    integration, tv = await _aufbau(hub)
    integration._gekoppelt[tv.id] = True
    with pytest.raises(ConnectionError, match="Netz"):
        await integration.handle_command(tv, "turn_on", {})


async def test_eine_fehlende_kopplung_schweigt_auch_beim_ausschalten_nicht(hub):
    """Sie ist ein Einrichtungsfehler, den man sehen muss - da hilft kein
    Schweigen."""
    integration, tv = await _aufbau(hub)
    integration._gekoppelt[tv.id] = False
    with pytest.raises(ConnectionError, match="gekoppelt"):
        await integration.handle_command(tv, "turn_off", {})


# ── Die stille Falle in der Bibliothek ─────────────────────────────────
#
# `send_key_command` wirft `ConnectionClosed` nur, wenn das
# Protokollobjekt ganz fehlt. Ist bloss die Verbindung darunter im
# Zumachen, verschluckt `_send_message` die Taste - kein Fehler, keine
# Wirkung. Der Hub meldete «erledigt», die App «ging an den Hub», und der
# Fernseher tat nichts.


class Leitung:
    """Ein Transport, wie asyncio ihn hat - offen oder im Zumachen."""

    def __init__(self, zu: bool) -> None:
        self._zu = zu

    def is_closing(self) -> bool:
        return self._zu


class Protokoll:
    def __init__(self, transport: object | None) -> None:
        self.transport = transport


class Verbunden:
    """Eine Fernbedienung, die aussieht wie die echte."""

    is_on = True

    def __init__(self, protokoll: object | None) -> None:
        self._remote_message_protocol = protokoll
        self.gesendet: list[str] = []

    def send_key_command(self, key: str) -> None:
        self.gesendet.append(key)


def test_eine_offene_leitung_erkennt_er():
    assert leitung_offen(Verbunden(Protokoll(Leitung(zu=False)))) is True


def test_eine_zumachende_leitung_auch():
    assert leitung_offen(Verbunden(Protokoll(Leitung(zu=True)))) is False
    assert leitung_offen(Verbunden(Protokoll(None))) is False
    assert leitung_offen(Verbunden(None)) is False


def test_was_er_nicht_versteht_gilt_als_unbekannt():
    """Lieber gelegentlich blind als plötzlich stumm.

    Die zwei Felder sind privat. Benennt die Bibliothek sie um, darf das
    nicht dazu führen, dass keine Taste mehr durchgeht - dann gilt
    «weiss nicht», und gesendet wird wie zuvor.
    """

    class Fremd:
        pass

    assert leitung_offen(Fremd()) is None

    class OhneTransport:
        _remote_message_protocol = object()

    assert leitung_offen(OhneTransport()) is None


async def test_in_eine_zumachende_leitung_wird_gar_nicht_erst_gesendet(hub):
    """Sonst verschwindet die Taste, und der Hub meldet «erledigt»."""
    integration, tv = await _aufbau(hub)
    remote = Verbunden(Protokoll(Leitung(zu=True)))
    integration._remotes[tv.id] = remote
    integration._gekoppelt[tv.id] = True
    with pytest.raises(ConnectionError) as absage_:
        await integration.handle_command(tv, "dpad_up", {})
    assert str(absage_.value) == NICHT_ERREICHBAR
    assert remote.gesendet == []


async def test_bei_offener_leitung_geht_sie_raus(hub):
    integration, tv = await _aufbau(hub)
    remote = Verbunden(Protokoll(Leitung(zu=False)))
    integration._remotes[tv.id] = remote
    integration._gekoppelt[tv.id] = True
    await integration.handle_command(tv, "dpad_up", {})
    assert remote.gesendet == ["KEYCODE_DPAD_UP"]
