"""Die Alarmanlage: Überblick, scharf/unscharf, Probealarm, PIN.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
)

from ...core import alarmbericht, alarmpflege, bildarchiv, cliparchiv
from ...core import throttle as throttle_module
from ...core.errors import HomePilotError
from ...core.users import Capability
from ...integrations import alarm as alarm_module
from ...integrations.alarm_rules import zonen
from ..context import ApiContext
from ..models import (
    AlarmArmRequest,
    AlarmDisarmRequest,
    AlarmPinRequest,
    AlarmSensorTestRequest,
    AlarmUrteilRequest,
    AlarmWartungRequest,
    AlarmZwangPinRequest,
)

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require

    # ── Alarmanlage ────────────────────────────────────────────────────────

    def alarm_service():
        service = hub.integrations.get("alarm")
        if service is None:
            raise HTTPException(status_code=503, detail="Alarmanlage nicht geladen")
        return service

    @app.get("/api/alarm")
    async def alarm_overview(request: Request) -> dict[str, Any]:
        """Zustand, Zuordnung und alle Sensoren, die in Frage kommen.

        Die Kandidatenliste kommt vom Hub statt aus der App: Nur er weiss,
        welche Entität wirklich einen Öffnungs- oder Bewegungszustand
        meldet – die App müsste es raten.
        """
        require(request, Capability.EDIT_CONFIG)
        service = alarm_service()
        config = service.config_dict()
        return {
            "state": service._entity.as_dict()["state"],
            **config,
            # Alle vergebenen Zonennamen (Punkt 398) - für die Auswahl
            # beim Scharfschalten, aus den Sensoren selbst abgeleitet.
            "zones": zonen(service._sensors),
            "history": service.history,
            # Ob überhaupt ein Bild in einer Nachricht landen kann: Ohne
            # `push.public_url` gibt es keine Adresse, die das Telefon ohne
            # Anmeldung erreicht (siehe core/snapshots.py). Die App sagt es
            # dann dort, wo man das Bild erwartet - statt dass es einfach
            # ausbleibt.
            "images": bool((hub.config.push or {}).get("public_url")),
            "candidates": [
                {
                    "entity_id": entity.id,
                    "name": entity.label,
                    "room": entity.room,
                    "kind": entity.kind,
                    "device_class": entity.state.get("device_class"),
                    "open": alarm_module.sensor_open(entity),
                    "available": entity.available,
                }
                for entity in service.candidates()
            ],
        }

    @app.put("/api/alarm")
    async def alarm_configure(body: dict[str, Any], request: Request) -> dict[str, Any]:
        user = require(request, Capability.EDIT_CONFIG)
        service = alarm_service()
        await service.update_config(body)
        hub.aenderungen.merken(user, "alarm", "eingestellt")
        return {"ok": True, **service.config_dict()}

    @app.post("/api/alarm/arm")
    async def alarm_arm(body: AlarmArmRequest, request: Request) -> dict[str, Any]:
        """Scharf schalten. Offene Fenster melden statt blind loszulaufen –
        sonst schlägt die Anlage los, sobald die Verzögerung endet."""
        user = require(request, Capability.CONTROL)
        service = alarm_service()
        try:
            return await service.arm(
                body.mode, force=body.force, by=user.name, zone=body.zone
            )
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.post("/api/alarm/disarm")
    async def alarm_disarm(
        request: Request,
        # Ohne Body gültig - ältere App-Fassungen schicken keinen, und ohne
        # gesetzte PIN braucht es auch keinen.
        body: AlarmDisarmRequest | None = None,
    ) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        try:
            return await alarm_service().disarm(
                by=user.name,
                pin=(body.pin if body else "") or None,
                address=throttle_module.client_address(request),
                # Am Wandtablet ist die PIN Pflicht - siehe check_pin().
                require_pin=user.shared,
            )
        except HomePilotError as err:
            # Falsche oder fehlende PIN - lesbar zurück, kein Stacktrace.
            raise HTTPException(status_code=403, detail=str(err)) from err

    @app.post("/api/alarm/panik")
    async def alarm_panik(request: Request) -> dict[str, Any]:
        """Alarm von Hand auslösen - jetzt, aus jedem Zustand.

        **Ohne PIN**, und das ist Absicht: Wer den Knopf drückt, ist in
        Bedrängnis, und eine Tastatur zwischen Bedrängnis und Sirene ist
        ein Fehler. Die PIN steht vor dem *Abstellen* - dort verhindert
        sie, dass jemand den Alarm beendet, der ihn nicht beenden darf.

        ``CONTROL`` und nicht ``EDIT_CONFIG`` wie beim Probealarm: Ein
        Probealarm ist eine Einstellungssache, ein Notruf nicht. Wer im
        Haus etwas schalten darf, darf auch um Hilfe rufen. Gäste
        bleiben aussen vor - die haben kein CONTROL.
        """
        user = require(request, Capability.CONTROL)
        try:
            return await alarm_service().panic(by=user.name)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.post("/api/alarm/test")
    async def alarm_test(request: Request) -> dict[str, Any]:
        """Probealarm: Sirene, Lichter und Nachricht einmal durchspielen.

        Die einzige Möglichkeit nachzusehen, ob die Anlage überhaupt
        etwas tut, bevor es darauf ankommt. Nur wer die Konfiguration
        ändern darf, darf testen – ein Gast soll keine Sirene starten.
        """
        user = require(request, Capability.EDIT_CONFIG)
        try:
            return await alarm_service().test_run(by=user.name)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.put("/api/alarm/pin")
    async def alarm_set_pin(body: AlarmPinRequest, request: Request) -> dict[str, Any]:
        """Die eigene PIN fürs Entschärfen setzen oder (leer) entfernen -
        je Person (Punkt 399 der Werkbank).

        Die eigene braucht nur ``CONTROL``, wie ein Passwort im eigenen
        Konto. Eine fremde zu setzen - etwa weil sie vergessen wurde -
        bleibt der Benutzerverwaltung vorbehalten.
        """
        user = require(request, Capability.CONTROL)
        ziel = (body.user or "").strip() or user.name
        if ziel != user.name:
            require(request, Capability.MANAGE_USERS)
        try:
            await alarm_service().set_pin(ziel, body.pin or None)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        return {"ok": True, "pin_required": alarm_service().pin_required()}

    @app.put("/api/alarm/pin/zwang")
    async def alarm_set_zwang_pin(
        body: AlarmZwangPinRequest, request: Request
    ) -> dict[str, Any]:
        """Die Zwangs-PIN setzen oder entfernen (Punkt 400 der Werkbank) -
        dieselbe Person, die ihre eigene PIN setzt, oder die
        Benutzerverwaltung für eine fremde."""
        user = require(request, Capability.CONTROL)
        ziel = (body.user or "").strip() or user.name
        if ziel != user.name:
            require(request, Capability.MANAGE_USERS)
        try:
            await alarm_service().set_duress_pin(ziel, body.pin or None)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        return {"ok": True}

    # ── Sensor-Testlauf (Punkt 403 der Werkbank) ────────────────────────────

    @app.post("/api/alarm/sensortest/start")
    async def alarm_sensor_test_start(
        body: AlarmSensorTestRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        try:
            return alarm_service().start_sensor_test(body.mode)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.get("/api/alarm/sensortest")
    async def alarm_sensor_test_state(request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        return alarm_service().sensor_test_state()

    @app.post("/api/alarm/sensortest/stop")
    async def alarm_sensor_test_stop(request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        return alarm_service().stop_sensor_test()

    # ── Fehlalarm-Statistik (Punkt 407 der Werkbank) ────────────────────────

    @app.get("/api/alarm/fehlalarme")
    async def alarm_fehlalarme(request: Request) -> dict[str, Any]:
        """Sensoren, die auffällig oft schnell und ohne Eskalation
        entschärft wurden - Kandidaten fürs Umstellen auf «verzögert»."""
        require(request, Capability.EDIT_CONFIG)
        service = alarm_service()
        kandidaten = alarmbericht.fehlalarm_kandidaten(service.history)
        # Und was ein Mensch wirklich gesagt hat (Punkt 485/490 der
        # Werkbank). Die Kandidaten oben sind geraten: unter sechzig
        # Sekunden entschärft, dreimal. Hier steht, was jemand
        # eingeordnet hat - und das ist die Zahl, aus der ein Handgriff
        # folgt.
        eingeordnet = alarmpflege.auffaellige_sensoren(service.history, mindest=2)
        for eintrag in [*kandidaten, *eingeordnet]:
            entity = hub.registry.get(eintrag["entity_id"])
            eintrag["name"] = entity.label if entity is not None else eintrag["entity_id"]
            # In welchen Modi er heute wacht - ohne das ist «stell ihn
            # um» ein Rat ohne Adresse.
            zeile: dict[str, Any] = next(
                (
                    row
                    for row in service.config_dict().get("sensors") or []
                    if row.get("entity_id") == eintrag["entity_id"]
                ),
                {},
            )
            eintrag["modes"] = list(zeile.get("modes") or [])
        return {"kandidaten": kandidaten, "eingeordnet": eingeordnet}

    @app.get("/api/alarm/einordnung")
    async def alarm_einordnung(request: Request) -> dict[str, Any]:
        """Steht ein Alarm zur Einordnung offen? (Punkt 490 der Werkbank)

        Die Fehlalarm-Statistik riet sie sich bisher aus der Zeit bis zum
        Entschärfen zusammen: Ein echter Einbruch, den jemand schnell
        entschärft, zählte als Fehlalarm; ein Fehlalarm, den zehn Minuten
        lang niemand bemerkt, als echt.
        """
        require(request, Capability.CONTROL)
        service = alarm_service()
        offen = service.offene_einordnung()
        if offen is None:
            return {"offen": None, "urteile": list(alarmpflege.URTEILE)}
        entity = hub.registry.get(str(offen.get("entity_id") or ""))
        return {
            "offen": {
                **offen,
                "name": entity.label if entity is not None else offen.get("entity_id"),
            },
            "urteile": list(alarmpflege.URTEILE),
        }

    @app.post("/api/alarm/einordnung")
    async def alarm_einordnen(
        body: AlarmUrteilRequest, request: Request
    ) -> dict[str, Any]:
        """Den letzten Alarm einordnen - die Frage nach dem Entschärfen."""
        user = require(request, Capability.CONTROL)
        try:
            return alarm_service().einordnen(body.urteil, by=user.name)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.post("/api/alarm/wartung")
    async def alarm_wartung(
        body: AlarmWartungRequest, request: Request
    ) -> dict[str, Any]:
        """Den Wartungsmodus starten (Punkt 489 der Werkbank).

        Wer scharf schalten darf, darf auch die Anlage für einen
        Vormittag ruhen lassen - es ist dieselbe Entscheidung, nur
        andersherum, und sie endet von selbst.
        """
        user = require(request, Capability.CONTROL)
        return await alarm_service().wartung_starten(body.stunden, by=user.name)

    @app.delete("/api/alarm/wartung")
    async def alarm_wartung_beenden(request: Request) -> dict[str, Any]:
        """Die Wartung beenden - und dabei wieder scharf schalten."""
        user = require(request, Capability.CONTROL)
        return await alarm_service().wartung_beenden(by=user.name)

    @app.get("/api/alarm/blatt")
    async def alarm_blatt(request: Request, at: float | None = None) -> Response:
        """Ein Alarm als Blatt für Polizei oder Versicherung (Punkt 484).

        Den Nachbericht gibt es seit Punkt 337 - als Absatz fürs
        Telefon. Für eine Anzeige braucht es dasselbe mit Zeiten,
        Sensoren und dem Hinweis auf die Aufnahmen, und zwar in der
        Stunde danach statt drei Tage später aus der Erinnerung.
        """
        require(request, Capability.CONTROL)
        service = alarm_service()

        def name_von(entity_id: str) -> str:
            entity = hub.registry.get(entity_id)
            return entity.label if entity is not None else entity_id

        text = alarmbericht.blatt(
            service.history,
            at,
            # Die Hausadresse aus der config.yaml (wie beim
            # Babysitter-Blatt, Punkt 213): Wer eine Anzeige macht, muss
            # als Erstes sagen, wo. Fehlt sie, bleibt die Zeile weg.
            haus=str((hub.config.location or {}).get("address") or "").strip(),
            name_von=name_von,
        )
        return Response(content=text, media_type="text/plain; charset=utf-8")

    # ── Das Ereignisblatt ──────────────────────────────────────────────────
    #
    # «Was war da eigentlich?» braucht bisher vier Orte: den
    # Alarm-Verlauf, den Haus-Rückblick, das Clip-Archiv und die
    # Push-Bilder (die nach zehn Minuten weg sind). Hier kommt die
    # Viertelstunde um ein Ereignis als EIN Blatt zurück - samt der
    # archivierten Standbilder (core/bildarchiv.py).

    #: Wie weit das Blatt um das Ereignis herum schaut (je Seite).
    EREIGNIS_FENSTER = 450.0

    @app.get("/api/alarm/ereignis")
    async def alarm_ereignis(at: float, request: Request) -> dict[str, Any]:
        """Alles aus der Viertelstunde um den Zeitpunkt `at`."""
        user = require(request, Capability.CONTROL)
        von, bis = at - EREIGNIS_FENSTER, at + EREIGNIS_FENSTER
        service = alarm_service()
        verlauf = [
            row
            for row in service.history
            if isinstance(row.get("at"), (int, float)) and von <= row["at"] <= bis
        ]

        def darf(entity_id: str) -> bool:
            entity = hub.registry.get(entity_id)
            if entity is None:
                return True
            return user.may_see(
                entity.id, entity.kind, entity.integration, entity.room
            )

        ereignisse = hub.eventlog.fenster(von, bis, sichtbar=darf)
        namen: dict[str, dict[str, Any]] = {}
        for eintrag in ereignisse:
            kennung = str(eintrag.get("entity_id") or "")
            if kennung not in namen:
                entity = hub.registry.get(kennung)
                namen[kennung] = {
                    "name": entity.label if entity is not None else kennung,
                    "kind": str(entity.kind) if entity is not None else "",
                    "room": entity.room if entity is not None else None,
                }
        bilder = bildarchiv.fenster(
            bildarchiv.liste(bildarchiv.ordner(hub.config.data_file)), von, bis
        )
        clips = [
            meta
            for meta in cliparchiv.liste(cliparchiv.ordner(hub.config.data_file))
            if isinstance(meta.get("at"), (int, float)) and von <= meta["at"] <= bis
        ]
        return {
            "von": von,
            "bis": bis,
            "verlauf": verlauf,
            "events": ereignisse,
            "devices": namen,
            "bilder": bilder,
            "clips": clips,
        }

    @app.get("/api/alarm/bild/{kennung}")
    async def alarm_bild(kennung: str, request: Request) -> Response:
        """Ein archiviertes Standbild - die Kennung kommt aus dem Blatt."""
        require(request, Capability.CONTROL)
        daten = bildarchiv.lesen(bildarchiv.ordner(hub.config.data_file), kennung)
        if daten is None:
            raise HTTPException(status_code=404, detail="Dieses Bild gibt es nicht mehr")
        return Response(
            content=daten,
            media_type="image/png" if daten.startswith(b"\x89PNG") else "image/jpeg",
            headers={"Cache-Control": "private, max-age=3600"},
        )

