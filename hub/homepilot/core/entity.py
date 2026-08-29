"""Einheitliches Entitätsmodell.

Jede Integration übersetzt ihre Geräte in Entities. Konvention für den
Zustand: der Hauptwert liegt immer unter dem Schlüssel ``state``
(z.B. "on"/"off" bei Lichtern, ein Messwert bei Sensoren), weitere
Attribute (brightness, unit, ...) liegen daneben. Automationen und die
App verlassen sich auf diese Konvention.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


class EntityKind:
    LIGHT = "light"
    SWITCH = "switch"
    SENSOR = "sensor"
    BINARY_SENSOR = "binary_sensor"
    ALERT = "alert"
    MEDIA_PLAYER = "media_player"
    CAMERA = "camera"
    VACUUM = "vacuum"
    APPLIANCE = "appliance"
    CALENDAR = "calendar"
    # Türöffner (z.B. Ring Intercom). Bewusst nicht in den Gast-Standards –
    # wer die Haustür öffnen darf, bekommt sie explizit freigegeben.
    LOCK = "lock"
    # Storen/Rollläden/Markisen (auf/ab/stopp, Position).
    COVER = "cover"
    # Wetterlage mit heutigem Wert und Mehrtagesvorhersage.
    WEATHER = "weather"
    # Wandtaster und Fernbedienungen. Sie haben keinen Zustand, den man
    # ablesen könnte – sie melden einen Druck. Der Zustand ist deshalb der
    # letzte Druck («short»/«long»); ein Ablauf kann darauf auslösen.
    BUTTON = "button"
    # Die Alarmanlage selbst: scharf/unscharf und in welchem Modus. Gäste
    # sehen sie bewusst nie – wer scharfschalten darf, ist eine Frage der
    # Rolle, nicht der Freigabe einzelner Bereiche.
    ALARM = "alarm"
    # Eine auf einer Bridge gespeicherte Lichtszene (Philips Hue). Sie hat
    # keinen Zustand, den man stellen könnte: Farben und Helligkeiten
    # liegen auf der Bridge, und nur sie kann alles in einem Zug setzen.
    # Der Hub ruft sie auf – ein Knopf, kein Regler.
    #
    # Als Entität und nicht als blosse Namensliste, weil das der einzige
    # Weg ist, sie überall dorthin zu bringen, wo ein Gerät steht: in eine
    # Szene des Hubs, in einen Ablauf, als Kachel in den Raum. Die Liste
    # gab es schon – aber nur im Ablauf-Editor, und in einer Szene liess
    # sich eine Hue-Szene deshalb gar nicht verwenden.
    SCENE = "scene"
    # Ein Timer als eigene Kachel – etwa der Einschlaf-Timer des
    # Fernsehers. Er steckt schon in der Fernsehkachel; als Entität kann
    # er zusätzlich dort stehen, wo Kacheln eben stehen: unter Geräte,
    # in den Favoriten, in einem Raum. Der Zustand gehört weiter dem
    # Gerät, dem er dient – die Timer-Entität spiegelt ihn nur.
    TIMER = "timer"


@dataclass
class Entity:
    id: str  # "<integration>.<object_id>"
    kind: str
    name: str
    integration: str
    state: dict[str, Any] = field(default_factory=dict)
    commands: list[str] = field(default_factory=list)
    # Antwortet das Gerät? – und *nur* das.
    #
    # Dreissig Stellen setzen dieses Feld, und sie meinten nicht alle
    # dasselbe. Die App macht daraus ein einziges «nicht erreichbar»,
    # also braucht es eine einzige Bedeutung:
    #
    # **False heisst: Der Hub hat es versucht und keine Antwort bekommen.**
    # Ein Funkgerät, das nicht mehr meldet. Eine Bridge, die einen Fehler
    # zurückgibt. Eine Cloud, die nicht antwortet.
    #
    # **False heisst ausdrücklich nicht:**
    #
    # - «ausgeschaltet» – das steht in ``state``. Eine Steckdose, die aus
    #   ist, ist erreichbar.
    # - «hat noch nie etwas gemeldet» – ein Wandtaster hat keinen Zustand,
    #   den man abfragen könnte; er ist trotzdem da.
    # - «kann diesen Befehl nicht» – das steht in ``commands``.
    # - «Cloud gerade langsam» – ein einzelner Zeitablauf ist kein
    #   Ausfall. Erst wenn mehrere Versuche in Folge scheitern, ist es
    #   einer; sonst blinkt die halbe Wohnung im Minutentakt rot.
    #
    # ``last_seen`` gehört dazu und wird zentral in der Registry gesetzt:
    # bei jeder Meldung, nicht nur bei jeder Änderung. Ein Gerät, das
    # unverändert weiterberichtet, ist gesehen worden.
    available: bool = True
    # Raum aus der Konfiguration; die App gruppiert danach.
    room: str | None = None
    # In der App vergebener Anzeigename (überschreibt den der Integration).
    display_name: str | None = None
    # Auf der Startseite als Favorit anzeigen.
    favorite: bool = False
    # Frei wählbare Anzeige-Kategorie (z.B. «Decke»), rein zum Sortieren
    # innerhalb eines Raums. Sie fasst nichts zusammen.
    group: str | None = None
    # Kennung der Lampe, in der diese Entität aufgeht – gesetzt, wenn sie
    # Mitglied einer zusammengefassten Leuchte ist. Eine Deckenlampe mit
    # fünf Spots soll ein Licht sein, nicht fünf: Wer das hier stehen hat,
    # verschwindet aus Räumen, Suche und Zählung und ist nur noch unter
    # Geräte zu finden. Bedienen lässt er sich dort weiterhin einzeln –
    # zum Ausrichten beim Einbau braucht man das.
    combined_into: str | None = None
    # Zeitpunkt (Epoch-Sekunden), zu dem das Gerät zuletzt erreichbar war –
    # für «zuletzt gesehen vor …» bei offline-Geräten.
    last_seen: float | None = None
    # Wann sich der Zustand zuletzt wirklich geändert hat, und wodurch.
    #
    # «Warum ist das Licht um drei Uhr angegangen?» stand bisher nur im
    # Protokoll – einen Abruf je Gerät entfernt. Hier reist die Antwort
    # mit dem Zustand mit: dieselbe Leitung, keine zusätzliche Anfrage.
    # Gezählt wird wie im Protokoll (eventlog.worth_recording): ein
    # echter Wechsel, keine Helligkeitszappelei am brennenden Licht.
    last_change: float | None = None
    #: {"kind": "automation", "label": "Bewegung Flur"}. Was nicht über
    #: den Hub kam, meldet sich als {"kind": "device"} – Wandschalter,
    #: Hersteller-App, Zeitschaltung im Gerät selbst (siehe core/source).
    last_source: dict[str, Any] | None = None

    @property
    def label(self) -> str:
        """Wie das Gerät heisst, wenn ein Mensch es liest (rein).

        `name` ist, was die Integration liefert - beim Matter-Kontakt am
        Küchenfenster heisst das «Aqara Door and Window Sensor P2». Das
        steht auf der Verpackung und beantwortet keine Frage: In der
        Mitteilung «… steht offen» will man wissen, *welches* Fenster.

        Die App zeigt seit je den selbst vergebenen Namen (`as_dict`
        unten). Alles, was der Hub in Worte fasst - Mitteilungen,
        Ansagen, Ablauf-Sätze -, gehört an dieselbe Quelle.
        """
        return self.display_name or self.name

    def as_dict(self) -> dict[str, Any]:
        return {
            "id": self.id,
            "kind": self.kind,
            "name": self.label,
            "integration": self.integration,
            "state": dict(self.state),
            "commands": list(self.commands),
            "available": self.available,
            "room": self.room,
            "favorite": self.favorite,
            "group": self.group,
            "combined_into": self.combined_into,
            "last_seen": self.last_seen,
            "last_change": self.last_change,
            "last_source": dict(self.last_source) if self.last_source else None,
        }
