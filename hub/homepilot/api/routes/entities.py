"""Entitäten: Zustand, Befehle, Raum/Meta, Kamera (Bild, Strom, Ereignisse), Verlauf, Ersetzen.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import logging
import time
from typing import Any

from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
)

from ...core import batterie, kurzverlauf, spaeter, widgetkarten
from ...core import replace as replace_module
from ...core import throttle as throttle_module
from ...core.errors import HomePilotError, UnknownEntityError, UnsupportedCommandError
from ...core.source import as_source, user_source
from ...core.streams import (
    SEGMENT_NAME,
    StreamError,
    rewrite_playlist,
    strip_low_latency,
)
from ...core.users import Capability
from ..context import ApiContext
from ..models import (
    CommandRequest,
    ErinnerungRequest,
    MetaRequest,
    RoomRequest,
)

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require
    visible = ctx.visible

    @app.get("/api/entities/{entity_id}/events")
    async def camera_events(
        entity_id: str, request: Request, hours: int = 24
    ) -> dict[str, Any]:
        """Zeitleiste einer Kamera: Bewegungen und Klingeln der letzten Stunden.

        «Letzte Bewegung um 16:45» beantwortet nur die halbe Frage – man
        will wissen, was über den Tag los war. Kann die Integration das
        nicht, kommt eine leere Liste statt eines Fehlers.
        """
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        service = hub.integrations.get(entity.integration)
        getter = getattr(service, "events", None)
        if not callable(getter):
            return {"events": [], "supported": False}
        try:
            events = await getter(entity, hours=max(1, min(72, hours)))
        except Exception as err:
            log.debug("Ereignisse von %s nicht abrufbar: %s", entity_id, err)
            return {"events": [], "supported": True}
        return {"events": events, "supported": True}

    # ── Entitäten ──────────────────────────────────────────────────────────

    @app.get("/api/entities")
    async def list_entities(request: Request) -> list[dict[str, Any]]:
        user = current_user(request)
        return visible(user, hub.registry.all())

    # ── Verwaiste Gerätedaten (Punkt 83 der Werkbank) ─────────────────────

    @app.get("/api/entities/orphans")
    async def list_orphans(request: Request) -> dict[str, Any]:
        """Kennungen in Raum- und Meta-Zuordnung, deren Gerät es nicht mehr
        gibt, obwohl seine Integration läuft. Kein Leck, aber Ballast -
        und die Liste zeigt, was ein Aufräumen entfernen würde."""
        require(request, Capability.EDIT_CONFIG)
        known = {entity.id for entity in hub.registry.all()}
        loaded = set(hub.integrations.loaded)
        return {
            "rooms": replace_module.stale_entity_rows(
                hub.data.get("entity_rooms"), known, loaded
            ),
            "meta": replace_module.stale_entity_rows(
                hub.data.get("entity_meta"), known, loaded
            ),
        }

    @app.post("/api/entities/orphans/cleanup")
    async def cleanup_orphans(request: Request) -> dict[str, Any]:
        """Die verwaisten Einträge entfernen - bewusst nur auf Knopfdruck:
        Automatisch beim Start hiesse, die Daten einer Integration
        wegzuwerfen, die bloss heute nicht hochkam."""
        user = require(request, Capability.EDIT_CONFIG)
        known = {entity.id for entity in hub.registry.all()}
        loaded = set(hub.integrations.loaded)
        entfernt: dict[str, int] = {}
        for key in ("entity_rooms", "entity_meta"):
            rows = hub.data.get(key)
            weg = set(replace_module.stale_entity_rows(rows, known, loaded))
            if weg:
                hub.data.set(
                    key, [row for row in rows if row.get("entity_id") not in weg]
                )
                entfernt[key] = len(weg)
        if entfernt:
            log.info("%s hat verwaiste Gerätedaten entfernt: %s", user.name, entfernt)
        return {"ok": True, "removed": entfernt}

    @app.get("/api/entities/{entity_id}")
    async def get_entity(entity_id: str, request: Request) -> dict[str, Any]:
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        return entity.as_dict()

    @app.post("/api/entities/{entity_id}/command")
    async def run_command(
        entity_id: str, body: CommandRequest, request: Request
    ) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        hub.audit.record(
            user.name, entity, body.command, throttle_module.client_address(request)
        )
        daten = body.data
        if user.shared and entity.integration == "alarm":
            # Am Wandtablet ist die PIN auch über die Kachel auf der
            # Startseite Pflicht. Ohne das hier führte der Weg über den
            # Alarm-Bildschirm durch die PIN, der kurze Weg daneben
            # vorbei - und der kurze Weg ist der, den man nimmt.
            daten = {**(body.data or {}), "require_pin": True}
        try:
            with as_source(user_source(user.name)):
                entity = await hub.integrations.dispatch_command(
                    entity_id, body.command, daten
                )
        except UnknownEntityError as err:
            raise HTTPException(status_code=404, detail=str(err)) from err
        except UnsupportedCommandError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        except HomePilotError as err:
            raise HTTPException(status_code=500, detail=str(err)) from err
        return {"ok": True, "entity": entity.as_dict()}

    @app.put("/api/entities/{entity_id}/room")
    async def set_entity_room(
        entity_id: str, body: RoomRequest, request: Request
    ) -> dict[str, Any]:
        """Raumzuordnung einer Entität in der App setzen (oder mit null lösen).

        Bleibt in der homepilot-data.json erhalten und hat Vorrang vor der
        config.yaml – so ordnet man Geräte den Räumen zu, ohne die Datei
        anzufassen. EDIT_DEVICES statt EDIT_CONFIG: Das ist Einrichten der
        Ansicht, nicht der Anlage - auch Mitbewohner dürfen es."""
        user = require(request, Capability.EDIT_DEVICES)
        entity = hub.registry.get(entity_id)
        if entity is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        await hub.set_entity_room(entity_id, body.room or None)
        hub.aenderungen.merken(
            user,
            "geraet",
            f"in den Raum «{body.room}» gelegt" if body.room else "aus dem Raum genommen",
            entity.label,
        )
        return {"ok": True, "entity": hub.registry.get(entity_id).as_dict()}

    @app.put("/api/entities/{entity_id}/meta")
    async def set_entity_meta(
        entity_id: str, body: MetaRequest, request: Request
    ) -> dict[str, Any]:
        """Anzeigename, Favorit oder Gruppe einer Entität setzen.

        Für «Gerät umbenennen», die Favoriten-Reihe auf der Startseite und
        das Gruppieren mehrerer Geräte. Bleibt in der homepilot-data.json.
        EDIT_DEVICES statt EDIT_CONFIG: Ein Name, den alle täglich lesen,
        darf von allen stammen, die hier wohnen - nur Gäste nicht."""
        user = require(request, Capability.EDIT_DEVICES)
        entity = hub.registry.get(entity_id)
        if entity is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        # Nur die tatsächlich mitgeschickten Felder weitergeben: group=null
        # heisst «Keine Gruppe» (entfernen) und ist etwas anderes als ein
        # gar nicht mitgeschicktes group.
        felder = body.model_dump(exclude_unset=True)
        vorher = entity.label
        await hub.set_entity_meta(entity_id, **felder)
        # Der Name zuerst: «seit wann heisst das so?» ist die Frage, die
        # man wirklich stellt. Favorit und Gruppe stehen daneben.
        if "name" in felder and felder["name"] and felder["name"] != vorher:
            hub.aenderungen.merken(
                user, "geraet", f"umbenannt in «{felder['name']}»", vorher
            )
        elif "group" in felder:
            hub.aenderungen.merken(
                user,
                "geraet",
                f"in die Gruppe «{felder['group']}» gelegt"
                if felder["group"]
                else "aus der Gruppe genommen",
                vorher,
            )
        return {"ok": True, "entity": hub.registry.get(entity_id).as_dict()}

    @app.post("/api/entities/{entity_id}/erinnern")
    async def erinnere_an_geraet(
        entity_id: str, body: ErinnerungRequest, request: Request
    ) -> dict[str, Any]:
        """«Sag mir in zwei Stunden Bescheid» - zu diesem Gerät.

        Die Waschmaschine läuft, man geht aus dem Haus, und in zwei
        Stunden möchte man daran erinnert werden - ohne dafür einen
        Ablauf zu bauen. Die Erinnerungen der Familie können das längst,
        sie waren nur nie mit einem Gerät verbunden.

        Dieselbe Schlange wie «Später erinnern» aus der Mitteilung
        (core/spaeter.py): Der Wächter schickt sie im nächsten Takt nach
        der Frist. Nur an den, der sie gestellt hat - dass Stefan an die
        Waschmaschine erinnert werden will, geht die anderen Telefone
        nichts an.

        Der Zustand von jetzt steht im Text: Beim Lesen ist er alt, aber
        er sagt, worum es ging. «Läuft» in zwei Stunden noch einmal zu
        behaupten, wäre schlimmer.
        """
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        stand = widgetkarten.zustand_text(entity)
        hub.data.set(
            spaeter.SCHLANGE,
            spaeter.einreihen(
                hub.data.get(spaeter.SCHLANGE),
                {
                    "title": f"Nachsehen: {entity.label}",
                    "body": f"Du wolltest daran erinnert werden. Damals: {stand}.",
                    # Eine eigene Kategorie wäre ein Schalter im Profil,
                    # mit dem man seine eigenen Erinnerungen abstellt -
                    # das will niemand. «tasks» ist, was es ist.
                    "category": "tasks",
                    "to": user.name,
                    "ziel": f"geraet:{entity.id}",
                },
                time.time(),
                body.minutes,
            ),
        )
        return {
            "ok": True,
            "minutes": spaeter.minuten_pruefen(body.minutes),
        }

    # ── Batterien ──────────────────────────────────────────────────────

    @app.get("/api/batteries")
    async def battery_state(request: Request) -> dict[str, Any]:
        """Was zu den Batteriewarnungen vermerkt ist.

        Die App braucht es für zwei Zeilen in der Batterienliste: ob eine
        Warnung schon raus ist und ob sie bis morgen quittiert wurde.
        """
        current_user(request)
        jetzt = time.time()
        return {
            "batteries": [
                {
                    "entity_id": row.get("entity_id"),
                    "notified_at": row.get("at") or None,
                    "muted_until": row.get("until") or None,
                    "muted": batterie.ist_stumm(
                        [row], str(row.get("entity_id")), jetzt
                    ),
                }
                for row in hub.data.get(batterie.STORE_KEY)
                if isinstance(row, dict) and row.get("entity_id")
            ]
        }

    @app.post("/api/batteries/{entity_id}/ack")
    async def acknowledge_battery(entity_id: str, request: Request) -> dict[str, Any]:
        """«Bis morgen stumm» – die Warnung ist zur Kenntnis genommen.

        Kein Ausschalten, sondern ein Aufschub: Morgen früh erinnert der
        Hub noch einmal. Wer die Batterie bis dahin gewechselt hat, hört
        nichts mehr – wer sie liegen lässt, wird erinnert.
        """
        require(request, Capability.CONTROL)
        if hub.registry.get(entity_id) is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        jetzt = time.time()
        rows = batterie.quittiere(hub.data.get(batterie.STORE_KEY), entity_id, jetzt)
        hub.data.set(batterie.STORE_KEY, rows)
        return {
            "ok": True,
            "entity_id": entity_id,
            "muted_until": batterie.stumm_bis(jetzt),
        }

    @app.delete("/api/batteries/{entity_id}/ack")
    async def unacknowledge_battery(entity_id: str, request: Request) -> dict[str, Any]:
        """Doch nicht stumm – für den Fehlgriff.

        Nimmt die Zeile ganz weg statt nur das «bis morgen»: Damit ist die
        Warnung wieder scharf wie vor der ersten Meldung, und das ist beim
        versehentlichen Quittieren die erwartete Antwort.
        """
        require(request, Capability.CONTROL)
        rows = batterie.vergiss(hub.data.get(batterie.STORE_KEY), [entity_id])
        hub.data.set(batterie.STORE_KEY, rows)
        return {"ok": True, "entity_id": entity_id}

    @app.get("/api/entities/{entity_id}/snapshot")
    async def entity_snapshot(entity_id: str, request: Request) -> Response:
        """Aktuelles Standbild: Kamerabild (JPEG) oder Saugerkarte (PNG).

        Läuft über den Hub statt direkt zum Gerät: Die App braucht so keine
        Geräte-Zugangsdaten, und die Sichtbarkeitsregeln gelten auch hier.
        """
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        integration = hub.integrations.get(entity.integration)
        if integration is None:
            raise HTTPException(status_code=503, detail="Integration nicht geladen")
        try:
            image = await integration.snapshot(entity)
        except Exception as err:
            raise HTTPException(status_code=502, detail=f"Schnappschuss: {err}") from err
        if not image:
            raise HTTPException(
                status_code=404, detail="Diese Kamera liefert keine Schnappschüsse"
            )
        return Response(
            content=image,
            media_type="image/png" if image.startswith(b"\x89PNG") else "image/jpeg",
            headers={"Cache-Control": "no-store"},
        )

    # Bewusst /log und nicht /events: Unter /events liegt schon die
    # Kamera-Zeitleiste (Bewegungen aus der Integration) - eine zweite
    # Route mit demselben Pfad würde still verschattet.
    @app.get("/api/entities/{entity_id}/log")
    async def entity_log(entity_id: str, request: Request) -> dict[str, Any]:
        """Die letzten Schaltvorgänge dieses Geräts, mit Quelle.

        Beantwortet «warum ging das Licht um drei Uhr an?» ohne Scrollen
        durch den Gesamtverlauf. Das Protokoll lebt im Speicher des Hubs
        und beginnt nach einem Neustart leer - das sagt die App dazu.
        """
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        # Die Spanne kommt mit: Ohne sie kann die App nicht sagen, ob
        # «drei Einträge» wenig Betrieb heisst oder ein junger Hub.
        return {
            "events": hub.eventlog.for_entity(entity_id),
            "log": hub.eventlog.span(),
        }

    @app.get("/api/log")
    async def house_log(
        request: Request, hours: int = 24, limit: int = 300
    ) -> dict[str, Any]:
        """Was im Haus los war - der Rückblick über alle Geräte.

        Der Verlauf je Gerät beantwortet «warum ging *das* an?». Diese
        Frage ist eine andere: «Was war heute Nacht los?» Sie liess sich
        nur beantworten, indem man jede Kachel einzeln aufmachte.
        """
        user = current_user(request)

        def darf(entity_id: str) -> bool:
            entity = hub.registry.get(entity_id)
            if entity is None:
                # Ein Gerät, das es nicht mehr gibt: Der Eintrag bleibt
                # lesbar, denn er trägt seinen Namen selbst.
                return True
            return user.may_see(entity.id, entity.kind, entity.integration)

        ereignisse = hub.eventlog.rueckblick(hours, limit, darf)
        namen = {}
        for eintrag in ereignisse:
            kennung = str(eintrag.get("entity_id") or "")
            if kennung not in namen:
                entity = hub.registry.get(kennung)
                namen[kennung] = {
                    "name": entity.label if entity is not None else kennung,
                    "kind": str(entity.kind) if entity is not None else "",
                    "room": (entity.room if entity is not None else None),
                }
        return {"events": ereignisse, "devices": namen, "log": hub.eventlog.span()}

    async def camera_for(entity_id: str, request: Request):
        """Kamera-Entität samt Integration – oder ein sauberes 404."""
        user = current_user(request)
        entity = hub.registry.get(entity_id)
        if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        integration = hub.integrations.get(entity.integration)
        if integration is None:
            raise HTTPException(status_code=503, detail="Integration nicht geladen")
        return entity, integration

    async def deliver(target, request: Request, prefix: str) -> Response:
        """Wiedergabeliste oder Häppchen ausliefern – aus Datei oder mediamtx.

        Wiedergabelisten werden dabei umgeschrieben: Ein Videoplayer schickt
        beim Abarbeiten keine eigenen Kopfzeilen mit, das Token muss also in
        jeder Adresse stehen.
        """
        query = str(request.url.query or "")
        if target.url:
            content, media_type = await hub.streams.fetch(target, query)
        else:
            if not target.path.is_file():
                raise HTTPException(status_code=404, detail="Häppchen nicht mehr vorhanden")
            content = target.path.read_bytes()
            media_type = (
                "application/vnd.apple.mpegurl"
                if target.path.suffix == ".m3u8"
                else "video/mp2t"
            )
        if "mpegurl" in media_type or str(target.path or target.url).endswith(".m3u8"):
            text = rewrite_playlist(
                content.decode("utf-8", "replace"),
                prefix,
                request.query_params.get("token"),
            )
            # Apple-Player (AVPlayer in der App, Safari) scheitern an den
            # zitternden Part-Dauern der Protect-Kameras – sie bekommen die
            # Liste ohne Low-Latency-Teile und spielen gewöhnliches HLS.
            agent = request.headers.get("user-agent", "")
            if "AppleCoreMedia" in agent or (
                "Safari/" in agent and "Chrome" not in agent and "Android" not in agent
            ):
                text = strip_low_latency(text)
            content, media_type = text.encode(), "application/vnd.apple.mpegurl"
        return Response(
            content=content,
            media_type=media_type,
            headers={"Cache-Control": "no-store"},
        )

    @app.get("/api/entities/{entity_id}/stream.m3u8")
    async def entity_stream(entity_id: str, request: Request) -> Response:
        """Live-Bild als HLS-Wiedergabeliste.

        Der Hub holt RTSP von der Kamera und packt es für die App um – die
        Kamera-Adresse bleibt so auf dem Hub, und die App braucht nur ihr
        gewohntes Token.
        """
        entity, integration = await camera_for(entity_id, request)
        source = await integration.stream_url(entity)
        if not source:
            raise HTTPException(
                status_code=404,
                detail="Diese Kamera liefert kein Live-Bild (RTSP nicht eingeschaltet)",
            )
        try:
            target = await hub.streams.playlist(entity_id, source)
            # Die Häppchen liegen unter .../stream/ – von der Liste aus
            # gesehen also ein Verzeichnis tiefer.
            return await deliver(target, request, prefix="stream/")
        except StreamError as err:
            # Auch ins Log: Die App zeigt nur «nicht verfügbar», die
            # Ursache steht sonst nirgends.
            log.warning("Live-Bild %s: %s", entity_id, err)
            raise HTTPException(status_code=502, detail=str(err)) from err

    @app.get("/api/entities/{entity_id}/stream/{name}")
    async def entity_stream_segment(entity_id: str, name: str, request: Request) -> Response:
        """Ein Häppchen, ein Bruchstück oder eine Unterliste des Stroms."""
        await camera_for(entity_id, request)
        # Nur erzeugte Namen zulassen – sonst liesse sich über den Dateinamen
        # jede Datei des Hubs abholen.
        if not SEGMENT_NAME.fullmatch(name):
            raise HTTPException(status_code=404, detail="Unbekanntes Häppchen")
        try:
            target = await hub.streams.locate(entity_id, name)
            # Unterlisten liegen im selben Verzeichnis wie ihre Häppchen.
            return await deliver(target, request, prefix="")
        except StreamError as err:
            log.warning("Live-Bild %s (%s): %s", entity_id, name, err)
            raise HTTPException(status_code=404, detail=str(err)) from err

    @app.get("/api/trends")
    async def trends(request: Request) -> dict[str, Any]:
        """Die Funkenlinien aller Sensoren in einem Abruf.

        Ein Abruf für alle statt einer je Kachel: Auf einer Seite mit
        zehn Fühlern wären das sonst zehn Anfragen im Minutentakt. Die
        Reihen leben nur im Speicher (core/kurzverlauf.py) - nach einem
        Neustart sind sie leer und füllen sich wieder; die App zeigt
        dann schlicht noch keine Linie.
        """
        current_user(request)
        return {"trends": hub.kurzverlauf.alle(), "span": kurzverlauf.SPANNE}

    @app.get("/api/entities/{entity_id}/history")
    async def entity_history(
        entity_id: str, request: Request, hours: float = 24, limit: int = 500
    ) -> dict[str, Any]:
        """Zustandsverlauf aus Supabase.

        Die App liest den Verlauf bewusst über den Hub statt direkt aus
        Supabase – so bleibt der Datenbank-Key ausschliesslich auf dem Hub.
        """
        require(request, Capability.VIEW_HISTORY)
        if hub.registry.get(entity_id) is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Entität: {entity_id}")
        if hub.store is None:
            raise HTTPException(status_code=503, detail="Keine Datenbank konfiguriert")
        try:
            rows = await hub.store.history(entity_id, hours=hours, limit=min(limit, 2000))
        except Exception as err:
            raise HTTPException(status_code=502, detail=f"Supabase: {err}") from err
        return {"entity_id": entity_id, "history": rows}

    @app.post("/api/entities/{old_id}/replace/{new_id}")
    async def replace_entity(
        old_id: str, new_id: str, request: Request
    ) -> dict[str, Any]:
        """Alle Verweise vom alten auf das neue Gerät umhängen.

        Eine Lampe geht kaputt, die neue meldet sich unter einer anderen
        Kennung - und damit zeigen Szenen, Abläufe, Favoriten, die
        Raumzuordnung und die zusammengefassten Leuchten ins Leere. Nichts
        davon wirft einen Fehler: Der Hub überspringt stillschweigend, was
        er nicht kennt. Man merkt es Wochen später, wenn abends ein Licht
        nicht mehr angeht.

        Von Hand ist das eine halbe Stunde Suchen an sechs Stellen.
        """
        user = require(request, Capability.EDIT_CONFIG)
        if old_id == new_id:
            raise HTTPException(
                status_code=400, detail="Altes und neues Gerät sind dasselbe"
            )
        neu = hub.registry.get(new_id)
        if neu is None:
            raise HTTPException(status_code=404, detail=f"Unbekanntes Gerät: {new_id}")

        betroffen: dict[str, int] = {}

        szenen = hub.data.get("scenes")
        treffer = sum(
            replace_module.swap_in_actions(szene.get("actions") or [], old_id, new_id)
            for szene in szenen
        )
        if treffer:
            hub.data.set("scenes", szenen)
            betroffen["Szenen"] = treffer

        ablaeufe = hub.data.get("automations")
        treffer = sum(
            replace_module.swap_in_automation(ablauf, old_id, new_id)
            for ablauf in ablaeufe
        )
        if treffer:
            hub.data.set("automations", ablaeufe)
            betroffen["Abläufe"] = treffer

        for key, label in (
            ("entity_rooms", "Raumzuordnung"),
            ("entity_meta", "Name/Favorit/Gruppe"),
        ):
            rows = hub.data.get(key)
            treffer = replace_module.swap_in_rows(rows, old_id, new_id)
            if treffer:
                hub.data.set(key, rows)
                betroffen[label] = treffer

        leuchten = hub.data.get("light_groups")
        treffer = replace_module.swap_in_light_groups(leuchten, old_id, new_id)
        if treffer:
            hub.data.set("light_groups", leuchten)
            betroffen["Zusammengefasste Leuchten"] = treffer

        # Die Szenen und Abläufe im Speicher neu einlesen, sonst gilt die
        # Änderung erst nach einem Neustart - und bis dahin schaltet der
        # Hub weiter das alte, nicht mehr vorhandene Gerät.
        hub.reload_scenes()
        await hub.reload_automations()

        # Raum und Name sitzen zusätzlich an der Entität selbst - die
        # umgeschriebene Zeile allein wirkt erst nach einem Neustart.
        for row in hub.data.get("entity_rooms"):
            if row.get("entity_id") == new_id:
                try:
                    await hub.registry.set_room(new_id, row.get("room"))
                except UnknownEntityError:
                    pass
        for row in hub.data.get("entity_meta"):
            if row.get("entity_id") == new_id:
                try:
                    await hub.registry.set_meta(new_id, row)
                except UnknownEntityError:
                    pass

        # Zusammengefasste Leuchten neu aufbauen, damit die neue Lampe
        # sofort mitschaltet.
        gruppe = hub.integrations.get("group")
        if gruppe is not None and "Zusammengefasste Leuchten" in betroffen:
            await gruppe.rebuild()

        log.warning(
            "%s hat %s durch %s ersetzt (%s)",
            user.name,
            old_id,
            new_id,
            betroffen or "keine Verweise",
        )
        return {"ok": True, "changed": betroffen}


