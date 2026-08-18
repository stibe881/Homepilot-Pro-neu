"""Die letzten Log-Meldungen im Speicher behalten, für die App.

Warum: Geht etwas schief, steht die Antwort im Log des Containers – und
die kommt man nur per SSH und ``docker logs`` heran. Das ist genau dann
unbequem, wenn man unterwegs ist und wissen will, warum die Storen nicht
gefahren sind.

Deshalb hängt sich dieser Handler in die Protokollierung und behält die
letzten Meldungen ab WARNING in einem Ring. Bewusst nur im Speicher:
Auf der Platte lägen sie ein zweites Mal (der Container schreibt sie
ohnehin), und der Ring darf einen vollen Datenträger nicht mitverursachen.
"""

from __future__ import annotations

import logging
import time
from collections import deque
from typing import Any

# So viele Meldungen bleiben erhalten. Genug für die Frage «was war heute
# Nacht los», klein genug, um im Speicher nicht aufzufallen.
LIMIT = 300


class LogBuffer(logging.Handler):
    def __init__(self, level: int = logging.WARNING, limit: int = LIMIT) -> None:
        super().__init__(level=level)
        self.records: deque[dict[str, Any]] = deque(maxlen=limit)

    def emit(self, record: logging.LogRecord) -> None:
        # Ein Fehler beim Protokollieren darf nie den Aufrufer stören.
        try:
            self.records.append(
                {
                    "at": record.created,
                    "level": record.levelname,
                    "logger": record.name,
                    "message": record.getMessage()[:2000],
                }
            )
        except Exception:
            pass

    def entries(self, limit: int = LIMIT, level: str | None = None) -> list[dict[str, Any]]:
        """Jüngste zuerst, optional auf eine Stufe eingegrenzt."""
        rows = list(self.records)
        if level:
            wanted = level.upper()
            rows = [row for row in rows if row["level"] == wanted]
        rows.reverse()
        return rows[: max(1, limit)]

    def clear(self) -> None:
        self.records.clear()


def install(level: int = logging.WARNING) -> LogBuffer:
    """Den Ring an die Wurzel hängen – genau einen je Prozess."""
    root = logging.getLogger()
    for handler in root.handlers:
        if isinstance(handler, LogBuffer):
            return handler
    buffer = LogBuffer(level=level)
    buffer.set_name(f"homepilot-logbuffer-{int(time.time())}")
    root.addHandler(buffer)
    return buffer
