"""System und Konfiguration: config.yaml, Update, Sicherungen, Protokolle, Energie.

Herausgelöst aus server.py (Punkt 16 der Werkbank): eine Datei je
Sachgebiet statt 3800 Zeilen am Stück. Die Routen selbst sind unverändert
- register() bekommt app und den geteilten Kontext (ctx) und hängt sie an.
"""

from __future__ import annotations

import json
import logging
import os
import threading
from datetime import datetime, timedelta
from pathlib import Path
from typing import Any

import aiohttp
from fastapi import (
    FastAPI,
    HTTPException,
    Request,
    Response,
)

from ...core import (
    config_edit,
    confighistory,
    extras,
    watchdog,
)
from ...core import energy as energy_module
from ...core import hausblatt as hausblatt_module
from ...core.config import ConfigError, load_config
from ...core.errors import HomePilotError
from ...core.users import Capability, parse_users
from .. import configio
from ..context import ApiContext
from ..models import ConfigEditRequest, ConfigRequest, UpdateTriggerRequest

log = logging.getLogger(__name__)

# Was in der App steht, wenn der Update-Dienst auf dem Server den
# iOS-Schalter nicht kennt. Ein nacktes «404 Nicht gefunden» schickte die
# Suche in die falsche Richtung; und weil der übliche Rat (einmal neu
# starten) nicht immer greift, steht hier auch, wie man nachsieht, was
# wirklich auf dem Port horcht - ein von Hand gestarteter Prozess von
# früher belegt ihn sonst weiter, und der Neustart des Dienstes ändert
# nichts.
STALE_LISTENER_HINT = (
    "Der Update-Dienst auf dem Server ist noch eine ältere Fassung, die den "
    "iOS-Schalter nicht kennt. «Nur Hub» funktioniert davon unberührt.\n"
    "1. Auf dem Server: sudo systemctl restart homepilot-update\n"
    "2. Ändert das nichts, horcht dort vermutlich noch ein alter Prozess "
    "von Hand. Nachsehen mit: sudo ss -lptn 'sport = :9126' - läuft dort "
    "etwas ausserhalb von homepilot-update, dieses beenden und den Dienst "
    "erneut starten.\n"
    "3. Was der Dienst kann, sagt er selbst: curl -s http://127.0.0.1:9126/"
)

# Der zweite stille Weg, auf dem ein iOS-Build ausbleibt: Gebaut wird auf
# den EAS-Servern, und dafür braucht der Docker-Host einen Zugangs-Token.
# Fehlt er, baut das Skript den Hub fertig und überspringt den iOS-Teil -
# das Update meldet «fertig», und in TestFlight kommt nie etwas an.
MISSING_EXPO_TOKEN_HINT = (
    "Auf dem Server fehlt der Zugang zu EAS - ohne ihn lässt sich kein "
    "iOS-Build anstossen. Der Hub selbst liesse sich mit «Nur Hub» "
    "aktualisieren.\n"
    "1. Token erzeugen auf expo.dev → Account settings → Access tokens.\n"
    "2. Auf dem Server eintragen: echo 'EXPO_TOKEN=…' | sudo tee -a "
    "/opt/homepilot/github-credentials.env\n"
    "3. Danach: sudo systemctl restart homepilot-update"
)


async def listener_status(
    status_url: str, headers: dict[str, str]
) -> dict[str, Any] | None:
    """Was der Update-Dienst auf dem Host über sich sagt – oder None.

    None heisst ausdrücklich «unbekannt», nicht «kann nichts»: Ältere
    Fassungen kennen die Auskunft noch nicht, und ein Portainer-Webhook
    hat gar kein /status. In beiden Fällen wird wie bisher losgeschickt
    und erst die Antwort ausgewertet – hier etwas zu blockieren, würde
    ein funktionierendes Update verhindern, um einen Hinweis zu geben.
    """
    try:
        timeout = aiohttp.ClientTimeout(total=5)
        async with aiohttp.ClientSession(timeout=timeout) as session:
            async with session.get(status_url, headers=headers) as response:
                if response.status != 200:
                    return None
                data = await response.json(content_type=None)
    except Exception:
        return None
    return data if isinstance(data, dict) else None


# Wie ein Kommando im Namen eines Kurzbefehls heisst – «Licht turn_on» wäre
# als Siri-Satz unbrauchbar.
COMMAND_WORDS = {
    "turn_on": "an",
    "turn_off": "aus",
    "open": "auf",
    "close": "zu",
}


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require
    _user_name = ctx.user_name
    token_from = ctx.token_from

    # ── Konfiguration aus der App bearbeiten ──────────────────────────────

    def _user_name(request: Request) -> str:
        """Wer gerade handelt – für Papierkorb und Protokoll."""
        try:
            return current_user(request).name
        except HTTPException:
            return "?"

    def config_path() -> str:
        return configio.config_path(hub)

    @app.get("/api/config")
    async def get_config(request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        path = config_path()
        try:
            content = Path(path).read_text(encoding="utf-8")
        except OSError as err:
            raise HTTPException(status_code=500, detail=f"Konfiguration nicht lesbar: {err}") from err
        return {"path": path, "content": content}

    @app.put("/api/config")
    async def put_config(body: ConfigRequest, request: Request) -> dict[str, Any]:
        """Konfiguration validiert speichern.

        Erst in eine Temporärdatei schreiben und komplett parsen – eine
        kaputte config.yaml darf nie auf der Platte landen, sonst kommt der
        Hub nach dem nächsten Neustart nicht mehr hoch.
        """
        require(request, Capability.EDIT_CONFIG)
        return save_config(body.content)

    def save_config(content: str) -> dict[str, Any]:
        return configio.save_config(hub, content)

    @app.get("/api/config/outline")
    async def config_outline(request: Request) -> dict[str, Any]:
        """Die Konfiguration als Gliederung – für die Bedienoberfläche.

        Zeilenbereiche statt eines geparsten Baums: Wer einen Block
        zurückschreibt, schreibt genau das zurück, was er gesehen hat -
        samt Kommentaren und Reihenfolge. Dazu die gelesenen Werte, damit
        die App etwas anzeigen kann, ohne selbst YAML zu können.
        """
        require(request, Capability.EDIT_CONFIG)
        path = config_path()
        try:
            content = Path(path).read_text(encoding="utf-8")
        except OSError as err:
            raise HTTPException(
                status_code=500, detail=f"Konfiguration nicht lesbar: {err}"
            ) from err
        return _outline_antwort(content)

    @app.post("/api/config/edit")
    async def config_edit_route(body: ConfigEditRequest, request: Request) -> dict[str, Any]:
        """Eine gezielte Änderung rechnen – ohne zu speichern.

        Bewusst getrennt: Gespeichert wird über PUT /api/config, mit
        derselben Prüfung, demselben Verlauf und demselben Neustart wie
        eine von Hand getippte Änderung. Die Bedienoberfläche ist nur ein
        anderer Weg, den Text zu erzeugen - kein zweiter Weg auf die
        Platte.
        """
        require(request, Capability.EDIT_CONFIG)
        if body.path:
            wert = None if body.remove else body.value
            neu = config_edit.set_scalar(body.content, list(body.path), wert)
        elif body.start is not None and body.end is not None:
            if body.enabled is not None:
                neu = config_edit.toggle_block(
                    body.content, body.start, body.end, body.enabled
                )
            else:
                neu = config_edit.replace_block(
                    body.content, body.start, body.end, body.text or ""
                )
        elif body.start is None and body.end is None and body.text is None:
            # Nichts zu ändern: Dann ist die Frage «wie sieht dieser Text
            # gegliedert aus». Die App braucht das nach jedem Tippen im
            # Textmodus - sonst zeigen die Zeilennummern der Übersicht
            # auf Stellen, die es nicht mehr gibt.
            neu = body.content
        else:
            raise HTTPException(
                status_code=400,
                detail="Ein Block braucht 'start' und 'end' – halb geht nicht",
            )
        return _outline_antwort(neu)

    def _outline_antwort(content: str) -> dict[str, Any]:
        """Text, Gliederung und gelesene Werte – immer zusammen.

        Getrennt wären sie eine Fehlerquelle: Die Gliederung nennt
        Zeilennummern, und die stimmen nur für genau diesen Text. Wer
        beides einzeln holt, zeigt irgendwann auf eine Zeile, die
        inzwischen woanders steht.
        """
        import yaml

        try:
            daten = yaml.safe_load(content) or {}
        except yaml.YAMLError as err:
            # Kaputtes YAML ist kein Grund, gar nichts zu zeigen: Die
            # Gliederung entsteht aus dem Text und steht auch dann.
            return {
                "content": content,
                "sections": config_edit.outline(content),
                "data": {},
                "error": str(err),
            }
        return {
            "content": content,
            "sections": config_edit.outline(content),
            "data": daten if isinstance(daten, dict) else {},
        }

    @app.post("/api/config/check")
    async def check_config(body: ConfigRequest, request: Request) -> dict[str, Any]:
        """Prüfen, ohne zu speichern.

        Damit man den Fehler sieht, bevor man ihn auf die Platte schreibt –
        und die Warnungen, bevor sie im Log versauern.
        """
        require(request, Capability.EDIT_CONFIG)
        temp = Path(config_path()).with_suffix(".check")
        try:
            temp.write_text(body.content, encoding="utf-8")
            candidate = load_config(temp)
            parse_users(candidate.users, candidate.api.token)
        except ConfigError as err:
            return {"ok": False, "error": str(err), "warnings": []}
        except OSError as err:
            raise HTTPException(
                status_code=500, detail=f"Prüfen fehlgeschlagen: {err}"
            ) from err
        finally:
            temp.unlink(missing_ok=True)

        known = {entity.id for entity in hub.registry.all()}
        return {
            "ok": True,
            "error": None,
            "warnings": [
                *config_edit.duplicate_devices(candidate.integrations),
                *config_edit.unused_rooms(candidate.rooms, known),
            ],
        }

    @app.post("/api/system/restart")
    async def restart(request: Request) -> dict[str, Any]:
        """Hub-Prozess beenden – Docker (restart: unless-stopped) oder
        systemd starten ihn sofort neu, mit frisch gelesener Konfiguration."""
        user = require(request, Capability.EDIT_CONFIG)
        log.warning("Neustart angefordert von %s", user.name)
        # Kurz warten, damit die Antwort das Gerät noch erreicht.
        # Über das server-Modul und zum Aufrufzeitpunkt aufgelöst: Tests
        # ersetzen dort _exit_for_restart, und das muss auch hier greifen.
        from .. import server as server_module

        threading.Timer(0.8, server_module._exit_for_restart).start()
        return {"ok": True}

    @app.get("/api/shortcuts")
    async def shortcuts(request: Request) -> dict[str, Any]:
        """Fertige Bausteine für Apple Kurzbefehle.

        Die Anleitung in docs/siri-und-widgets.md erklärt, wie man einen
        Kurzbefehl von Hand zusammensetzt – und genau das ist die Hürde:
        URL, Methode, zwei Header und ein JSON-Rumpf, für jede Szene aufs
        Neue. Hier kommt alles fertig heraus, samt Token des Anfragenden.

        Bewusst mit *seinem* Token: Wer den Kurzbefehl baut, soll ihn mit
        den eigenen Rechten bauen. Ein Gast bekommt so auch nur die Geräte,
        die er ohnehin sehen darf.
        """
        user = current_user(request)
        token = token_from(request) or ""
        base = str(request.base_url).rstrip("/")

        items: list[dict[str, Any]] = [
            {
                "kind": "scene",
                "name": scene.name,
                "url": f"{base}/api/scenes/{scene.id}/activate",
                "method": "POST",
                "headers": {"Authorization": f"Bearer {token}"},
                "body": None,
            }
            for scene in hub.scenes.scenes
        ]
        for entity in hub.registry.all():
            if not user.may_see(entity.id, entity.kind, entity.integration):
                continue
            for command in ("turn_on", "turn_off", "open", "close"):
                if command not in entity.commands:
                    continue
                items.append(
                    {
                        "kind": "device",
                        "name": f"{entity.label} {COMMAND_WORDS.get(command, command)}",
                        "url": f"{base}/api/entities/{entity.id}/command",
                        "method": "POST",
                        "headers": {
                            "Authorization": f"Bearer {token}",
                            "Content-Type": "application/json",
                        },
                        "body": {"command": command},
                    }
                )
        return {"shortcuts": items}

    @app.post("/api/system/update")
    async def trigger_update(
        request: Request, body: UpdateTriggerRequest | None = None
    ) -> dict[str, Any]:
        """Stösst die eingerichtete Update-Adresse an.

        Was der Hub *nicht* kann: sich selbst neu bauen. Er läuft in einem
        Container und hat weder das Repository noch Docker zur Hand – das
        wäre auch kein Zugriff, den ein Hausautomations-Dienst haben sollte.

        Was er kann: eine Adresse aufrufen, die das auf dem Host anstösst –
        den Stack-Webhook von Portainer oder einen eigenen kleinen Dienst,
        der rebuild-hub.sh startet. Die Adresse steht in der config.yaml
        unter ``update.webhook_url``; ohne sie passiert hier nichts.
        """
        user = require(request, Capability.EDIT_CONFIG)
        url = str((hub.config.update or {}).get("webhook_url") or "")
        if not url.startswith(("http://", "https://")):
            raise HTTPException(
                status_code=400,
                detail=(
                    "Keine Update-Adresse eingerichtet. In der config.yaml "
                    "unter 'update.webhook_url' eintragen – siehe "
                    "deploy/portainer.md."
                ),
            )
        wants_ios = bool(body and body.ios)
        # Nur update-listener.py versteht den iOS-Parameter - und auch der
        # erst in seiner heutigen Fassung. Seine Antwort verrät, ob er ihn
        # verstanden hat («Bau gestartet (mit iOS-Build)») - daran erkennt
        # der Hub eine veraltete Fassung und kann es sagen, statt dass der
        # iOS-Build kommentarlos ausbleibt.
        is_listener = url.rstrip("/").endswith("/update")
        status_url = url.rstrip("/")[: -len("/update")] + "/status"
        # Ein Dienst, der auf dem Host baut, darf nicht ohne Nachweis
        # anspringen. Der Portainer-Webhook braucht dagegen keinen – seine
        # Adresse ist selbst das Geheimnis.
        secret = str((hub.config.update or {}).get("token") or "")
        headers = {"Authorization": f"Bearer {secret}"} if secret else {}

        if wants_ios and is_listener:
            # Vorher fragen statt hinterher rätseln: Neuere Fassungen des
            # Dienstes sagen unter /status, was sie können und ob der
            # Zugang zu EAS bereitliegt. Stimmt eines nicht, wird gar
            # nicht erst gebaut - sonst liefe ein Update durch, das den
            # iOS-Build stillschweigend weglässt, und in TestFlight käme
            # nichts an, ohne dass irgendwo stünde warum.
            status = await listener_status(status_url, headers)
            features = (status or {}).get("features")
            if isinstance(features, list) and "ios" not in [str(f) for f in features]:
                raise HTTPException(status_code=502, detail=STALE_LISTENER_HINT)
            if (status or {}).get("expo_token") is False:
                raise HTTPException(status_code=502, detail=MISSING_EXPO_TOKEN_HINT)

        if wants_ios:
            # Nur der Listener versteht den Parameter; einem
            # Portainer-Webhook schadet er nicht, er ignoriert ihn.
            url += ("&" if "?" in url else "?") + "ios=1"
        log.warning(
            "Update angefordert von %s%s",
            user.name,
            " (mit iOS-Build)" if wants_ios else "",
        )
        try:
            timeout = aiohttp.ClientTimeout(total=30)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.post(url, headers=headers) as response:
                    text = (await response.text())[:200]
                    if response.status == 403:
                        # Der Listener kennt nur einen Grund für 403: Das
                        # Geheimnis passt nicht. Das steht an zwei Orten,
                        # und wer eines davon dreht, sucht sonst lange.
                        raise HTTPException(
                            status_code=502,
                            detail=(
                                "Das Update-Geheimnis stimmt nicht überein. Es muss "
                                "an zwei Stellen gleich sein: 'update.token' des "
                                "Hubs (Umgebungsvariable UPDATE_SECRET) und "
                                "UPDATE_SECRET in /opt/homepilot/"
                                "github-credentials.env auf dem Host. Nach dem "
                                "Ändern dort: systemctl restart homepilot-update."
                            ),
                        )
                    if response.status == 409:
                        # Der Dienst baut schon. Früher hat er trotzdem
                        # «Bau gestartet» geantwortet - wer während der
                        # Wartezeit auf Portainer nochmals drückte, bekam
                        # eine Bestätigung und nichts weiter.
                        raise HTTPException(
                            status_code=409,
                            detail=(
                                "Es läuft bereits ein Update. Dieser Wunsch "
                                "wurde nicht übernommen - warte, bis der "
                                "laufende Bau fertig ist, und drücke dann "
                                "erneut. Der Fortschritt steht oben."
                            ),
                        )
                    if response.status == 404 and wants_ios and is_listener:
                        # Die ältesten Fassungen des Listeners vergleichen
                        # den Pfad mitsamt Anhang - «/update?ios=1» passt
                        # dann nicht auf «/update», und es kommt 404. Ohne
                        # Übersetzung stünde hier nur «Nicht gefunden», und
                        # die Suche ginge in die falsche Richtung.
                        raise HTTPException(
                            status_code=502, detail=STALE_LISTENER_HINT
                        )
                    if response.status >= 400:
                        raise HTTPException(
                            status_code=502,
                            detail=f"Die Update-Adresse antwortet mit {response.status}: {text}",
                        )
        except HTTPException:
            raise
        except Exception as err:
            raise HTTPException(
                status_code=502, detail=f"Update-Adresse nicht erreichbar: {err}"
            ) from err
        if wants_ios and is_listener and "ios" not in text.lower():
            return {"ok": True, "ios_ignored": True}
        if not is_listener:
            # Ein blosser Portainer-Webhook rollt den Stack neu aus - er
            # baut nichts. Steht er unter 'update.webhook_url', tut der
            # Knopf jedes Mal etwas und ändert doch nie den Stand: Der
            # Container wird neu erstellt, aus demselben Abbild. Von
            # aussen sieht das aus wie ein Update, das nicht ankommt, und
            # genau so hat ein Haus tagelang auf altem Code gelaufen.
            return {"ok": True, "nur_ausrollen": True}
        return {"ok": True}

    @app.get("/api/system/update/status")
    async def update_status(request: Request) -> dict[str, Any]:
        """Live-Fortschritt des Host-Baus, für einen Fortschrittsbalken in der App.

        Nur der beiliegende ``deploy/update-listener.py`` kennt einen
        Fortschritt (er beobachtet die Ausgabe von rebuild-hub.sh live) –
        ein reiner Portainer-Stack-Webhook hat kein Gegenstück dazu. Ohne
        passende Adresse kommt hier schlicht ``available: false`` zurück,
        kein Fehler: Die App blendet den Balken dann einfach aus.
        """
        require(request, Capability.EDIT_CONFIG)
        url = str((hub.config.update or {}).get("webhook_url") or "")
        if not url.endswith("/update"):
            return {"available": False}
        status_url = url[: -len("/update")] + "/status"
        secret = str((hub.config.update or {}).get("token") or "")
        headers = {"Authorization": f"Bearer {secret}"} if secret else {}
        try:
            timeout = aiohttp.ClientTimeout(total=5)
            async with aiohttp.ClientSession(timeout=timeout) as session:
                async with session.get(status_url, headers=headers) as response:
                    if response.status != 200:
                        return {"available": False}
                    data = await response.json()
        except Exception:
            return {"available": False}
        if not isinstance(data, dict):
            return {"available": False}
        data["available"] = True
        return data

    @app.get("/api/system/log")
    async def system_log(request: Request, limit: int = 100, level: str | None = None) -> dict[str, Any]:
        """Die letzten Warnungen und Fehler des Hubs.

        Damit beantwortet die App die Frage «warum ist nichts passiert»,
        ohne dass jemand per SSH ins Container-Log steigen muss.
        """
        require(request, Capability.EDIT_CONFIG)
        return {
            "entries": hub.log_buffer.entries(limit=min(500, max(1, limit)), level=level)
        }

    @app.get("/api/system/extras")
    async def system_extras(request: Request) -> dict[str, Any]:
        """Welche Zusatzteile installiert sind - und welche fehlen.

        Ein paar Bibliotheken sind bewusst nicht im Grundbestand. Fehlt
        eine, bleibt genau eine Funktion dunkel, und zwar still: Der
        Durchsage-Knopf tat lange nichts, weil gTTS fehlte, und das stand
        nirgends, wo jemand nachgesehen hätte.

        Gelesen wird die *konfigurierte* Liste der Integrationen, nicht
        die geladene: Eine Anbindung, die gerade an genau diesem
        fehlenden Paket scheitert, ist nicht geladen - und wäre dann von
        der Prüfung ausgenommen, die sie erklären soll.
        """
        current_user(request)
        angebunden = {
            str(eintrag.get("integration"))
            for eintrag in hub.config.integrations
            if isinstance(eintrag, dict) and eintrag.get("integration")
        }
        zeilen = extras.stand(angebunden, apns=bool(hub.config.apns))
        return {
            "extras": zeilen,
            "summary": extras.satz(zeilen),
            "command": extras.befehl(zeilen),
        }

    @app.get("/api/system/changes")
    async def system_changes(request: Request) -> dict[str, Any]:
        """Was dieses Update mitbrachte - für die «Was ist neu»-Karte.

        Die Liste (Commit-Betreffzeilen seit dem vorherigen Stand) legt
        das Bau-Skript als changes.txt neben den Code. Ohne Datei oder
        leer: einfach nichts anzeigen - besser keine Karte als eine
        erfundene.
        """
        current_user(request)
        commit = os.environ.get("HOMEPILOT_COMMIT", "unbekannt")
        # parents[2] ist das Paket homepilot/ - dorthin legt
        # deploy/rebuild-hub.sh die Datei. Hier stand einmal
        # parent.parent (homepilot/api/), und weil eine fehlende Datei
        # bewusst nur eine leere Liste ergibt, blieb «Was ist neu» im Haus
        # jahrelang wortlos leer, statt sich zu beschweren.
        path = Path(__file__).resolve().parents[2] / "changes.txt"
        try:
            lines = [
                line.strip()
                for line in path.read_text(encoding="utf-8").splitlines()
                if line.strip()
            ]
        except OSError:
            lines = []
        return {"commit": commit, "changes": lines[:12]}

    @app.get("/api/system/audit")
    async def system_audit(
        request: Request, limit: int = 200, entity_id: str | None = None
    ) -> dict[str, Any]:
        """Zugriffsprotokoll: wer hat wann was geschaltet."""
        require(request, Capability.EDIT_CONFIG)
        return {"entries": hub.audit.entries(limit=min(500, max(1, limit)), entity_id=entity_id)}

    @app.get("/api/config/history")
    async def config_history(request: Request) -> dict[str, Any]:
        """Frühere Fassungen der config.yaml (jüngste zuerst)."""
        require(request, Capability.EDIT_CONFIG)
        return {"versions": confighistory.versions(config_path())}

    @app.get("/api/config/history/{name}")
    async def config_history_read(name: str, request: Request) -> dict[str, Any]:
        require(request, Capability.EDIT_CONFIG)
        try:
            return {"name": name, "content": confighistory.read(config_path(), name)}
        except (ValueError, FileNotFoundError) as err:
            raise HTTPException(status_code=404, detail=f"Fassung nicht gefunden: {err}") from err

    @app.post("/api/config/history/{name}/restore")
    async def config_history_restore(name: str, request: Request) -> dict[str, Any]:
        """Eine frühere Fassung zurückholen.

        Sie läuft durch dieselbe Prüfung wie jede Änderung - und der
        aktuelle Stand wird vorher seinerseits gesichert, damit auch das
        Zurückholen umkehrbar bleibt.
        """
        require(request, Capability.EDIT_CONFIG)
        try:
            content = confighistory.read(config_path(), name)
        except (ValueError, FileNotFoundError) as err:
            raise HTTPException(status_code=404, detail=f"Fassung nicht gefunden: {err}") from err
        return {**save_config(content), "restored": name}

    @app.get("/api/system/backups")
    async def list_backups(request: Request) -> dict[str, Any]:
        """Vorhandene Sicherungen der App-Daten (jüngste zuerst)."""
        require(request, Capability.EDIT_CONFIG)
        return {"backups": hub.data.backups(), "offsite": hub.offsite}

    @app.post("/api/system/backup")
    async def make_backup(request: Request) -> dict[str, Any]:
        """Jetzt eine Sicherung anlegen – ergänzt die tägliche Automatik."""
        require(request, Capability.EDIT_CONFIG)
        result = hub.data.backup()
        if result is None:
            raise HTTPException(
                status_code=400,
                detail="Ohne Datei-Speicher (z.B. reiner Demo-Hub) gibt es nichts zu sichern",
            )
        return {"ok": True, "backup": result, "backups": hub.data.backups()}

    @app.get("/api/system/backups/{name}")
    async def download_backup(name: str, request: Request) -> Response:
        """Eine Sicherung herunterladen - für die Kopie ausserhalb des Hubs.

        Die täglichen Sicherungen liegen auf derselben Platte wie das
        Original; gegen einen Plattenschaden hilft nur eine Kopie woanders.
        """
        require(request, Capability.EDIT_CONFIG)
        try:
            payload = hub.data.backup_bytes(name)
        except ValueError as err:
            raise HTTPException(status_code=404, detail=str(err)) from err
        return Response(
            content=payload,
            media_type="application/json",
            headers={"Content-Disposition": f'attachment; filename="{name}"'},
        )

    @app.post("/api/integrations/{name}/reload")
    async def reload_integration(name: str, request: Request) -> dict[str, Any]:
        """Eine Integration neu anlaufen lassen, ohne den Hub durchzustarten.

        Beim Einrichten eines neuen Geräts der Unterschied zwischen zwei
        Sekunden und zwei Minuten. Die Konfiguration kommt frisch von der
        Platte – wer die config.yaml geändert hat, sieht genau diese
        Änderung.
        """
        require(request, Capability.EDIT_CONFIG)
        try:
            return await hub.integrations.reload(name)
        except HomePilotError as err:
            raise HTTPException(status_code=400, detail=str(err)) from err

    @app.get("/api/system/hausblatt")
    async def hausblatt_text(request: Request) -> Response:
        """Das Haus auf einem Blatt – für die Ferienvertretung.

        Wer zwei Wochen giesst, bekommt sonst die App in die Hand
        gedrückt. Was er wirklich braucht, passt auf eine Seite – vor
        allem das, was von selbst passiert: Ein Licht, das um 22 Uhr von
        allein ausgeht, erschreckt jemanden, der es nicht weiss.

        Nur, was die anfragende Person auch sehen darf: Ein Gast, dem
        drei Räume freigegeben sind, bekommt kein Blatt über das ganze
        Haus.
        """
        user = current_user(request)
        sichtbar = [
            entity
            for entity in hub.registry.all()
            if user.may_see(entity.id, entity.kind, entity.integration)
        ]
        raeume: dict[str, list[dict[str, Any]]] = {}
        for name in hub.known_rooms():
            raeume[name] = [
                entity.as_dict() for entity in sichtbar if entity.room == name
            ]
        ohne_raum = [entity.as_dict() for entity in sichtbar if not entity.room]
        if ohne_raum:
            raeume["Ohne Raum"] = ohne_raum

        hinweise = [
            "Bedient wird alles über die App – dieselbe Adresse wie im Browser.",
            "Was hier von selbst passiert, lässt sich unter «Abläufe» kurz "
            "abschalten, ohne es zu löschen.",
        ]
        # Die Alarmanlage gehört zum Haus und ist immer geladen – aber
        # ein Gast sieht sie nie, und dann gehört der Hinweis auch nicht
        # aufs Blatt.
        if any(entity.get("kind") == "alarm" for entity in
               (e.as_dict() for e in sichtbar)):
            hinweise.append(
                "Die Alarmanlage ist eingerichtet. Vor dem Weggehen unter "
                "«Alarmanlage» scharf schalten, beim Kommen entschärfen."
            )

        text = hausblatt_module.hausblatt(
            haus="HomePilot – das Haus auf einem Blatt",
            raeume=raeume,
            szenen=[scene.as_dict() for scene in hub.scenes.scenes],
            ablaeufe=[a.as_dict() for a in hub.automations.automations],
            hinweise=hinweise,
        )
        return Response(content=text, media_type="text/plain; charset=utf-8")

    @app.get("/api/system/export")
    async def export_data(request: Request) -> Response:
        """Alles Eigene als eine Datei – Abläufe, Szenen, Listen, Räume.

        Der Unterschied zur Sicherung ist nicht die Technik, sondern wohin
        es geht: Eine Sicherung bleibt im Haus, ein Export landet auf einem
        Telefon oder in einer Mail. Deshalb fehlen hier Token, Sitzungen,
        Push-Geräte und das Zugriffsprotokoll (siehe `SECRETS` in
        persistence.py) – und deshalb darf ihn auch nur auslösen, wer
        ohnehin alles ändern könnte.
        """
        require(request, Capability.EDIT_CONFIG)
        daten = hub.data.export()
        # Ohne Datum im Namen liegen nach dem dritten Mal drei Dateien
        # namens «homepilot-export.json» im Ordner.
        tag = datetime.now().strftime("%Y-%m-%d")
        payload = json.dumps(daten, ensure_ascii=False, indent=2).encode("utf-8")
        return Response(
            content=payload,
            media_type="application/json",
            headers={
                "Content-Disposition": f'attachment; filename="homepilot-{tag}.json"'
            },
        )

    @app.post("/api/system/backups/{name}/restore")
    async def restore_backup(name: str, request: Request) -> dict[str, Any]:
        """Eine Sicherung zurückspielen - für den Tag, an dem jemand
        versehentlich zehn Abläufe gelöscht hat.

        Der aktuelle Stand wird vorher gesichert, danach startet der Hub
        neu: Benutzer, Abläufe und Szenen entstehen beim Start aus der
        Datei, ein halb ausgetauschter Zustand im laufenden Betrieb wäre
        keiner von beiden.
        """
        require(request, Capability.EDIT_CONFIG)
        try:
            hub.data.restore_backup(name)
        except (ValueError, OSError, json.JSONDecodeError) as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        # Über das server-Modul und zum Aufrufzeitpunkt aufgelöst: Tests
        # ersetzen dort _exit_for_restart, und das muss auch hier greifen.
        from .. import server as server_module

        threading.Timer(0.8, server_module._exit_for_restart).start()
        return {
            "ok": True,
            "hinweis": "Zurückgespielt - der Hub startet jetzt neu. Der "
            "vorherige Stand liegt als frische Sicherung daneben.",
        }

    @app.get("/api/appliances/cycles")
    async def appliance_cycles(request: Request) -> dict[str, Any]:
        """Wie oft und wie lange die Haushaltgeräte laufen.

        Neben Anzahl und Durchschnitt steht der letzte Lauf – erst der
        Vergleich sagt, ob ein Gerät schleichend länger braucht.
        """
        require(request, Capability.VIEW_SYSTEM)
        cycles = hub.data.get("appliance_cycles")
        return {
            "stats": watchdog.cycle_stats(cycles),
            "cycles": cycles[:30],
        }

    @app.get("/api/energy/months")
    async def energy_months(request: Request) -> dict[str, Any]:
        """Diesen Monat mit dem letzten vergleichen.

        Der Vergleich mit demselben Zeitraum steht bewusst daneben: Am 3.
        des Monats sieht der bisherige Verbrauch neben einem vollen
        Vormonat nach einer Ersparnis aus, die es nicht gibt.
        """
        require(request, Capability.VIEW_SYSTEM)
        today = datetime.now().strftime("%Y-%m-%d")
        days = hub.data.get("energy_days")
        totals = energy_module.month_totals(days, today)
        # Hochrechnung und Vorjahr gehören daneben: «312 statt 280 wie
        # letztes Jahr» sagt mehr als eine nackte Zwischensumme.
        totals["forecast"] = energy_module.forecast(totals, today)
        totals["year_ago_kwh"] = energy_module.year_ago(days, totals["month"])
        # Die Stunden von heute und gestern: «warum war gestern so hoch?»
        # beantwortet erst der Blick auf den Tagesverlauf.
        hours = hub.data.get("energy_hours")
        yesterday = (datetime.now() - timedelta(days=1)).strftime("%Y-%m-%d")
        totals["hours_today"] = energy_module.hourly_usage(hours, today)
        totals["hours_yesterday"] = energy_module.hourly_usage(hours, yesterday)
        return totals

    @app.get("/api/energy/devices")
    async def energy_devices(request: Request) -> dict[str, Any]:
        """Wohin die Kilowattstunden gehen - und was dauernd zieht.

        Zwei Fragen, eine Antwort: Die Rangliste zeigt den heutigen
        Verbrauch, die Standby-Liste alles, was rund um die Uhr Strom
        zieht, mit den Kosten aufs Jahr gerechnet.
        """
        user = require(request, Capability.VIEW_SYSTEM)
        visible = [
            entity
            for entity in hub.registry.all()
            if user.may_see(entity.id, entity.kind, entity.integration)
        ]
        price = float((hub.config.energy or {}).get("price_per_kwh") or 0)
        return {
            "top": energy_module.top_consumers(visible),
            "standby": energy_module.standby_costs(visible, price),
            "price_per_kwh": price or None,
            "currency": (hub.config.energy or {}).get("currency") or "CHF",
        }

