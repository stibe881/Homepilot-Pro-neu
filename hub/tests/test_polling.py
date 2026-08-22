"""Der gemeinsame Polltakt der Integrationen (start_polling).

Der Grund für den Umbau: Wo der Fehlerfang fehlte, beendete die erste
kaputte Antwort den Takt für immer. Genau das prüft der zweite Fall.
"""

import asyncio

from homepilot.core.config import ApiConfig, HubConfig
from homepilot.core.hub import Hub
from homepilot.core.integration import Integration


class Zappelig(Integration):
    """Frischt auf, scheitert beim zweiten Mal - und muss weiterleben."""

    name = "demo"  # bekannter Name, damit scan_interval nicht warnt

    async def setup(self) -> None:
        self.calls = 0

    async def refresh(self) -> None:
        self.calls += 1
        if self.calls == 2:
            raise RuntimeError("kaputte Antwort")


def test_polling_survives_a_broken_answer_and_supports_sofort():
    async def check():
        hub = Hub(HubConfig(api=ApiConfig(), integrations=[]))
        service = Zappelig(hub, {})
        await service.setup()
        # sofort=True: einmal vor dem ersten Schlafen.
        service.start_polling(service.refresh, interval=0.02, sofort=True)
        await asyncio.sleep(0.11)
        await service.teardown()
        # Sofort-Abruf plus mehrere Takte - und der Fehler beim zweiten
        # Aufruf hat die Schleife nicht beendet.
        assert service.calls >= 4

    asyncio.run(check())
