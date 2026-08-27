"""Bluetooth-Anhänger: wo liegt der Schlüssel, der Rucksack, das Velo?

Konfiguration:
  - integration: bletags
    broker: 192.168.1.5
    port: 1883
    username: "${MQTT_USER}"
    password: "${MQTT_PASSWORD}"
    base_topic: espresense       # so heisst es bei ESPresense selbst
    away_after: 120              # Sekunden ohne Meldung = ausser Haus
    tags:
      - id: tile:abcd1234        # wie der Empfänger den Anhänger nennt
        name: Schlüsselbund
      - id: ibeacon:0102...-1-2
        name: Rucksack

**AirTags gehen nicht, und daran ändert auch diese Integration nichts.**
Ein AirTag sendet seine Kennung verschlüsselt und wechselt sie
ständig; wiedererkennen kann ihn nur, wer den privaten Schlüssel des
Besitzers hat, und der liegt im iPhone. Eine öffentliche Schnittstelle
zu «Wo ist?» gibt es nicht. Wer es trotzdem anbietet, meldet sich mit
dem Apple-Konto an einem undokumentierten Dienst an - das fliegt beim
nächsten Umbau auf, und das Konto ist dabei im Spiel. Für «wo liegt
der Schlüssel?» ist das der falsche Handel.

**Was geht: Anhänger mit fester Kennung** - iBeacon, Eddystone, viele
billige Schlüsselfinder. Sie senden dieselbe Kennung an jeden, der
zuhört. Empfangen wird sie im Haus von ein paar ESP32 mit ESPresense
(oder einem Theengs Gateway); die melden je Zimmer eine geschätzte
Entfernung über MQTT. Der Hub rechnet daraus das Zimmer
(core/bletag.py).

**Welche Kennung hat mein Anhänger?** Nicht raten - nachsehen:

    python -m homepilot.integrations.bletags -c config.yaml --geraete

Das hört eine halbe Minute mit und zeigt, was gerade sendet, mit
Zimmer und Entfernung. Danach steht die Kennung in der config.yaml.

Was die Integration bewusst *nicht* tut: von sich aus für alles eine
Kachel anlegen, was vorbeikommt. In Reichweite sind auch die Telefone
der Nachbarn, jede Uhr und jeder Kopfhörer - eine Wohnung voller
Kacheln für fremde Geräte wäre keine Übersicht, und eine Anwesenheits-
liste, in der Fremde auftauchen, wäre schlimmer.
"""

from __future__ import annotations

import asyncio
import json
import ssl
import time
from typing import Any

import aiomqtt

from ..core import bletag
from ..core.entity import EntityKind
from ..core.errors import ConfigError
from ..core.integration import Integration


def tags_lesen(config: Any) -> list[dict[str, str]]:
    """Die Anhänger aus der Konfiguration (rein, testbar).

    Ohne Kennung kein Anhänger: Sie ist das Einzige, woran der Hub ihn
    wiedererkennt. Ein Eintrag nur mit Namen wäre eine Kachel, die nie
    etwas anzeigt.
    """
    raus: list[dict[str, str]] = []
    for eintrag in config or []:
        if not isinstance(eintrag, dict):
            continue
        kennung = str(eintrag.get("id") or "").strip()
        if not kennung:
            continue
        raus.append({"id": kennung, "name": str(eintrag.get("name") or kennung).strip()})
    return raus


def object_id(kennung: str) -> str:
    """Aus «tile:abcd» wird «tile_abcd» (rein, testbar)."""
    sauber = "".join(
        zeichen if zeichen.isalnum() else "_" for zeichen in str(kennung).lower()
    )
    return sauber.strip("_") or "tag"


class BleTagsIntegration(Integration):
    name = "bletags"

    async def setup(self) -> None:
        self._broker = self.config.get("broker")
        if not self._broker:
            raise ConfigError("bletags braucht 'broker' in der Konfiguration")
        self._port = int(self.config.get("port", 1883))
        self._username = self.config.get("username")
        self._password = self.config.get("password")
        self._tls = bool(self.config.get("tls", False))
        self._tls_insecure = bool(self.config.get("tls_insecure", False))
        self._base = str(self.config.get("base_topic") or "espresense").strip("/")
        self._frist = float(self.config.get("away_after", bletag.FRIST))
        self._tags = tags_lesen(self.config.get("tags"))
        if not self._tags:
            raise ConfigError(
                "bletags braucht 'tags' mit id und name - welche Kennung ein "
                "Anhänger hat, zeigt: python -m homepilot.integrations.bletags "
                "-c config.yaml --geraete"
            )

        # Kennung → entity_id, und je Anhänger die Meldungen je Zimmer.
        self._ids: dict[str, str] = {}
        self._meldungen: dict[str, dict[str, dict[str, Any]]] = {}
        for tag in self._tags:
            entity = await self.add_entity(
                object_id(tag["id"]),
                EntityKind.SENSOR,
                tag["name"],
                state={"state": "weg", "room": None, "distance": None},
                # Bis der erste Empfänger meldet, weiss der Hub nichts.
                available=False,
            )
            self._ids[tag["id"]] = entity.id
            self._meldungen[tag["id"]] = {}

        self.start_task(self._connection_loop())
        self.start_task(self._verfall_loop())

    def _tls_context(self) -> ssl.SSLContext | None:
        if not self._tls:
            return None
        context = ssl.create_default_context()
        if self._tls_insecure:
            context.check_hostname = False
            context.verify_mode = ssl.CERT_NONE
        return context

    async def _connection_loop(self) -> None:
        delay = 1.0
        while True:
            try:
                async with aiomqtt.Client(
                    hostname=self._broker,
                    port=self._port,
                    username=self._username,
                    password=self._password,
                    tls_context=self._tls_context(),
                ) as client:
                    delay = 1.0
                    self.log.info("Mit dem Broker verbunden, warte auf Anhänger")
                    await client.subscribe(f"{self._base}/devices/+/+")
                    async for message in client.messages:
                        await self._nachricht(
                            str(message.topic), _decode(message.payload)
                        )
            except asyncio.CancelledError:
                raise
            except Exception as err:
                self.log.warning(
                    "Verbindung zum Broker verloren (%s), neuer Versuch in %.0fs",
                    err,
                    delay,
                )
            await asyncio.sleep(delay)
            delay = min(60.0, delay * 2)

    async def _nachricht(self, topic: str, payload: str) -> None:
        gelesen = bletag.thema_lesen(topic, self._base)
        if gelesen is None:
            return
        kennung, zimmer = gelesen
        entity_id = self._ids.get(kennung)
        if entity_id is None:
            # Ein fremdes Gerät in Reichweite - kein Grund für eine Kachel.
            return
        try:
            daten = json.loads(payload)
        except ValueError:
            return
        meter = bletag.abstand(daten)
        if meter is None:
            return
        self._meldungen[kennung] = bletag.melden(
            self._meldungen[kennung], zimmer, meter, time.time()
        )
        await self._schreiben(kennung, entity_id)

    async def _verfall_loop(self) -> None:
        """Nachsehen, ob ein Anhänger verstummt ist.

        Ohne diese Runde bliebe der Schlüssel für immer im letzten
        Zimmer stehen: Ein Anhänger, den niemand mehr hört, schickt auch
        keine Meldung «ich bin weg».
        """
        while True:
            await asyncio.sleep(30)
            for kennung, entity_id in self._ids.items():
                await self._schreiben(kennung, entity_id)

    async def _schreiben(self, kennung: str, entity_id: str) -> None:
        entity = self.hub.registry.get(entity_id)
        bisher = str((entity.state.get("room") if entity else None) or "") or None
        stand = bletag.zustand(
            self._meldungen.get(kennung), time.time(), bisher, self._frist
        )
        await self.hub.registry.update_state(entity_id, stand, available=True)


def _decode(payload: Any) -> str:
    if isinstance(payload, (bytes, bytearray)):
        return payload.decode("utf-8", "ignore")
    return str(payload)


INTEGRATION = BleTagsIntegration


# ── Hilfe beim Einrichten ──────────────────────────────────────────────────
#
# «Welche Kennung hat mein Anhänger?» lässt sich nicht raten und steht
# auch nicht auf der Verpackung. Also mithören und zeigen, was sendet.

async def _lauschen(config_path: str, sekunden: float) -> None:
    import yaml

    with open(config_path, encoding="utf-8") as datei:
        roh = yaml.safe_load(datei) or {}
    eintrag = next(
        (
            teil
            for teil in (roh.get("integrations") or [])
            if isinstance(teil, dict) and teil.get("integration") == "bletags"
        ),
        None,
    )
    if eintrag is None:
        raise SystemExit(
            "In dieser config.yaml steht keine bletags-Integration. Es genügt "
            "der Abschnitt mit broker (und ggf. username/password) - die Tags "
            "trägt man danach ein."
        )
    basis = str(eintrag.get("base_topic") or "espresense").strip("/")
    gesehen: dict[str, dict[str, Any]] = {}
    print(f"Höre {int(sekunden)} Sekunden auf {basis}/devices/+/+ …\n")

    async def sammeln() -> None:
        async with aiomqtt.Client(
            hostname=eintrag.get("broker"),
            port=int(eintrag.get("port", 1883)),
            username=eintrag.get("username"),
            password=eintrag.get("password"),
        ) as client:
            await client.subscribe(f"{basis}/devices/+/+")
            async for message in client.messages:
                gelesen = bletag.thema_lesen(str(message.topic), basis)
                if gelesen is None:
                    continue
                kennung, zimmer = gelesen
                try:
                    daten = json.loads(_decode(message.payload))
                except ValueError:
                    continue
                meter = bletag.abstand(daten)
                eintrag_alt = gesehen.get(kennung) or {"name": "", "zimmer": {}}
                eintrag_alt["name"] = str(daten.get("name") or eintrag_alt["name"])
                eintrag_alt["zimmer"][zimmer] = meter
                gesehen[kennung] = eintrag_alt

    try:
        await asyncio.wait_for(sammeln(), timeout=sekunden)
    except TimeoutError:
        pass

    if not gesehen:
        print(
            "Nichts gehört. Läuft ein Empfänger (ESPresense) und schickt er "
            "auf dieses Thema?"
        )
        return
    for kennung, eintrag_gesehen in sorted(gesehen.items()):
        zimmer = ", ".join(
            f"{name} {meter} m" if meter is not None else name
            for name, meter in sorted(eintrag_gesehen["zimmer"].items())
        )
        print(f"  id: {kennung}")
        if eintrag_gesehen["name"]:
            print(f"    meldet sich als: {eintrag_gesehen['name']}")
        print(f"    gehört in: {zimmer}\n")
    print("Die gewünschten Kennungen unter 'tags:' in die config.yaml eintragen.")


def _main() -> None:
    import argparse

    parser = argparse.ArgumentParser(description="Bluetooth-Anhänger einrichten")
    parser.add_argument("-c", "--config", required=True, help="Pfad zur config.yaml")
    parser.add_argument(
        "--geraete",
        action="store_true",
        help="mithören und zeigen, welche Anhänger gerade senden",
    )
    parser.add_argument(
        "--sekunden", type=float, default=30.0, help="wie lange mithören"
    )
    args = parser.parse_args()
    if not args.geraete:
        parser.error("Ohne --geraete gibt es hier nichts zu tun.")
    asyncio.run(_lauschen(args.config, args.sekunden))


if __name__ == "__main__":
    _main()
