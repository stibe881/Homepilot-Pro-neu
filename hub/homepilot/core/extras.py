"""Was der Hub kann - und was ihm dafür fehlt (alle rein, testbar).

Der Anlass war ein Fehlerbericht: «Dieser Knopf funktioniert nicht.» Es
war der Knopf für eine eigene Durchsage. Er tat sehr wohl etwas - der
Hub antwortete, dass ihm gTTS fehlt, und die App verschluckte den Satz.
Das Verschlucken ist behoben; die eigentliche Frage bleibt offen: Warum
erfährt man erst beim Scheitern, dass ein Teil fehlt?

Ein paar Bibliotheken sind bewusst nicht im Grundbestand - sie sind
schwer, brauchen eine neuere Python-Fassung oder werden nur von einem
Gerät verlangt, das die meisten nicht haben. Sie stehen in der
pyproject.toml als «Extras». Fehlt eines, bleibt genau eine Funktion
dunkel, und zwar still.

Hier steht die Liste - und dazu, ob sie im Haus überhaupt gebraucht
wird. Ein fehlendes Pit-Boss-Paket ist keine Meldung wert, wenn niemand
einen Pelletgrill hat. Gemeldet wird nur, was jemand angebunden hat und
was dann nicht laufen kann.

Geprüft wird mit ``find_spec`` und nicht mit einem Import: Der Import
zöge beim Aufruf der Systemseite ein halbes Dutzend Protokoll-
Bibliotheken in den Speicher, nur um zu sehen, dass es sie gibt.
"""

from __future__ import annotations

from importlib.util import find_spec
from typing import Any

#: Ein Extra: der Name in der pyproject.toml, das Modul, an dem man es
#: erkennt, wofür es da ist - und woran hängt, ob es hier gebraucht wird.
#:
#: ``integration`` nennt die Anbindung, ohne die das Extra hier niemand
#: vermisst. Die Sprachausgabe hängt an ``google_cast``, weil eine
#: Durchsage eine Box braucht, auf der sie landen kann. Steht dort
#: ``None``, entscheidet die Konfiguration - bei ``apns`` der Block in
#: der config.yaml.
EXTRAS: list[dict[str, Any]] = [
    {
        "key": "speech",
        "module": "gtts",
        "title": "Sprachausgabe",
        "detail": "Durchsagen und gesprochene Meldungen auf den Boxen. "
        "Ohne sie bleibt der Durchsage-Knopf stumm.",
        "integration": "google_cast",
    },
    {
        "key": "cast",
        "module": "pychromecast",
        "title": "Chromecast und Cast-Boxen",
        "detail": "Musik, Radio und Durchsagen auf Google-Geräten.",
        "integration": "google_cast",
    },
    {
        "key": "roborock",
        "module": "roborock",
        "title": "Saugroboter",
        "detail": "Starten, Räume saugen, Karte und Fortschritt.",
        "integration": "roborock",
    },
    {
        "key": "androidtv",
        "module": "androidtvremote2",
        "title": "Fernseher (Google TV)",
        "detail": "Fernbedienung, Apps starten, Einschlaf-Timer.",
        "integration": "androidtv",
    },
    {
        "key": "ring",
        "module": "ring_doorbell",
        "title": "Ring-Türklingel",
        "detail": "Klingeln, Bewegung und Kamerabilder.",
        "integration": "ring",
    },
    {
        "key": "tuya",
        "module": "tinytuya",
        "title": "Tuya-Geräte",
        "detail": "Lampen, Steckdosen und Projektoren im eigenen Netz.",
        "integration": "tuya",
    },
    {
        "key": "overkiz",
        "module": "pyoverkiz",
        "title": "Somfy/Overkiz-Storen",
        "detail": "Storen und Markisen über die Overkiz-Cloud.",
        "integration": "overkiz",
    },
    {
        "key": "pitboss",
        "module": "pytboss",
        "title": "Pelletgrill",
        "detail": "Temperaturen, Sonden und Programme des Pit Boss.",
        "integration": "pitboss",
    },
    {
        "key": "apns",
        "module": "h2",
        "title": "Live-Aktivität an der Haustüre",
        "detail": "Der Klingel-Hinweis auf dem Sperrbildschirm. Nur "
        "nötig, wenn ein apns-Block in der config.yaml steht.",
        # Kein Integrationsname: Das hängt an der Konfiguration, nicht
        # an einem Gerät - siehe `stand(apns=...)`.
        "integration": None,
    },
]


def vorhanden(modul: str) -> bool:
    """Liegt dieses Modul installiert bereit?

    ``find_spec`` wirft bei einem fehlenden *Eltern*-Paket, statt None zu
    liefern - das darf die Systemseite nicht zu Fall bringen.
    """
    try:
        return find_spec(modul) is not None
    except (ImportError, ValueError):
        return False


def stand(
    integrationen: set[str] | None = None, apns: bool = False
) -> list[dict[str, Any]]:
    """Der Zustand aller Extras für die Systemseite (rein, testbar).

    ``integrationen`` sind die angebundenen Integrationen, ``apns`` sagt,
    ob ein apns-Block in der config.yaml steht. Beides entscheidet über
    ``needed``: ob das Fehlen hier überhaupt jemanden stört.
    """
    angebunden = integrationen or set()
    zeilen = []
    for extra in EXTRAS:
        noetig = (
            extra["integration"] in angebunden
            if extra["integration"]
            else (apns if extra["key"] == "apns" else True)
        )
        zeilen.append(
            {
                "key": extra["key"],
                "title": extra["title"],
                "detail": extra["detail"],
                "installed": vorhanden(str(extra["module"])),
                "needed": noetig,
            }
        )
    return zeilen


def fehlend(zeilen: list[dict[str, Any]]) -> list[dict[str, Any]]:
    """Was fehlt und gebraucht wird (rein, testbar)."""
    return [zeile for zeile in zeilen if zeile["needed"] and not zeile["installed"]]


def satz(zeilen: list[dict[str, Any]]) -> str:
    """Die Zusammenfassung über der Liste.

    Sie sagt zuerst, dass alles da ist - das ist der Normalfall, und
    genau dann soll man die Liste nicht durchlesen müssen.
    """
    luecken = fehlend(zeilen)
    if not luecken:
        return "Alles da, was hier gebraucht wird."
    if len(luecken) == 1:
        return f"{luecken[0]['title']} fehlt - dieser Teil bleibt still."
    namen = ", ".join(zeile["title"] for zeile in luecken)
    return f"{len(luecken)} Teile fehlen: {namen}."


def befehl(zeilen: list[dict[str, Any]]) -> str | None:
    """Wie man das Fehlende nachinstalliert - oder nichts.

    Ein Befehl zum Abtippen und kein Knopf: Der Hub läuft im Abbild, und
    ein `pip install` darin wäre beim nächsten Update wieder weg. Was
    wirklich hilft, ist die Zeile in der eigenen Abbild-Beschreibung.
    """
    luecken = fehlend(zeilen)
    if not luecken:
        return None
    return "pip install -e '.[" + ",".join(zeile["key"] for zeile in luecken) + "]'"
