"""Ring – Türklingeln und Kameras über die (inoffizielle) Cloud-API.

Konfiguration:
  - integration: ring
    # token_file: /etc/homepilot/ring-token.json   # optional
    # scan_interval: 300

Voraussetzung:  pip install "homepilot[ring]"  bzw.  pip install ring-doorbell

Einrichtung (einmalig, Ring schickt einen 2FA-Code per Mail/SMS):
  1. Den Block oben in die config.yaml eintragen.
  2. Auf dem Hub-Rechner ausführen:
         python -m homepilot.integrations.ring -c config.yaml
     E-Mail, Passwort und den zugeschickten Code eingeben.
  3. Hub (neu) starten.

Das Passwort wird nirgends gespeichert – nur das dabei ausgestellte Token
(ring-token.json neben der homepilot-data.json, nur für den eigenen
Benutzer lesbar). Der Hub frischt es selbst auf und schreibt es zurück.

Klingeln und Bewegung kommen als Push über den Ereigniskanal der Ring-App
(Firebase); Gerätestatus und Akku werden zusätzlich alle scan_interval
Sekunden abgefragt. Die Kacheln benutzen dieselben Felder wie UniFi
Protect (state/motion/last_motion/last_ring) – die App kennt sie schon.

Kommt der Ereigniskanal nicht zustande, ist das die eine Störung, die man
nie bemerkt: Nichts stürzt ab, die Kacheln stehen da wie immer, es
klingelt bloss niemand mehr in der App. Deshalb zwei Dinge – der Hub
versucht es immer wieder statt einmal beim Start, und solange der Kanal
fehlt, fragt er die aktiven Meldungen alle paar Sekunden selbst ab. Wie
es gerade steht, sagt health() und damit der System-Bildschirm.
"""

from __future__ import annotations

import asyncio
import json
import os
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from ..core.entity import Entity, EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration

USER_AGENT = "HomePilot/1.0"

# Ersatzweg: Ring führt eine Liste der gerade laufenden Meldungen – die
# gleiche, aus der auch die Ring-App ihre Nachricht baut.
#
# Zehn Sekunden, solange der Push-Kanal fehlt: Für eine Türklingel ist das
# die Grenze des Erträglichen, wer davorsteht wartet nicht länger.
DING_POLL_SECONDS = 10
# Dreissig Sekunden, während er steht. Nicht aus Misstrauen gegen den
# Push-Kanal an sich, sondern gegen das, was er im Fehlerfall meldet: Er
# gilt als «gestartet», bis ihn jemand stoppt. Reisst die Verbindung
# darunter weg, sieht von aussen alles gut aus und es kommt bloss nichts
# mehr an. Diese Abfrage ist das Netz darunter; doppelt gemeldete
# Ereignisse fallen ohnehin heraus.
DING_POLL_BACKUP_SECONDS = 30

# Abstände zwischen den Anläufen für den Ereigniskanal. Erst rasch,
# danach ruhiger: Wenn Ring den Dienst verweigert, hilft es niemandem,
# alle dreissig Sekunden anzuklopfen.
RETRY_SECONDS = [30, 60, 300, 900, 1800]


def retry_delay(attempt: int) -> float:
    """Wartezeit vor dem nächsten Anlauf (rein, testbar)."""
    if attempt < 1:
        return RETRY_SECONDS[0]
    return RETRY_SECONDS[min(attempt, len(RETRY_SECONDS)) - 1]


def alert_key(event: Any) -> tuple[int, int, str]:
    """Kennung einer Meldung – dieselbe Klingel zweimal ist einmal."""
    return (int(event.doorbot_id), int(event.id), str(event.kind))


def new_alerts(
    alerts: list[Any], seen: dict[tuple[int, int, str], float], now: float
) -> tuple[list[Any], dict[tuple[int, int, str], float]]:
    """Welche Meldungen neu sind, und was man sich merken muss (rein, testbar).

    Eine Meldung bleibt bei Ring ein paar Minuten «aktiv». Ohne Gedächtnis
    käme dieselbe Klingel bei jeder Abfrage erneut - alle zehn Sekunden
    eine Nachricht, bis sie abläuft. Gemerkt wird bis zum Ablauf und
    keinen Moment länger, sonst wächst die Liste mit jedem Besucher.
    """
    frisch = []
    behalten = {key: bis for key, bis in seen.items() if bis > now}
    for event in alerts:
        try:
            key = alert_key(event)
        except (TypeError, ValueError, AttributeError):
            continue
        if key in behalten:
            continue
        begonnen = float(getattr(event, "now", None) or now)
        dauer = float(getattr(event, "expires_in", None) or 60)
        behalten[key] = begonnen + dauer
        frisch.append(event)
    return frisch, behalten


# Ein Kanal, der sich beim Verbinden gleich wieder verabschiedet, hat fast
# immer eine kaputt gespeicherte Push-Anmeldung. Wer länger als das durch-
# hält, hatte ein anderes Problem - und dessen Anmeldung wegzuwerfen wäre
# nur eine unnötige Neuregistrierung bei Ring.
QUICK_DEATH_SECONDS = 60


def channel_alive(listener: Any) -> bool:
    """Steht der Ereigniskanal wirklich noch? (rein, testbar)

    «started» am Zuhörer heisst bloss, dass ihn niemand gestoppt hat. Der
    Push-Client darunter schaltet sich bei einem Fehler selbst ab - genau
    das passiert bei einer beschädigten Anmeldung, eine Sekunde nach dem
    «erfolgreich angemeldet». Von aussen sah dann alles gut aus, und es
    klingelte bloss nie.

    Fehlt der Einblick (ältere Fassung der Bibliothek), gilt der Kanal als
    in Ordnung: Lieber einen toten Kanal übersehen als einen gesunden
    ständig neu aufbauen - die Abfrage fängt den Fall ohnehin auf.
    """
    if not getattr(listener, "started", False):
        return False
    receiver = getattr(listener, "_receiver", None)
    pruefen = getattr(receiver, "is_started", None)
    if not callable(pruefen):
        return True
    try:
        return bool(pruefen())
    except Exception:
        return True


def health_detail(events_ok: bool, error: str | None) -> str:
    """Was im System-Bildschirm über den Ereigniskanal steht (rein, testbar)."""
    if events_ok:
        return "Ereigniskanal verbunden – Klingeln kommt sofort an"
    grund = f" ({error})" if error else ""
    return (
        f"Ereigniskanal nicht verbunden{grund} – Klingeln wird ersatzweise "
        f"alle {DING_POLL_SECONDS} s abgefragt"
    )


def device_state(
    battery: Any, connection: str | None, *, klingel: bool = False
) -> dict[str, Any]:
    """Übersetzt Gerätedaten in Entitäts-Attribute (rein, testbar).

    `klingel` setzt das Feld «ring» von Anfang an auf «off». Das ist kein
    Schönheitsfehler: Ohne den Eintrag gibt es das Feld erst, nachdem es
    zum ersten Mal geklingelt hat - und bis dahin lässt sich kein Ablauf
    darauf bauen, weil weder der Editor noch die Vorlagen es sehen. Wer
    eine Nachricht beim Klingeln einrichten will, müsste also warten, bis
    jemand klingelt.
    """
    state: dict[str, Any] = {
        "state": "offline" if connection == "offline" else "online",
        "motion": "off",
    }
    if klingel:
        state["ring"] = "off"
    if battery is not None:
        try:
            state["battery"] = int(battery)
        except (TypeError, ValueError):
            pass
    return state


def event_fields(kind: str, now: float) -> dict[str, Any]:
    """Übersetzt ein Push-Ereignis in Zustandsfelder (rein, testbar).

    Ring meldet 'ding' (geklingelt) und 'motion' (Bewegung erkannt).
    """
    stamp = datetime.fromtimestamp(now, tz=timezone.utc).isoformat()
    if kind == "ding":
        return {"last_ring": stamp, "ring": "on"}
    if kind == "motion":
        return {"last_motion": stamp, "motion": "on"}
    return {}


class RingIntegration(Integration):
    name = "ring"

    # Als Klassenvorgaben, damit health() auch dann antwortet, wenn das
    # Setup unterwegs steckengeblieben ist.
    _events_ok = False
    _last_event: float | None = None
    _listen_error: str | None = None
    _listener: Any = None

    async def setup(self) -> None:
        try:
            import ring_doorbell  # noqa: F401 – nur Verfügbarkeit prüfen
        except ImportError as err:
            raise ConfigError(
                "ring-doorbell fehlt – installieren mit: pip install ring-doorbell"
            ) from err

        self._token_file = Path(
            self.config.get("token_file")
            or Path(self.hub.config.data_file).parent / "ring-token.json"
        )
        if not self._token_file.is_file():
            raise ConfigError(
                f"{self._token_file} fehlt – einmalig anmelden mit: "
                "python -m homepilot.integrations.ring -c config.yaml"
            )
        self._stored = json.loads(self._token_file.read_text())

        from ring_doorbell import Auth, Ring

        self._auth = Auth(
            USER_AGENT,
            token=self._stored.get("token"),
            token_updater=lambda token: self._save("token", token),
            http_client_session=self.http_session(),
        )
        self._ring = Ring(self._auth)
        await self._ring.async_create_session()
        await self._ring.async_update_devices()

        # Entity-ID → Ring-Geräteobjekt; Ring-Geräte-ID → Entity-ID
        self._devices: dict[str, Any] = {}
        self._by_ring_id: dict[int, str] = {}
        self._clear_tasks: dict[str, asyncio.Task] = {}

        devices = self._ring.devices()
        klingeln = {int(device.id) for device in devices.doorbells}
        for device in list(devices.doorbells) + list(devices.stickup_cams):
            entity = await self.add_entity(
                str(device.id),
                EntityKind.CAMERA,
                device.name,
                state=device_state(
                    device.battery_life,
                    device.connection_status,
                    klingel=int(device.id) in klingeln,
                ),
                commands=[],
            )
            self._devices[entity.id] = device
            self._by_ring_id[int(device.id)] = entity.id

        # Ring Intercom: Gegensprechanlage mit Türöffner. Eigene Geräteart
        # 'lock' – für Gäste ohne explizite Freigabe unsichtbar.
        for device in list(getattr(devices, "other", []) or []):
            if not hasattr(device, "async_open_door"):
                continue
            entity = await self.add_entity(
                str(device.id),
                EntityKind.LOCK,
                device.name or "Türöffner",
                # Eine Gegensprechanlage klingelt ebenfalls - und zwar an
                # genau der Türe, an der man es wissen will.
                state=device_state(
                    device.battery_life, device.connection_status, klingel=True
                ),
                commands=["open_door"],
            )
            self._devices[entity.id] = device
            self._by_ring_id[int(device.id)] = entity.id

        if not self._devices:
            self.log.warning("Ring-Konto verbunden, aber keine Geräte gefunden")

        self._seen_alerts: dict[tuple[int, int, str], float] = {}
        self._listener: Any = None
        self.start_task(self._poll_loop())
        self.start_task(self._listen_loop())
        self.start_task(self._ding_loop())

    def health(self) -> dict[str, Any]:
        """Steht der schnelle Weg? Das ist hier die ganze Frage.

        Ohne diese Auskunft ist ein toter Ereigniskanal von aussen nicht
        von «es hat halt niemand geklingelt» zu unterscheiden.
        """
        return {
            "ok": self._events_ok,
            "detail": health_detail(self._events_ok, self._listen_error),
            "last_event": self._last_event,
        }

    async def teardown(self) -> None:
        await self._stop_listener()
        self._events_ok = False
        await super().teardown()

    def _save(self, key: str, value: dict[str, Any]) -> None:
        """Aufgefrischte Tokens sofort sichern, sonst sperrt Ring den Zugang aus."""
        self._stored[key] = value
        tmp = self._token_file.with_suffix(".tmp")
        tmp.write_text(json.dumps(self._stored))
        os.chmod(tmp, 0o600)
        tmp.replace(self._token_file)

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _poll_loop(self) -> None:
        interval = int(self.config.get("scan_interval", 300))
        while True:
            await asyncio.sleep(interval)
            try:
                await self._ring.async_update_devices()
                devices = self._ring.devices()
                for entity_id, old in list(self._devices.items()):
                    device = devices.get_device(int(old.id))
                    self._devices[entity_id] = device
                    await self.hub.registry.update_state(
                        entity_id,
                        device_state(device.battery_life, device.connection_status),
                        available=True,
                    )
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.warning("Ring-Abfrage fehlgeschlagen: %s", err)

    async def _listen_loop(self) -> None:
        """Den Ereigniskanal offenhalten – nicht nur einmal anklopfen.

        Vorher gab es genau einen Anlauf beim Start. Fiel der aus - Ring
        gerade schlecht gelaunt, das Netz noch nicht da -, blieb die
        Klingel für immer stumm, und im Log stand eine Zeile, die man
        Wochen später sucht. Jetzt versucht es der Hub weiter und merkt
        auch, wenn der Kanal später abreisst.
        """
        loop = asyncio.get_running_loop()

        def on_event(event: Any) -> None:
            asyncio.run_coroutine_threadsafe(self._handle_event(event), loop)

        versuch = 0
        while True:
            if await self._start_listener(on_event):
                versuch = 0
                verbunden_seit = time.time()
                # Steht er, gibt es nichts zu tun ausser hinzusehen - aber
                # genau hinsehen: eine Viertelminute, nicht eine ganze.
                while channel_alive(self._listener):
                    await asyncio.sleep(15)
                self._events_ok = False
                stand = time.time() - verbunden_seit
                await self._stop_listener()
                if stand < QUICK_DEATH_SECONDS and self._stored.get("listener"):
                    # Sofort wieder weg: Das ist die Handschrift einer
                    # beschädigten Push-Anmeldung («Incorrect padding» aus
                    # firebase_messaging). Sie wegzuwerfen ist der einzige
                    # Weg - mit ihr geht es beim nächsten Mal genauso aus.
                    self._listen_error = "Push-Anmeldung beschädigt"
                    self.log.warning(
                        "Ring-Ereigniskanal brach nach %.0f s wieder ab – die "
                        "gespeicherte Push-Anmeldung wird verworfen und neu "
                        "registriert",
                        stand,
                    )
                    self._stored.pop("listener", None)
                    self._save("listener", None)
                else:
                    self._listen_error = "Verbindung abgerissen"
                    self.log.warning("Ring-Ereigniskanal abgerissen – neuer Anlauf")
                continue
            versuch += 1
            wartezeit = retry_delay(versuch)
            # Einmal laut, danach leise: Eine Störung, die eine Stunde
            # dauert, soll das Log nicht füllen. Sichtbar bleibt sie über
            # health() im System-Bildschirm.
            melden = self.log.warning if versuch == 1 else self.log.debug
            melden(
                "Ring-Ereigniskanal nicht verfügbar (%s) – Klingeln kommt "
                "ersatzweise über die Abfrage alle %ss, nächster Anlauf in %ss",
                self._listen_error or "Grund unbekannt",
                DING_POLL_SECONDS,
                int(wartezeit),
            )
            await asyncio.sleep(wartezeit)

    async def _start_listener(self, on_event: Any) -> bool:
        """Ein Anlauf, notfalls mit frischer Credential; True bei Erfolg."""
        # Erster Versuch mit der gespeicherten Credential. Ist sie beschädigt
        # (z.B. 'Incorrect padding' aus firebase_messaging beim Dekodieren
        # eines alten Eintrags), verwerfen und einmal frisch registrieren.
        if await self._try_listen(on_event, self._stored.get("listener")):
            return True
        if self._stored.get("listener") is not None:
            self.log.warning(
                "Ring-Push-Credential unbrauchbar – wird verworfen und neu registriert"
            )
            self._stored.pop("listener", None)
            self._save("listener", None)
            if await self._try_listen(on_event, None):
                return True
        return False

    async def _stop_listener(self) -> None:
        listener, self._listener = self._listener, None
        if listener is None:
            return
        try:
            await listener.stop()
        except Exception:
            pass

    async def _try_listen(self, on_event: Any, credentials: Any) -> bool:
        """Ereigniskanal mit gegebener Credential starten; True bei Erfolg."""
        listener = None
        try:
            from ring_doorbell import RingEventListener

            listener = RingEventListener(
                self._ring,
                credentials=credentials,
                credentials_updated_callback=lambda creds: self._save("listener", creds),
            )
            if not await listener.start():
                # start() meldet False, wenn Ring die Anmeldung abweist -
                # der Grund steht dann im Log von ring_doorbell selbst.
                self._listen_error = "Anmeldung beim Push-Dienst abgelehnt"
                return False
            listener.add_notification_callback(on_event)
            self._listener = listener
            self._events_ok = True
            self._listen_error = None
            self.log.info("Ring-Ereigniskanal verbunden")
            return True
        except asyncio.CancelledError:
            raise
        except Exception as err:
            self._listen_error = f"{err.__class__.__name__}: {err}" if str(err) else err.__class__.__name__
            if listener is not None:
                try:
                    await listener.stop()
                except Exception:
                    pass
            return False

    async def _ding_loop(self) -> None:
        """Aktive Meldungen selbst abfragen – der zweite Weg zur Klingel.

        Er kostet einen Aufruf und macht den Unterschied zwischen «die
        Klingel geht nicht» und «die Klingel geht ein paar Sekunden
        später». Was der Push-Kanal schon gebracht hat, erkennt
        new_alerts wieder; es wird kein zweites Mal gemeldet.
        """
        while True:
            await asyncio.sleep(
                DING_POLL_BACKUP_SECONDS if self._events_ok else DING_POLL_SECONDS
            )
            if not self._devices:
                continue
            try:
                await self._ring.async_update_dings()
                frisch, self._seen_alerts = new_alerts(
                    list(self._ring.active_alerts()), self._seen_alerts, time.time()
                )
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.debug("Ring-Meldungen nicht abrufbar: %s", err)
                continue
            for event in frisch:
                await self._handle_event(event)

    async def _handle_event(self, event: Any) -> None:
        try:
            entity_id = self._by_ring_id.get(int(event.doorbot_id))
        except (TypeError, ValueError):
            return
        if entity_id is None:
            return
        fields = event_fields(event.kind, event.now or time.time())
        if not fields:
            return
        # Auch was über den Push-Kanal kam, vormerken: Sonst holt die
        # Abfrage dieselbe Meldung gleich noch einmal aus der Liste.
        try:
            self._seen_alerts[alert_key(event)] = float(
                getattr(event, "now", None) or time.time()
            ) + float(getattr(event, "expires_in", None) or 60)
        except (TypeError, ValueError, AttributeError):
            pass
        self._last_event = time.time()
        await self.hub.registry.update_state(entity_id, fields, available=True)

        # 'Bewegung'/'Klingelt' nach Ablauf wieder löschen, damit die Kachel
        # nicht dauerhaft leuchtet.
        flag = "motion" if event.kind == "motion" else "ring"
        old = self._clear_tasks.pop(f"{entity_id}:{flag}", None)
        if old:
            old.cancel()
        delay = min(float(event.expires_in or 60), 300)
        self._clear_tasks[f"{entity_id}:{flag}"] = self.start_task(
            self._clear_flag(entity_id, flag, delay)
        )

    async def _clear_flag(self, entity_id: str, flag: str, delay: float) -> None:
        await asyncio.sleep(delay)
        await self.hub.registry.update_state(entity_id, {flag: "off"})

    # ── Hub → Gerät ────────────────────────────────────────────────────────

    async def handle_command(self, entity: Any, command: str, data: dict[str, Any]) -> None:
        device = self._devices.get(entity.id)
        if device is None or command != "open_door":
            raise ConfigError(f"Kommando '{command}' gibt es hier nicht")
        ok = await device.async_open_door()
        if not ok:
            raise ConnectionError("Ring hat das Öffnen abgelehnt")
        self.log.info("Tür geöffnet über %s", entity.name)
        # Kurze Rückmeldung auf der Kachel, dann zurück zum Ruhezustand.
        await self.hub.registry.update_state(
            entity.id,
            {"state": "opened", "last_opened": datetime.now(timezone.utc).isoformat()},
        )
        old = self._clear_tasks.pop(f"{entity.id}:opened", None)
        if old:
            old.cancel()
        self._clear_tasks[f"{entity.id}:opened"] = self.start_task(
            self._close_again(entity.id)
        )

    async def _close_again(self, entity_id: str) -> None:
        await asyncio.sleep(5)
        await self.hub.registry.update_state(entity_id, {"state": "online"})

    async def snapshot(self, entity: Any) -> bytes | None:
        device = self._devices.get(entity.id)
        if device is None:
            return None
        try:
            # Stösst bei Ring einen frischen Schnappschuss an – das dauert
            # ein paar Sekunden, dafür ist das Bild aktuell.
            return await device.async_get_snapshot()
        except Exception as err:
            self.log.debug("Ring-Schnappschuss fehlgeschlagen: %s", err)
            return None


INTEGRATION = RingIntegration


# ── Anmelde-Helfer ─────────────────────────────────────────────────────────
# Aufruf:  python -m homepilot.integrations.ring -c config.yaml
# Fragt E-Mail, Passwort und den 2FA-Code ab und legt das Token dorthin,
# wo der Hub es liest. Das Passwort wird nicht gespeichert.


async def _login_main(config_path: str) -> int:
    import getpass

    from ring_doorbell import Auth, Requires2FAError

    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "ring"]
    token_file = Path(
        (blocks[0].get("token_file") if blocks else None)
        or Path(config.data_file).parent / "ring-token.json"
    )

    username = input("Ring-E-Mail: ").strip()
    password = getpass.getpass("Ring-Passwort: ")

    auth = Auth(USER_AGENT)
    try:
        try:
            token = await auth.async_fetch_token(username, password)
        except Requires2FAError:
            code = input("2FA-Code (per Mail/SMS zugestellt): ").strip()
            token = await auth.async_fetch_token(username, password, code)
    except Exception as err:
        print(f"✗ Anmeldung fehlgeschlagen: {err}")
        return 1
    finally:
        await auth.async_close()

    token_file.parent.mkdir(parents=True, exist_ok=True)
    token_file.write_text(json.dumps({"token": token}))
    os.chmod(token_file, 0o600)
    print(f"✓ Angemeldet. Token liegt in {token_file} – jetzt den Hub starten.")
    return 0


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Ring-Anmeldung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    args = parser.parse_args()
    sys.exit(asyncio.run(_login_main(args.config)))
