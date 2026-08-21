"""Woher eine Änderung kam.

Damit die App auf die Frage „warum ist das Licht angegangen?" antworten
kann, trägt jedes Ereignis seine Quelle mit: ein Benutzer, eine Automation,
eine Szene – oder das Gerät selbst, wenn jemand am Schalter gedrückt hat.

Umgesetzt als Kontextvariable: Der Auslöser setzt sie einmal, und die
Registry liest sie beim Veröffentlichen aus. So muss die Quelle nicht durch
jede Integration hindurchgereicht werden.
"""

from __future__ import annotations

from collections.abc import Iterator
from contextlib import contextmanager
from contextvars import ContextVar
from typing import Any

_current: ContextVar[dict[str, Any] | None] = ContextVar("homepilot_source", default=None)

DEVICE = {"kind": "device", "label": "Gerät"}


def user_source(name: str) -> dict[str, Any]:
    return {"kind": "user", "label": name}


def automation_source(automation_id: str, alias: str) -> dict[str, Any]:
    return {"kind": "automation", "label": alias, "id": automation_id}


def scene_source(scene_id: str, name: str) -> dict[str, Any]:
    return {"kind": "scene", "label": name, "id": scene_id}


def current() -> dict[str, Any]:
    """Die aktuelle Quelle – ohne gesetzte Quelle war es das Gerät selbst."""
    return _current.get() or DEVICE


@contextmanager
def as_source(source: dict[str, Any] | None) -> Iterator[None]:
    token = _current.set(source)
    try:
        yield
    finally:
        _current.reset(token)
