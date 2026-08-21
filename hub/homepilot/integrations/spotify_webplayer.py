"""Web-Player-Zugriffstoken von Spotify holen (für das Wecken von Cast-Boxen).

Warum nötig: Der Geräte-Anmelde-Endpunkt (device-auth), über den eine
Cast-Box zum Spotify-Connect-Ziel wird, akzeptiert **nur** Tokens des
offiziellen Web-Players – ein Token unserer eigenen App wird mit «RBAC:
access denied» abgewiesen. Der Web-Player-Token wiederum hängt an einem
Browser-Cookie (sp_dc) plus einem zeitbasierten Einmalcode (TOTP), dessen
Geheimnis Spotify im Web-Player-JavaScript versteckt. Dieselbe Mechanik
nutzen «Spotcast» und verwandte Projekte.

Das ist eine inoffizielle Schnittstelle: Ändert Spotify das TOTP-Verfahren,
klemmt das Wecken, bis die Secrets nachgezogen sind. Der reguläre Rest der
Integration (Playlisten, Steuern, Wiedergabe umziehen) läuft unabhängig
davon über die offizielle Web-API weiter.
"""

from __future__ import annotations

import base64
import hashlib
import hmac
import json
import struct
import time

import aiohttp

SERVER_TIME_URL = "https://open.spotify.com/api/server-time"
TOKEN_URL = "https://open.spotify.com/api/token"
# Von der Gemeinschaft gepflegte TOTP-Geheimnisse (stündlich aktualisiert).
# Zur Laufzeit wird die frische Fassung geladen; das hier ist der Rückfall.
SECRETS_URL = "https://raw.githubusercontent.com/xyloflake/spot-secrets-go/main/secrets/secretDict.json"
FALLBACK_SECRETS: dict[str, list[int]] = {
    "59": [123, 105, 79, 70, 110, 59, 52, 125, 60, 49, 80, 70, 89, 75, 80, 86, 63, 53, 123, 37, 117, 49, 52, 93, 77, 62, 47, 86, 48, 104, 68, 72],
    "60": [79, 109, 69, 123, 90, 65, 46, 74, 94, 34, 58, 48, 70, 71, 92, 85, 122, 63, 91, 64, 87, 87],
    "61": [44, 55, 47, 42, 70, 40, 34, 114, 76, 74, 50, 111, 120, 97, 75, 76, 94, 102, 43, 69, 49, 120, 118, 80, 64, 78],
}


def secret_to_base32(cipher_bytes: list[int]) -> str:
    """Wandelt die versteckten Bytes in den Base32-TOTP-Schlüssel (rein, testbar).

    Jedes Byte wird mit ((Position mod 33) + 9) XOR-verknüpft, die Zahlen
    aneinandergehängt, das Ergebnis als Text hex-kodiert und Base32-kodiert –
    exakt das Verfahren aus dem Web-Player.
    """
    transformed = [value ^ ((index % 33) + 9) for index, value in enumerate(cipher_bytes)]
    joined = "".join(str(number) for number in transformed)
    hex_str = joined.encode().hex()
    return base64.b32encode(bytes.fromhex(hex_str)).decode().rstrip("=")


def totp_at(secret_base32: str, moment_seconds: float, digits: int = 6, period: int = 30) -> str:
    """Standard-TOTP (HMAC-SHA1) zu einem Zeitpunkt (rein, testbar)."""
    counter = int(moment_seconds // period)
    key = base64.b32decode(secret_base32 + "=" * (-len(secret_base32) % 8))
    mac = hmac.new(key, struct.pack(">Q", counter), hashlib.sha1).digest()
    offset = mac[-1] & 0x0F
    binary = struct.unpack(">I", mac[offset : offset + 4])[0] & 0x7FFFFFFF
    return str(binary % (10**digits)).zfill(digits)


def newest_secret(secrets: dict[str, list[int]]) -> tuple[str, list[int]]:
    """Die höchste Versionsnummer gewinnt (rein, testbar)."""
    version = max(secrets, key=lambda key: int(key))
    return version, secrets[version]


class WebPlayerAuth:
    """Holt (und cached) ein Web-Player-Zugriffstoken über sp_dc + TOTP."""

    def __init__(self, sp_dc: str) -> None:
        self._sp_dc = sp_dc
        self._token: str | None = None
        self._expires_at = 0.0
        self._secrets: dict[str, list[int]] | None = None

    async def _load_secrets(self, session: aiohttp.ClientSession) -> dict[str, list[int]]:
        if self._secrets is not None:
            return self._secrets
        try:
            async with session.get(
                SECRETS_URL, timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                text = await response.text()
            self._secrets = json.loads(text)
        except Exception:
            # Kein Netz zu GitHub? Mit der eingebauten Fassung weiterarbeiten.
            self._secrets = FALLBACK_SECRETS
        return self._secrets

    async def token(self, session: aiohttp.ClientSession) -> str:
        now = time.time()
        if self._token and now < self._expires_at:
            return self._token

        headers = {
            "User-Agent": "Mozilla/5.0 (Windows NT 10.0; Win64; x64)",
            "Accept": "application/json",
            "Referer": "https://open.spotify.com/",
            "App-Platform": "WebPlayer",
            "Cookie": f"sp_dc={self._sp_dc}",
        }

        # Spotifys eigene Zeit nehmen – die Uhr des Servers kann abweichen.
        try:
            async with session.get(
                SERVER_TIME_URL, headers=headers, timeout=aiohttp.ClientTimeout(total=10)
            ) as response:
                payload = await response.json(content_type=None)
            server_time = float((payload or {}).get("serverTime") or now)
        except Exception:
            server_time = now

        secrets = await self._load_secrets(session)
        version, cipher = newest_secret(secrets)
        secret_base32 = secret_to_base32(cipher)
        otp = totp_at(secret_base32, server_time)

        params = {
            "reason": "transport",
            "productType": "web-player",
            "totp": otp,
            "totpServer": otp,
            "totpVer": version,
        }
        async with session.get(
            TOKEN_URL, params=params, headers=headers,
            timeout=aiohttp.ClientTimeout(total=10),
        ) as response:
            text = await response.text()
        try:
            data = json.loads(text) if text else {}
        except ValueError:
            data = {}

        token = data.get("accessToken")
        if not token:
            raise RuntimeError(
                f"Web-Player-Token abgelehnt (HTTP {response.status}): "
                f"{text[:160] or 'leere Antwort'} – sp_dc-Cookie abgelaufen? "
                "Neu aus dem Browser holen (open.spotify.com → Anwendung → "
                "Cookies → sp_dc)."
            )
        # Etwas vor Ablauf verfallen lassen, damit kein Aufruf ins Leere geht.
        expires_ms = data.get("accessTokenExpirationTimestampMs")
        self._expires_at = (
            float(expires_ms) / 1000 - 30 if expires_ms else now + 3000
        )
        self._token = token
        return token
