class HomePilotError(Exception):
    """Basisklasse für alle Hub-Fehler."""


class ConfigError(HomePilotError):
    """Ungültige oder fehlende Konfiguration."""


class UnknownEntityError(HomePilotError):
    def __init__(self, entity_id: str) -> None:
        super().__init__(f"Unbekannte Entität: {entity_id}")
        self.entity_id = entity_id


class UnsupportedCommandError(HomePilotError):
    def __init__(self, entity_id: str, command: str) -> None:
        super().__init__(f"Entität {entity_id} unterstützt Kommando '{command}' nicht")
        self.entity_id = entity_id
        self.command = command
