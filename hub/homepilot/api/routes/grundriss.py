"""Der Grundriss: Bild und Geräte-Punkte fürs Wandpanel.

Die Logik (was ein gültiger Punkt ist) steht in core/grundriss.py; hier
hängen nur die Routen. Das Bild geht denselben Weg wie die Rezeptbilder
(Punkt 193): als Datei neben der Datendatei, ausgeliefert mit langem
Cache über den Fingerabdruck in der Adresse.

Anpassen dürfen alle, die auch Geräte anpassen dürfen (EDIT_DEVICES):
Wer sagen darf, wie ein Gerät heisst und wo es steht, darf es auch auf
den Plan setzen. Die Besitzer-Rechte (EDIT_CONFIG) wären hier zu eng -
das Bild landet neben den Daten, nicht in der config.yaml.
"""

from __future__ import annotations

import logging
from pathlib import Path
from typing import Any

from fastapi import FastAPI, HTTPException, Request, Response

from ...core import bilder, grundriss
from ...core.users import Capability
from ..context import ApiContext
from ..models import GrundrissBildRequest, GrundrissPunkteRequest

log = logging.getLogger(__name__)

#: Der feste Dateiname (plus Endung) - es gibt genau einen Plan.
BILD_NAME = "plan"


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user
    require = ctx.require

    def bilder_ordner() -> Path | None:
        pfad = hub.data.path
        return Path(pfad).parent / "grundriss" if pfad else None

    def bild_datei() -> Path | None:
        ordner = bilder_ordner()
        if ordner is None or not ordner.exists():
            return None
        for datei in sorted(ordner.glob(f"{BILD_NAME}.*")):
            return datei
        return None

    def bild_url() -> str | None:
        datei = bild_datei()
        if datei is None:
            return None
        try:
            kennung = bilder.fingerprint(datei.read_bytes())
        except OSError:
            return None
        return f"/api/grundriss/bild?v={kennung}"

    @app.get("/api/grundriss")
    async def grundriss_stand(request: Request) -> dict[str, Any]:
        """Bild-Adresse und Punkte - alles, was die Ansicht braucht."""
        current_user(request)
        return {
            "bild": bild_url(),
            "punkte": grundriss.punkte_bereinigen(hub.data.get(grundriss.STORE_KEY)),
        }

    @app.get("/api/grundriss/bild")
    async def grundriss_bild(request: Request, v: str = "") -> Response:
        """Das Bild selbst - mit langem Cache, solange `v` mitkommt.

        Ein neues Bild ist eine neue Adresse (anderer Fingerabdruck);
        das alte darf im Gerät liegen bleiben.
        """
        current_user(request)
        datei = bild_datei()
        if datei is None:
            raise HTTPException(status_code=404, detail="Kein Grundriss hinterlegt")
        return Response(
            content=datei.read_bytes(),
            media_type=bilder.media_type(datei.name),
            headers={
                "Cache-Control": "public, max-age=31536000, immutable"
                if v
                else "public, max-age=300"
            },
        )

    @app.post("/api/grundriss/bild")
    async def grundriss_bild_setzen(
        body: GrundrissBildRequest, request: Request
    ) -> dict[str, Any]:
        """Ein neues Bild hinterlegen - ersetzt das alte.

        Die Punkte bleiben stehen: Ein neues Foto desselben Plans (besser
        ausgeleuchtet, endlich gerade) soll nicht alle Positionen kosten.
        Wer wirklich einen anderen Plan lädt, verschiebt sie einmal.
        """
        user = require(request, Capability.EDIT_DEVICES)
        entschluesselt = bilder.decode_data_uri(body.image)
        if entschluesselt is None:
            raise HTTPException(
                status_code=400,
                detail="Das Bild kam nicht an - erwartet wird ein data-URI "
                "(JPEG, PNG oder WebP, höchstens ein paar MB).",
            )
        roh, endung = entschluesselt
        ordner = bilder_ordner()
        if ordner is None:
            raise HTTPException(
                status_code=503, detail="Der Hub läuft ohne Datendatei (Demo)."
            )
        try:
            ordner.mkdir(parents=True, exist_ok=True)
            # Alte Fassung mit anderer Endung wegräumen, sonst wäre das
            # ausgelieferte Bild Zufall (wie bei den Rezeptbildern).
            for vorher in ordner.glob(f"{BILD_NAME}.*"):
                vorher.unlink(missing_ok=True)
            (ordner / f"{BILD_NAME}.{endung}").write_bytes(roh)
        except OSError as err:
            log.warning("Grundriss nicht geschrieben: %s", err)
            raise HTTPException(
                status_code=507, detail="Das Bild liess sich nicht speichern."
            ) from err
        log.info("Grundriss hinterlegt von %s (%d Bytes)", user.name, len(roh))
        return {"bild": bild_url()}

    @app.delete("/api/grundriss/bild")
    async def grundriss_bild_loeschen(request: Request) -> dict[str, Any]:
        """Bild entfernen. Die Punkte bleiben - siehe oben."""
        require(request, Capability.EDIT_DEVICES)
        ordner = bilder_ordner()
        if ordner is not None and ordner.exists():
            for datei in ordner.glob(f"{BILD_NAME}.*"):
                datei.unlink(missing_ok=True)
        return {"bild": None}

    @app.put("/api/grundriss/punkte")
    async def grundriss_punkte(
        body: GrundrissPunkteRequest, request: Request
    ) -> dict[str, Any]:
        """Alle Punkte auf einmal ersetzen.

        Ganz statt einzeln: Der Anpassen-Modus der App speichert beim
        Verlassen seinen Stand - einzelne Änderungen zu übertragen
        hiesse, dieselbe Reihenfolge-Logik auf beiden Seiten zu pflegen.
        """
        require(request, Capability.EDIT_DEVICES)
        punkte = grundriss.punkte_bereinigen(body.punkte)
        hub.data.set(grundriss.STORE_KEY, punkte)
        return {"punkte": punkte}
