"""Welche Kamera zu einem Ereignis gehört.

Zwei Fragen, dieselbe Antwort: Die Alarmanlage sucht die Kamera zum
ausgelösten Sensor, ein Ablauf die Kamera zum Auslöser seiner Nachricht.
Stand beides getrennt in den Integrationen, hätte der Ablauf-Kern von
der Alarmanlage abhängen müssen - deshalb hier im Kern, wo beide
hinsehen dürfen.
"""

from __future__ import annotations

from typing import Any

from .entity import Entity, EntityKind

# Der Wert, mit dem ein Ablauf «die Kamera, die ausgelöst hat» meint.
# Ein Wort statt einer Kennung: Genau das ist der Punkt - der Ablauf soll
# für alle Kameras gelten, nicht für eine.
TRIGGER = "trigger"


def nearest_camera(entities: list[Entity], room: str | None) -> str | None:
    """Die Kamera im selben Raum wie der Auslöser (rein, testbar).

    Ohne Raum keine Kamera: Eine beliebige zu nehmen wäre schlimmer als
    keine - man sähe ein Bild und hielte es für den richtigen Ort.
    """
    if not room:
        return None
    for entity in entities:
        if entity.kind == EntityKind.CAMERA and entity.room == room:
            return entity.id
    return None


def camera_for(entity: Entity, entities: list[Entity]) -> str | None:
    """Welche Kamera gehört zu diesem Auslöser? (rein, testbar)

    Ist der Auslöser selbst eine Kamera, ist die Frage beantwortet - auch
    dann, wenn ihr niemand einen Raum zugeordnet hat. Vorher suchte auch
    eine auslösende Kamera erst nach «einer Kamera in ihrem Raum» und ging
    ohne Raum leer aus: kein Bild, kein Sprung zur Kamera beim Antippen.
    """
    if entity.kind == EntityKind.CAMERA:
        return entity.id
    return nearest_camera(entities, entity.room)


def fill(text: Any, entity: Entity | None) -> str:
    """Platzhalter im Nachrichtentext füllen (rein, testbar).

    «Jemand weint im Zimmer {raum}» soll für alle Kinderzimmer gelten und
    nicht je Kamera abgeschrieben werden. Bekannt sind {gerät}, {raum} und
    {meldung}; ohne auslösendes Gerät bleibt alles leer statt geschweifte
    Klammern in der Nachricht stehen zu lassen.

    {meldung} ist der Text, den das Gerät selbst zu sagen hat - bei
    MeteoAlarm «Sturm, stark, bis 18:00». Ein Ablauf «Sturmwarnung als
    Push» muss ihn damit nicht abschreiben, und die Nachricht sagt, wovor
    gewarnt wird, statt bloss dass gewarnt wird. Geräte ohne `headline`
    lassen ihn leer - die meisten haben nichts zu sagen ausser ihrem
    Zustand.
    """
    satz = str(text or "")
    if "{" not in satz:
        return satz
    name = entity.label if entity is not None else ""
    raum = (entity.room if entity is not None else "") or ""
    meldung = str((entity.state.get("headline") if entity is not None else "") or "")
    for schluessel, wert in (
        ("{gerät}", name),
        ("{geraet}", name),
        ("{raum}", raum),
        ("{meldung}", meldung),
    ):
        satz = satz.replace(schluessel, wert)
    # Doppelte Leerzeichen, wo ein Platzhalter leer blieb: «Jemand weint
    # im Zimmer .» liest sich schlecht genug, ohne Lücke davor.
    return " ".join(satz.split())
