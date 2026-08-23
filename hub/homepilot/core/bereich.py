"""Ein Passwort vor den persönlichen Bereichen.

Das Wandtablet im Flur hängt so, dass jeder daran vorbeigeht. Licht,
Storen, Alarm – alles gut, dafür hängt es da. Die Einkaufsliste, der
Kalender, die Nachrichten der Familie sind etwas anderes: Sie stehen
sonst offen im Flur, auch für den Besuch, der auf den Kaffee wartet.

Darum kann die Verwaltung je Benutzer ein Passwort hinterlegen. Wer die
persönlichen Bereiche öffnet, tippt es einmal ein; danach bleibt es für
eine Weile offen, sonst tippt man es zwanzigmal am Tag.

Bewusst kein zweiter Anmeldeweg: Es ist ein Riegel vor einer Tür, hinter
der man ohnehin schon steht. Der Zugang selbst hängt am Token.

Gespeichert wird nur ein gesalzener Hashwert – wie bei der Alarm-PIN. Die
Verwaltung kann ein neues setzen, aber keines ablesen.
"""

from __future__ import annotations

import hashlib
import secrets
from typing import Any

# So lange bleibt der Bereich nach dem Eintippen offen. Zehn Minuten: lang
# genug für «Liste ansehen, etwas ergänzen, Kalender prüfen», kurz genug,
# dass es nicht offen steht, wenn die nächste Person vorbeikommt.
OPEN_SECONDS = 10 * 60


def hash_secret(secret: str, salt: str) -> str:
    """Passwort gesalzen hashen (rein, testbar)."""
    return hashlib.sha256((salt + secret).encode("utf-8")).hexdigest()


def make_entry(secret: str) -> dict[str, str]:
    """Der Eintrag, der gespeichert wird – mit frischem Salz."""
    salt = secrets.token_hex(8)
    return {"salt": salt, "hash": hash_secret(secret, salt)}


def matches(entry: Any, secret: str) -> bool:
    """Stimmt das Passwort mit dem Eintrag überein? (rein, testbar)"""
    if not isinstance(entry, dict) or not secret:
        return False
    salt = str(entry.get("salt") or "")
    return bool(salt) and secrets.compare_digest(
        hash_secret(secret, salt), str(entry.get("hash") or "")
    )


def check_length(secret: str) -> str:
    """Wirft für zu kurze Passwörter – oder gibt das saubere zurück.

    Vier Zeichen sind die Untergrenze, weil auch eine vierstellige Zahl
    reichen soll: Am Wandtablet tippt man auf Glas, nicht auf einer
    Tastatur.
    """
    clean = (secret or "").strip()
    if len(clean) < 4:
        raise ValueError("Das Passwort braucht mindestens 4 Zeichen.")
    return clean
