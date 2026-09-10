"""Zwei Telefone, derselbe Zeile - Punkt 341 der Werkbank.

Familienlisten werden per PUT ganz überschrieben (``item.update(body)`` in
``api/routes/family.py``). Bearbeiten zwei Telefone denselben Eintrag
kurz nacheinander, gewinnt bisher schlicht, wer zuletzt speichert - das
zweite PUT trägt noch den Stand von vor der ersten Änderung und löscht
sie damit wieder, ohne dass irgendwer es merkt. Am ehesten trifft das
eine Liste, die mehrere gleichzeitig pflegen (Einkauf, Ämtli) und eine
Notiz, die zwei Personen fast zeitgleich ergänzen.

Der Ausweg ist keine Sperre - ein Eintrag, den ein Telefon «besitzt»,
bliebe nach einem Absturz für immer gesperrt -, sondern ein Stempel:
Jeder Eintrag trägt ``updated`` (Unix-Sekunden der letzten Änderung, vom
Hub gesetzt). Wer speichert, schickt den Stempel mit, den er beim Laden
gesehen hat; weicht er vom gespeicherten ab, hat sich der Eintrag
inzwischen geändert, und der Hub weist mit 409 zurück statt still zu
überschreiben - die App lädt neu und zeigt, was inzwischen dazukam.
"""

from __future__ import annotations

from typing import Any


def stempel_passt(gespeichert: Any, erwartet: Any) -> bool:
    """Ob der von der App mitgeschickte Stempel noch zum gespeicherten
    passt (rein, testbar).

    Fehlt der erwartete Stempel, wird nicht geprüft - das ist der weiche
    Übergang für ältere App-Fassungen und für Einträge, die noch nie
    einen Stempel trugen, kein Freibrief: Sobald der Hub einmal einen
    Stempel gesetzt hat, kommt er in jeder Antwort mit zurück, und die
    nächste Änderung derselben App schickt ihn dann auch mit.
    """
    if erwartet is None:
        return True
    return gespeichert == erwartet
