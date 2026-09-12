"""Die Brandmeldeanlage - Rauch- und Gasmelder als eigene Anlage.

Punkt 543 der Werkbank. Was sie tut, wenn ein Melder anschlägt, und
warum sie keine Betriebsart kennt, steht in ``core/brandmelder.py``;
hier sind die Seiteneffekte: Push mit Bild, Durchsage, Lichter, Storen,
Türen, die übrigen Melder, der Verlauf - und das Quittieren.

Wie die Alarmanlage gehört sie zum Haus und nicht zu einer
Geräteanbindung: Sie ist immer da, auch ohne Eintrag in der config.yaml
(core/hub.py ergänzt sie beim Start). Welche Melder sie führt, liest sie
von selbst aus dem Gerätebestand - wer einen Rauchmelder anschliesst,
hat ihn damit in der Anlage; abschalten lässt sich jeder einzeln.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from ..core import brandmelder, personenbild, say
from ..core.entity import Entity, EntityKind
from ..core.integration import Integration
from ..core.kamera import camera_for

log = logging.getLogger(__name__)

#: So lange wartet die Nachricht höchstens auf das Kamerabild - dieselbe
#: Frist wie bei der Alarmanlage.
BILD_WARTEZEIT = 4.0


class BrandIntegration(Integration):
    name = "brand"

    async def setup(self) -> None:
        stored = self.hub.data.get(brandmelder.DATA_KEY)
        config = stored[0] if stored else {}
        self._settings = brandmelder.settings_lesen(config.get("settings"))
        self._abgeschaltet: set[str] = {
            str(eintrag) for eintrag in (config.get("disabled") or []) if str(eintrag)
        }
        self._tests: dict[str, float] = {
            str(k): float(v)
            for k, v in (config.get("tests") or {}).items()
            if isinstance(v, (int, float))
        }
        self._history: list[dict[str, Any]] = list(config.get("history") or [])
        self._erinnert: float | None = config.get("reminded")
        # Der laufende Vorfall: welche Melder gemeldet haben, wann die
        # letzte Meldung hinausging, ob jemand quittiert hat.
        self._ausloeser: set[str] = set()
        self._quittiert = False
        self._quittiert_von = ""
        self._zuletzt_gemeldet: float | None = None
        self._seit: float | None = None
        self._entity = await self.add_entity(
            "anlage",
            EntityKind.ALARM,
            self.config.get("name", "Brandmeldeanlage"),
            state=self._state_dict(),
            commands=["quittieren", "stumm", "probealarm"],
        )
        self._unsubscribe = self.hub.bus.subscribe("state_changed", self._on_state_changed)

    async def teardown(self) -> None:
        if self._unsubscribe:
            self._unsubscribe()

    # ── Zustand ───────────────────────────────────────────────────────────

    def zustand(self) -> str:
        return brandmelder.zustand(
            self.hub.registry.all(), self._abgeschaltet, self._quittiert
        )

    def _state_dict(self) -> dict[str, Any]:
        entities = self.hub.registry.all() if hasattr(self.hub, "registry") else []
        aktive = brandmelder.alarmierend(entities, self._abgeschaltet)
        return {
            "state": self.zustand(),
            "melder": len(
                [e for e in brandmelder.melder(entities) if e.id not in self._abgeschaltet]
            ),
            "alarm": [entity.id for entity in aktive],
            "since": self._seit,
            "acknowledged_by": self._quittiert_von or None,
        }

    async def _publish(self) -> None:
        await self.hub.registry.update_state(
            self._entity.id, self._state_dict(), available=True
        )

    def config_dict(self) -> dict[str, Any]:
        return {
            "settings": dict(self._settings),
            "disabled": sorted(self._abgeschaltet),
            "tests": dict(self._tests),
            "reminded": self._erinnert,
        }

    def _save(self) -> None:
        self.hub.data.set(
            brandmelder.DATA_KEY, [{**self.config_dict(), "history": self._history}]
        )

    def _note(self, kind: str, text: str, by: str = "", entity_id: str | None = None) -> None:
        zeile: dict[str, Any] = {"kind": kind, "text": text, "by": by, "at": time.time()}
        if entity_id:
            zeile["entity_id"] = entity_id
        self._history.insert(0, zeile)
        del self._history[int(self._settings.get("history_limit") or 50) :]
        self._save()

    @property
    def history(self) -> list[dict[str, Any]]:
        return list(self._history)

    def melderliste(self) -> list[dict[str, Any]]:
        return [
            brandmelder.melder_zeile(entity, self._abgeschaltet, self._tests)
            for entity in brandmelder.melder(self.hub.registry.all())
        ]

    async def update_config(self, patch: dict[str, Any]) -> None:
        if "settings" in patch:
            self._settings = brandmelder.settings_lesen(
                {**self._settings, **(patch.get("settings") or {})}
            )
        if "disabled" in patch and isinstance(patch["disabled"], list):
            self._abgeschaltet = {str(e) for e in patch["disabled"] if str(e)}
        self._save()
        await self._publish()

    async def melder_getestet(self, entity_id: str, by: str = "") -> None:
        """«Getestet» an einem Melder: Datum merken, Erinnerung von vorn."""
        self._tests[entity_id] = time.time()
        self._erinnert = None
        entity = self.hub.registry.get(entity_id)
        self._note("test", f"{entity.label if entity else entity_id} geprüft", by, entity_id)

    # ── Ereignisse ────────────────────────────────────────────────────────

    async def _on_state_changed(self, _event_type: str, payload: dict[str, Any]) -> None:
        entity = self.hub.registry.get(str(payload.get("entity_id")))
        if entity is None or not brandmelder.ist_melder(entity):
            return
        if entity.id in self._abgeschaltet:
            return
        if brandmelder.meldet(entity):
            if entity.id not in self._ausloeser:
                await self._ausloesen(entity)
            return
        # Ein Melder ist wieder ruhig: Entwarnung erst, wenn alle es sind.
        if entity.id in self._ausloeser and not brandmelder.alarmierend(
            self.hub.registry.all(), self._abgeschaltet
        ):
            await self._entwarnung()
        else:
            await self._publish()

    async def _ausloesen(self, entity: Entity) -> None:
        """Ein Melder schlägt an - alles, was dann geschieht, in dieser Reihenfolge:
        melden, sprechen, schalten. Die Nachricht zuerst, weil sie die
        ist, die auch ankommt, wenn der Rest hängt."""
        erster = not self._ausloeser
        self._ausloeser.add(entity.id)
        if erster:
            self._seit = time.time()
            self._quittiert = False
            self._quittiert_von = ""
        await self._publish()
        self._note(
            "ausgeloest",
            f"Rauch gemeldet: {entity.label}" + (f" ({entity.room})" if entity.room else ""),
            "",
            entity_id=entity.id,
        )
        await self._melden(entity, wiederholung=False)
        await self._sprechen(entity)
        await self._schalten()
        await self.hub.bus.publish(
            "fire", {"entity_id": entity.id, "name": entity.label, "room": entity.room}
        )

    async def _melden(self, entity: Entity, wiederholung: bool) -> None:
        if not self._settings.get("notify"):
            return
        camera = camera_for(entity, self.hub.registry.all())
        wo = f" – {entity.room}" if entity.room else ""
        titel = "🔥 Immer noch Rauch" if wiederholung else "🔥 Rauch gemeldet"
        text = (
            f"{entity.label}{wo} meldet weiter Rauch. Noch niemand hat quittiert."
            if wiederholung
            else f"{entity.label}{wo} meldet Rauch. Das Haus verlassen, dann 118 anrufen."
        )
        self._zuletzt_gemeldet = time.time()
        try:
            image = await personenbild.bild_adresse(
                self.hub, camera, BILD_WARTEZEIT, "die Brandmeldung"
            )
        except Exception:  # noqa: BLE001 - ohne Bild, aber nicht ohne Meldung
            image = None
        tokens = self.hub.push.recipients(self.hub.users.users, "all", "smoke")
        await self.hub.push.send(
            tokens,
            title=titel,
            body=text,
            data={"type": "smoke", "ziel": "bereich:brand", "entity_id": entity.id, "camera": camera},
            image=image,
            category="smoke",
        )

    async def _sprechen(self, entity: Entity) -> None:
        if not self._settings.get("announce"):
            return
        text = brandmelder.durchsage_text(str(self._settings.get("announce_text") or ""), entity)
        try:
            # Auf allen Boxen, laut: Eine Brandansage ist der eine Fall, in
            # dem «zu laut» kein Einwand ist.
            await say.speak(self.hub, text, speakers=None, volume=90)
        except Exception as err:  # noqa: BLE001
            log.info("Brand-Durchsage nicht möglich: %s", err)

    async def _schalten(self) -> None:
        befehle = brandmelder.schaltbefehle(
            self.hub.registry.all(), self._settings, self._ausloeser
        )
        for entity_id, command, data in befehle:
            try:
                await self.hub.integrations.dispatch_command(entity_id, command, data)
            except Exception as err:  # noqa: BLE001 - einer darf hängen, die anderen nicht
                log.warning("Brand-Aktion %s %s fehlgeschlagen: %s", entity_id, command, err)

    async def _entwarnung(self) -> None:
        dauer = round((time.time() - self._seit) / 60) if self._seit else 0
        self._ausloeser.clear()
        self._quittiert = False
        self._quittiert_von = ""
        self._seit = None
        self._zuletzt_gemeldet = None
        await self._publish()
        self._note("entwarnung", f"Entwarnung - alle Melder wieder ruhig nach {dauer} min", "")
        if self._settings.get("notify_clear"):
            tokens = self.hub.push.recipients(self.hub.users.users, "all", "smoke")
            await self.hub.push.send(
                tokens,
                title="Entwarnung",
                body=f"Alle Rauchmelder sind wieder ruhig (nach {dauer} Minuten).",
                data={"type": "smoke", "ziel": "bereich:brand"},
                category="smoke",
            )

    # ── Bedienung ─────────────────────────────────────────────────────────

    async def quittieren(self, by: str = "") -> dict[str, Any]:
        """Gesehen: keine Wiederholung mehr, die Melder bleiben, was sie sind."""
        if not self._ausloeser:
            return {"ok": True, "state": self.zustand()}
        self._quittiert = True
        self._quittiert_von = by
        await self._publish()
        self._note("quittiert", "Quittiert", by)
        return {"ok": True, "state": self.zustand()}

    async def stumm(self, by: str = "") -> dict[str, Any]:
        """Alle Melder stummschalten, die es können (Aqara: buzzer mute)."""
        befehle = brandmelder.stummbefehle(self.hub.registry.all())
        gesendet: list[str] = []
        for entity_id, command, data in befehle:
            try:
                await self.hub.integrations.dispatch_command(entity_id, command, data)
                gesendet.append(entity_id)
            except Exception as err:  # noqa: BLE001
                log.info("Stummschalten %s fehlgeschlagen: %s", entity_id, err)
        if gesendet:
            self._note("stumm", f"{len(gesendet)} Melder stummgeschaltet", by)
        return {"ok": True, "muted": gesendet}

    async def probealarm(self, by: str = "") -> dict[str, Any]:
        """Alles einmal durchspielen, ohne Melder: Nachricht, Durchsage,
        Schaltbefehle. Damit man weiss, dass es klappt, bevor es brennt."""
        self._note("probe", "Probealarm", by)
        tokens = self.hub.push.recipients(self.hub.users.users, "all", "smoke")
        await self.hub.push.send(
            tokens,
            title="Probealarm der Brandmeldeanlage",
            body=f"Ausgelöst von {by or 'unbekannt'} - kein Feuer.",
            data={"type": "smoke", "ziel": "bereich:brand"},
            category="smoke",
        )
        if self._settings.get("announce"):
            try:
                await say.speak(self.hub, "Probealarm der Brandmeldeanlage. Kein Feuer.", speakers=None, volume=70)
            except Exception as err:  # noqa: BLE001
                log.info("Probe-Durchsage nicht möglich: %s", err)
        await self._schalten()
        return {"ok": True}

    async def takt(self) -> None:
        """Vom Wächter, einmal je Minute: Wiederholung und Prüf-Erinnerung."""
        jetzt = time.time()
        if self._ausloeser and brandmelder.wiederholung_faellig(
            self._zuletzt_gemeldet, jetzt, int(self._settings.get("repeat_minutes") or 0),
            self._quittiert,
        ):
            aktive = brandmelder.alarmierend(self.hub.registry.all(), self._abgeschaltet)
            if aktive:
                await self._melden(aktive[0], wiederholung=True)
        # Nur echte Melder zählen für die Prüfung - eine Kamera, die
        # einen Melder hört, hat keine Prüftaste. Vorher stand sie mit
        # «nie geprüft» in der Rechnung, und die Erinnerung kam sofort.
        letzte = [
            self._tests.get(e.id)
            for e in brandmelder.melder(self.hub.registry.all())
            if e.id not in self._abgeschaltet and e.kind != EntityKind.CAMERA
        ]
        if not letzte:
            return
        aeltester = None if any(t is None for t in letzte) else min(t for t in letzte if t)
        if brandmelder.pruefung_faellig(
            aeltester, jetzt, int(self._settings.get("test_months") or 0), self._erinnert
        ):
            self._erinnert = jetzt
            self._save()
            tokens = self.hub.push.recipients(self.hub.users.users, "all", "maintenance")
            await self.hub.push.send(
                tokens,
                title="Rauchmelder prüfen",
                body="Die Prüfung der Rauchmelder ist fällig - Prüftaste drücken und in der App «Getestet» antippen.",
                data={"type": "smoke", "ziel": "bereich:brand"},
                category="maintenance",
            )

    async def handle_command(self, entity: Entity, command: str, data: dict[str, Any]) -> None:
        if command == "quittieren":
            await self.quittieren(by=str(data.get("by") or "Befehl"))
        elif command == "stumm":
            await self.stumm(by=str(data.get("by") or "Befehl"))
        elif command == "probealarm":
            await self.probealarm(by=str(data.get("by") or "Befehl"))
        else:
            await super().handle_command(entity, command, data)


INTEGRATION = BrandIntegration
