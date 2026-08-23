"""Sitzungen: was nach der Anmeldung bleibt.

Nach einer erfolgreichen Anmeldung mit E-Mail und Passwort stellt der Hub
eine eigene Sitzung aus. Ab dann läuft alles wie bisher über ein Token im
Kopf jeder Anfrage – nur dass dieses Token nicht mehr von Hand verteilt
wurde, sondern hinter einer richtigen Anmeldung steht.

Der Grund für den Umweg: Der Hub steuert das Haus und muss das auch dann
tun, wenn das Internet weg ist. Würde jede Anfrage bei Supabase
nachfragen, stünde die Wohnung bei jeder Störung still.

Gespeichert wird nur der Hashwert des Tokens. Wer die Datendatei in die
Hände bekommt, hat damit noch keine gültige Sitzung – anders als bei den
fest vergebenen Tokens, die dort im Klartext stehen müssen, weil sie auch
in QR-Codes und Kurzbefehlen auftauchen.
"""

from __future__ import annotations

import hashlib
import secrets
import time
from typing import Any

# So lange gilt eine Sitzung ohne Benutzung. Drei Monate: lang genug, dass
# niemand sich ständig neu anmeldet, kurz genug, dass ein vergessenes
# Zweitgerät nicht ewig offen bleibt.
MAX_AGE = 90 * 24 * 3600
# Mehr Sitzungen je Person braucht niemand; die ältesten fallen heraus.
PER_USER = 10


def hash_token(token: str) -> str:
    """Das, was gespeichert wird (rein, testbar)."""
    return hashlib.sha256(token.encode("utf-8")).hexdigest()


def bleibt(row: dict[str, Any], moment: float) -> bool:
    """Gilt diese Sitzung noch? (rein, testbar)

    ``keep`` steht auf Sitzungen von Geräten, die allen gehören - dem
    Wandtablet im Flur. Es hat keine Hosentasche, aus der es jemand
    mitnehmen könnte, und niemand tippt dort eine E-Mail-Adresse samt
    Passwort ein, bloss weil drei Monate um sind. Es soll nach einem
    Stromausfall einfach wieder da sein.
    """
    if row.get("keep"):
        return True
    return moment - float(row.get("seen") or 0) < MAX_AGE


def prune(rows: list[dict[str, Any]], now: float | None = None) -> list[dict[str, Any]]:
    """Abgelaufene entfernen und je Person auf ``PER_USER`` kürzen (rein)."""
    moment = time.time() if now is None else now
    fresh = [
        row for row in rows or [] if isinstance(row, dict) and bleibt(row, moment)
    ]
    fresh.sort(key=lambda row: float(row.get("seen") or 0), reverse=True)
    counted: dict[str, int] = {}
    kept = []
    for row in fresh:
        user = str(row.get("user") or "")
        counted[user] = counted.get(user, 0) + 1
        if counted[user] <= PER_USER:
            kept.append(row)
    return kept


class SessionStore:
    def __init__(self, data: Any) -> None:
        self._data = data

    def _rows(self) -> list[dict[str, Any]]:
        return self._data.get("sessions")

    def _save(self, rows: list[dict[str, Any]]) -> None:
        self._data.set("sessions", rows)

    def create(self, user: str, label: str = "", keep: bool = False) -> str:
        """Eine neue Sitzung – gibt das Token zurück, das nur jetzt sichtbar ist.

        ``keep`` für Gemeinschaftsgeräte: Die Sitzung läuft nie ab (siehe
        ``bleibt``).
        """
        token = secrets.token_urlsafe(32)
        now = time.time()
        rows = prune(self._rows())
        rows.insert(
            0,
            {
                "hash": hash_token(token),
                "user": user,
                "label": label,
                "created": now,
                "seen": now,
                "keep": bool(keep),
            },
        )
        self._save(prune(rows))
        return token

    def user_for(self, token: str) -> str | None:
        """Zu welchem Benutzer gehört dieses Token? (None = keine Sitzung)

        Nebenbei wird der Zeitstempel nachgeführt – eine Sitzung, die
        benutzt wird, läuft nicht ab.
        """
        if not token:
            return None
        wanted = hash_token(token)
        rows = self._rows()
        now = time.time()
        for row in rows:
            if not isinstance(row, dict) or row.get("hash") != wanted:
                continue
            if not bleibt(row, now):
                return None
            # Nur gelegentlich schreiben: Jede Anfrage würde die Datei
            # dutzendfach pro Minute neu schreiben.
            if now - float(row.get("seen") or 0) > 3600:
                row["seen"] = now
                self._save(rows)
            return str(row.get("user") or "") or None
        return None

    def revoke(self, token: str) -> bool:
        wanted = hash_token(token)
        rows = self._rows()
        rest = [row for row in rows if row.get("hash") != wanted]
        if len(rest) == len(rows):
            return False
        self._save(rest)
        return True

    def revoke_user(self, user: str) -> int:
        """Alle Sitzungen einer Person beenden – etwa nach «Passwort weg»."""
        rows = self._rows()
        rest = [row for row in rows if row.get("user") != user]
        self._save(rest)
        return len(rows) - len(rest)

    def list_for(self, user: str) -> list[dict[str, Any]]:
        return [
            {k: v for k, v in row.items() if k != "hash"}
            for row in prune(self._rows())
            if row.get("user") == user
        ]
