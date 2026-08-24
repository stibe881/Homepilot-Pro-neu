"""Einladen mit Link und Passwort – statt den Hausschlüssel zu verschicken.

Bisher lief das Einladen so: Der Hub baute eine Zeile aus Adresse, Name
und Token, und die verschickte man als Nachricht. Der Hinweis daneben
sagte die Wahrheit – «der Text enthält das Token, er ist der Schlüssel
zum Haus» – und genau das ist das Problem. Ein Schlüssel, der einmal in
einem Chat liegt, liegt dort für immer: in der Sicherung des Telefons,
in der Wolke des Anbieters, in der Vorschau auf dem Sperrbildschirm.

Darum jetzt zwei Teile, die getrennt reisen:

  * Ein **Link** mit einer kurzen, zufälligen Kennung. Er allein öffnet
    nichts – er zeigt nur ein Feld für das Passwort.
  * Ein **Passwort**, das der Einladende festlegt und auf einem anderen
    Weg durchgibt (am Telefon, persönlich, in einer anderen App).

Erst beides zusammen gibt den Zugang heraus. Wer den Chat mitliest, hat
nichts; wer das Passwort hört, ohne den Link zu haben, ebenso.

Drei Dinge, ohne die das nur nach Sicherheit aussähe:

  * **Das Passwort wird nie gespeichert**, nur ein Abdruck davon
    (PBKDF2 mit Salz). Wer die hub.data liest, kann damit nichts
    anfangen.
  * **Wenige Versuche.** Eine kurze Kennung plus ein Passwort wäre ohne
    Deckel ratbar. Nach `MAX_VERSUCHE` Fehlversuchen ist die Einladung
    tot – nicht gesperrt, tot. Wer sich vertippt hat, bekommt eine neue.
  * **Ablauf und einmaliger Gebrauch.** Eine Einladung ist ein
    Türöffner, kein Zweitschlüssel.

Hier steht nur das Rechnen; wo die Zeilen liegen, weiss die Route.
"""

from __future__ import annotations

import hashlib
import hmac
import secrets
from typing import Any

# Wie lange eine Einladung gilt, wenn niemand etwas anderes sagt. Ein
# Tag deckt «ich schicke es dir jetzt, du machst es heute Abend» ab.
DEFAULT_MINUTES = 24 * 60
# Länger als eine Woche ist kein Einladen mehr, sondern ein Zweitschlüssel.
MAX_MINUTES = 7 * 24 * 60

# Kurz genug zum Vorlesen, lang genug, dass Raten sinnlos ist – zusammen
# mit der Versuchsgrenze. 40 Bit aus dem Alphabet unten.
KENNUNG_ZEICHEN = 10
# Ohne die Zeichen, die man am Telefon verwechselt: 0/O, 1/l/I.
ALPHABET = "abcdefghijkmnpqrstuvwxyz23456789"

# Kürzere Passwörter sind kein Schutz, sondern ein Gefühl davon.
MIN_LAENGE = 6
# Nach so vielen Fehlversuchen ist die Einladung verbraucht.
MAX_VERSUCHE = 5

# So lange bleibt eine erledigte Einladung noch als Auskunft liegen –
# damit «abgelaufen» auch «abgelaufen» heissen kann und nicht «gibt es
# nicht». Einen Tag; danach ist die Frage ohnehin eine andere.
GNADENFRIST = 24 * 3600

# PBKDF2-Runden. Genug, dass Durchprobieren teuer wird, wenig genug, dass
# der Hub auf schwacher Hardware nicht sekundenlang rechnet.
RUNDEN = 200_000


def kennung(zeichen: int = KENNUNG_ZEICHEN) -> str:
    """Eine zufällige Kennung für den Link (nicht rein – zieht Zufall)."""
    return "".join(secrets.choice(ALPHABET) for _ in range(zeichen))


def abdruck(passwort: str, salz: str) -> str:
    """Der Abdruck eines Passworts (rein, testbar).

    PBKDF2-HMAC-SHA256 aus der Standardbibliothek – keine neue
    Abhängigkeit für etwas, das jede Python-Fassung mitbringt.
    """
    return hashlib.pbkdf2_hmac(
        "sha256", passwort.encode("utf-8"), salz.encode("utf-8"), RUNDEN
    ).hex()


def passwort_haltbar(passwort: Any) -> str | None:
    """Taugt dieses Passwort? Sonst der Satz, der es erklärt (rein, testbar)."""
    text = str(passwort or "")
    if len(text.strip()) < MIN_LAENGE:
        return f"Das Passwort braucht mindestens {MIN_LAENGE} Zeichen."
    if text != text.strip():
        return "Das Passwort fängt oder endet mit einem Leerzeichen – das vertippt sich."
    return None


def neu(
    benutzer: str,
    passwort: str,
    jetzt: float,
    minuten: int = DEFAULT_MINUTES,
    id_: str | None = None,
    salz: str | None = None,
) -> dict[str, Any]:
    """Eine Einladung anlegen (rein bis auf den Zufall, testbar).

    Kennung und Salz lassen sich hereinreichen – so ist die Funktion im
    Test vorhersagbar, ohne dass der Zufall im Betrieb schwächer wird.
    """
    dauer = max(1, min(int(minuten or DEFAULT_MINUTES), MAX_MINUTES))
    korn = salz or secrets.token_hex(16)
    return {
        "id": id_ or kennung(),
        "user": str(benutzer),
        "salt": korn,
        "hash": abdruck(str(passwort), korn),
        "created": jetzt,
        "expires": jetzt + dauer * 60,
        "tries": 0,
        "used_at": None,
    }


def zustand(zeile: Any, jetzt: float) -> str:
    """Wie steht es um diese Einladung? (rein, testbar)

    «offen», «abgelaufen», «gebraucht» oder «verbraucht» (zu viele
    Fehlversuche). Vier Wörter statt eines Wahrheitswerts, weil der
    Empfänger den Unterschied wissen soll: «abgelaufen» heisst «frag nach
    einer neuen», «falsch» heisst «schau nochmal aufs Passwort».
    """
    if not isinstance(zeile, dict):
        return "unbekannt"
    if zeile.get("used_at"):
        return "gebraucht"
    if int(zeile.get("tries") or 0) >= MAX_VERSUCHE:
        return "verbraucht"
    try:
        bis = float(zeile.get("expires") or 0)
    except (TypeError, ValueError):
        return "abgelaufen"
    if bis <= jetzt:
        return "abgelaufen"
    return "offen"


def stimmt(zeile: dict[str, Any], passwort: str) -> bool:
    """Passt das Passwort? (rein, testbar)

    Vergleich in fester Zeit: Ein Vergleich, der beim ersten
    Unterschied abbricht, verrät über die Dauer, wie viel schon stimmt.
    """
    erwartet = str(zeile.get("hash") or "")
    gerechnet = abdruck(str(passwort), str(zeile.get("salt") or ""))
    return bool(erwartet) and hmac.compare_digest(erwartet, gerechnet)


def finde(rows: Any, id_: str) -> dict[str, Any] | None:
    """Die Einladung zu dieser Kennung (rein, testbar)."""
    gesucht = str(id_ or "").strip().lower()
    if not gesucht:
        return None
    for row in rows or []:
        if isinstance(row, dict) and str(row.get("id") or "").lower() == gesucht:
            return row
    return None


def ersetze(rows: Any, zeile: dict[str, Any]) -> list[dict[str, Any]]:
    """Eine Einladung austauschen (rein, testbar)."""
    andere = [
        row
        for row in rows or []
        if isinstance(row, dict) and row.get("id") != zeile.get("id")
    ]
    return [zeile, *andere]


def aufraeumen(rows: Any, jetzt: float, frist: float = GNADENFRIST) -> list[dict[str, Any]]:
    """Verbrauchte Einladungen wegwerfen (rein, testbar).

    Nicht sofort: Eine Einladung, die eben abgelaufen ist, soll das auch
    sagen können. Verschwindet sie im selben Moment, liest der Empfänger
    «diesen Link gibt es nicht» – und sucht den Fehler bei sich, statt um
    eine neue zu bitten. Darum eine Gnadenfrist, in der die Zeile nur
    noch Auskunft gibt und nichts mehr öffnet.

    Danach fliegt sie weg: Ein Abdruck hat in einer Datei nichts
    verloren, die in die Sicherung wandert und nichts mehr tut.
    """
    behalten = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if zustand(row, jetzt) == "offen":
            behalten.append(row)
            continue
        try:
            ende = max(float(row.get("expires") or 0), float(row.get("used_at") or 0))
        except (TypeError, ValueError):
            continue
        if ende and jetzt - ende <= frist:
            behalten.append(row)
    return behalten
