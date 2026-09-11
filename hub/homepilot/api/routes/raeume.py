"""Die Zimmer selbst – und das Foto, das auf ihrer Kachel liegt.

Bisher waren Räume nur eine Eigenschaft von Geräten: Die Liste kam im
Schnappschuss des WebSockets mit, mehr gab es nicht zu holen. Mit den
Bildern bekommt das Zimmer eine eigene Adresse.

Wer darf was: Ansehen darf jeder, der angemeldet ist - die Kachel steht
ohnehin vor ihm. Setzen und Entfernen verlangt `edit_devices`, dieselbe
Fähigkeit wie das Umbenennen eines Geräts, und aus demselben Grund: Das
Bild liegt neben der Datendatei und nicht in der config.yaml, und wer
hier wohnt, darf sagen, wie sein Zuhause aussieht. Die Konfiguration des
Hubs bleibt davon unberührt und bei der Besitzerin. Ein Gast bekommt
beides nicht - er sieht die Kachel, mehr nicht.
"""

from __future__ import annotations

import json
import logging
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response

from ...core import raumbilder
from ...core import replace as replace_module
from ...core.users import Capability
from ..context import ApiContext
from ..models import RaumbildRequest, RaumNameRequest

log = logging.getLogger(__name__)


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    def ordner():
        return raumbilder.ordner(hub.config.data_file)

    def bekannt(room: str) -> str:
        """Den Raum so zurückgeben, wie das Haus ihn schreibt.

        Sonst legte ein Tippfehler («wohnzimmer») ein zweites Bild an, das
        nie jemand zu Gesicht bekommt - die Kachel fragt unter dem Namen
        aus der config.yaml.
        """
        gesucht = room.strip().casefold()
        for name in hub.known_rooms():
            if name.strip().casefold() == gesucht:
                return name
        raise HTTPException(status_code=404, detail=f"Unbekannter Raum: {room}")

    @app.post("/api/rooms/{room}/umbenennen")
    async def room_umbenennen(
        room: str, body: RaumNameRequest, request: Request
    ) -> dict[str, Any]:
        """Einen Raum umbenennen - samt allem, was an seinem Namen hängt.

        Punkt 495 der Werkbank. «Gerät ersetzen» schreibt eine Kennung
        um; ein Raum hat keine, sein Name *ist* der Schlüssel. Wer ihn in
        der config.yaml von «Büro» auf «Arbeitszimmer» ändert, hat danach
        ein Zimmer ohne Foto, ohne Kachel-Reihenfolge und ohne seine
        Szenen - und nichts sagt es, weil nichts fehlschlägt: Der Hub
        überspringt still, was er nicht kennt.

        Die config.yaml selbst rührt diese Route **nicht** an. Dort
        stehen die Zimmer mit ihren Geräten, und die Datei gehört dem
        Menschen, der sie schreibt (siehe api/configio.py). Was hier
        umzieht, ist alles, was der Hub selbst angelegt hat - und die
        Antwort sagt, was in der Datei noch zu ändern bleibt.
        """
        user = require(request, Capability.EDIT_CONFIG)
        alt = bekannt(room)
        neu = body.name.strip()
        if not neu:
            raise HTTPException(status_code=400, detail="Der neue Name fehlt.")
        if neu == alt:
            return {"ok": True, "geaendert": {}, "hinweis": "Name unverändert."}

        geaendert: dict[str, int] = {}

        # Die Geräte: ihre Raumzuordnung liegt in entity_meta.
        meta = hub.data.get("entity_meta")
        treffer = replace_module.swap_room_in_rows(meta, alt, neu)
        if treffer:
            hub.data.set("entity_meta", meta)
            geaendert["geraete"] = treffer

        # Die Szenen: eine Szene gehört einem Zimmer.
        szenen = hub.data.get("scenes")
        treffer = replace_module.swap_room_in_rows(szenen, alt, neu)
        if treffer:
            hub.data.set("scenes", szenen)
            geaendert["szenen"] = treffer

        # Kachel-Reihenfolgen, ausgeblendete Kacheln, Raumreihenfolge.
        haus = hub.data.get("house_prefs")
        zeile = haus[0] if haus else {}
        vorher = json.dumps(zeile, sort_keys=True, ensure_ascii=False)
        punkte = replace_module.swap_room_in_order(zeile.get("order"), alt, neu)
        punkte += replace_module.swap_room_in_values(
            (zeile.get("order") or {}).get("raeume"), alt, neu
        )
        punkte += replace_module.swap_room_in_values(zeile.get("hidden"), alt, neu)
        if punkte and json.dumps(zeile, sort_keys=True, ensure_ascii=False) != vorher:
            hub.data.set("house_prefs", [zeile])
            geaendert["einstellungen"] = punkte

        # Das Raumfoto zieht mit: Es heisst nach dem Zimmer.
        bild = raumbilder.umbenennen(ordner(), alt, neu)
        if bild:
            geaendert["bild"] = 1

        hub.aenderungen.merken(user, "raum", f"umbenannt in «{neu}»", alt)
        return {
            "ok": True,
            "geaendert": geaendert,
            # Ehrlich benannt: Die Zimmer selbst stehen in der
            # config.yaml, und die gehört dem Menschen.
            "hinweis": (
                f"In der config.yaml heisst das Zimmer weiter «{alt}» - "
                "dort unter «rooms» ändern, dann übernimmt der Hub es beim "
                "nächsten Start."
            ),
        }

    @app.get("/api/rooms/images")
    async def room_images(request: Request) -> dict[str, Any]:
        """Welcher Raum ein Bild hat und von wann.

        Eine Abfrage für alle Zimmer statt einer je Kachel: Die Seite
        «Räume» zeigt sie alle auf einmal, und sechs 404 beim Öffnen wären
        sechs Fehlversuche im Protokoll für einen Normalfall.

        Der Zeitstempel hängt in der App an der Bildadresse. Ohne ihn
        zeigte ein Telefon nach dem Wechseln wochenlang das alte Foto aus
        seinem Zwischenspeicher.
        """
        current_user(request)
        return {"images": raumbilder.stand(ordner(), hub.known_rooms())}

    @app.get("/api/rooms/{room}/image")
    async def room_image(room: str, request: Request) -> Response:
        """Das Foto eines Zimmers.

        Läuft über den Hub wie die Kamerabilder, mit demselben Token in
        der Adresse - die App braucht keinen zweiten Weg zu kennen.
        """
        current_user(request)
        folder = ordner()
        datei = raumbilder.pfad(folder, bekannt(room)) if folder else None
        if datei is None:
            raise HTTPException(status_code=404, detail=f"Kein Bild für {room}")
        try:
            inhalt = datei.read_bytes()
        except OSError as err:
            raise HTTPException(status_code=500, detail=f"Bild nicht lesbar: {err}") from err
        art = {".jpg": "image/jpeg", ".png": "image/png", ".webp": "image/webp"}
        return Response(
            content=inhalt,
            media_type=art.get(datei.suffix, "image/jpeg"),
            # Ein Jahr, und das ohne Sorge: In der Adresse steht der
            # Zeitstempel des Bildes (siehe /api/rooms/images), ein neues
            # Foto ist also eine neue Adresse.
            headers={"Cache-Control": "private, max-age=31536000, immutable"},
        )

    @app.put("/api/rooms/{room}/image")
    async def set_room_image(
        room: str, body: RaumbildRequest, request: Request
    ) -> dict[str, Any]:
        """Ein Foto für dieses Zimmer setzen (ersetzt das bisherige)."""
        require(request, Capability.EDIT_DEVICES)
        name = bekannt(room)
        folder = ordner()
        if folder is None:
            raise HTTPException(
                status_code=503,
                detail="Dieser Hub hat keine Datendatei - Bilder brauchen einen Ort.",
            )
        try:
            daten, suffix = raumbilder.entpacke(body.image)
        except raumbilder.BildFehler as err:
            raise HTTPException(status_code=400, detail=str(err)) from err
        try:
            raumbilder.schreiben(folder, name, daten, suffix)
        except OSError as err:
            raise HTTPException(
                status_code=500, detail=f"Bild liess sich nicht ablegen: {err}"
            ) from err
        log.info("Raumbild für '%s' gesetzt (%d KB)", name, len(daten) // 1000)
        return {"ok": True, "images": raumbilder.stand(folder, hub.known_rooms())}

    @app.delete("/api/rooms/{room}/image")
    async def delete_room_image(room: str, request: Request) -> dict[str, Any]:
        """Das Foto wieder entfernen – die Kachel fällt auf ihre Farbe zurück."""
        require(request, Capability.EDIT_DEVICES)
        name = bekannt(room)
        weg = raumbilder.loeschen(ordner(), name)
        if weg:
            log.info("Raumbild für '%s' entfernt", name)
        return {"ok": True, "removed": weg, "images": raumbilder.stand(ordner(), hub.known_rooms())}
