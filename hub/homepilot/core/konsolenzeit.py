"""Konsolenzeit: wie viel darf ein Kind heute und diesen Monat spielen.

Die Regeln sind hier, die Uhr und die Konsolen im Wächter
(``core/konsolenwache.py``). Alles in dieser Datei ist reines Rechnen über
Zahlen und Daten: Es fragt nicht nach der Uhrzeit, nicht nach der
PlayStation und nicht nach dem Speicher. Darum lässt sich jeder Fall, der
im Haus einmal schiefgehen kann («Fenster zu, aber 15 Minuten geschenkt»,
«Monat voll, Tag nicht»), mit einer Zeile Test nachstellen.

Das Modell, mit Absicht klein:

- Pro Kind ein Wochenplan (Mo–So): erlaubtes Fenster «von–bis» und
  «höchstens N Minuten» darin.
- Dazu eine Monatsgrenze. **Beides gilt, es zählt, was zuerst aufgebraucht
  ist** - wer jeden Tag die volle Zeit nutzt, stösst am Monatsende an die
  Grenze, nicht an die des Tages.
- Alle Konsolen eines Kindes teilen sich die Zeit (ein Konto, nicht eines
  je Gerät): Wer 15 Minuten an der Switch spielt, hat sie an der
  PlayStation nicht mehr.
- «Etwas geben» (Bonus) und «Heute frei» sind Entscheidungen der Eltern
  für **heute**; sie verfallen um Mitternacht, genau wie der Rest.

Zeiten werden in Minuten seit Mitternacht abgelegt (16:00 = 960), Dauern
in Sekunden gezählt: Der Wächter schaut alle paar Sekunden hin, und wer
nur ganze Minuten buchte, verschenkte bei jedem Wechsel bis zu einer.
"""

from __future__ import annotations

import calendar
from datetime import date
from typing import Any

#: Mo=0 … So=6, wie ``date.weekday()``.
TAGE = ("Mo", "Di", "Mi", "Do", "Fr", "Sa", "So")

MAX_TAG_MINUTEN = 600
MAX_MONAT_MINUTEN = 6000
#: Vorwarnungen, die man wählen kann (Minuten vor Ende).
WARN_WAHL = (1, 2, 3, 5, 10, 15, 20, 30)
WARN_STANDARD = (10, 5, 1)

#: Eine Lücke zwischen zwei Taktschlägen, die länger ist als das, zählt nicht
#: als gespielt: Lief der Hub nicht (Update, Neustart), wissen wir nicht,
#: ob gespielt wurde. Lieber ein paar Minuten zu wenig gebucht als zu viel.
MAX_LUECKE_SEKUNDEN = 120.0

# Gründe, warum die Zeit zu Ende ist - der Wächter sagt sie dem Kind.
GRUND_TAG = "tag"
GRUND_FENSTER = "fenster"
GRUND_MONAT = "monat"
GRUND_GESPERRT = "gesperrt"
GRUND_KEIN_TAG = "kein_tag"


def _ganz(wert: Any, ersatz: int, tief: int, hoch: int) -> int:
    """Eine ganze Zahl in Grenzen - Unsinn wird zum Ersatz (rein, testbar)."""
    try:
        zahl = int(round(float(wert)))
    except (TypeError, ValueError):
        return ersatz
    return max(tief, min(hoch, zahl))


def standard_tag() -> dict[str, Any]:
    return {"an": False, "von": 16 * 60, "bis": 19 * 60, "minuten": 45}


def tag_lesen(roh: Any) -> dict[str, Any]:
    """Ein Wochentag des Plans, bereinigt (rein, testbar).

    Ein Fenster, das vor seinem Beginn endet, kennt die Uhr nicht - der
    Tag endet um Mitternacht. Dann gilt das Fenster bis 23:59.
    """
    if not isinstance(roh, dict):
        return standard_tag()
    von = _ganz(roh.get("von"), 16 * 60, 0, 24 * 60 - 1)
    bis = _ganz(roh.get("bis"), 19 * 60, 1, 24 * 60)
    if bis <= von:
        bis = 24 * 60
    return {
        "an": bool(roh.get("an")),
        "von": von,
        "bis": bis,
        "minuten": _ganz(roh.get("minuten"), 45, 0, MAX_TAG_MINUTEN),
    }


def plan_lesen(roh: Any) -> dict[str, Any]:
    """Der Plan eines Kindes, bereinigt und vollständig (rein, testbar).

    Ein leerer oder kaputter Eintrag ergibt einen **ausgeschalteten** Plan:
    Wer nichts eingerichtet hat, wird nicht begrenzt.
    """
    roh = roh if isinstance(roh, dict) else {}
    tage_roh = roh.get("tage")
    tage_roh = tage_roh if isinstance(tage_roh, list) else []
    tage = [tag_lesen(tage_roh[i]) if i < len(tage_roh) else standard_tag() for i in range(7)]

    monat_roh = roh.get("monat")
    monat: int | None
    if monat_roh in (None, "", 0, False):
        monat = None
    else:
        monat = _ganz(monat_roh, 0, 0, MAX_MONAT_MINUTEN) or None

    warn_roh = roh.get("warnungen")
    if isinstance(warn_roh, list):
        warnungen = sorted(
            {_ganz(w, 0, 0, 999) for w in warn_roh if _ganz(w, 0, 0, 999) in WARN_WAHL},
            reverse=True,
        )
    else:
        warnungen = list(WARN_STANDARD)

    konsolen_roh = roh.get("konsolen")
    konsolen: list[str] = []
    for eintrag in konsolen_roh if isinstance(konsolen_roh, list) else []:
        kennung = str(eintrag or "").strip()
        if kennung and kennung not in konsolen:
            konsolen.append(kennung)

    return {
        "aktiv": bool(roh.get("aktiv")),
        "konsolen": konsolen,
        "tage": tage,
        "monat": monat,
        "ferien_wie_wochenende": roh.get("ferien_wie_wochenende", True) is not False,
        "abschalten": roh.get("abschalten", True) is not False,
        "warnungen": warnungen,
        "durchsage": roh.get("durchsage", True) is not False,
        "eltern_melden": roh.get("eltern_melden", True) is not False,
    }


def tag_regel(plan: dict[str, Any], tag: date, ferien: bool = False) -> dict[str, Any]:
    """Was an diesem Datum gilt (rein, testbar).

    In den Schulferien gelten die Zeiten des Wochenendes - und zwar die
    des **Samstags**: Der Sonntag ist oft kürzer (morgen ist Schule), in
    den Ferien ist morgen aber keine. Fällt der Tag selbst aufs
    Wochenende, gilt sein eigener Eintrag.
    """
    wochentag = tag.weekday()
    if ferien and plan.get("ferien_wie_wochenende", True) and wochentag < 5:
        wochentag = 5
    return dict(plan["tage"][wochentag])


def rest_sekunden(
    plan: dict[str, Any],
    tag: date,
    minute_des_tages: float,
    gespielt_heute_s: float,
    gespielt_monat_s: float,
    bonus_minuten: float = 0,
    frei: bool = False,
    gesperrt: bool = False,
    ferien: bool = False,
) -> dict[str, Any]:
    """Wie lange das Kind noch spielen darf (rein, testbar).

    Antwort: ``rest_s`` (None = unbegrenzt), ``grund`` (warum es endet -
    leer, solange Zeit da ist), dazu ``tag_s`` und ``monat_s`` einzeln, weil
    die App beides zeigt, und ``regel`` (der geltende Tagesplan).

    Die Rangfolge, von hart nach weich:

    1. **Gesperrt** (von Hand): null, sonst nichts zählt.
    2. **Monat**: gilt immer, auch bei «Heute frei» - der Monat ist die
       Zusage der Eltern an sich selbst und lässt sich in den Einstellungen
       ändern, nicht per Knopfdruck am Abend umgehen.
    3. **Tag**: Fenster und Tageshöchstzeit, beides. Das Fenster ist nur
       für die regulären Minuten eine Grenze; **geschenkte Minuten
       gelten auch ausserhalb**, sonst wäre «15 Minuten geben» um 19:05
       ein Geschenk, das sich nicht einlösen lässt.

    Ein ausgeschalteter Plan begrenzt nichts.
    """
    regel = tag_regel(plan, tag, ferien)
    antwort: dict[str, Any] = {
        "rest_s": None, "grund": "", "tag_s": None, "monat_s": None, "regel": regel,
    }
    if not plan.get("aktiv"):
        return antwort

    monat_s: float | None = None
    if plan.get("monat"):
        monat_s = max(0.0, plan["monat"] * 60.0 - gespielt_monat_s)
    antwort["monat_s"] = monat_s

    if gesperrt:
        antwort.update(rest_s=0.0, grund=GRUND_GESPERRT, tag_s=0.0)
        return antwort

    if frei:
        tag_s: float | None = None
        grund_tag = ""
    else:
        grund_tag = GRUND_TAG
        bonus_s = max(0.0, bonus_minuten * 60.0)
        if regel["an"]:
            regulaer = max(0.0, regel["minuten"] * 60.0 - gespielt_heute_s)
            im_fenster = regel["von"] <= minute_des_tages < regel["bis"]
            fenster_s = (regel["bis"] - minute_des_tages) * 60.0 if im_fenster else 0.0
            nutzbar = min(regulaer, fenster_s)
            if regulaer > 0 and fenster_s < regulaer:
                grund_tag = GRUND_FENSTER
            # Was schon gespielt ist, hat zuerst die regulären Minuten verbraucht.
            ueber = max(0.0, gespielt_heute_s - regel["minuten"] * 60.0)
            bonus_rest = max(0.0, bonus_s - ueber)
        else:
            nutzbar = 0.0
            grund_tag = GRUND_KEIN_TAG
            bonus_rest = max(0.0, bonus_s - gespielt_heute_s)
        tag_s = nutzbar + bonus_rest
    antwort["tag_s"] = tag_s

    kandidaten = [wert for wert in (tag_s, monat_s) if wert is not None]
    if not kandidaten:
        return antwort
    rest = min(kandidaten)
    antwort["rest_s"] = rest
    if rest <= 0:
        # Sind Tag und Monat beide voll, nennt die Antwort den Tag: Er war
        # zuerst da, und «morgen wieder» stimmt dann auch. Nur wenn allein
        # der Monat Schluss macht, sagt sie das.
        monat_voll = monat_s is not None and monat_s <= 0
        tag_voll = tag_s is not None and tag_s <= 0
        antwort["grund"] = GRUND_MONAT if monat_voll and not tag_voll else (grund_tag or GRUND_MONAT)
    return antwort


def luecke_zaehlt(sekunden: float) -> float:
    """Wie viel einer Taktlücke als gespielt gebucht wird (rein, testbar).

    Negatives (Uhr zurückgestellt) und zu Langes (Hub stand still) zählen
    nichts - siehe ``MAX_LUECKE_SEKUNDEN``.
    """
    if sekunden <= 0 or sekunden > MAX_LUECKE_SEKUNDEN:
        return 0.0
    return sekunden


def warnstufe(
    rest_vorher_s: float | None, rest_nachher_s: float | None, warnungen: list[int]
) -> int | None:
    """Welche Vorwarnung zwischen zwei Takten fällig wurde (rein, testbar).

    Gibt die **dringendste** (kleinste) überschrittene Schwelle zurück,
    oder None. Ist beim Start schon weniger Zeit übrig als die kleinste
    Schwelle, gibt es keine Warnung nachträglich: Wer mit 3 Minuten Rest
    anfängt, hört nicht «noch 10 Minuten».
    """
    if rest_vorher_s is None or rest_nachher_s is None or rest_nachher_s <= 0:
        return None
    gekreuzt = [
        minuten
        for minuten in warnungen
        if rest_vorher_s > minuten * 60 >= rest_nachher_s
    ]
    return min(gekreuzt) if gekreuzt else None


def nintendo_limit(gespielt_min: float, rest_s: float | None, hoechst: int = 360) -> int:
    """Die Höchstzeit von heute, die an der Switch einzustellen ist (rein, testbar).

    Nintendo kennt nur «so viele Minuten heute **insgesamt**» - die Zeit,
    die die Konsole schon gezählt hat, steckt also mit drin: gespielt
    plus das, was dem Kind noch bleibt. ``rest_s`` None heisst keine
    Grenze (-1). Abgerundet: Lieber eine halbe Minute weniger als eine
    mehr, die das Kind nicht haben sollte. Über 360 nimmt Nintendo nichts.
    """
    if rest_s is None:
        return -1
    rest_min = int(max(0.0, rest_s) // 60)
    return max(0, min(hoechst, int(gespielt_min) + rest_min))


def tag_schluessel(tag: date) -> str:
    return tag.isoformat()


def monat_schluessel(tag: date) -> str:
    return f"{tag.year:04d}-{tag.month:02d}"


def monat_summe(tage: dict[str, Any], tag: date) -> float:
    """Sekunden dieses Kalendermonats aus den Tageszählern (rein, testbar).

    ``tage`` ist ``{"2026-11-08": {"gesamt": 1500, ...}}``. Der Monat ist
    der **Kalendermonat**: Was übrig bleibt, verfällt am Monatsende.
    """
    vorspann = monat_schluessel(tag) + "-"
    summe = 0.0
    for schluessel, zeile in tage.items():
        if schluessel.startswith(vorspann) and isinstance(zeile, dict):
            try:
                summe += float(zeile.get("gesamt") or 0)
            except (TypeError, ValueError):
                continue
    return summe


def monatstempo(
    gespielt_monat_s: float, monat_minuten: int | None, tag: date
) -> dict[str, Any] | None:
    """Wie weit der Monat ist und wie weit das Konto (rein, testbar).

    ``strich`` ist, wie weit der Monat vorangeschritten ist (Tag 10 von 30
    = 0.33), ``genutzt`` der Anteil des Kontos. Das Urteil ist bewusst
    grob: «schneller» erst ab einem Viertel Vorsprung, damit ein Kind, das
    am Wochenende viel spielt, nicht jeden Montag eine Rüge sieht.
    """
    if not monat_minuten:
        return None
    tage_im_monat = calendar.monthrange(tag.year, tag.month)[1]
    strich = tag.day / tage_im_monat
    genutzt = gespielt_monat_s / (monat_minuten * 60.0)
    if genutzt >= 1:
        urteil = "voll"
    elif genutzt > strich + 0.25:
        urteil = "viel_schneller"
    elif genutzt > strich + 0.05:
        urteil = "schneller"
    else:
        urteil = "im_plan"
    return {"strich": strich, "genutzt": genutzt, "urteil": urteil}


def dauer_text(sekunden: float) -> str:
    """«1 h 30 min», «45 min», «unter einer Minute» (rein, testbar)."""
    minuten = int(sekunden // 60)
    if minuten <= 0:
        return "unter einer Minute"
    if minuten < 60:
        return f"{minuten} min"
    stunden, rest = divmod(minuten, 60)
    return f"{stunden} h" if rest == 0 else f"{stunden} h {rest} min"


def zeit_text(minute_des_tages: int) -> str:
    """960 → «16:00» (rein, testbar)."""
    minute_des_tages = max(0, min(24 * 60, int(minute_des_tages)))
    stunden, minuten = divmod(minute_des_tages, 60)
    return f"{stunden:02d}:{minuten:02d}"


def warn_text(name: str, minuten: int) -> str:
    """Die Durchsage vor dem Ende (rein, testbar)."""
    einheit = "Minute" if minuten == 1 else "Minuten"
    if minuten <= 1:
        return f"{name}, noch eine Minute – speichere jetzt dein Spiel."
    return f"{name}, noch {minuten} {einheit} – speichere dein Spiel."


def ende_text(name: str, grund: str, naechstes: str | None = None) -> str:
    """Die Durchsage, wenn die Zeit um ist (rein, testbar)."""
    if grund == GRUND_MONAT:
        text = f"{name}, die Konsolenzeit für diesen Monat ist aufgebraucht."
    elif grund == GRUND_FENSTER:
        text = f"{name}, die Spielzeit für heute ist vorbei."
    elif grund == GRUND_GESPERRT:
        text = f"{name}, die Konsole ist gerade gesperrt."
    elif grund == GRUND_KEIN_TAG:
        text = f"{name}, heute ist kein Konsolentag."
    else:
        text = f"{name}, deine Konsolenzeit für heute ist um."
    if naechstes:
        text += f" {naechstes}"
    return text
