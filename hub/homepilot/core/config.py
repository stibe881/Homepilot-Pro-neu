"""Laden und Validieren der YAML-Konfiguration."""

from __future__ import annotations

import os
import re
from dataclasses import dataclass, field
from pathlib import Path
from typing import Any

import yaml

from .errors import ConfigError

ENV_PATTERN = re.compile(r"\$\{([A-Za-z_][A-Za-z0-9_]*)\}")


class DuplicateKeyLoader(yaml.SafeLoader):
    """YAML-Leser, der doppelt vergebene Schlüssel meldet.

    YAML nimmt bei einem doppelten Schlüssel wortlos den letzten. Steht
    also ``energy:`` zweimal in der Datei, gilt der zweite Preis und der
    erste ist weg – ohne Fehler, ohne Warnung, und man sucht den falschen
    Betrag wochenlang an der falschen Stelle. Das hier ist die Warnung.
    """

    def __init__(self, stream: Any) -> None:
        super().__init__(stream)
        self.duplicates: list[str] = []

    def construct_mapping(self, node: Any, deep: bool = False) -> dict[Any, Any]:
        seen: set[Any] = set()
        for key_node, _ in node.value:
            try:
                key = self.construct_object(key_node, deep=deep)
            except yaml.YAMLError:
                # Ein unlesbarer Schlüssel fällt weg - die Datei selbst wird
                # gleich darauf regulär geprüft und meldet dann sauber.
                continue
            if not isinstance(key, (str, int, float, bool)):
                continue
            if key in seen:
                self.duplicates.append(f"{key} (Zeile {key_node.start_mark.line + 1})")
            seen.add(key)
        return super().construct_mapping(node, deep=deep)


def read_yaml(text: str) -> tuple[Any, list[str]]:
    """YAML lesen und dabei doppelte Schlüssel einsammeln (rein, testbar)."""
    loader = DuplicateKeyLoader(text)
    try:
        return loader.get_single_data(), loader.duplicates
    finally:
        loader.dispose()


@dataclass
class ApiConfig:
    host: str = "0.0.0.0"
    port: int = 8123
    token: str | None = None
    # Herkünfte, denen der Browser Zugriff erlauben darf. "*" ist für ein
    # Gerät im eigenen Netz vertretbar, weil der Token nicht automatisch
    # mitgeschickt wird; einschränken lässt es sich trotzdem.
    cors_origins: list[str] = field(default_factory=lambda: ["*"])


@dataclass
class HubConfig:
    api: ApiConfig = field(default_factory=ApiConfig)
    supabase: dict[str, Any] = field(default_factory=dict)
    integrations: list[dict[str, Any]] = field(default_factory=list)
    automations: list[dict[str, Any]] = field(default_factory=list)
    # Raumname → Liste von Entitäts-IDs. Die App macht daraus ihre Reiter.
    rooms: dict[str, list[str]] = field(default_factory=dict)
    scenes: list[dict[str, Any]] = field(default_factory=list)
    users: list[dict[str, Any]] = field(default_factory=list)
    # Strompreis für die Kostenanzeige, z.B. {price_per_kwh: 0.32, currency: CHF}
    energy: dict[str, Any] = field(default_factory=dict)
    # Standort für Sonnenauf-/-untergangs-Trigger. Standard: Zell LU.
    location: dict[str, Any] = field(default_factory=dict)
    # Gäste-WLAN: {ssid, password, hidden?}. Die Benutzerverwaltung zeigt
    # daraus einen QR-Code, den Gäste mit der Kamera scannen.
    guest_wifi: dict[str, Any] = field(default_factory=dict)
    # Live-Bild: Adressen von mediamtx, falls es nicht neben dem Hub läuft
    # ({mediamtx_api, mediamtx_hls}). Leer = die Standardadressen probieren.
    streaming: dict[str, Any] = field(default_factory=dict)
    # Push-Nachrichten: {public_url: "https://haus.example.ch"} – die von
    # aussen erreichbare Adresse des Hubs. Nur damit kann eine Alarm-Meldung
    # das Kamerabild mitbringen; das Telefon holt es beim Anzeigen selbst,
    # also ohne Token. Ohne diesen Eintrag geht die Nachricht ohne Bild raus.
    #
    # Dazu {person_fenster: 10} – so viele Sekunden wartet der Hub bei einer
    # Kamera mit Personenerkennung darauf, dass wirklich jemand im Bild
    # steht, bevor er das Bild nachreicht. Die Nachricht selbst wartet nie.
    # 0 schaltet das ab. Warum es das gibt: core/personenbild.py.
    push: dict[str, Any] = field(default_factory=dict)
    # Update aus der App: {webhook_url: "https://…"} – die Adresse, die
    # angestossen wird. Ohne Eintrag bleibt der Knopf aus.
    update: dict[str, Any] = field(default_factory=dict)
    # Sprachausgabe der Durchsagen: {engine: piper, voice: "/config/de_DE-….onnx"}.
    # Ohne Block spricht gTTS (braucht Internet). Piper spricht lokal -
    # bessere Stimme, kein Netz; Details in core/say.py.
    speech: dict[str, Any] = field(default_factory=dict)
    # Totmannschalter: {url: "https://hc-ping.com/…", minutes?: 5}. Der
    # Wächter meldet dorthin regelmässig «lebe noch»; bleibt das aus,
    # schlägt der Dienst (z.B. healthchecks.io) Alarm. Der Wächter selbst
    # kann den Ausfall des Hubs nicht melden – er fällt mit aus.
    heartbeat: dict[str, Any] = field(default_factory=dict)
    # Direkter Draht zu Apple (APNs) - nur für Live-Aktivitäten nötig,
    # denn die kann kein Dienst dazwischen anstossen, nur Apple selbst:
    # {key_file: "apns-key.p8", key_id: "ABC123", team_id: "DEF456",
    #  bundle_id: "ch.stibe.homepilot"}. Der Schlüssel kommt aus dem
    # Apple-Entwicklerkonto (Keys → APNs) und liegt neben der config.yaml.
    # Ohne den Block bleibt das Ganze einfach aus. Details:
    # core/liveaktivitaet.py.
    apns: dict[str, Any] = field(default_factory=dict)
    # Ordner mit der gebauten Web-Fassung der App. Ist er da, liefert der
    # Hub sie unter «/» aus – dann genügt eine Adresse für App und
    # Schnittstelle. Leer = der Hub bleibt reine Schnittstelle.
    web_root: str | None = None
    # Wohin in der App angelegte Benutzer und Automationen geschrieben werden.
    data_file: str | None = None
    # Woher diese Konfiguration geladen wurde – für den Editor in der App.
    source_path: str | None = None
    # Doppelt vergebene Schlüssel, die YAML still verworfen hat. Kein
    # Fehler – der Hub soll deswegen nicht stehenbleiben –, aber etwas,
    # das der System-Screen zeigen muss.
    duplicate_keys: list[str] = field(default_factory=list)


# Geheimnisse neben der Konfiguration, für alles, was nicht in der
# config.yaml stehen soll.
#
# Der Weg über Umgebungsvariablen hat einen Haken, der jedes Mal Zeit
# kostet: Bei Portainer genügt es nicht, die Variable im Stack zu setzen -
# sie muss zusätzlich in der environment-Liste der compose-Datei stehen,
# und die liegt im Repository. Für jedes neue Geheimnis also ein Commit,
# ein Ausrollen und die Gelegenheit, genau das zu vergessen.
#
# Diese Datei ist die Abkürzung: eine Zeile je Geheimnis, gleich neben der
# config.yaml, die ohnehin nicht im Repository liegt. Umgebungsvariablen
# haben weiterhin Vorrang - was bereits läuft, ändert sich dadurch nicht.
SECRETS_FILE = "secrets.env"


def read_secrets(path: str | Path) -> dict[str, str]:
    """Zeilen der Form NAME=WERT lesen (rein, testbar).

    Bewusst anspruchslos: keine Fortsetzungszeilen, keine Ersetzungen im
    Wert. Leerzeilen und '#'-Zeilen werden übersprungen, umschliessende
    Anführungszeichen fallen weg - sonst landet das Zeichen im Schlüssel
    und man sucht den Fehler im Gerät.
    """
    datei = Path(path)
    if not datei.is_file():
        return {}
    werte: dict[str, str] = {}
    for zeile in datei.read_text(encoding="utf-8").splitlines():
        zeile = zeile.strip()
        if not zeile or zeile.startswith("#") or "=" not in zeile:
            continue
        name, _, wert = zeile.partition("=")
        name = name.strip()
        if not name:
            continue
        wert = wert.strip()
        if len(wert) >= 2 and wert[0] == wert[-1] and wert[0] in "\"'":
            wert = wert[1:-1]
        werte[name] = wert
    return werte


def expand_env(value: Any, extra: dict[str, str] | None = None) -> Any:
    """Ersetzt ${VARIABLE} rekursiv durch Umgebungsvariablen.

    So bleiben Tokens und Keys aus der Konfigurationsdatei heraus. Eine
    nicht gesetzte Variable ist ein Fehler – lieber ein klarer Abbruch als
    ein Hub, der sich still ohne Datenbank verbindet.

    `extra` sind die Werte aus der secrets.env neben der Konfiguration.
    Die echte Umgebung geht vor: Wer eine Variable im Container setzt,
    soll damit auch gewinnen.
    """
    extra = extra or {}

    if isinstance(value, str):
        def replace(match: re.Match[str]) -> str:
            name = match.group(1)
            resolved = os.environ.get(name)
            if resolved is None:
                resolved = extra.get(name)
            if resolved is None:
                # Zuerst der einfache Weg, dann der bisherige: Die
                # häufigste Ursache ist nicht ein Tippfehler, sondern die
                # Annahme, eine Variable im Portainer-Stack reiche aus.
                # Portainer setzt sie aber nur in die compose-Datei ein;
                # in den Container kommt sie erst durch eine Zeile in
                # deren environment-Liste. Das gehört in die Meldung,
                # sonst sucht man an der falschen Stelle.
                raise ConfigError(
                    f"Umgebungsvariable '{name}' ist nicht gesetzt. Am "
                    f"einfachsten trägst du sie in die Datei {SECRETS_FILE} "
                    "neben dieser Konfiguration ein (eine Zeile "
                    f"'{name}=…'); der Hub liest sie beim Start mit. "
                    "Der andere Weg führt über den Portainer-Stack - dann "
                    "fehlt sie zusätzlich in der environment-Liste der "
                    f"docker-compose-Datei (Zeile "
                    f"'- {name}=${{{name}:-}}'), erst die reicht sie in "
                    "den Container weiter."
                )
            return resolved

        return ENV_PATTERN.sub(replace, value)
    if isinstance(value, dict):
        return {key: expand_env(item, extra) for key, item in value.items()}
    if isinstance(value, list):
        return [expand_env(item, extra) for item in value]
    return value


def load_config(path: str | Path) -> HubConfig:
    path = Path(path)
    if not path.exists():
        raise ConfigError(f"Konfigurationsdatei nicht gefunden: {path}")

    try:
        raw, duplicates = read_yaml(path.read_text(encoding="utf-8"))
        raw = raw or {}
    except yaml.YAMLError as err:
        # Als ConfigError weiterreichen, damit der Fehler überall lesbar
        # ankommt – etwa als Meldung im Konfigurations-Editor der App.
        raise ConfigError(f"Kein gültiges YAML: {err}") from err
    if not isinstance(raw, dict):
        raise ConfigError("Konfiguration muss ein YAML-Mapping sein")
    raw = expand_env(raw, read_secrets(path.parent / SECRETS_FILE))

    api_raw = raw.get("api") or {}
    origins = api_raw.get("cors_origins")
    if origins is not None and not isinstance(origins, list):
        raise ConfigError("'api.cors_origins' muss eine Liste sein")
    api = ApiConfig(
        host=api_raw.get("host", "0.0.0.0"),
        port=int(api_raw.get("port", 8123)),
        token=api_raw.get("token"),
        cors_origins=[str(origin) for origin in origins] if origins else ["*"],
    )

    supabase = raw.get("supabase") or {}
    if not isinstance(supabase, dict):
        raise ConfigError("'supabase' muss ein Mapping sein")

    integrations = raw.get("integrations") or []
    automations = raw.get("automations") or []
    if not isinstance(integrations, list) or not isinstance(automations, list):
        raise ConfigError("'integrations' und 'automations' müssen Listen sein")

    rooms = raw.get("rooms") or {}
    if not isinstance(rooms, dict) or not all(
        isinstance(members, list) for members in rooms.values()
    ):
        raise ConfigError("'rooms' muss Raumnamen auf Listen von Entitäts-IDs abbilden")

    scenes = raw.get("scenes") or []
    users = raw.get("users") or []
    if not isinstance(scenes, list) or not isinstance(users, list):
        raise ConfigError("'scenes' und 'users' müssen Listen sein")

    energy = raw.get("energy") or {}
    if not isinstance(energy, dict):
        raise ConfigError("'energy' muss ein Mapping sein")

    location = raw.get("location") or {}
    if not isinstance(location, dict):
        raise ConfigError("'location' muss ein Mapping sein (latitude, longitude)")

    guest_wifi = raw.get("guest_wifi") or {}
    if not isinstance(guest_wifi, dict):
        raise ConfigError("'guest_wifi' muss ein Mapping sein (ssid, password)")

    streaming = raw.get("streaming") or {}
    if not isinstance(streaming, dict):
        raise ConfigError("'streaming' muss ein Mapping sein (mediamtx_api, mediamtx_hls)")

    web_root = raw.get("web_root")
    if web_root is not None and not isinstance(web_root, str):
        raise ConfigError("'web_root' muss ein Pfad sein")

    update_config = raw.get("update") or {}
    if not isinstance(update_config, dict):
        raise ConfigError("'update' muss ein Mapping sein (webhook_url)")

    speech_config = raw.get("speech") or {}
    if not isinstance(speech_config, dict):
        raise ConfigError("'speech' muss ein Mapping sein (engine, voice)")

    heartbeat_config = raw.get("heartbeat") or {}
    if not isinstance(heartbeat_config, dict):
        raise ConfigError("'heartbeat' muss ein Mapping sein (url, minutes)")
    heartbeat_url = heartbeat_config.get("url")
    if heartbeat_url is not None and not str(heartbeat_url).startswith(
        ("http://", "https://")
    ):
        raise ConfigError(
            "'heartbeat.url' muss mit http:// oder https:// beginnen, "
            f"nicht «{heartbeat_url}»"
        )

    push_config = raw.get("push") or {}
    if not isinstance(push_config, dict):
        raise ConfigError("'push' muss ein Mapping sein (public_url)")
    public_url = push_config.get("public_url")
    if public_url is not None and not str(public_url).startswith(("http://", "https://")):
        # Lieber hier abbrechen als später eine Nachricht mit einem leeren
        # Kasten verschicken, wo ein Bild sein sollte.
        raise ConfigError(
            "'push.public_url' muss mit http:// oder https:// beginnen, "
            f"nicht «{public_url}»"
        )

    # Neben der config.yaml, wenn nichts anderes angegeben ist.
    data_file = raw.get("data_file") or str(path.parent / "homepilot-data.json")

    return HubConfig(
        api=api,
        supabase=supabase,
        data_file=str(data_file),
        integrations=integrations,
        automations=automations,
        rooms={
            str(name): [str(member) for member in members]
            for name, members in rooms.items()
        },
        scenes=scenes,
        users=users,
        streaming=streaming,
        energy=energy,
        location=location,
        guest_wifi=guest_wifi,
        push=push_config,
        update=update_config,
        speech=speech_config,
        heartbeat=heartbeat_config,
        apns=raw.get("apns") or {},
        web_root=str(web_root) if web_root else None,
        source_path=str(path),
        duplicate_keys=duplicates,
    )
