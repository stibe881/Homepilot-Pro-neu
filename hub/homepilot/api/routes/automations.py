"""Szenen und Abläufe – samt Papierkorb und früheren Fassungen.

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
)

from ...core import automation as automation_module
from ...core import babysitter as babysitter_module
from ...core import editversions as editversions_module
from ...core import konflikte as konflikte_module
from ...core import trash as trash_module
from ...core.users import Capability, Role
from ..context import ApiContext
from ..models import (
    AutomationRequest,
    BabysitterAllowRequest,
    BabysitterRequest,
    ConflictAckRequest,
    PauseRequest,
    ProbeStepRequest,
    RestoreVersionRequest,
    SceneRequest,
    SnoozeRequest,
)

log = logging.getLogger(__name__)

def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require
    _user_name = ctx.user_name

    @app.get("/api/automations/conflicts")
    async def automation_conflicts(request: Request) -> dict[str, Any]:
        """Abläufe, die dasselbe Gerät gegensätzlich schalten.

        Kein Fehler – manchmal ist genau das gewollt. Aber wenn nachts das
        Licht von selbst angeht, sucht man diese Liste.

        Geprüfte Zeilen lassen sich quittieren; sie stehen dann nur noch
        unter `acknowledged`. Sonst verdecken acht gewollte Widersprüche
        den einen, der es nicht ist.
        """
        require(request, Capability.EDIT_AUTOMATIONS)
        alle = automation_module.find_conflicts(hub.automations.automations)
        # Quittungen zu Widersprüchen, die es nicht mehr gibt, fliegen
        # beim Nachsehen raus - ohne eigene Aufräumrunde.
        uebrig = konflikte_module.aufraeumen(hub.data.get(konflikte_module.KEY), alle)
        if uebrig is not None:
            hub.data.set(konflikte_module.KEY, uebrig)
        offen, erledigt = konflikte_module.teilen(
            alle, hub.data.get(konflikte_module.KEY)
        )
        return {"conflicts": offen, "acknowledged": erledigt}

    @app.post("/api/automations/conflicts/ack")
    async def acknowledge_conflict(
        body: ConflictAckRequest, request: Request
    ) -> dict[str, Any]:
        """Eine Zeile abhaken - oder die Quittung wieder zurücknehmen.

        Die Quittung gilt fürs Haus, nicht für die Person: Wer prüft,
        prüft für alle. Wer sie zurücknimmt, holt die Zeile für alle
        zurück.
        """
        user = require(request, Capability.EDIT_AUTOMATIONS)
        roh = hub.data.get(konflikte_module.KEY)
        if body.on:
            neu = konflikte_module.quittieren(roh, body.key, user.name, time.time())
        else:
            neu = konflikte_module.zuruecknehmen(roh, body.key)
        hub.data.set(konflikte_module.KEY, neu)
        alle = automation_module.find_conflicts(hub.automations.automations)
        offen, erledigt = konflikte_module.teilen(alle, neu)
        return {"ok": True, "conflicts": offen, "acknowledged": erledigt}

    @app.get("/api/automations/agenda")
    async def automation_agenda(request: Request) -> dict[str, Any]:
        """Was das Haus heute vorhat (Punkt 163) - das Tagesband der App."""
        require(request, Capability.VIEW_AUTOMATIONS)
        return {"agenda": hub.automations.tagesplan()}

    @app.get("/api/automations/{automation_id}/diagnose")
    async def automation_diagnose(automation_id: str, request: Request) -> dict[str, Any]:
        """Warum schweigt dieser Ablauf?

        Der Lauf-Verlauf sagt, was gelaufen ist – nicht, ob der Auslöser
        überhaupt ankam. Genau das ist aber der häufigere Fall: ein Melder
        mit leerer Batterie, ein falscher Kanal, ein Zustand, den das Gerät
        nie meldet. Hier steht je Auslöser, wann er zuletzt gefeuert hat
        und wann sich sein Gerät zuletzt überhaupt gemeldet hat.
        """
        require(request, Capability.VIEW_AUTOMATIONS)
        bericht = hub.automations.diagnose(automation_id)
        if bericht is None:
            raise HTTPException(status_code=404, detail="Ablauf nicht gefunden")
        return bericht

    @app.get("/api/automations/{automation_id}/runs")
    async def automation_runs(automation_id: str, request: Request) -> dict[str, Any]:
        """Der Verlauf genau dieses Ablaufs – was er tat und was nicht."""
        require(request, Capability.EDIT_AUTOMATIONS)
        return {
            "runs": [
                run
                for run in hub.automations.runs
                if run.get("automation_id") == automation_id
            ][:50]
        }

    # ── Papierkorb ─────────────────────────────────────────────────────────

    @app.get("/api/trash")
    async def list_trash(request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        rows = trash_module.purge(hub.data.get("trash"))
        hub.data.set("trash", rows)
        return {
            "trash": [
                {k: v for k, v in row.items() if k != "item"} | {"id": (row.get("item") or {}).get("id")}
                for row in rows
            ],
            "keep_days": trash_module.KEEP_DAYS,
        }

    @app.post("/api/trash/{kind}/{item_id}/restore")
    async def restore_from_trash(kind: str, item_id: str, request: Request) -> dict[str, Any]:
        """Gelöschtes zurückholen – es landet wieder dort, wo es herkam."""
        require(request, Capability.EDIT_AUTOMATIONS)
        if kind not in ("scene", "automation"):
            raise HTTPException(status_code=400, detail="Unbekannte Art")
        row, rest = trash_module.take(hub.data.get("trash"), kind, item_id)
        if row is None:
            raise HTTPException(status_code=404, detail="Nicht (mehr) im Papierkorb")
        key = "scenes" if kind == "scene" else "automations"
        existing = hub.data.get(key)
        if any(entry.get("id") == item_id for entry in existing):
            raise HTTPException(status_code=409, detail="Gibt es schon wieder")
        hub.data.set(key, [*existing, row["item"]])
        hub.data.set("trash", rest)
        if kind == "scene":
            hub.reload_scenes()
        else:
            await hub.reload_automations()
        return {"ok": True, "restored": row["name"]}

    @app.delete("/api/trash")
    async def empty_trash(request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        hub.data.set("trash", [])
        return {"ok": True}

    # ── Frühere Fassungen (das Gegenstück zum Papierkorb fürs Überschreiben) ──

    @app.get("/api/edit-history/{kind}/{item_id}")
    async def list_edit_versions(
        kind: str, item_id: str, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        if kind not in ("scene", "automation"):
            raise HTTPException(status_code=400, detail="Unbekannte Art")
        rows = editversions_module.versions_of(
            hub.data.get("edit_versions"), kind, item_id
        )
        # Ohne den vollen Inhalt: Die App braucht Zeitpunkt und Urheber,
        # zurückgeholt wird über den Zeitstempel.
        return {
            "versions": [
                {k: v for k, v in row.items() if k != "item"} for row in rows
            ]
        }

    @app.post("/api/edit-history/{kind}/{item_id}/restore")
    async def restore_edit_version(
        kind: str, item_id: str, body: RestoreVersionRequest, request: Request
    ) -> dict[str, Any]:
        """Eine frühere Fassung zurückholen.

        Der jetzige Stand wird dabei selbst zur Fassung - Zurückholen ist
        damit ebenso wenig endgültig wie das Speichern davor.
        """
        require(request, Capability.EDIT_AUTOMATIONS)
        if kind not in ("scene", "automation"):
            raise HTTPException(status_code=400, detail="Unbekannte Art")
        rows = hub.data.get("edit_versions")
        row = editversions_module.find(rows, kind, item_id, body.at)
        if row is None:
            raise HTTPException(status_code=404, detail="Fassung nicht (mehr) da")
        key = "scenes" if kind == "scene" else "automations"
        stored = hub.data.get(key)
        current = next((entry for entry in stored if entry.get("id") == item_id), None)
        if current is None:
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Einträge haben Fassungen",
            )
        hub.data.set(
            "edit_versions",
            editversions_module.remember(rows, kind, current, _user_name(request)),
        )
        hub.data.set(
            key,
            [row["item"] if entry.get("id") == item_id else entry for entry in stored],
        )
        if kind == "scene":
            hub.reload_scenes()
        else:
            await hub.reload_automations()
        return {"ok": True, "restored": row["name"]}

    # ── Szenen ─────────────────────────────────────────────────────────────

    @app.get("/api/scenes")
    async def list_scenes(request: Request) -> list[dict[str, Any]]:
        user = current_user(request)
        scenes = [scene.as_dict() for scene in hub.scenes.scenes]
        if user.role != Role.GUEST:
            return scenes
        # Ein Gast sieht nur Szenen, die ausschliesslich freigegebene Geräte
        # anfassen – sonst schaltete er über Umwege doch das ganze Haus.
        allowed = []
        for scene in scenes:
            entities = [hub.registry.get(eid) for eid in scene["entity_ids"]]
            if all(
                entity is not None and user.may_see(entity.id, entity.kind, entity.integration)
                for entity in entities
            ):
                allowed.append(scene)
        return allowed

    @app.post("/api/scenes/{scene_id}/activate")
    async def activate_scene(scene_id: str, request: Request) -> dict[str, Any]:
        user = require(request, Capability.CONTROL)
        scene = hub.scenes.get(scene_id)
        if scene is None:
            raise HTTPException(status_code=404, detail=f"Unbekannte Szene: {scene_id}")
        if user.role == Role.GUEST:
            for entity_id in (action.get("entity_id") for action in scene.actions):
                entity = hub.registry.get(entity_id or "")
                if entity is None or not user.may_see(entity.id, entity.kind, entity.integration):
                    raise HTTPException(status_code=403, detail="Szene nicht freigegeben")
        return await hub.scenes.activate(scene_id)

    def stored_scenes() -> list[dict[str, Any]]:
        return hub.data.get("scenes")

    def validate_scene_actions(actions: list[dict[str, Any]]) -> None:
        if not actions:
            raise HTTPException(status_code=400, detail="Eine Szene braucht Aktionen")
        for action in actions:
            if not action.get("entity_id") or not action.get("command"):
                raise HTTPException(
                    status_code=400,
                    detail="Jede Aktion braucht 'entity_id' und 'command'",
                )

    @app.post("/api/scenes")
    async def create_scene(body: SceneRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        validate_scene_actions(body.actions)
        import secrets as _secrets

        entry = {
            "id": f"app_{_secrets.token_hex(4)}",
            "name": body.name,
            "icon": body.icon,
            "actions": body.actions,
            "room": body.room,
            "on_start": body.on_start,
            "transition": body.transition,
            "category": body.category,
        }
        hub.data.set("scenes", [*stored_scenes(), entry])
        hub.reload_scenes()
        return {"scene": entry}

    @app.put("/api/scenes/{scene_id}")
    async def update_scene(
        scene_id: str, body: SceneRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        validate_scene_actions(body.actions)
        stored = stored_scenes()
        if not any(entry["id"] == scene_id for entry in stored):
            # Aus der config.yaml stammende gehören der Datei, nicht der App.
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Szenen lassen sich hier ändern",
            )
        # Die bisherige Fassung aufheben - Überschreiben soll so wenig
        # endgültig sein wie Löschen (dafür gibt es den Papierkorb).
        bisher = next(entry for entry in stored if entry["id"] == scene_id)
        hub.data.set(
            "edit_versions",
            editversions_module.remember(
                hub.data.get("edit_versions"), "scene", bisher, _user_name(request)
            ),
        )
        updated = [
            {
                "id": scene_id,
                "name": body.name,
                "icon": body.icon,
                "actions": body.actions,
                "room": body.room,
                "on_start": body.on_start,
                "transition": body.transition,
                "category": body.category,
            }
            if entry["id"] == scene_id
            else entry
            for entry in stored
        ]
        hub.data.set("scenes", updated)
        hub.reload_scenes()
        return {"ok": True}

    @app.delete("/api/scenes/{scene_id}")
    async def delete_scene(scene_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        stored = stored_scenes()
        remaining = [entry for entry in stored if entry["id"] != scene_id]
        if len(remaining) == len(stored):
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Szenen lassen sich hier löschen",
            )
        gone = next(entry for entry in stored if entry["id"] == scene_id)
        hub.data.set("scenes", remaining)
        hub.data.set(
            "trash",
            trash_module.put(hub.data.get("trash"), "scene", gone, _user_name(request)),
        )
        hub.reload_scenes()
        return {"ok": True}

    # ── Automationen ───────────────────────────────────────────────────────

    @app.get("/api/automations")
    async def list_automations(request: Request) -> dict[str, Any]:
        require(request, Capability.VIEW_AUTOMATIONS)
        return {
            "automations": [
                # next_run (Punkt 161): «heute 21:12» in der Liste statt
                # Kopfrechnen über Sonnenuntergang plus Versatz.
                automation.as_dict()
                | {"next_run": hub.automations.next_run(automation)}
                for automation in hub.automations.automations
            ],
            "paused_until": (
                hub.automations.paused_until.isoformat()
                if hub.automations.paused_until
                else None
            ),
            "babysitter": babysitter_module.summary(
                hub.data.get(babysitter_module.KEY),
                [automation.id for automation in hub.automations.automations],
            ),
        }

    @app.post("/api/automations/babysitter")
    async def set_babysitter(body: BabysitterRequest, request: Request) -> dict[str, Any]:
        """Den Babysitter-Modus ein- oder ausschalten.

        Dieselbe Berechtigung wie das Pausieren: Es ist derselbe Eingriff -
        Abläufe ruhen zu lassen -, nur gezielter.
        """
        require(request, Capability.PAUSE_AUTOMATIONS)
        stand = babysitter_module.set_active(
            hub.data.get(babysitter_module.KEY), body.active, now=time.time()
        )
        hub.data.set(babysitter_module.KEY, babysitter_module.store(stand))
        log.info("Babysitter-Modus %s", "an" if body.active else "aus")
        return {
            "babysitter": babysitter_module.summary(
                stand, [automation.id for automation in hub.automations.automations]
            )
        }

    @app.put("/api/automations/{automation_id}/babysitter")
    async def allow_babysitter(
        automation_id: str, body: BabysitterAllowRequest, request: Request
    ) -> dict[str, Any]:
        """Einen Ablauf für den Modus frei- oder zurückgeben.

        Bewusst unabhängig davon, wo der Ablauf herkommt: Auch einer aus
        der config.yaml lässt sich anhaken, ohne die Datei anzufassen.
        Die Liste liegt darum neben den Abläufen, nicht in ihnen.
        """
        require(request, Capability.PAUSE_AUTOMATIONS)
        if not any(a.id == automation_id for a in hub.automations.automations):
            raise HTTPException(status_code=404, detail="Unbekannter Ablauf")
        stand = babysitter_module.toggle(
            hub.data.get(babysitter_module.KEY), automation_id, body.allow
        )
        hub.data.set(babysitter_module.KEY, babysitter_module.store(stand))
        return {
            "babysitter": babysitter_module.summary(
                stand, [automation.id for automation in hub.automations.automations]
            )
        }

    @app.post("/api/automations/pause")
    async def pause_automations(body: PauseRequest, request: Request) -> dict[str, Any]:
        require(request, Capability.PAUSE_AUTOMATIONS)
        until = hub.automations.pause(body.seconds)
        return {"paused_until": until.isoformat() if until else None}

    def stored_automations() -> list[dict[str, Any]]:
        return hub.data.get("automations")

    @app.post("/api/automations")
    async def create_automation(
        body: AutomationRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        import secrets as _secrets

        entry = {
            "id": f"app_{_secrets.token_hex(4)}",
            "alias": body.alias,
            "trigger": body.trigger,
            "condition": body.condition,
            "action": body.action,
            "otherwise": body.otherwise,
            "enabled": body.enabled,
            "mode": body.mode,
            "match": body.match,
            "category": body.category,
            "quiet_until": body.quiet_until,
            "cooldown": body.cooldown,
        }
        hub.data.set("automations", [*stored_automations(), entry])
        await hub.reload_automations()
        return {"automation": entry}

    @app.put("/api/automations/{automation_id}")
    async def update_automation(
        automation_id: str, body: AutomationRequest, request: Request
    ) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        stored = stored_automations()
        if not any(entry["id"] == automation_id for entry in stored):
            # Aus der config.yaml stammende gehören der Datei, nicht der App.
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Abläufe lassen sich hier ändern",
            )
        # Wie bei den Szenen: die bisherige Fassung aufheben.
        bisher = next(entry for entry in stored if entry["id"] == automation_id)
        hub.data.set(
            "edit_versions",
            editversions_module.remember(
                hub.data.get("edit_versions"), "automation", bisher, _user_name(request)
            ),
        )
        updated = [
            {
                "id": automation_id,
                "alias": body.alias,
                "trigger": body.trigger,
                "condition": body.condition,
                "action": body.action,
                "otherwise": body.otherwise,
                "enabled": body.enabled,
                "mode": body.mode,
                "match": body.match,
                "category": body.category,
                "quiet_until": body.quiet_until,
                "cooldown": body.cooldown,
            }
            if entry["id"] == automation_id
            else entry
            for entry in stored
        ]
        hub.data.set("automations", updated)
        await hub.reload_automations()
        return {"ok": True}

    @app.post("/api/automations/{automation_id}/snooze")
    async def snooze_automation(
        automation_id: str, body: SnoozeRequest, request: Request
    ) -> dict[str, Any]:
        """«Aus bis morgen» statt nur aus (Punkt 159 der Werkbank).

        Heute Abend soll das Bewegungslicht schweigen (Gäste schlafen im
        Flur) - also schaltet man den Ablauf aus. Und vergisst ihn wieder
        einzuschalten. Mit einer Frist meldet er sich von selbst zurück;
        ``until: null`` weckt ihn sofort.
        """
        require(request, Capability.EDIT_AUTOMATIONS)
        stored = stored_automations()
        if not any(entry["id"] == automation_id for entry in stored):
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Abläufe lassen sich hier ändern",
            )
        until = automation_module.parse_quiet_until(body.until)
        updated = [
            {**entry, "quiet_until": until} if entry["id"] == automation_id else entry
            for entry in stored
        ]
        hub.data.set("automations", updated)
        await hub.reload_automations()
        return {"ok": True, "quiet_until": until}

    @app.post("/api/automations/probestep")
    async def probe_step(body: ProbeStepRequest, request: Request) -> dict[str, Any]:
        """Einen einzelnen Schritt ausführen, nicht den ganzen Ablauf (164).

        Der Probelauf zählt auf, der Testlauf führt alles aus - hier
        liegt das Dazwischen: die eine Durchsage, die eine Nachricht,
        bevor man den Ablauf speichert.
        """
        require(request, Capability.EDIT_AUTOMATIONS)
        try:
            await hub.automations.probe_action(body.action)
        except ValueError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        except Exception as err:
            raise HTTPException(
                status_code=502, detail=f"Schritt fehlgeschlagen: {err}"
            ) from err
        return {"ok": True}

    @app.delete("/api/automations/{automation_id}")
    async def delete_automation(automation_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        stored = stored_automations()
        remaining = [entry for entry in stored if entry["id"] != automation_id]
        if len(remaining) == len(stored):
            raise HTTPException(
                status_code=404,
                detail="Nur in der App angelegte Abläufe lassen sich hier löschen",
            )
        gone = next(entry for entry in stored if entry["id"] == automation_id)
        hub.data.set("automations", remaining)
        hub.data.set(
            "trash",
            trash_module.put(
                hub.data.get("trash"), "automation", gone, _user_name(request)
            ),
        )
        await hub.reload_automations()
        return {"ok": True}

    @app.get("/api/automations/runs")
    async def automation_runs_all(request: Request) -> dict[str, Any]:
        """Was die Abläufe zuletzt getan haben – und was nicht, mit Grund.

        Der häufigste Support-Fall lautet «der Ablauf geht nicht». Ohne
        diese Liste bleibt nur Raten, ob der Auslöser ausblieb oder eine
        Bedingung im Weg war.
        """
        require(request, Capability.VIEW_AUTOMATIONS)
        return {"runs": hub.automations.runs}

    @app.post("/api/automations/{automation_id}/duplicate")
    async def duplicate_automation(automation_id: str, request: Request) -> dict[str, Any]:
        """Kopie anlegen – sechs fast gleiche Taster-Abläufe tippt niemand."""
        require(request, Capability.EDIT_AUTOMATIONS)
        import secrets as _secrets

        source = next(
            (entry for entry in stored_automations() if entry["id"] == automation_id),
            None,
        )
        if source is None:
            # Aus der config.yaml. Der lief bisher ins Leere («nur in der
            # App angelegte lassen sich kopieren») – und damit gab es
            # keinen Weg von der Datei zur Bedienbarkeit. Eine Kopie ist
            # genau dieser Weg: Das Original in der Datei bleibt, wie es
            # ist, die Kopie liegt in der App und ist änderbar.
            laufend = hub.automations.get(automation_id)
            if laufend is None:
                raise HTTPException(status_code=404, detail="Ablauf nicht gefunden")
            source = laufend.as_config()
            # Aus der Datei kopiert und dann in der App bearbeitet: Wer
            # den ursprünglichen nicht abschaltet, hat ihn zweimal. Die
            # Kopie kommt deshalb ausgeschaltet – ein Ablauf, der beim
            # Kopieren losgeht, ist eine Überraschung.
            source = {**source, "enabled": False}
        copy = {
            **source,
            "id": f"app_{_secrets.token_hex(4)}",
            "alias": f"{source.get('alias', 'Ablauf')} (Kopie)",
        }
        copy.pop("editable", None)
        hub.data.set("automations", [*stored_automations(), copy])
        await hub.reload_automations()
        return {"automation": copy}

    @app.post("/api/automations/{automation_id}/trigger")
    async def trigger_automation(automation_id: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_AUTOMATIONS)
        ok = await hub.automations.trigger_now(automation_id)
        if not ok:
            raise HTTPException(status_code=404, detail="Ablauf nicht gefunden")
        return {"ok": True}

    @app.get("/api/automations/{automation_id}/dryrun")
    async def dry_run_automation(automation_id: str, request: Request) -> dict[str, Any]:
        """Zeigt, was der Ablauf jetzt täte – ohne es zu tun.

        Der Testlauf über /trigger führt wirklich aus. Das schreckt bei
        allem ab, was die Storen bewegt oder die Familie anpiepst, und
        gerade dort will man vorher wissen, ob die Bedingungen passen.
        """
        require(request, Capability.VIEW_AUTOMATIONS)
        found = next(
            (item for item in hub.automations.automations if item.id == automation_id),
            None,
        )
        if found is None:
            raise HTTPException(status_code=404, detail="Ablauf nicht gefunden")
        return hub.automations.dry_run(found)

    @app.get("/api/hue/scenes")
    async def hue_scenes(request: Request) -> dict[str, Any]:
        """Die auf der Hue-Bridge gespeicherten Szenen.

        Sie gehören der Bridge: Farben und Helligkeiten stecken dort, und
        nur sie kann eine Szene in einem Zug setzen. Der Hub ruft sie auf,
        baut sie aber nicht nach.
        """
        require(request, Capability.VIEW_AUTOMATIONS)
        hue = hub.integrations.get("hue")
        if hue is None or not hasattr(hue, "scenes"):
            return {"scenes": [], "reason": "keine Hue-Bridge verbunden"}
        return {"scenes": hue.scenes()}

