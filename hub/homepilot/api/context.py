"""Der geteilte Kontext der Routen-Module.

create_app() baut die Authentifizierungs-Helfer als Closures über dem Hub
und der Fehlversuchs-Bremse - die Routen-Module bekommen sie über dieses
Objekt gereicht, statt sie zu duplizieren.
"""

from __future__ import annotations

from collections.abc import Callable
from dataclasses import dataclass
from typing import Any

from ..core.hub import Hub


@dataclass
class ApiContext:
    hub: Hub
    # Die Fehlversuchs-Bremse - Anmelde- und Einlöse-Routen zählen dort
    # ihre eigenen Fehlschläge mit.
    throttle: Any
    current_user: Callable[..., Any]
    require: Callable[..., Any]
    user_payload: Callable[..., Any]
    visible: Callable[..., Any]
    user_name: Callable[..., Any]
    token_from: Callable[..., Any]
