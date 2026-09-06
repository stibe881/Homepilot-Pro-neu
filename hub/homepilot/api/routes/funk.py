"""Die Funkqualität der Zigbee-Geräte – Wert, Wochenmittel und Richtung.

Punkt 230 der Werkbank: linkquality stand im Zustand, und niemand las
sie. Der Wächter sammelt jetzt Wochenmittel und meldet den Abstieg
(core/funkqualitaet.py); diese Route reicht denselben Stand an die App
weiter, wo die Geräte-Gesundheit daraus den Abschnitt «Funk» zeigt.

Eine eigene kleine Datei statt eines Anbaus: Die Batterie-Vermerke
wohnen in entities.py, aber die Funkfrage hat ihren eigenen Speicher
und ihre eigene Rechnung - und ein Sachgebiet je Datei ist ohnehin die
Richtung (Punkt 16).
"""

from __future__ import annotations

from typing import Any

from fastapi import FastAPI, Request

from ...core import funkqualitaet
from ..context import ApiContext


def register(app: FastAPI, ctx: ApiContext) -> None:
    hub = ctx.hub
    current_user = ctx.current_user

    @app.get("/api/funk")
    async def funk_state(request: Request) -> dict[str, Any]:
        """Je Funkgerät der aktuelle Wert samt Trend aus den Wochenmitteln.

        Nur Entitäten, die eine linkquality im Zustand führen - das sind
        genau die Zigbee-Geräte. `mean_from`/`mean_to` und `direction`
        bleiben null, solange die Reihe jung ist: Unter drei Wochen Daten
        wäre der Trend geraten, und die App soll keinen erfinden.
        """
        current_user(request)
        verlauf = hub.data.get(funkqualitaet.STORE_KEY)
        zeilen: list[dict[str, Any]] = []
        for entity in hub.registry.all():
            wert = entity.state.get("linkquality")
            if not isinstance(wert, (int, float)) or isinstance(wert, bool):
                continue
            mittel = funkqualitaet.mittelwerte(verlauf, entity.id)
            zeilen.append(
                {
                    "entity_id": entity.id,
                    "name": entity.label,
                    "room": entity.room,
                    "value": float(wert),
                    "mean_from": round(mittel[0]) if mittel else None,
                    "mean_to": round(mittel[1]) if mittel else None,
                    "direction": funkqualitaet.richtung(verlauf, entity.id),
                    "weak": funkqualitaet.bewertung(verlauf, entity.id) is not None,
                }
            )
        return {"radios": zeilen}
