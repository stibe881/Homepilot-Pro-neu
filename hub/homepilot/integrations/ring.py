"""Ring – Türklingeln und Kameras über die (inoffizielle) Cloud-API.

Konfiguration:
  - integration: ring
    # token_file: /etc/homepilot/ring-token.json   # optional
    # scan_interval: 300
    # events: false   # Ereigniskanal (läuft über Googles Push-Dienst)
    #                 # gar nicht erst versuchen - siehe unten

Voraussetzung:  pip install "homepilot[ring]"  bzw.  pip install ring-doorbell

Einrichtung (einmalig, Ring schickt einen 2FA-Code per Mail/SMS):
  1. Den Block oben in die config.yaml eintragen.
  2. Im Hub ausführen (im Container, dort liegt ring-doorbell):
         docker exec -it homepilot-hub \
             python -m homepilot.integrations.ring -c /config/config.yaml
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

Der Ereigniskanal läuft technisch über Googles Push-Dienst (FCM) - das
ist Rings Wahl, nicht unsere. Wer Google im Heimnetz bewusst aussperrt,
setzt ``events: false``: Dann übernimmt die 10-Sekunden-Abfrage von
vornherein, ohne Warnung im System-Bildschirm und ohne vergebliche
Anläufe alle halbe Stunde.

Klemmt er, sagt das der System-Bildschirm - und seit push_diagnose()
auch, *woran*: Der Hub prüft dann die drei Google-Adressen (siehe
PUSH_ENDPOINTS) und schreibt mit, was die Push-Bibliothek unterwegs
meldet. Aus «RuntimeError: Unable to establish subscription with Google
Cloud Messaging» wird so entweder «mtalk.google.com:5228 nicht
erreichbar - Firewall?» oder «Google lehnt die Anmeldung ab
(PHONE_REGISTRATION_ERROR)». Von Hand nachsehen:

    docker exec homepilot-hub \
        python -m homepilot.integrations.ring -c /config/config.yaml --diagnose

Im Container, nicht auf dem Host: Dort gelten andere Netzregeln, und wer
auf dem Host misst, misst das falsche Netz.
"""

from __future__ import annotations

import asyncio
import time
from datetime import UTC, datetime
from typing import Any

from ..core import tokenstore
from ..core.entity import EntityKind
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


# Die drei Adressen, über die Rings Ereigniskanal läuft. Sie gehören
# Google, nicht Ring – wer sie im Netz sperrt (Gäste-VLAN, Pi-hole,
# Firewall-Regel «kein Google»), sperrt damit die Türklingel aus, ohne
# dass irgendwo «Türklingel» steht. Genau darum stehen sie hier
# namentlich: Die Meldung soll sagen, welche fehlt.
PUSH_ENDPOINTS: list[tuple[str, int, str]] = [
    ("android.clients.google.com", 443, "Anmeldung (GCM-Checkin)"),
    ("fcm.googleapis.com", 443, "Registrierung (FCM)"),
    ("mtalk.google.com", 5228, "Dauerverbindung (MCS)"),
]

# So lange darf ein Erreichbarkeitstest dauern. Kurz: Es geht nicht um
# eine Messung, sondern um «kommt überhaupt etwas durch».
REACH_TIMEOUT = 4.0


def push_diagnose(erreichbar: dict[str, bool], meldungen: list[str]) -> str:
    """Aus Erreichbarkeit und Bibliotheks-Log einen brauchbaren Satz machen.

    (rein, testbar)

    «RuntimeError: Unable to establish subscription with Google Cloud
    Messaging» ist wahr und hilft niemandem: Der Satz nennt weder, was
    fehlgeschlagen ist, noch was man dagegen tun könnte. Der eigentliche
    Grund steht im Log von firebase_messaging – oder er steht nirgends,
    weil schon die Verbindung nicht zustande kam.

    Die Reihenfolge ist Absicht: Erst das, was man selbst ändern kann
    (ein gesperrter Weg im eigenen Netz), dann das, was man aussitzen
    muss (Google lehnt ab).
    """
    fehlend = [
        f"{host}:{port}"
        for host, port, _zweck in PUSH_ENDPOINTS
        if erreichbar.get(host) is False
    ]
    if fehlend:
        return (
            ", ".join(fehlend)
            + " ist vom Hub aus gesperrt – Firewall, Pi-hole oder VLAN?"
        )
    text = " ".join(meldungen)
    if "PHONE_REGISTRATION_ERROR" in text:
        return (
            "Google lehnt die Anmeldung ab (PHONE_REGISTRATION_ERROR) – "
            "das ist Googles Seite, der Hub versucht es weiter"
        )
    if "AUTHENTICATION_FAILED" in text or "401" in text:
        return "Google weist die Anmeldung zurück (Authentifizierung)"
    if "TOO_MANY_REGISTRATIONS" in text or "429" in text:
        return "zu viele Anmeldungen in kurzer Zeit – später wieder"
    for zeile in reversed(meldungen):
        sauber = zeile.strip()
        if sauber:
            return sauber
    return "Grund unbekannt – alle Google-Adressen sind erreichbar"


def health_detail(events_ok: bool, error: str | None, abgeschaltet: bool = False) -> str:
    """Was im System-Bildschirm über den Ereigniskanal steht (rein, testbar)."""
    if abgeschaltet:
        # Bewusste Entscheidung, keine Störung - deshalb ohne Warnton.
        return (
            f"Ereigniskanal abgeschaltet (events: false) – Klingeln wird "
            f"alle {DING_POLL_SECONDS} s abgefragt"
        )
    if events_ok:
        return "Ereigniskanal verbunden – Klingeln kommt sofort an"
    # Der Grund als eigener Satz, nicht in Klammern: Er enthält oft
    # selbst welche, und «(RuntimeError: … (MCS))» liest niemand.
    grund = ""
    if error:
        # Kein zweiter Punkt hinter einem Fragezeichen.
        schluss = "" if error.rstrip().endswith((".", "!", "?")) else "."
        grund = f"{error.rstrip()}{schluss} "
    return (
        f"Ereigniskanal nicht verbunden. {grund}Klingeln wird ersatzweise "
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
    stamp = datetime.fromtimestamp(now, tz=UTC).isoformat()
    if kind == "ding":
        return {"last_ring": stamp, "ring": "on"}
    if kind == "motion":
        return {"last_motion": stamp, "motion": "on"}
    return {}


class _LogMitschnitt:
    """Fängt für die Dauer eines Anlaufs mit, was eine fremde Bibliothek meldet.

    Die Push-Bibliothek protokolliert den echten Grund – «GCM register
    request attempt 2 out of 2 has failed with Error=PHONE_REGISTRATION_
    ERROR» – und wirft danach eine Ausnahme, in der davon nichts mehr
    steht. Ohne diesen Mitschnitt landet im System-Bildschirm ein
    RuntimeError ohne Aussage, und man sucht die Ursache im falschen
    Haus.

    Bewusst nur während des Anlaufs und mit Obergrenze: ein Horchposten,
    kein zweites Log.
    """

    LIMIT = 8

    def __init__(self, logger_name: str) -> None:
        self._name = logger_name
        self.zeilen: list[str] = []
        self._handler: Any = None

    def __enter__(self) -> _LogMitschnitt:
        import logging

        sammler = self

        class _Handler(logging.Handler):
            def emit(self, record: logging.LogRecord) -> None:
                if len(sammler.zeilen) >= _LogMitschnitt.LIMIT:
                    return
                try:
                    sammler.zeilen.append(record.getMessage())
                except Exception:
                    pass

        self._handler = _Handler(level=logging.WARNING)
        logger = logging.getLogger(self._name)
        logger.addHandler(self._handler)
        return self

    def __exit__(self, *_ausnahme: Any) -> None:
        import logging

        if self._handler is not None:
            logging.getLogger(self._name).removeHandler(self._handler)
            self._handler = None


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

        self._token_file = tokenstore.token_file(
            self.hub.config.data_file, self.config, "ring"
        )
        stored = tokenstore.load(self._token_file)
        if stored is None:
            raise ConfigError(
                f"{self._token_file} fehlt oder ist unlesbar – einmalig anmelden mit: "
                "docker exec -it homepilot-hub python -m "
                "homepilot.integrations.ring -c /config/config.yaml"
            )
        self._stored = stored

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
        # events: false heisst: den Push-Weg (Google/FCM) gar nicht erst
        # versuchen - die Abfrage unten ist dann der Hauptweg, keine
        # Rückfallebene.
        self._events_abgeschaltet = self.config.get("events") is False
        self.start_polling(self._refresh_devices)
        if not self._events_abgeschaltet:
            self.start_task(self._listen_loop())
        else:
            self.log.info(
                "Ring-Ereigniskanal per Konfiguration abgeschaltet - "
                "Klingeln wird alle %ss abgefragt",
                DING_POLL_SECONDS,
            )
        self.start_task(self._ding_loop())

    def health(self) -> dict[str, Any]:
        """Steht der schnelle Weg? Das ist hier die ganze Frage.

        Ohne diese Auskunft ist ein toter Ereigniskanal von aussen nicht
        von «es hat halt niemand geklingelt» zu unterscheiden.
        """
        if self._events_abgeschaltet:
            return {
                "ok": True,
                "detail": health_detail(False, None, abgeschaltet=True),
                "last_event": self._last_event,
            }
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
        tokenstore.save(self._token_file, self._stored)

    # ── Gerät → Hub ────────────────────────────────────────────────────────

    async def _refresh_devices(self) -> None:
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

    async def _reachable(self) -> dict[str, bool]:
        """Kommt der Hub überhaupt an Googles Push-Adressen? (nur bei Fehlschlag)

        Ein reiner TCP-Verbindungsversuch, kein Handschlag: Es geht um
        «ist der Weg offen», nicht um «funktioniert der Dienst».
        """
        ergebnis: dict[str, bool] = {}
        for host, port, _zweck in PUSH_ENDPOINTS:
            try:
                verbindung = asyncio.open_connection(host, port)
                reader, writer = await asyncio.wait_for(verbindung, REACH_TIMEOUT)
                del reader
                writer.close()
                try:
                    await writer.wait_closed()
                except Exception:
                    pass
                ergebnis[host] = True
            except asyncio.CancelledError:
                raise
            except Exception:
                ergebnis[host] = False
        return ergebnis

    async def _try_listen(self, on_event: Any, credentials: Any) -> bool:
        """Ereigniskanal mit gegebener Credential starten; True bei Erfolg."""
        listener = None
        # Was die Push-Bibliothek unterwegs meldet, mitschreiben: Der
        # eigentliche Grund («GCM register … PHONE_REGISTRATION_ERROR»)
        # steht in ihrem Log, nicht in der Ausnahme, die bei uns ankommt.
        mitschnitt = _LogMitschnitt("firebase_messaging")
        with mitschnitt:
            erfolg = await self._listen_once(on_event, credentials, listener)
        if not erfolg and self._listen_error:
            # Erst jetzt nachsehen, ob der Weg überhaupt offen ist – bei
            # jedem Start wäre das drei Verbindungen für nichts.
            erreichbar = await self._reachable()
            self._listen_error = push_diagnose(erreichbar, mitschnitt.zeilen)
        return erfolg

    async def _listen_once(self, on_event: Any, credentials: Any, listener: Any) -> bool:
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
            {"state": "opened", "last_opened": datetime.now(UTC).isoformat()},
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
# Aufruf:  docker exec -it homepilot-hub \
#              python -m homepilot.integrations.ring -c /config/config.yaml
# Fragt E-Mail, Passwort und den 2FA-Code ab und legt das Token dorthin,
# wo der Hub es liest. Das Passwort wird nicht gespeichert.


async def _login_main(config_path: str) -> int:
    import getpass

    from ring_doorbell import Auth, Requires2FAError

    from ..core.config import load_config

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "ring"]
    token_file = tokenstore.token_file(
        config.data_file, blocks[0] if blocks else None, "ring"
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

    tokenstore.save(token_file, {"token": token})
    print(f"✓ Angemeldet. Token liegt in {token_file} – jetzt den Hub starten.")
    return 0


async def _diagnose_main(config_path: str) -> int:
    """Warum kommt der Ereigniskanal nicht zustande?

    Aufruf:  docker exec homepilot-hub \
                 python -m homepilot.integrations.ring -c /config/config.yaml --diagnose

    Der System-Bildschirm sagt, *dass* es klemmt; hier steht, *woran*.
    Zwei Teile: Kommt der Rechner an Googles Adressen heran, und was
    antwortet Google auf einen echten Anmeldeversuch.
    """
    import logging

    from ..core.config import load_config

    logging.basicConfig(level=logging.WARNING, format="  %(name)s: %(message)s")

    # Wo gemessen wird, gehört dazu: Im Container gelten andere Regeln
    # als auf dem Docker-Host, und wer auf dem Host misst, misst das
    # falsche Netz - dann sieht alles offen aus und der Hub kommt
    # trotzdem nicht durch.
    import socket

    print(f"Gemessen von: {socket.gethostname()}")
    print("Erreichbarkeit der Push-Adressen (Google, nicht Ring):")
    erreichbar: dict[str, bool] = {}
    for host, port, zweck in PUSH_ENDPOINTS:
        try:
            reader, writer = await asyncio.wait_for(
                asyncio.open_connection(host, port), REACH_TIMEOUT
            )
            del reader
            writer.close()
            try:
                await writer.wait_closed()
            except Exception:
                pass
            erreichbar[host] = True
            print(f"  ✓ {host}:{port} – {zweck}")
        except Exception as err:
            erreichbar[host] = False
            print(f"  ✗ {host}:{port} – {zweck} ({err.__class__.__name__})")

    config = load_config(config_path)
    blocks = [b for b in config.integrations if b.get("integration") == "ring"]
    token_file = tokenstore.token_file(
        config.data_file, blocks[0] if blocks else None, "ring"
    )
    stored = tokenstore.load(token_file)
    if stored is None:
        print(f"\nKein Token in {token_file} – zuerst anmelden (ohne --diagnose).")
        return 1

    print("\nAnmeldeversuch beim Push-Dienst …")
    mitschnitt = _LogMitschnitt("firebase_messaging")
    fehler: str | None = None
    with mitschnitt:
        try:
            from ring_doorbell import Auth, Ring, RingEventListener

            auth = Auth(USER_AGENT, token=stored.get("token"))
            ring = Ring(auth)
            await ring.async_create_session()
            await ring.async_update_devices()
            listener = RingEventListener(ring, credentials=stored.get("listener"))
            gestartet = await listener.start()
            if gestartet:
                print("  ✓ Ereigniskanal steht – Klingeln kommt sofort an.")
                await listener.stop()
            else:
                fehler = "Anmeldung beim Push-Dienst abgelehnt"
            await auth.async_close()
        except Exception as err:
            fehler = f"{err.__class__.__name__}: {err}"

    for zeile in mitschnitt.zeilen:
        print(f"  … {zeile}")
    if fehler is None:
        return 0
    print(f"\n✗ {fehler}")
    print(f"→ {push_diagnose(erreichbar, mitschnitt.zeilen)}")
    print(
        "\nWer den Weg über Google gar nicht will: 'events: false' in den "
        f"ring-Block der config.yaml. Dann fragt der Hub alle {DING_POLL_SECONDS} s "
        "selbst nach – ohne Warnung im System-Bildschirm."
    )
    return 1


if __name__ == "__main__":
    import argparse
    import sys

    parser = argparse.ArgumentParser(description="Ring-Anmeldung für HomePilot")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml des Hubs")
    parser.add_argument(
        "--diagnose",
        action="store_true",
        help="Nicht anmelden, sondern prüfen, warum der Ereigniskanal fehlt",
    )
    args = parser.parse_args()
    if args.diagnose:
        sys.exit(asyncio.run(_diagnose_main(args.config)))
    sys.exit(asyncio.run(_login_main(args.config)))
