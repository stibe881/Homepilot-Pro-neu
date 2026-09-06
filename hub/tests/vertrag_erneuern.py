"""Schreibt die Vertragsdatei tests/vertrag.json aus dem laufenden Code neu.

Bewusst von Hand aufzurufen, nie automatisch - sonst schriebe jeder
Testlauf den Vertrag so um, dass er wieder passt, und die Prüfung wäre
keine:

    cd hub && python3 -m tests.vertrag_erneuern

Warum echte Antworten über den TestClient statt app.openapi(): Keine
einzige Route deklariert ein response_model - die Handler geben schlichte
dicts zurück, und im OpenAPI-Baum stünde für jede Antwort nur ein leeres
Schema. Ein Vertrag über leere Schemata prüft nichts. Die Schlüsselmenge
einer echten Antwort aus dem Demo-Setup ist dagegen genau das, worauf
sich app/src/api/types.ts verlässt - der ehrlichere Vertrag.

Aufgenommen sind die Routen, die die App laufend liest (Startseite,
Listen, System), nicht jede der weit über hundert. Ein «· Eintrag» im
Schlüssel heisst: geprüft wird ein Element der Liste, nicht die Hülle.
"""

from __future__ import annotations

import json
from collections.abc import Callable
from pathlib import Path
from typing import Any

from fastapi.testclient import TestClient

from homepilot.api import create_app
from homepilot.core.hub import Hub

from .conftest import make_config

VERTRAG_DATEI = Path(__file__).with_name("vertrag.json")


class VertragsFehler(AssertionError):
    """Eine Route liefert nicht mehr, was der Vertrag zum Messen braucht."""


def make_client() -> TestClient:
    # Ohne Token: Dann gibt es keine Benutzerverwaltung, und jede Anfrage
    # läuft als Besitzer - genau wie in tests/test_api.py.
    return TestClient(create_app(Hub(make_config())))


def _get(client: TestClient, pfad: str) -> Any:
    antwort = client.get(pfad)
    if antwort.status_code != 200:
        raise VertragsFehler(f"GET {pfad} antwortet {antwort.status_code} statt 200")
    return antwort.json()


def _erster(liste: Any, route: str) -> dict[str, Any]:
    if not isinstance(liste, list) or not liste:
        raise VertragsFehler(
            f"{route}: erwartet eine nicht-leere Liste als Probe-Grundlage "
            f"(bekommen: {type(liste).__name__}) - hat bereite() den Eintrag angelegt?"
        )
    return liste[0]


def bereite(client: TestClient) -> None:
    """Legt an, was die Listen-Routen zum Vermessen brauchen.

    Das Demo-Setup startet ohne Szenen, Abläufe, Benutzer und Einkäufe -
    eine leere Liste hat aber keine Schlüssel, an denen sich ein Vertrag
    messen liesse. Angelegt wird über dieselben Routen wie aus der App,
    damit die Probe-Einträge exakt die Form haben, die die App sieht.
    """
    schritte = [
        (
            "/api/scenes",
            {
                "name": "Vertragsszene",
                "actions": [{"entity_id": "demo.light_livingroom", "command": "turn_on"}],
            },
        ),
        (
            "/api/automations",
            {
                "alias": "Vertragsablauf",
                "trigger": [{"type": "time", "at": "03:00"}],
                "condition": [],
                "action": [
                    {
                        "type": "command",
                        "entity_id": "demo.light_livingroom",
                        "command": "turn_on",
                    }
                ],
            },
        ),
        ("/api/users", {"name": "Vertragsgast", "role": "bewohner"}),
        ("/api/family/shopping", {"text": "Milch"}),
    ]
    for pfad, body in schritte:
        antwort = client.post(pfad, json=body)
        if antwort.status_code != 200:
            raise VertragsFehler(
                f"Vorbereitung POST {pfad} antwortet {antwort.status_code} statt 200"
            )


def _kommando(client: TestClient) -> dict[str, Any]:
    antwort = client.post(
        "/api/entities/demo.light_livingroom/command",
        json={"command": "turn_on", "data": {"brightness": 42}},
    )
    if antwort.status_code != 200:
        raise VertragsFehler(
            f"POST /api/entities/…/command antwortet {antwort.status_code} statt 200"
        )
    return antwort.json()


# Die Routen des Vertrags. Jede Funktion liefert das eine Objekt, dessen
# Schlüsselmenge festgehalten wird. Die Auswahl folgt app/src/api/types.ts
# und den Aufrufen der App: Entitäten und Befehle (der Kern), Szenen,
# Abläufe, Benutzer, System-Status, die persönlichen und haushaltsweiten
# Einstellungen, Familienlisten, Batterien, Funkenlinien und der
# Haus-Rückblick.
ROUTEN: list[tuple[str, Callable[[TestClient], dict[str, Any]]]] = [
    ("GET /api/health", lambda c: _get(c, "/api/health")),
    ("GET /api/me", lambda c: _get(c, "/api/me")),
    (
        "GET /api/entities · Eintrag",
        lambda c: _erster(_get(c, "/api/entities"), "GET /api/entities"),
    ),
    ("POST /api/entities/{id}/command", _kommando),
    ("GET /api/system/status", lambda c: _get(c, "/api/system/status")),
    ("GET /api/automations", lambda c: _get(c, "/api/automations")),
    (
        "GET /api/automations · Eintrag",
        lambda c: _erster(
            _get(c, "/api/automations").get("automations"), "GET /api/automations"
        ),
    ),
    (
        "GET /api/scenes · Eintrag",
        lambda c: _erster(_get(c, "/api/scenes"), "GET /api/scenes"),
    ),
    (
        "GET /api/users · Eintrag",
        lambda c: _erster(_get(c, "/api/users"), "GET /api/users"),
    ),
    ("GET /api/prefs", lambda c: _get(c, "/api/prefs")),
    ("GET /api/houseprefs", lambda c: _get(c, "/api/houseprefs")),
    (
        "GET /api/family/shopping · Eintrag",
        lambda c: _erster(_get(c, "/api/family/shopping"), "GET /api/family/shopping"),
    ),
    ("GET /api/batteries", lambda c: _get(c, "/api/batteries")),
    ("GET /api/trends", lambda c: _get(c, "/api/trends")),
    ("GET /api/log", lambda c: _get(c, "/api/log")),
]


def erhebe() -> dict[str, list[str]]:
    """Die Schlüsselmengen aller Vertrags-Routen, frisch gemessen. (rein bis
    auf den Wegwerf-Hub - kein Netz, keine Dateien.)"""
    with make_client() as client:
        bereite(client)
        vertrag: dict[str, list[str]] = {}
        for schluessel, hole in ROUTEN:
            probe = hole(client)
            if not isinstance(probe, dict):
                raise VertragsFehler(
                    f"{schluessel}: erwartet ein Objekt, bekommen {type(probe).__name__}"
                )
            vertrag[schluessel] = sorted(probe.keys())
        return vertrag


def main() -> None:
    vertrag = erhebe()
    VERTRAG_DATEI.write_text(
        json.dumps(vertrag, indent=2, ensure_ascii=False, sort_keys=True) + "\n",
        encoding="utf-8",
    )
    print(f"Vertrag neu geschrieben: {VERTRAG_DATEI} ({len(vertrag)} Routen)")
    print("Nicht vergessen: Passt app/src/api/types.ts noch dazu?")


if __name__ == "__main__":
    main()
