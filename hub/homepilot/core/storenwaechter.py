"""Die Storen-Wächter: Unwetter fährt hoch, Sommerhitze empfiehlt runter.

Zwei Wächter, zwei Haltungen - mit Absicht:

- **Sturm, Hagel, Gewitter → die gewählten Storen fahren hoch.** Hier
  wird gehandelt, nicht gefragt: Ein heruntergelassener Behang ist die
  Angriffsfläche für den Wind, und Hagel verbeult Lamellen, während das
  Glas dahinter hält. Bis die Nachricht gelesen ist, ist der Schaden da.
- **Sommerhitze → nur ein Vorschlag.** Tagsüber «Storen runter?», abends
  «jetzt querlüften». Geschaltet wird nichts von selbst - wer am Tisch
  sitzt, will nicht plötzlich im Dunkeln sitzen (die Hausdoktrin aus
  core/suggest.py: Vorschlag ist ein Satz, keine Tat).

Die Beschattung (integrations/shading.py) hat ihren eigenen Sturmschutz -
aber nur für die dort konfigurierten Fenster, ohne Hagel und ohne
Nachricht. Dieser Wächter deckt die frei gewählten Storen ab (leer =
alle) und sagt Bescheid; doppeltes Hochfahren ist harmlos.

Hier stehen die reinen Hälften; Takt und Versand wohnen im Watchdog.
"""

from __future__ import annotations

import re
from typing import Any

# Die Wortlisten der MeteoAlarm-Texte, klein verglichen. Der Feed liefert
# je nach Region Deutsch, Französisch, Italienisch oder Englisch - darum
# alle vier. Getrennt nach Grund, damit die Nachricht das richtige Wort
# trägt: «Hagelwarnung» erklärt das Hochfahren besser als «Warnung».
STURM_WOERTER = ("wind", "sturm", "storm", "gale", "orkan", "böen", "boen", "foehn", "föhn")
HAGEL_WOERTER = ("hagel", "hail", "grêle", "grele", "grandine")
GEWITTER_WOERTER = ("gewitter", "thunderstorm", "orage", "temporale")

# Am Wortanfang verglichen, nicht als Teilwort - dieselbe Lehre wie in
# meteoalarm.ist_wind(): «Thunderstorm» enthält «storm» und wäre sonst
# eine Sturm- statt einer Gewitterwarnung.
_STURM = re.compile(r"\b(" + "|".join(STURM_WOERTER) + ")")
_HAGEL = re.compile(r"\b(" + "|".join(HAGEL_WOERTER) + ")")
_GEWITTER = re.compile(r"\b(" + "|".join(GEWITTER_WOERTER) + ")")

# Erst ab «markant»: Eine Vorwarnung der Stufe «Minor» soll nicht die
# halbe Wohnung aufreissen - dieselbe Schwelle wie in der Beschattung.
SCHWEREN = ("Moderate", "Severe", "Extreme")

#: Ab dieser Sonnenhöhe zählt «die Sonne brennt» - unter 15 Grad wärmt
#: sie Fassaden kaum noch, dieselbe Vorgabe wie in der Beschattung.
SONNE_HOCH = 15.0
#: Abends muss es draussen so viel kühler sein, bevor Lüften etwas bringt.
LUEFTEN_MARGE = 2.0


#: Wo der Wächter sich merkt, dass ein Unwetter läuft. In `hub.data`
#: und nicht im Gedächtnis des Prozesses: Der Hub startet bei jedem
#: Update neu, und ein Neustart mitten im Gewitter fuhr die Storen sonst
#: ein zweites Mal hoch und meldete es ein zweites Mal.
STURM_STORE_KEY = "storm_covers_lage"


def sturm_schritt(
    lage: dict[str, str] | None, gemerkt: Any, jetzt: float
) -> tuple[str, list[dict[str, Any]]]:
    """Was jetzt zu tun ist und was zu merken (rein, testbar).

    Der gemeldete Fall: «Diese Meldung kommt immer wieder. Sie soll aber
    nur einmal kommen pro Gewitter.» - und sie kam wirklich alle paar
    Stunden. Gemerkt wurde bisher Grund *und Ablaufzeit* der Warnung,
    und MeteoAlarm stellt im Lauf eines Gewitterabends immer wieder neue
    Warnungen mit neuem Ablauf aus. Für den Wächter war jede davon ein
    neues Unwetter: Storen nochmals hoch, Nachricht nochmals raus.

    Ein Unwetter ist aber nicht eine Warnung, sondern die Zeit, in der
    überhaupt eine läuft. Gemerkt wird deshalb nur, *dass* eines läuft -
    bis keine Warnung mehr da ist. Dann, und nur dann, gibt es die
    Entwarnung.

    Zurück kommt der Schritt («fahren», «entwarnen», «nichts») und die
    neue Merkliste.
    """
    laufend = next(
        (row for row in (gemerkt or []) if isinstance(row, dict) and row.get("grund")),
        None,
    )
    if lage is None:
        if laufend is None:
            return ("nichts", [])
        return ("entwarnen", [])
    if laufend is not None:
        return ("nichts", [laufend])
    return ("fahren", [{"grund": lage["grund"], "seit": float(jetzt)}])


def _text_von(alert: dict[str, Any]) -> str:
    return " ".join(
        str(alert.get(key) or "")
        for key in ("event", "headline", "title", "description")
    ).lower()


def unwetter(state: dict[str, Any]) -> dict[str, str] | None:
    """Die aktive Unwetterwarnung samt Grund (rein, testbar).

    Hagel sticht Sturm sticht Gewitter: «Gewitter mit Hagel» soll als
    Hagelwarnung gemeldet werden - das ist der Teil, der den Lamellen
    wehtut. `bis` trägt das Ablaufdatum der Warnung, damit der Wächter
    dieselbe Warnung nur einmal beantwortet.
    """
    alerts = state.get("alerts")
    if not isinstance(alerts, list):
        return None
    bester: dict[str, str] | None = None
    rang = {"Hagel": 3, "Sturm": 2, "Gewitter": 1}
    for alert in alerts:
        if not isinstance(alert, dict):
            continue
        if alert.get("severity") not in SCHWEREN:
            continue
        text = _text_von(alert)
        grund: str | None = None
        if _HAGEL.search(text):
            grund = "Hagel"
        elif _STURM.search(text):
            grund = "Sturm"
        elif _GEWITTER.search(text):
            grund = "Gewitter"
        if grund is None:
            continue
        treffer = {
            "grund": grund,
            "severity": str(alert.get("severity") or ""),
            "bis": str(alert.get("expires") or ""),
            # Ab wann die Warnung gilt. Stand schon immer in den Daten
            # (integrations/meteoalarm.py), wurde aber nirgends benutzt -
            # jetzt hängt die Vorwarnung daran (core/sturmvorwarnung.py).
            "onset": str(alert.get("onset") or ""),
        }
        if bester is None or rang[grund] > rang[bester["grund"]]:
            bester = treffer
    return bester


def storen_auswahl(entities: list[Any], gewaehlt: list[str]) -> list[Any]:
    """Die Storen, die der Wächter anfassen darf (rein, testbar).

    Leere Auswahl heisst alle - so wirkt der Wächter sofort, ohne dass
    jemand etwas speichert; wer einzelne nennt, bekommt genau diese.
    """
    covers = [e for e in entities if getattr(e, "kind", "") == "cover"]
    if not gewaehlt:
        return covers
    erlaubt = set(gewaehlt)
    return [e for e in covers if getattr(e, "id", "") in erlaubt]


# Räume, deren Fühler draussen hängen: Sie sagen nichts darüber, wie warm
# es in der Stube ist, und zögen den Mittelwert in die falsche Richtung.
_DRAUSSEN = ("aussen", "draussen", "terrasse", "balkon", "garten", "sitzplatz")


#: Was ein Fühler misst - und in welchen Grenzen das plausibel ist.
#:
#: Ausreisser sind Backöfen, Grillsonden und kaputte Geräte; bei der
#: Feuchte ist alles ausserhalb von 0 bis 100 Prozent schlicht keine.
_GRENZEN = {"temperature": (-10.0, 45.0), "humidity": (0.0, 100.0)}
_EINHEIT = {"temperature": "°C", "humidity": "%"}

#: Prozente, die keine Luftfeuchtigkeit sind.
#:
#: Die Einheit allein genügt nicht: Akkustand, Funkauslastung und
#: Filterlaufzeit zählen alle in Prozent. Dieselbe Lehre wie in der App
#: (lib/klimachip.ts), wo der Tropfen oben einmal die Auslastung des
#: Funkmoduls zeigte - eine Zahl, die niemand deuten kann, ist schlimmer
#: als keine. Hier stünde sie in der Auswahlliste und liesse sich
#: anhaken.
_KEINE_FEUCHTE = re.compile(
    r"duty[_ ]?cycle|sendespeicher|batter|akku|filter|signal|wlan|lautst", re.I
)


def _messwert(entity: Any, art: str) -> float | None:
    """Was dieses Gerät gerade misst - oder nichts (rein, testbar).

    Zwei Formen, weil es zwei Sorten Gerät gibt: Ein Thermostat trägt
    seine Werte als Attribut (`temperature`, `humidity`) neben dem
    Zustand, ein Fühler hat sie *als* Zustand mit einer Einheit daneben.
    """
    state = getattr(entity, "state", None) or {}
    if art == "humidity" and _KEINE_FEUCHTE.search(
        f"{getattr(entity, 'id', '')} {getattr(entity, 'name', '')}"
    ):
        return None
    wert = state.get(art)
    if not isinstance(wert, (int, float)):
        if getattr(entity, "kind", "") != "sensor":
            return None
        if str(state.get("unit") or "") != _EINHEIT[art]:
            return None
        try:
            wert = float(state.get("state"))
        except (TypeError, ValueError):
            return None
    unten, oben = _GRENZEN[art]
    return float(wert) if unten <= float(wert) <= oben else None


def klimafuehler(entities: list[Any], art: str) -> list[Any]:
    """Alle Geräte, die für den Hitze-Hinweis in Frage kommen (rein, testbar).

    Dieselbe Vorauswahl, die `innenwert` trifft - hier als Liste, damit
    die App daraus die Häkchen bauen kann, ohne die Regeln zu kennen.

    Draussen bleibt draussen, und «zählt nur für seinen Raum» ebenso:
    Der Fühler in der Waschküche steht neben dem Rack und misst 30 Grad.
    Er läge innerhalb der Plausibilitätsgrenzen und zöge das Mittel so
    weit hoch, dass der Hitze-Hinweis an einem kühlen Tag käme.
    """
    passend = []
    for entity in entities:
        raum = str(getattr(entity, "room", "") or "")
        if not raum or any(wort in raum.lower() for wort in _DRAUSSEN):
            continue
        if getattr(entity, "room_only", False):
            continue
        if _messwert(entity, art) is not None:
            passend.append(entity)
    return passend


def innenwert(
    entities: list[Any], art: str, gewaehlt: list[str] | None = None
) -> float | None:
    """Der Mittelwert der gewählten Raumfühler (rein, testbar).

    ``gewaehlt`` nennt die Geräte, die zählen sollen - leer heisst alle,
    dieselbe Regel wie bei den Storen (`storen_auswahl`). Der Grund für
    die Wahl kam aus dem Haus: Gemittelt wurde über *jeden* Fühler mit
    einem Raum, und darunter sind welche, die nichts über die Wohnstube
    sagen - der im Serverschrank, der an der Fussbodenheizung, der im
    Estrich unterm Ziegeldach. Ein einziger davon hebt das Mittel um
    Grade, und dann kommt «Drinnen wird es warm» an einem Tag, an dem es
    das nicht ist.
    """
    erlaubt = {str(eintrag) for eintrag in (gewaehlt or []) if str(eintrag)}
    werte: list[float] = []
    for entity in klimafuehler(entities, art):
        if erlaubt and str(getattr(entity, "id", "")) not in erlaubt:
            continue
        wert = _messwert(entity, art)
        if wert is not None:
            werte.append(wert)
    if not werte:
        return None
    return round(sum(werte) / len(werte), 1)


def innentemperatur(
    entities: list[Any], gewaehlt: list[str] | None = None
) -> float | None:
    """Der Mittelwert der Temperaturfühler (rein, testbar)."""
    return innenwert(entities, "temperature", gewaehlt)


def innenfeuchte(
    entities: list[Any], gewaehlt: list[str] | None = None
) -> float | None:
    """Der Mittelwert der Feuchtefühler (rein, testbar)."""
    return innenwert(entities, "humidity", gewaehlt)


def hitze_tagsueber(
    innen: float | None, schwelle: float, elevation: float, stunde: int
) -> bool:
    """Lohnt sich jetzt der Storen-Vorschlag? (rein, testbar)

    Nur solange die Sonne wirklich brennt und der Tag noch vor einem
    liegt - um 18 Uhr die Storen zu senken, holt die Wärme nicht mehr
    aus der Stube.
    """
    if innen is None or innen < schwelle:
        return False
    return elevation >= SONNE_HOCH and 9 <= stunde <= 17


def lueften_abends(
    innen: float | None, draussen: float | None, schwelle: float, elevation: float
) -> bool:
    """Lohnt sich jetzt das Querlüften? (rein, testbar)

    Erst nach Sonnenuntergang, und nur wenn es draussen spürbar kühler
    ist - eine Marge von zwei Grad, sonst lüftet man warme Luft herein.
    """
    if innen is None or draussen is None:
        return False
    if innen < schwelle or elevation > 0:
        return False
    return draussen <= innen - LUEFTEN_MARGE


def guard_auswahl(rows: list[Any], art: str) -> list[str]:
    """Die gespeicherte Storen-Auswahl einer Wächter-Art (rein, testbar).

    `rows` ist der Datenspeicher-Eintrag (höchstens ein Dict in einer
    Liste, wie beim Gute-Nacht-Knopf); kaputte Einträge zählen als leer.
    """
    for row in rows or []:
        if isinstance(row, dict):
            wert = row.get(art)
            if isinstance(wert, list):
                return [str(eintrag) for eintrag in wert if str(eintrag)]
    return []
