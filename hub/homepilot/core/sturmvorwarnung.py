"""Bescheid sagen, bevor es losgeht.

Der Sturmwächter fährt die Storen hoch, wenn die Warnung eintrifft, und
meldet danach, dass er es getan hat (core/watchdog.py). Das ist der
richtige Griff für die Lamellen - und es beantwortet die andere Hälfte
der Frage nicht: Was der Hub nicht hochfahren kann, muss ein Mensch
hereinholen. Der Sonnenschirm, die Kissen, das Trampolin, das Fenster im
Bad, das seit dem Morgen kippt.

Dafür ist die Vorwarnung da. Sie hängt an ``onset`` - dem Zeitpunkt, ab
dem MeteoSchweiz die Warnung gelten lässt. Der steht seit je in den
Daten (integrations/meteoalarm.py holt ihn), wurde aber nirgends
benutzt: Gehandelt wurde beim Eintreffen der Warnung, und das kann
Stunden vor dem Wind sein oder zehn Minuten.

**Warum nicht einfach beim Eintreffen melden**: MeteoSchweiz gibt
Unwetterwarnungen gern am Vormittag für den Abend heraus. Eine Meldung
«Sturm ab 19 Uhr» um zehn Uhr morgens ist eine, die man wegwischt und
um sieben vergessen hat. Eine um Viertel vor sieben ist eine, nach der
man aufsteht.

**Warum sie trotzdem nicht die einzige ist**: Kommt die Warnung erst
kurz vorher - oder gilt sie sofort -, gibt es keine Vorwarnung, sondern
nur den Sturmwächter. Eine «Vorwarnung», die zugleich mit dem Wind
eintrifft, wäre eine Lüge im Namen.

Reines Rechnen über die Warnung; wer meldet, ist der Wächter.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

#: Wie lange vorher gemeldet wird.
#:
#: Vierzig Minuten: Lang genug, um den Schirm zu schliessen, die Kissen
#: hereinzuholen und die Fenster zu schliessen, auch wenn man gerade am
#: Kochen ist. Kürzer wäre Hektik, länger vergisst man wieder - und die
#: Meldung des Sturmwächters kommt ja ohnehin noch.
VORLAUF_MINUTEN = 40.0

#: Wo vermerkt steht, wofür schon vorgewarnt wurde.
STORE_KEY = "sturm_vorwarnung"


def onset_lesen(roh: Any) -> datetime | None:
    """Den Beginn einer Warnung einlesen (rein, testbar).

    MeteoAlarm liefert ihn als ISO-Zeitstempel, meist mit Zeitzone.
    Alles Unlesbare wird zu ``None`` - und ``None`` heisst hier
    ausdrücklich «keine Vorwarnung», nicht «sofort»: Eine Vorwarnung
    aufgrund eines Zeitstempels, den niemand lesen konnte, käme zur
    falschen Zeit, und das ist schlechter als keine.
    """
    text = str(roh or "").strip()
    if not text:
        return None
    try:
        wann = datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    # Auf die Ortszeit des Hubs bringen und die Zeitzone abstreifen -
    # verglichen wird gegen `datetime.now()`, und das ist naiv.
    if wann.tzinfo is not None:
        wann = wann.astimezone().replace(tzinfo=None)
    return wann


def marke(lage: dict[str, str]) -> str:
    """Die Kennung dieser einen Warnung (rein, testbar).

    Aus Grund und Beginn: Dieselbe Warnung soll einmal vorwarnen. Ein
    zweiter Sturm am selben Abend hat einen anderen Beginn und bekommt
    seine eigene - alles andere hiesse, den zweiten zu verschlucken.
    """
    return f"{lage.get('grund', '?')}:{lage.get('onset', '')}"


def faellig(
    lage: dict[str, str] | None,
    jetzt: datetime,
    vorlauf: float = VORLAUF_MINUTEN,
) -> bool:
    """Ist jetzt der Zeitpunkt für die Vorwarnung? (rein, testbar)

    Ein Fenster und kein Zeitpunkt: Der Wächter läuft im Minutentakt,
    aber eine Runde kann ausfallen (Neustart, Update), und dann wäre
    eine Vorwarnung «genau bei 40 Minuten» für immer verpasst.
    Gemeldet wird also alles zwischen dem Vorlauf und dem Beginn -
    einmal, dank ``marke``.
    """
    if not lage:
        return False
    beginn = onset_lesen(lage.get("onset"))
    if beginn is None:
        return False
    minuten = (beginn - jetzt).total_seconds() / 60.0
    return 0 < minuten <= vorlauf


def text(lage: dict[str, str], offen: list[str], jetzt: datetime) -> tuple[str, str]:
    """Titel und Text der Vorwarnung (rein, testbar).

    Die offenen Fenster stehen mit drin - sie sind das, was der Hub
    weiss und der Mensch gerade nicht. Was draussen liegt, weiss er
    nicht; deshalb steht dort eine Frage und keine Liste.
    """
    grund = lage.get("grund", "Unwetter")
    beginn = onset_lesen(lage.get("onset"))
    wann = beginn.strftime("%H:%M") if beginn else "bald"
    minuten = max(1, round((beginn - jetzt).total_seconds() / 60.0)) if beginn else 0

    titel = f"⚠️ {grund} ab {wann}"
    teile = [f"In etwa {minuten} Minuten."]
    if offen:
        namen = ", ".join(offen[:4])
        rest = len(offen) - 4
        teile.append(
            f"Offen: {namen}" + (f" und {rest} weitere." if rest > 0 else ".")
        )
    # Nach den Fenstern und als Frage: Was draussen steht, weiss nur,
    # wer hinsieht - eine Liste dazu wäre erfunden.
    teile.append("Steht draussen noch etwas?")
    return titel, " ".join(teile)


def schon_gewarnt(rows: Any, kennung: str) -> bool:
    """Wurde für diese Warnung schon vorgewarnt? (rein, testbar)"""
    return any(
        isinstance(row, dict) and str(row.get("marke")) == kennung for row in (rows or [])
    )


#: So viele Marken bleiben stehen. Mehr braucht niemand - sie dienen nur
#: dazu, dieselbe Warnung nicht zweimal zu melden.
HOECHSTENS = 10


def vermerken(rows: Any, kennung: str, jetzt: float) -> list[dict[str, Any]]:
    """Vermerken, dass für diese Warnung vorgewarnt wurde (rein, testbar)."""
    frisch = [
        row
        for row in (rows or [])
        if isinstance(row, dict) and str(row.get("marke")) != kennung
    ]
    frisch.append({"marke": kennung, "at": float(jetzt)})
    return frisch[-HOECHSTENS:]
