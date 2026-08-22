"""Die letzten Log-Meldungen im Speicher behalten, für die App.

Warum: Geht etwas schief, steht die Antwort im Log des Containers – und
die kommt man nur per SSH und ``docker logs`` heran. Das ist genau dann
unbequem, wenn man unterwegs ist und wissen will, warum die Storen nicht
gefahren sind.

Deshalb hängt sich dieser Handler in die Protokollierung und behält die
letzten Meldungen ab WARNING in einem Ring. Bewusst im Speicher, nicht
als Dauer-Mitschrift auf der Platte: Dort lägen sie ein zweites Mal (der
Container schreibt sie ohnehin), und der Ring darf einen vollen
Datenträger nicht mitverursachen.

Eine Ausnahme gibt es: **Beim geordneten Halt** wird der Ring einmal in
eine Datei gelegt und beim nächsten Start zurückgeholt. Das kostet einen
einzigen Schreibvorgang je Neustart und beantwortet die Frage, für die
man den Ring am dringendsten braucht – «warum hat er neu gestartet?» –
genau dann, wenn der Speicher sie gerade vergessen hat. Ein harter
Absturz (SIGKILL, Stromausfall) schreibt naturgemäss nichts; dafür bleibt
``docker logs``.
"""

from __future__ import annotations

import json
import logging
import time
from collections import deque
from pathlib import Path
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

    def save(self, path: str | Path) -> None:
        """Den Ring beim Halt einmal weglegen – still bei jedem Fehler:
        Ein Protokoll darf das Anhalten nie aufhalten."""
        try:
            Path(path).write_text(
                json.dumps(list(self.records), ensure_ascii=False),
                encoding="utf-8",
            )
        except Exception:
            pass

    def load(self, path: str | Path) -> int:
        """Die Meldungen von vor dem Neustart zurückholen.

        Sie kommen *vor* die neuen in den Ring und tragen einen Vermerk,
        damit in der App erkennbar bleibt, dass sie aus dem vorigen Lauf
        stammen. Die Datei wird danach gelöscht: Sie ist eine Übergabe,
        kein Archiv.
        """
        try:
            file = Path(path)
            rows = json.loads(file.read_text(encoding="utf-8"))
            file.unlink()
        except FileNotFoundError:
            return 0
        except Exception:
            return 0
        if not isinstance(rows, list):
            return 0
        alte: list[dict[str, Any]] = []
        for row in rows:
            if not isinstance(row, dict) or "message" not in row:
                continue
            alte.append({**row, "vorher": True})
        neue = list(self.records)
        self.records.clear()
        self.records.extend(alte[-(self.records.maxlen or LIMIT) :])
        self.records.extend(neue)
        return len(alte)


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
