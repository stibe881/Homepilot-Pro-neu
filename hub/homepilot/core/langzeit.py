"""Der Monats- und Jahresrückblick: was das Haus über sich weiss.

Punkt 253 der Werkbank. Supabase schreibt seit jeher eine
``state_history`` (core/store.py), die nie jemand gelesen hat - hier
wird sie zum ersten Mal gelesen. Drei Kernaussagen:

  - **Stromtrend** gegen Vormonat und Vorjahr - aus den lokalen
    Tageswerten (core/energy.py, 400 Tage). Bewusst *kein* Supabase
    dafür: Der Rückblick muss auch offline etwas zeigen, und die
    Verbrauchs-Mitschrift liegt ohnehin neben der Konfiguration.
  - **Meistgeschaltetes Licht** - aus dem Geräteprotokoll
    (core/eventlog.py), das den Neustart überlebt und ebenfalls ohne
    Datenbank da ist.
  - **Wärmster und kältester Raum** - aus der ``state_history``. Das ist
    der Supabase-Teil: Temperatur-Messwerte hält der Hub lokal nur
    Stunden (core/kurzverlauf.py), einen Monat weiss nur die Datenbank.

Fehlt Supabase, fällt nur der Temperatur-Teil weg; die Antwort sagt
unter ``fehlt`` ehrlich, was und warum - ein leeres Feld ohne Erklärung
liest sich sonst wie «bei uns ist nichts los».

Die Rechenlogik (aus Rohreihen die Kernaussagen) ist rein und testbar;
``erstellen()`` daneben sammelt nur ein.
"""

from __future__ import annotations

import logging
import time
from datetime import date
from typing import TYPE_CHECKING, Any

from . import energy
from .entity import EntityKind

if TYPE_CHECKING:
    from .hub import Hub

log = logging.getLogger(__name__)

ZEITRAEUME = ("monat", "jahr")

# So viele Verlaufszeilen holt der Temperatur-Teil höchstens aus
# Supabase. Ein Monat mit zehn Fühlern im Fünf-Minuten-Takt wären fast
# 900'000 Zeilen - für ein Mittel je Raum reicht ein Ausschnitt, und der
# Hub soll an einem Rückblick nicht minutenlang laden.
TEMPERATUR_LIMIT = 10000

# Wie viele Lichter die Hitparade nennt. Interessant ist die Spitze,
# nicht die vollständige Buchhaltung.
HITPARADE_LIMIT = 3


def zeitraum_start(heute: date, zeitraum: str) -> date:
    """Der erste Tag des laufenden Monats bzw. Jahres (rein, testbar)."""
    if zeitraum == "jahr":
        return date(heute.year, 1, 1)
    return date(heute.year, heute.month, 1)


def prozent(neu: float, alt: float) -> float | None:
    """Veränderung in Prozent - None, wenn es keinen Vergleichswert gibt
    (rein, testbar).

    Null als Basis heisst «wissen wir nicht», nicht «unendlich mehr»:
    Ein erster Monat Mitschrift darf nicht wie eine Explosion aussehen.
    """
    if alt <= 0:
        return None
    return round((neu - alt) / alt * 100, 1)


def stromtrend_monat(days: list[dict[str, Any]], heute: str) -> dict[str, Any] | None:
    """Der Monats-Stromtrend aus den Tageswerten (rein, testbar).

    Verglichen wird mit *demselben Zeitraum* des Vormonats, nicht mit dem
    ganzen: Am 6. des Monats sähe der Vergleich mit einem vollen Vormonat
    nach einer Ersparnis aus, die es nicht gibt (siehe energy.month_totals).
    Der ganze Vormonat steht trotzdem daneben - für die Einordnung.
    """
    if not days:
        return None
    totals = energy.month_totals(days, heute)
    aktuell = float(totals["this_month_kwh"])
    vormonat_gleich = float(totals["last_month_so_far_kwh"])
    vorjahr = energy.year_ago(days, totals["month"])
    return {
        "monat": totals["month"],
        "aktuell_kwh": aktuell,
        "vormonat_kwh": vormonat_gleich,
        "vormonat_gesamt_kwh": float(totals["last_month_kwh"]),
        # 0 aus year_ago heisst «wissen wir nicht» - das darf die App
        # nicht als Ersparnis von 100 Prozent ausgeben.
        "vorjahresmonat_kwh": vorjahr or None,
        "trend_vormonat_prozent": prozent(aktuell, vormonat_gleich),
        "trend_vorjahr_prozent": prozent(aktuell, vorjahr),
    }


def stromtrend_jahr(days: list[dict[str, Any]], heute: str) -> dict[str, Any] | None:
    """Der Jahres-Stromtrend aus den Tageswerten (rein, testbar).

    Auch hier gleicher Zeitraum gegen gleichen Zeitraum: bis heute gegen
    «bis zum selben Tag im Vorjahr». Die Mitschrift hält gut 13 Monate
    (energy.DAY_LIMIT) - vom Vorjahr ist also nur der jüngste Teil da,
    und ein Vergleich gegen ein halb leeres Vorjahr wäre eine erfundene
    Ersparnis. Deshalb zählt der Vorjahres-Vergleich nur Tage, zu denen
    es tatsächlich einen Eintrag gibt, und nennt deren Anzahl mit.
    """
    if not days:
        return None
    jahr = heute[:4]
    vorjahr = str(int(jahr) - 1)
    stichtag_vorjahr = vorjahr + heute[4:]

    aktuell = 0.0
    vorjahr_bis_stichtag = 0.0
    tage_aktuell = 0
    tage_vorjahr = 0
    for entry in days:
        day = str(entry.get("day") or "")
        try:
            kwh = float(entry.get("kwh") or 0)
        except (TypeError, ValueError):
            continue
        if day[:4] == jahr and day <= heute:
            aktuell += kwh
            tage_aktuell += 1
        elif day[:4] == vorjahr and day <= stichtag_vorjahr:
            vorjahr_bis_stichtag += kwh
            tage_vorjahr += 1

    return {
        "jahr": jahr,
        "aktuell_kwh": round(aktuell, 3),
        "aktuell_tage": tage_aktuell,
        "vorjahr_kwh": round(vorjahr_bis_stichtag, 3) or None,
        "vorjahr_tage": tage_vorjahr,
        "trend_vorjahr_prozent": prozent(aktuell, vorjahr_bis_stichtag),
    }


def schalt_hitparade(
    events: list[dict[str, Any]],
    seit: float,
    lampen: set[str],
    limit: int = HITPARADE_LIMIT,
) -> list[dict[str, Any]]:
    """Die meistgeschalteten Lichter im Zeitraum (rein, testbar).

    Gezählt wird das Einschalten («on»), nicht jeder Wechsel: «wie oft
    ging das Licht an?» ist die Frage - Aus gehört zum selben Vorgang.
    """
    zaehler: dict[str, int] = {}
    for event in events:
        entity_id = str(event.get("entity_id") or "")
        if entity_id not in lampen:
            continue
        wann = event.get("at")
        if not isinstance(wann, (int, float)) or wann < seit:
            continue
        if str(event.get("state") or "") != "on":
            continue
        zaehler[entity_id] = zaehler.get(entity_id, 0) + 1
    rangliste = sorted(zaehler.items(), key=lambda paar: paar[1], reverse=True)
    return [
        {"entity_id": entity_id, "count": anzahl}
        for entity_id, anzahl in rangliste[:limit]
    ]


def temperatur_extreme(
    reihen: list[dict[str, Any]], raum_von: dict[str, str]
) -> dict[str, Any] | None:
    """Wärmster und kältester Raum aus rohen Verlaufszeilen (rein, testbar).

    ``reihen`` sind state_history-Zeilen ({entity_id, state}); gemittelt
    wird je Raum über alle Messwerte aller Fühler darin. Das Mittel und
    nicht der Spitzenwert: Ein einzelner Ausreisser (Fühler an der Sonne)
    soll nicht den «wärmsten Raum» krönen.
    """
    summen: dict[str, float] = {}
    anzahl: dict[str, int] = {}
    for zeile in reihen:
        raum = raum_von.get(str(zeile.get("entity_id") or ""))
        if not raum:
            continue
        state = zeile.get("state")
        if not isinstance(state, dict):
            continue
        roh = state.get("temperature")
        if not isinstance(roh, (int, float, str)):
            continue
        try:
            wert = float(roh)
        except ValueError:
            continue
        summen[raum] = summen.get(raum, 0.0) + wert
        anzahl[raum] = anzahl.get(raum, 0) + 1

    if not summen:
        return None
    raeume: list[dict[str, Any]] = [
        {
            "raum": raum,
            "mittel_c": round(summen[raum] / anzahl[raum], 1),
            "messwerte": anzahl[raum],
        }
        for raum in summen
    ]
    raeume.sort(key=lambda zeile: float(zeile["mittel_c"]), reverse=True)
    return {
        "waermster": raeume[0],
        "kaeltester": raeume[-1],
        "raeume": raeume,
    }


async def erstellen(
    hub: Hub, zeitraum: str, heute: date | None = None
) -> dict[str, Any]:
    """Den Rückblick zusammensetzen - jede Quelle einzeln abgesichert.

    Was eine Quelle nicht hergibt, steht unter ``fehlt`` mit Grund; die
    übrigen Teile kommen trotzdem. Ein Rückblick, der wegen einer
    fehlenden Datenbank ganz ausfällt, wäre die falsche Antwort.
    """
    tag = heute or date.today()
    start = zeitraum_start(tag, zeitraum)
    seit = time.mktime(start.timetuple())
    fehlt: list[str] = []

    # Strom: rein lokal (siehe Modulkopf).
    days = hub.data.get("energy_days")
    if zeitraum == "jahr":
        strom = stromtrend_jahr(days, tag.isoformat())
    else:
        strom = stromtrend_monat(days, tag.isoformat())
    if strom is None:
        fehlt.append(
            "strom: keine Verbrauchs-Mitschrift - es misst noch keine "
            "Steckdose mit Zähler"
        )

    # Licht: aus dem Geräteprotokoll, ebenfalls lokal. Das Protokoll ist
    # ein Ringpuffer - reicht er nicht bis zum Zeitraumbeginn zurück,
    # sagt die Antwort das dazu, statt eine zu kleine Zahl als Wahrheit
    # auszugeben.
    lampen = {
        entity.id
        for entity in hub.registry.all()
        if entity.kind == EntityKind.LIGHT
    }
    events = hub.eventlog.all()
    licht = schalt_hitparade(events, seit, lampen)
    for zeile in licht:
        entity = hub.registry.get(zeile["entity_id"])
        zeile["name"] = entity.label if entity is not None else zeile["entity_id"]
        zeile["room"] = entity.room if entity is not None else None
    protokoll = hub.eventlog.span()
    aelteste = protokoll.get("oldest") or protokoll.get("started")
    licht_vollstaendig = isinstance(aelteste, (int, float)) and aelteste <= seit
    if not licht:
        fehlt.append("licht: im Zeitraum ist kein Einschalten protokolliert")

    # Temperatur: der Supabase-Teil - der einzige, denn nur die
    # state_history reicht Wochen zurück.
    temperatur: dict[str, Any] | None = None
    if hub.store is None:
        fehlt.append(
            "temperatur: Supabase nicht konfiguriert - wärmster und "
            "kältester Raum brauchen die state_history"
        )
    else:
        raum_von = {
            entity.id: entity.room
            for entity in hub.registry.all()
            if entity.room and isinstance(entity.state.get("temperature"), (int, float))
        }
        if not raum_von:
            fehlt.append(
                "temperatur: kein Temperaturfühler mit Raumzuordnung"
            )
        else:
            kennungen = ",".join(f'"{kennung}"' for kennung in sorted(raum_von))
            try:
                reihen = await hub.store.client.select(
                    "state_history",
                    {
                        "select": "entity_id,state",
                        "entity_id": f"in.({kennungen})",
                        "recorded_at": f"gte.{start.isoformat()}",
                        "order": "recorded_at.desc",
                        "limit": str(TEMPERATUR_LIMIT),
                    },
                )
                temperatur = temperatur_extreme(reihen, raum_von)
                if temperatur is None:
                    fehlt.append(
                        "temperatur: noch keine Messwerte im Zeitraum"
                    )
            except Exception as err:
                # Nicht scheitern: Der Rest des Rückblicks steht ja da.
                log.warning("Rückblick: state_history nicht lesbar: %s", err)
                fehlt.append(f"temperatur: Supabase nicht erreichbar ({err})")

    return {
        "zeitraum": zeitraum,
        "von": start.isoformat(),
        "bis": tag.isoformat(),
        "strom": strom,
        "licht": licht,
        # Ob das Protokoll den ganzen Zeitraum abdeckt - sonst ist die
        # Hitparade eine Untergrenze, keine Wahrheit.
        "licht_vollstaendig": bool(licht_vollstaendig),
        "temperatur": temperatur,
        "fehlt": fehlt,
    }
