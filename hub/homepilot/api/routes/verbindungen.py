"""Die Dienst-Verbindungen: Kalender, Spotify und Google Home aus der App.

Die Seite «Verbindungen» soll die drei Dienste zeigen, ändern und neu
anlegen können, ohne dass jemand die config.yaml öffnet. Gerechnet wird
alles über core/config_edit (Text an Ort und Stelle, Kommentare bleiben)
und gespeichert über configio.save_config - denselben geprüften Weg wie
jede getippte Änderung. Es gibt keinen zweiten Weg auf die Platte.

Geheimnisse gehen nur hinein, nie hinaus: client_id und client_secret
landen in der secrets.env neben der config.yaml (nie im Repository,
siehe CLAUDE.md), im Block steht nur der Verweis `${NAME}`. Die App
erfährt bloss, ob sie gesetzt sind.
"""

from __future__ import annotations

import logging
import os
from pathlib import Path
from typing import Any

import yaml
from fastapi import FastAPI, HTTPException, Request

from ...core import config_edit, tokenstore, verbindungen
from ...core.config import SECRETS_FILE
from ...core.users import Capability
from .. import configio
from ..context import ApiContext
from ..models import VerbindungRequest

log = logging.getLogger(__name__)


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require

    def config_path() -> Path:
        return Path(configio.config_path(hub))

    def config_text() -> str:
        try:
            return config_path().read_text(encoding="utf-8")
        except OSError as err:
            raise HTTPException(
                status_code=500, detail=f"Konfiguration nicht lesbar: {err}"
            ) from err

    def _bloecke(content: str) -> dict[str, dict[str, Any]]:
        """Die (eingeschalteten) Integrationsblöcke, roh und unaufgelöst.

        Bewusst der rohe Text statt hub.config: Der läuft auf dem Stand
        des letzten Starts, und `${VERWEISE}` sollen Verweise bleiben -
        aufgelöste Geheimnisse haben in dieser Route nichts verloren.
        """
        try:
            daten = yaml.safe_load(content) or {}
        except yaml.YAMLError:
            return {}
        bloecke: dict[str, dict[str, Any]] = {}
        liste = daten.get("integrations") if isinstance(daten, dict) else None
        for eintrag in liste or []:
            if isinstance(eintrag, dict) and eintrag.get("integration"):
                bloecke.setdefault(str(eintrag["integration"]), eintrag)
        return bloecke

    def _abgeschaltet(content: str) -> set[str]:
        """Welche Integrationen nur auskommentiert dastehen."""
        namen: set[str] = set()
        for abschnitt in config_edit.outline(content):
            if abschnitt.get("key") != "integrations":
                continue
            for item in abschnitt.get("items") or []:
                if not item.get("enabled"):
                    namen.add(str(item.get("name")))
        return namen

    def _angemeldet(eintrag: dict[str, Any], block: dict[str, Any] | None) -> bool | None:
        """Liegt für den Dienst eine Anmeldung vor? None: braucht keine."""
        name = eintrag.get("token_name")
        if not name:
            return None
        # Ein refresh_token direkt im Block hat Vorrang vor der Datei -
        # dieselbe Regel wie in den Integrationen selbst.
        if str((block or {}).get("refresh_token") or "").strip():
            return True
        datei = tokenstore.token_file(hub.config.data_file, block, str(name))
        return tokenstore.value(datei, "refresh_token") is not None

    @app.get("/api/verbindungen")
    async def get_verbindungen(request: Request) -> dict[str, Any]:
        """Der Stand der drei Dienste - für die Verbindungen-Seite."""
        require(request, Capability.EDIT_CONFIG)
        content = config_text()
        bloecke = _bloecke(content)
        abgeschaltet = _abgeschaltet(content)
        verfuegbarkeit = {
            entity.id: bool(entity.available) for entity in hub.registry.all()
        }
        ladefehler = hub.integrations.status()

        dienste: list[dict[str, Any]] = []
        for eintrag in verbindungen.KATALOG:
            integration = str(eintrag["integration"])
            block = bloecke.get(integration)
            eingerichtet = block is not None or integration in abgeschaltet
            enabled = block is not None
            geladen = hub.integrations.get(integration) is not None
            zugang: bool | None = None
            angemeldet: bool | None = None
            verfuegbar: bool | None = None
            werte: dict[str, Any] = {}

            if eintrag["key"] == "kalender":
                zugang = verbindungen.zugang_da(block) if enabled else None
                angemeldet = _angemeldet(eintrag, block) if enabled else None
                verfuegbar = verfuegbarkeit.get("google_calendar.next")
                werte = verbindungen.kalender_werte(block) if enabled else {}
            elif eintrag["key"] == "spotify":
                zugang = verbindungen.zugang_da(block) if enabled else None
                angemeldet = _angemeldet(eintrag, block) if enabled else None
                verfuegbar = verfuegbarkeit.get("spotify.player")
            elif eintrag["key"] == "googlehome":
                geraete = verbindungen.cast_geraete(
                    block,
                    {
                        entity_id.split(".", 1)[1]: da
                        for entity_id, da in verfuegbarkeit.items()
                        if entity_id.startswith("google_cast.")
                    },
                )
                werte = {"geraete": geraete}
                if geraete:
                    verfuegbar = any(g["erreichbar"] for g in geraete)

            fehler = (
                str((ladefehler.get(integration) or {}).get("error") or "") or None
                if enabled
                else None
            )
            status = verbindungen.status_von(
                eingerichtet, enabled, geladen, verfuegbar, zugang, angemeldet, fehler
            )
            dienste.append(
                {
                    "key": eintrag["key"],
                    "label": eintrag["label"],
                    "kurz": eintrag["kurz"],
                    "eingerichtet": eingerichtet,
                    "enabled": enabled,
                    "status": status,
                    "fehler": fehler,
                    "werte": werte,
                    "zugang": zugang,
                    "angemeldet": angemeldet,
                    # Der Weg zur Anmeldung steht nur da, wenn sie fehlt -
                    # sonst ist er Rauschen auf der Karte.
                    "anmeldung": (
                        eintrag["anmelde_befehl"] if angemeldet is False else None
                    ),
                }
            )
        return {"dienste": dienste}

    def _geheimnis(wert: str, feld: str) -> str:
        """Ein Geheimnis prüfen, bevor es in die secrets.env darf.

        Die Datei ist zeilenbasiert - ein Wert mit Zeilenumbruch würde
        dort zur nächsten Variablen. Leerraum kommt in diesen Schlüsseln
        ohnehin nie vor, also ist er ein Tippfehler, kein Sonderfall.
        """
        wert = wert.strip()
        if not wert or any(zeichen.isspace() for zeichen in wert):
            raise HTTPException(
                status_code=400, detail=f"'{feld}' darf keinen Leerraum enthalten"
            )
        return wert

    def _secrets_schreiben(neu: dict[str, str]) -> None:
        """Werte in die secrets.env neben der config.yaml legen.

        Vor dem Speichern der config.yaml: Deren Prüfung löst die
        `${VERWEISE}` auf, und die zeigen auf genau diese Datei. Wie die
        Token-Dateien nur für den Besitzer lesbar und atomar ersetzt.
        """
        datei = config_path().parent / SECRETS_FILE
        try:
            text = datei.read_text(encoding="utf-8") if datei.is_file() else ""
            for name, wert in neu.items():
                text = verbindungen.secrets_zeile_setzen(text, name, wert)
            tmp = datei.with_suffix(".tmp")
            tmp.write_text(text, encoding="utf-8")
            os.chmod(tmp, 0o600)
            tmp.replace(datei)
        except OSError as err:
            raise HTTPException(
                status_code=500, detail=f"secrets.env nicht schreibbar: {err}"
            ) from err

    @app.put("/api/verbindungen/{key}")
    async def put_verbindung(
        key: str, body: VerbindungRequest, request: Request
    ) -> dict[str, Any]:
        """Einen Dienst ändern - oder anlegen, wenn es ihn noch nicht gibt."""
        user = require(request, Capability.EDIT_CONFIG)
        eintrag = verbindungen.dienst(key)
        if eintrag is None:
            raise HTTPException(status_code=404, detail=f"Unbekannter Dienst '{key}'")
        integration = str(eintrag["integration"])

        # Felder, die zum falschen Dienst geschickt werden, sind ein
        # Fehler im Aufrufer - still ignoriert würden sie irgendwann
        # als «hat nicht funktioniert» gemeldet.
        if key != "kalender" and (
            body.calendar_ids is not None or body.remind_minutes is not None
        ):
            raise HTTPException(
                status_code=400, detail="Kalender-Felder gehören zum Dienst 'kalender'"
            )
        if key == "googlehome" and (body.client_id or body.client_secret):
            raise HTTPException(
                status_code=400, detail="Google Home braucht keine Zugangsdaten"
            )
        if key != "googlehome" and (body.geraet_hinzu or body.geraet_weg):
            raise HTTPException(
                status_code=400, detail="Geräte gehören zum Dienst 'googlehome'"
            )

        content = config_text()
        vorher = content
        geheimnisse: dict[str, str] = {}
        prefix = eintrag.get("secret_prefix")

        # Die Kalender-Adressen einmal prüfen - sie kommen beim Anlegen
        # und beim Ändern über denselben Weg in die Datei.
        ids: list[str] | None = None
        if body.calendar_ids is not None:
            ids = [wert.strip() for wert in body.calendar_ids if wert.strip()]
            if not ids:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        "Mindestens ein Kalender muss bleiben - «primary» "
                        "ist der Hauptkalender"
                    ),
                )
            for wert in ids:
                if not verbindungen.gueltige_kalender_id(wert):
                    raise HTTPException(
                        status_code=400,
                        detail=f"'{wert}' sieht nicht nach einer Kalender-Adresse aus",
                    )

        # ── Anlegen, wenn der Block fehlt ─────────────────────────────
        fehlt = (
            config_edit.enabled_block(content, integration) is None
            and integration not in _abgeschaltet(content)
        )
        if fehlt and key in ("kalender", "spotify"):
            if not (body.client_id and body.client_secret):
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{eintrag['label']} ist noch nicht eingerichtet - zum "
                        "Anlegen braucht es client_id und client_secret"
                    ),
                )
            geheimnisse[f"{prefix}_CLIENT_ID"] = _geheimnis(body.client_id, "client_id")
            geheimnisse[f"{prefix}_CLIENT_SECRET"] = _geheimnis(
                body.client_secret, "client_secret"
            )
            felder: list[tuple[str, object]] = [
                ("client_id", f"${{{prefix}_CLIENT_ID}}"),
                ("client_secret", f"${{{prefix}_CLIENT_SECRET}}"),
            ]
            if key == "kalender":
                felder.append(("calendar_ids", ids or ["primary"]))
                if body.remind_minutes is not None:
                    felder.append(("remind_minutes", int(body.remind_minutes)))
            content = config_edit.append_integration_block(content, integration, felder)
        elif fehlt and key == "googlehome" and body.geraet_hinzu is None:
            raise HTTPException(
                status_code=400,
                detail=(
                    "Google Home ist noch nicht eingerichtet - zum Anlegen "
                    "braucht es ein erstes Gerät (Name und Adresse)"
                ),
            )

        # ── Bestehenden Block ändern ──────────────────────────────────
        if not fehlt:
            bearbeitet = any(
                wert is not None
                for wert in (
                    body.calendar_ids,
                    body.remind_minutes,
                    body.client_id,
                    body.client_secret,
                    body.geraet_hinzu,
                    body.geraet_weg,
                )
            )
            if bearbeitet and config_edit.enabled_block(content, integration) is None:
                raise HTTPException(
                    status_code=400,
                    detail=(
                        f"{eintrag['label']} ist ausgeschaltet - zuerst "
                        "einschalten, dann ändern"
                    ),
                )
            if ids is not None:
                # Die alte Einzahl-Schreibweise räumt die Liste gleich ab -
                # zwei Quellen für dieselbe Frage wären eine zu viel.
                content = config_edit.set_block_scalar(
                    content, integration, "calendar_id", None
                )
                content = config_edit.set_block_list(
                    content, integration, "calendar_ids", ids
                )
            if body.remind_minutes is not None:
                minuten = max(0, int(body.remind_minutes))
                content = config_edit.set_block_scalar(
                    content, integration, "remind_minutes", minuten or None
                )
            if prefix and (body.client_id or body.client_secret):
                if body.client_id:
                    geheimnisse[f"{prefix}_CLIENT_ID"] = _geheimnis(
                        body.client_id, "client_id"
                    )
                    content = config_edit.set_block_scalar(
                        content, integration, "client_id", f"${{{prefix}_CLIENT_ID}}"
                    )
                if body.client_secret:
                    geheimnisse[f"{prefix}_CLIENT_SECRET"] = _geheimnis(
                        body.client_secret, "client_secret"
                    )
                    content = config_edit.set_block_scalar(
                        content,
                        integration,
                        "client_secret",
                        f"${{{prefix}_CLIENT_SECRET}}",
                    )

        # ── Google-Home-Geräte ────────────────────────────────────────
        if body.geraet_hinzu is not None:
            name = body.geraet_hinzu.name.strip()
            host = body.geraet_hinzu.host.strip()
            if not name or not verbindungen.gueltiger_host(host):
                raise HTTPException(
                    status_code=400, detail="Ein Gerät braucht Name und Adresse"
                )
            # add_cast_device legt den Block bei Bedarf gleich mit an.
            content = config_edit.add_cast_device(
                content, name, host, body.geraet_hinzu.port
            )
        if body.geraet_weg is not None:
            content = config_edit.remove_cast_device(
                content, body.geraet_weg.host.strip(), body.geraet_weg.port
            )

        # ── Ein- und Ausschalten - zuletzt, auf dem geänderten Text ───
        if body.enabled is not None:
            item = next(
                (
                    it
                    for abschnitt in config_edit.outline(content)
                    if abschnitt.get("key") == "integrations"
                    for it in abschnitt.get("items") or []
                    if it.get("name") == integration
                ),
                None,
            )
            if item is None:
                raise HTTPException(
                    status_code=400,
                    detail=f"{eintrag['label']} steht nicht in der Konfiguration",
                )
            if bool(item.get("enabled")) != body.enabled:
                content = config_edit.toggle_block(
                    content, int(str(item["code"])), int(str(item["end"])), body.enabled
                )

        if content == vorher and not geheimnisse:
            return {"ok": True, "restart_required": False, "unveraendert": True}

        # Erst die Geheimnisse, dann die Konfiguration: Die Prüfung beim
        # Speichern löst die frischen ${VERWEISE} bereits auf.
        if geheimnisse:
            _secrets_schreiben(geheimnisse)
        antwort = (
            configio.save_config(hub, content)
            if content != vorher
            else {"ok": True, "restart_required": True, "warnings": []}
        )
        hub.aenderungen.merken(user, "verbindung", f"{eintrag['label']} geändert")
        return antwort
