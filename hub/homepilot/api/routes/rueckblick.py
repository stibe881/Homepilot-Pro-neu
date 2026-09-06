"""Der Monats- und Jahresrückblick (Punkt 253 der Werkbank).

Eine eigene, kleine Datei statt eines Anbaus an system.py: Der Rückblick
liest quer über Quellen (energy, eventlog, Supabase-state_history) und
gehört keinem der bestehenden Sachgebiete. Die Rechenlogik liegt in
core/langzeit.py - hier hängt nur die Route.
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, HTTPException, Request

from ...core import langzeit
from ...core.users import Capability
from ..context import ApiContext


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    require = ctx.require

    @app.get("/api/rueckblick/langzeit")
    async def langzeit_rueckblick(
        request: Request, zeitraum: str = "monat"
    ) -> dict[str, Any]:
        """Was der Monat bzw. das Jahr über das Haus sagt.

        `view_history` wie beim Zustandsverlauf: Der Rückblick erzählt,
        wann welches Licht wie oft anging - das geht einen Gast nichts an.
        """
        require(request, Capability.VIEW_HISTORY)
        if zeitraum not in langzeit.ZEITRAEUME:
            raise HTTPException(
                status_code=400,
                detail="zeitraum muss «monat» oder «jahr» sein",
            )
        return await langzeit.erstellen(hub, zeitraum)
