"""Gutscheine der Familie: wer sie sieht, was gültig ist, was abläuft.

Punkt 264 der Werkbank. Ein Geschenkgutschein ist Geld, das nirgends
steht: Die Karte liegt in einer Schublade, der Code in einer Mail vom
letzten Weihnachten, und im Juni fällt jemandem ein, dass da noch
hundert Franken bei Brack waren – abgelaufen im Mai. Die Sammlung
``family_vouchers`` hält Betrag, Rest, Nummer und Ablaufdatum; die
App zieht ab, der Hub rechnet, was daraus folgt.

Zwei Dinge unterscheiden Gutscheine von den anderen Familienlisten:

- **Privatsphäre.** Ein Gutschein ist auf Wunsch «privat» - dann sieht
  ihn nur, wer ihn eingetragen hat. Auch der Besitzer des Hubs nicht:
  «privat» heisst privat, auch vor dem Verwalter, sonst wäre das Wort
  eine Lüge. Wer dem Verwalter etwas zeigen will, stellt auf «familie».
- **Ein Ablaufdatum, das Geld kostet.** Ein Termin, den man verpasst,
  ist ärgerlich; ein Gutschein, der verfällt, ist weg. Deshalb erinnert
  der Wächter - in Stufen, jede genau einmal.

Hier steht nur das Rechnen. Wer schreibt und ausliefert, ist
api/routes/family.py; wer meldet, ist core/watchdog.py.
"""

from __future__ import annotations

from datetime import date
from typing import Any

from . import dateien

#: Sammlung im Datenspeicher (``hub.data``).
KEY = "family_vouchers"

#: Was ein Gutschein zählt: Franken oder Stück (ein Kinoeintritt, ein
#: Eintritt ins Kinderparadies).
UNITS: tuple[str, ...] = ("chf", "stk")
#: Wer ihn sieht.
SHARED: tuple[str, ...] = ("privat", "familie")
#: Womit die Kasse liest (Punkt 420 der Werkbank). Die App entscheidet,
#: welches Bild sie zeichnet; der Hub hält nur fest, was dort steht -
#: und dass es eines der beiden Wörter ist.
CODES: tuple[str, ...] = ("strich", "qr")

#: Wo die Erinnerungsstufen liegen (hub.data). Der Schlüssel steht hier,
#: weil Wächter und Push-Route ihn beide brauchen. Abgelegt als Liste
#: mit genau einem Eintrag [{first_days, second_days}], weil der
#: DataStore Listen verwaltet - `set` macht aus einem blossen Dict die
#: Liste seiner Schlüssel, und `get` gäbe dann ['first_days',
#: 'second_days'] zurück. `prefs_lesen` liest beides.
PREFS_KEY = "voucher_prefs"

#: Vorgaben: In wie vielen Tagen vor dem Verfall erinnert wird - je Stufe
#: genau einmal. Dreissig Tage reichen, um noch etwas Sinnvolles zu
#: kaufen; sieben, damit es nicht doch untergeht. Nur die Vorgabe - die
#: wirklichen Werte stehen in den Push-Einstellungen (PREFS_KEY).
ERSTE_TAGE = 30
ZWEITE_TAGE = 7

#: Der Ablauftag selbst ist immer eine Stufe: «verfallen heute» ist die
#: letzte Gelegenheit, und die hängt an keiner Einstellung.
STUFEN: tuple[int, ...] = (ERSTE_TAGE, ZWEITE_TAGE, 0)

#: Wie die Stufen in der Einmal-Marke heissen - nach ihrer Stellung,
#: nicht nach der Tageszahl. Wer die erste Erinnerung von 30 auf 45 Tage
#: stellt, hat sie für die laufenden Gutscheine schon bekommen; eine
#: Marke mit «30» darin hiesse, dass sie mit «45» ein zweites Mal kommt.
STUFEN_NAMEN: tuple[str, ...] = ("erste", "zweite", "tag")


def prefs_lesen(rows: Any) -> dict[str, int]:
    """Die Erinnerungsstufen aus den Push-Einstellungen (rein, testbar).

    Defensiv gelesen, mit Klemmen: 1 bis 365 Tage - null Tage wäre der
    Ablauftag, den es ohnehin gibt, und mehr als ein Jahr vorher erinnert
    an nichts, was jemand noch weiss. Die erste Erinnerung liegt vor der
    zweiten; wer es umgekehrt einträgt, hat die Felder vertauscht, nicht
    die Absicht - also wird getauscht, nicht abgelehnt. Gleiche Werte
    wären eine Erinnerung zweimal am selben Tag: Dann rückt die erste
    einen Tag nach vorn.

    Nimmt ein Dict oder die Ein-Eintrag-Liste des DataStore (PREFS_KEY).
    """
    daten: dict[str, Any] = {}
    if isinstance(rows, dict):
        daten = rows
    elif isinstance(rows, list):
        daten = next((row for row in rows if isinstance(row, dict)), {})

    def _tage(feld: str, vorgabe: int) -> int:
        try:
            wert = int(daten.get(feld, vorgabe))
        except (TypeError, ValueError):
            wert = vorgabe
        return min(365, max(1, wert))

    erste = _tage("first_days", ERSTE_TAGE)
    zweite = _tage("second_days", ZWEITE_TAGE)
    if erste < zweite:
        erste, zweite = zweite, erste
    if erste == zweite:
        if zweite > 1:
            zweite -= 1
        else:
            erste += 1
    return {"first_days": erste, "second_days": zweite}


def stufen(prefs: dict[str, int]) -> tuple[int, ...]:
    """Die Stufen aus den Einstellungen, den Ablauftag eingeschlossen (rein)."""
    return (int(prefs["first_days"]), int(prefs["second_days"]), 0)


def ist_privat(entry: dict[str, Any]) -> bool:
    """Ist dieser Gutschein nur für seinen Eintragenden? (rein, testbar)

    Alles ausser dem ausdrücklichen «privat» gilt als geteilt: Ein
    Eintrag ohne das Feld ist einer, den jemand vor dem Feld angelegt
    hat - und der war für alle sichtbar.
    """
    return str(entry.get("shared") or "").strip().lower() == "privat"


def darf_sehen(entry: dict[str, Any], user: str) -> bool:
    """Darf diese Person den Eintrag sehen und ändern? (rein, testbar)

    Sehen und Ändern sind hier dasselbe Recht: Wer den Gutschein
    einsetzen darf, darf auch abziehen. Die Rolle spielt keine Rolle -
    siehe Kopf der Datei.
    """
    if not ist_privat(entry):
        return True
    return str(entry.get("author") or "") == str(user or "")


def sichtbar(rows: Any, user: str) -> list[dict[str, Any]]:
    """Die Gutscheine, die diese Person sehen darf (rein, testbar)."""
    return [
        row
        for row in rows or []
        if isinstance(row, dict) and darf_sehen(row, user)
    ]


def _zahl(value: Any, ganz: bool) -> float | int:
    """Eine Zahl aus dem, was die App schickt - Unsinn wird 0."""
    if isinstance(value, bool):
        return 0
    try:
        zahl = float(value)
    except (TypeError, ValueError):
        return 0
    if zahl != zahl or zahl in (float("inf"), float("-inf")):  # NaN, ∞
        return 0
    if ganz:
        return int(round(zahl))
    # Auf Rappen runden: 33.333333 aus einer Drittelung sieht auf keiner
    # Karte so aus.
    return round(zahl, 2)


def datum(value: Any) -> date | None:
    """«2030-06-30» als Datum, sonst None (rein, testbar)."""
    text = str(value or "").strip()
    if not text:
        return None
    try:
        return date.fromisoformat(text[:10])
    except ValueError:
        return None


def bereinigen(entry: dict[str, Any]) -> dict[str, Any]:
    """Einen Gutschein in seine Grenzen zwingen (rein, testbar).

    Die App rechnet den Rest zur Anzeige selbst - der Hub glaubt ihr aber
    nicht mehr aufs Wort: Der Rest wird **immer** aus dem Verlauf
    (`transactions`) hergeleitet, nie aus dem mitgeschickten `left`
    (Punkt 371 der Werkbank, siehe `rest_aus_transaktionen`). Zwei
    Telefone, die im selben Moment abziehen, schicken sonst beide ihren
    eigenen, je unvollständigen Verlauf - wessen PUT zuletzt ankommt,
    überschreibt die Buchung des anderen wortlos. Das Zusammenführen der
    Verläufe (`transaktionen_zusammenfuehren`) passiert vorher in der
    Route, weil nur sie den bisherigen Stand kennt; hier zählt nur noch,
    was am Ende in `transactions` steht.

    Was sonst noch geklemmt wird: Stück sind ganze Zahlen, Einheit und
    Sichtbarkeit sind eines der bekannten Wörter, das Ablaufdatum ist ein
    Datum oder nichts. Geklemmt, nicht abgelehnt: Was hier ankommt, hat
    ein Mensch in ein Formular getippt, und eine 422 für einen Tippfehler
    im Betrag wäre die Art Fehlermeldung, wegen der man die Kachel nicht
    mehr benutzt.
    """
    sauber = dict(entry)

    unit = str(sauber.get("unit") or "").strip().lower()
    sauber["unit"] = unit if unit in UNITS else UNITS[0]
    ganz = sauber["unit"] == "stk"

    shared = str(sauber.get("shared") or "").strip().lower()
    # Ohne Angabe geteilt: So waren die anderen Familienlisten immer,
    # und wer «privat» will, hat es angetippt.
    sauber["shared"] = shared if shared in SHARED else "familie"

    total = max(_zahl(sauber.get("total"), ganz), 0)
    sauber["total"] = total

    transactions = sauber.get("transactions")
    sauber["transactions"] = (
        [t for t in transactions if isinstance(t, dict)]
        if isinstance(transactions, list)
        else None
    )
    if sauber["transactions"] is not None:
        sauber["left"] = rest_aus_transaktionen(total, sauber["transactions"], ganz)
    else:
        # Kein Verlauf im Bild (ein sehr alter Aufruf, der das Feld gar
        # nicht kennt): dann bleibt `left` die einzige Quelle, geklemmt
        # wie eh und je.
        left = _zahl(sauber.get("left"), ganz) if "left" in sauber else total
        sauber["left"] = min(max(left, 0), total)
        sauber["transactions"] = []

    wann = datum(sauber.get("expires"))
    sauber["expires"] = wann.isoformat() if wann else None

    # Womit die Kasse liest (Punkt 420). Anders als bei `unit` und
    # `shared` gibt es hier keinen Ersatzwert: Fehlt die Angabe, bleibt
    # sie weg, und die App rechnet sie sich aus der Nummer aus. Ein
    # hier eingesetztes «strich» wäre eine Behauptung über eine Karte,
    # die niemand angesehen hat - und stünde dann einem QR-Code im Weg,
    # den die App am Inhalt längst erkannt hätte.
    code = str(sauber.get("code") or "").strip().lower()
    if code in CODES:
        sauber["code"] = code
    else:
        sauber.pop("code", None)

    # Muss das Original vorgezeigt werden? (Punkt 267 der Werkbank)
    # Immer gesetzt, nicht nur wenn es mitkommt: Ein Eintrag von vor der
    # Frage bekommt beim ersten Speichern ein ehrliches False, statt das
    # Feld weiter fehlen zu lassen - sonst hinge an derselben Liste
    # zweierlei Bedeutung von «nicht da».
    sauber["physical"] = bool(sauber.get("physical"))

    # Archiviert? (Punkt 372 der Werkbank) Immer gesetzt, aus demselben
    # Grund wie oben bei «physical»: ein Eintrag von vor der Frage soll
    # ein ehrliches False tragen, nicht das Feld weiter schuldig bleiben.
    sauber["archived"] = bool(sauber.get("archived"))

    for feld in ("shop", "title", "number", "pin", "category", "url", "notes"):
        if feld in sauber:
            sauber[feld] = str(sauber.get(feld) or "").strip()

    # Die angehängte Datei (Punkt 266 der Werkbank): Was keine Adresse
    # hat, ist keine - der Block fliegt raus und wird null, statt als
    # halbe Wahrheit am Gutschein zu bleiben. Das ist zugleich die
    # Stelle, an der ein data-URI hängen bliebe, wenn das Ablegen nicht
    # stattgefunden hat: Er käme sonst in die Datendatei, und genau
    # davor sollen die Dateien ja bewahren (siehe core/dateien.py).
    if "file" in sauber:
        sauber["file"] = dateien.bereinigen(sauber.get("file"))
    # Mehrere Belege (Punkt 431): dieselbe Bereinigung je Block, und
    # was keiner ist, fliegt still heraus.
    if "files" in sauber:
        bloecke = [dateien.bereinigen(eintrag) for eintrag in (sauber.get("files") or [])]
        sauber["files"] = [b for b in bloecke if b is not None]
    return sauber


def rest_aus_transaktionen(
    total: float, transactions: list[dict[str, Any]], ganz: bool
) -> float | int:
    """`left` aus dem Verlauf rechnen statt der App zu glauben (rein, testbar).

    Abzug und Storno tragen ihren Betrag schon mit dem richtigen
    Vorzeichen (eine Rücknahme ist die Gegenbuchung mit negativem Betrag,
    siehe `abziehen`/`stornieren` in lib/gutscheine.ts) - Übergaben zählen
    nicht mit, ihr Betrag ist immer 0. Geklemmt zwischen 0 und dem
    Gesamtwert, dieselbe Grenze wie früher bei `left` direkt.
    """
    verbraucht = sum(
        _zahl(t.get("amount"), False)
        for t in transactions
        if isinstance(t, dict) and t.get("art") != "uebergabe"
    )
    rest = min(max(total - verbraucht, 0), total)
    return int(round(rest)) if ganz else round(rest, 2)


def transaktionen_zusammenfuehren(
    bisherige: list[dict[str, Any]], neue: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Neue Buchungen anfügen statt die Liste zu ersetzen (rein, testbar).

    Der Grund, warum es diese Funktion braucht (Punkt 371 der Werkbank):
    Die App schickt beim Abziehen, Stornieren oder Übergeben den ganzen
    Gutschein per PUT, mit ihrer eigenen Sicht auf `transactions`. Zwei
    Telefone, die im selben Moment abziehen, kennen beide nur ihre
    eigene Buchung; ein blosses Ersetzen liesse die des anderen
    verschwinden. Hier wird angefügt: Jede Buchung, die der Hub am
    Zeitstempel `at` noch nicht kennt, kommt dazu - was er schon hat,
    bleibt unverändert liegen, auch in anderer Reihenfolge geschickt.

    Eine Rücknahme, die ein Ziel schon zurückgenommen hat, kommt kein
    zweites Mal hinein - sonst würde ein Abzug, den zwei
    Familienmitglieder im selben Moment stornieren, doppelt
    gutgeschrieben.
    """
    bekannt = {t.get("at") for t in bisherige if isinstance(t, dict)}
    schon_storniert = {
        t.get("storniert")
        for t in bisherige
        if isinstance(t, dict) and t.get("art") == "storno"
    }
    ergebnis = list(bisherige)
    for t in neue:
        if not isinstance(t, dict) or t.get("at") in bekannt:
            continue
        if t.get("art") == "storno" and t.get("storniert") in schon_storniert:
            continue
        ergebnis.append(t)
        bekannt.add(t.get("at"))
        if t.get("art") == "storno":
            schon_storniert.add(t.get("storniert"))
    return ergebnis


def aufgebraucht(entry: dict[str, Any]) -> bool:
    """Ist nichts mehr drauf? (rein, testbar) Gegenstück zu `aufgebraucht()`
    in lib/gutscheine.ts - ein Rest unter einem Rappen zählt als leer."""
    return _zahl(entry.get("left"), False) < 0.005


def ablaufende(
    rows: Any, heute: date, stufen: tuple[int, ...] = STUFEN
) -> list[tuple[dict[str, Any], int, int]]:
    """Welche Gutscheine bald verfallen (rein, testbar).

    `stufen` sind Tage vor dem Verfall, von weit nach nah; die letzte
    ist der Ablauftag (0). Zurück kommt je Gutschein höchstens ein
    Dreier (Eintrag, Stufen-Index, Tage bis zum Verfall) - und zwar die
    *engste* Stufe, die schon erreicht ist. Ein Gutschein, der mit fünf
    Tagen Rest eingetragen wird, löst nur die zweite Erinnerung aus,
    nicht nachträglich die erste: Zwei Nachrichten am selben Morgen für
    denselben Gutschein sind eine zu viel.

    Der Index statt der Tageszahl, weil die Einmal-Marke des Wächters
    daran hängt (siehe STUFEN_NAMEN).

    Nur mit Restwert: Ein aufgebrauchter Gutschein darf verfallen, ohne
    dass es jemand erfährt. Und nur mit Datum: «unbegrenzt» läuft nie ab.
    Was schon abgelaufen ist, kommt auch nicht mehr - dafür ist es zu
    spät, und eine Nachricht «gestern verfallen» ist nur noch Vorwurf.
    """
    treffer: list[tuple[dict[str, Any], int, int]] = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        wann = datum(row.get("expires"))
        if wann is None:
            continue
        if _zahl(row.get("left"), False) <= 0:
            continue
        tage = (wann - heute).days
        if tage < 0:
            continue
        passend = [
            (stufe, index) for index, stufe in enumerate(stufen) if tage <= stufe
        ]
        if not passend:
            continue
        _, engste = min(passend)
        treffer.append((row, engste, tage))
    return treffer


def frisch_verfallen(rows: Any, heute: date) -> list[dict[str, Any]]:
    """Gutscheine, die gerade erst verfallen sind (rein, testbar).

    Das Gegenstück zu `ablaufende()`: Die schliesst Verfallenes aus -
    dafür ist es zu spät, um noch loszufahren. Hier ist genau das
    gefragt, mit Restwert und noch nicht archiviert: der Gutschein, für
    den die letzte Meldung fällig ist (Punkt 372 der Werkbank). Der
    Wächter ruft das einmal täglich; ob die Meldung wirklich neu ist,
    entscheidet die Einmal-Marke dort, nicht ein exakter Tagesabstand -
    war der Hub am eigentlichen Tag aus, soll sie trotzdem noch kommen.
    """
    treffer: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict) or row.get("archived"):
            continue
        wann = datum(row.get("expires"))
        if wann is None or wann >= heute:
            continue
        if _zahl(row.get("left"), False) <= 0:
            continue
        treffer.append(row)
    return treffer


def verfalls_meldung(entry: dict[str, Any]) -> tuple[str, str]:
    """Titel und Text der letzten Meldung - der Betrag, der weg ist (rein, testbar).

    Anders als `meldung()` (die vor dem Ablauf warnt) gibt es hier
    nichts mehr zu tun - nur noch zu wissen, was verloren ist.
    """
    wo = str(entry.get("shop") or entry.get("title") or "Gutschein").strip()
    return "Gutschein verfallen", f"{wo}: {restwert(entry)} sind verfallen und weg."


def verfallen_zeitraum(rows: Any, von: date, bis: date) -> dict[str, Any]:
    """Was zwischen zwei Tagen verfallen ist - für den Rückblick (rein, testbar).

    Dieselbe Zahl wie `verfallen()` auf dem Telefon (lib/gutscheine.ts),
    dort aber «seit einem Stichtag bis heute» gerechnet; der Rückblick
    (Punkt 253/372) fragt nach einem Monat oder einem Jahr, nicht nach
    der ganzen Geschichte - deshalb hier auf einen Zeitraum eingegrenzt.
    Nur Franken zählen: Stück-Gutscheine haben keinen Betrag, den man
    verlieren könnte, nur eine Zahl Einlösungen.
    """
    treffer = []
    for row in rows or []:
        if not isinstance(row, dict) or row.get("unit") == "stk":
            continue
        wann = datum(row.get("expires"))
        if wann is None or not (von <= wann <= bis):
            continue
        if _zahl(row.get("left"), False) <= 0:
            continue
        treffer.append(row)
    summe = sum(_zahl(row.get("left"), False) for row in treffer)
    return {"summe": round(summe, 2), "anzahl": len(treffer)}


def restwert(entry: dict[str, Any]) -> str:
    """«80 CHF» oder «1 Stück» - wie ein Mensch es sagt (rein, testbar)."""
    ganz = str(entry.get("unit") or "").lower() == "stk"
    left = _zahl(entry.get("left"), ganz)
    if ganz:
        return f"{int(left)} Stück"
    # Ganze Franken ohne «.00»: «80 CHF», aber «12.50 CHF».
    return f"{int(left)} CHF" if float(left).is_integer() else f"{left:.2f} CHF"


def meldung(entry: dict[str, Any], tage: int) -> tuple[str, str]:
    """Titel und Text der Erinnerung (rein, testbar).

    «Brack.ch: 80 CHF verfallen in 7 Tagen (30.06.2030)» - der Laden
    zuerst, weil man daran erkennt, ob es einen betrifft; das Datum am
    Schluss, weil «in 7 Tagen» am Freitag gelesen etwas anderes ist als
    am Montag.
    """
    wo = str(entry.get("shop") or entry.get("title") or "Gutschein").strip()
    wann = datum(entry.get("expires"))
    datum_text = f" ({wann.strftime('%d.%m.%Y')})" if wann else ""
    rest = restwert(entry)
    verb = "verfällt" if rest.endswith("Stück") and rest.startswith("1 ") else "verfallen"
    if tage <= 0:
        frist = "heute"
    elif tage == 1:
        frist = "morgen"
    else:
        frist = f"in {tage} Tagen"
    return "Gutschein läuft ab", f"{wo}: {rest} {verb} {frist}{datum_text}"


def marke(entry: dict[str, Any], index: int) -> str:
    """Der Merkzettel des Wächters je Gutschein und Stufe (rein, testbar).

    Das Ablaufdatum gehört in die Marke: Wer die Frist eines Gutscheins
    verlängert (der Laden hat kulant nachgegeben), soll vor dem neuen
    Datum wieder erinnert werden. Die Stufe steht als Stellung (erste,
    zweite, tag) und nicht als Tageszahl - warum, steht bei STUFEN_NAMEN.
    """
    name = STUFEN_NAMEN[index] if 0 <= index < len(STUFEN_NAMEN) else str(index)
    return f"voucher:{entry.get('id')}:{entry.get('expires')}:{name}"


def uebergabe_vorschlagen(
    entry: dict[str, Any], an: str, von: str, jetzt: Any
) -> dict[str, Any]:
    """Eine Übergabe vorschlagen statt sie sofort zu vollziehen (rein,
    testbar) - Punkt 377 der Werkbank.

    Bisher wechselte der Gutschein den Besitzer, sobald jemand
    «Übergeben» antippte, ohne dass die andere Seite je gefragt wurde -
    wer sich beim Namen vertippte, hatte den Gutschein an die falsche
    Person verschenkt, bis die ihn zufällig fand. Jetzt bleibt der
    bisherige Besitzer Besitzer, bis der Vorschlag angenommen ist; nur
    `pending_transfer_to` und eine Merkzeile im Verlauf stehen dafür da.
    """
    empfaenger_name = str(an or "").strip()
    if not empfaenger_name:
        return entry
    neu = dict(entry)
    neu["pending_transfer_to"] = empfaenger_name
    buchung = {
        "at": jetzt.isoformat(),
        "amount": 0,
        "by": str(von or "").strip() or "?",
        "art": "uebergabe_vorschlag",
        "note": f"an {empfaenger_name}",
    }
    neu["transactions"] = [*(entry.get("transactions") or []), buchung]
    return neu


def uebergabe_annehmen(
    entry: dict[str, Any], user: str, jetzt: Any
) -> tuple[dict[str, Any] | None, str | None]:
    """Eine vorgeschlagene Übergabe annehmen (rein, testbar).

    Nur wer als Empfänger vorgeschlagen ist, darf - alles andere wäre,
    als könnte man sich einen fremden Gutschein selbst zusprechen.
    """
    ziel = str(entry.get("pending_transfer_to") or "").strip()
    if not ziel:
        return None, "Für diesen Gutschein liegt keine Übergabe vor."
    if ziel != str(user or ""):
        return None, "Diese Übergabe ist nicht an dich adressiert."
    neu = dict(entry)
    neu["author"] = ziel
    neu["pending_transfer_to"] = None
    buchung = {
        "at": jetzt.isoformat(),
        "amount": 0,
        "by": ziel,
        "art": "uebergabe",
        "note": "angenommen",
    }
    neu["transactions"] = [*(entry.get("transactions") or []), buchung]
    return neu, None


def uebergabe_ablehnen(
    entry: dict[str, Any], user: str, jetzt: Any
) -> tuple[dict[str, Any] | None, str | None]:
    """Eine vorgeschlagene Übergabe ablehnen oder zurückziehen (rein,
    testbar). Beide Seiten dürfen: die eingeladene Person («doch nicht
    für mich») und wer sie vorgeschlagen hat («war ein Versehen»)."""
    ziel = str(entry.get("pending_transfer_to") or "").strip()
    if not ziel:
        return None, "Für diesen Gutschein liegt keine Übergabe vor."
    if str(user or "") not in (ziel, str(entry.get("author") or "")):
        return None, "Das darfst du nicht entscheiden."
    neu = dict(entry)
    neu["pending_transfer_to"] = None
    return neu, None


def eingehende_uebergaben(rows: Any, user: str) -> list[dict[str, Any]]:
    """Was auf diese Person zur Annahme wartet (rein, testbar).

    Eigener, schmaler Auszug statt der vollen Liste: Ein privater
    Gutschein bleibt bis zur Annahme fremd, aber wer ihn annehmen soll,
    muss wenigstens wissen, dass und was da wartet - Laden, Rest, wer ihn
    schickt. Nummer und PIN gehören nicht dazu, dafür ist die Annahme da.
    """
    treffer = []
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        if str(row.get("pending_transfer_to") or "") != str(user or ""):
            continue
        treffer.append(
            {
                "id": row.get("id"),
                "shop": row.get("shop"),
                "left": row.get("left"),
                "unit": row.get("unit"),
                "by": row.get("author"),
            }
        )
    return treffer


def empfaenger(entry: dict[str, Any]) -> str | None:
    """An wen die Erinnerung geht (rein, testbar).

    Privat heisst: nur an den, der ihn eingetragen hat - die anderen
    wissen nicht einmal, dass es den Gutschein gibt. Geteilt heisst:
    an alle (None), denn jeder in der Familie könnte ihn einlösen.
    """
    if ist_privat(entry):
        return str(entry.get("author") or "").strip() or None
    return None


# Was ins Familienbuch (core/familienbuch.py) darf.
#
# Ein Gutschein ist Geld, und das Buch ist für den Tag gedacht, an dem
# es den Hub nicht mehr gibt - also gehören die Gutscheine hinein. Aber
# nicht alle und nicht ganz: Das Buch ist eine Seite für die ganze
# Familie, es liegt neben den Sicherungen und wird gedruckt. Private
# Gutscheine bleiben deshalb draussen (sonst wäre «privat» eine Lüge,
# siehe oben), und die PIN kommt nicht mit: Nummer und PIN zusammen sind
# Bargeld auf einem Blatt Papier. Wer die Nummer hat, kann beim Laden
# den Stand erfragen und den Rest sichern - mehr braucht das Buch nicht.
# `code` gehört dazu, obwohl es kein Geheimnis ist: Auf einer
# gedruckten Seite steht die Nummer ausgeschrieben, und ob der Laden sie
# einst als Strichcode oder QR-Code aufgedruckt hatte, hilft dort
# niemandem - einen Scanner hat man an dem Tag ohnehin nicht.
BUCH_OHNE = frozenset({"pin", "transactions", "image_url", "shared", "code"})


def _buchzeile(row: dict[str, Any]) -> dict[str, Any]:
    """Ein Gutschein, wie er auf der Druckseite steht (rein, testbar).

    Die angehängte Datei (Punkt 266) wird auf ihren Namen eingedampft.
    Der Name darf mit: «Gutschein Brack.pdf» sagt dem, der die Seite in
    zehn Jahren liest, dass es zu diesem Eintrag ein PDF gab - und mit
    dem Namen findet er es in der Sicherung oder im Postfach wieder.
    Die Adresse dagegen führt in einen Hub, und der ist an dem Tag, für
    den das Buch gemacht ist, gerade nicht mehr da; gedruckt wäre sie
    eine Zeile Unsinn. Deshalb nicht in BUCH_OHNE, sondern gekürzt.
    """
    schmal = {k: v for k, v in row.items() if k not in BUCH_OHNE}
    # Auf der gedruckten Seite steht kein «physical False». Ein «True»
    # dagegen gehört hin - und als Satz, nicht als Wahrheitswert: Wer
    # das Buch in zehn Jahren liest, soll wissen, dass zu diesem
    # Gutschein noch etwas Greifbares gehörte, nach dem sich das Suchen
    # lohnt.
    if schmal.pop("physical", False):
        schmal["mitbringen"] = "Karte, Bon oder Ausdruck nötig"
    anhang = schmal.get("file")
    namen = [
        str(eintrag.get("name") or "").strip()
        for eintrag in dateien.anhaenge(schmal)
        if str(eintrag.get("name") or "").strip()
    ]
    schmal.pop("files", None)
    if len(namen) > 1:
        # Mehrere Belege (Punkt 431): alle Namen, durch Komma - im Buch
        # zählt, dass es sie gab und wie sie hiessen.
        schmal["file"] = ", ".join(namen)
    elif isinstance(anhang, dict):
        schmal["file"] = str(anhang.get("name") or "").strip()
    elif not isinstance(anhang, str):
        # Kein Anhang (None) und nichts Lesbares kommt weg. Ein blosser
        # Name bleibt stehen: So lässt sich dieselbe Zeile zweimal durchs
        # Sieb schicken, ohne dass sie beim zweiten Mal leer wird.
        schmal.pop("file", None)
    return schmal


def fuers_buch(rows: Any) -> list[dict[str, Any]]:
    """Die Gutscheine, wie sie ins Familienbuch dürfen (rein, testbar)."""
    return [
        _buchzeile(row)
        for row in rows or []
        if isinstance(row, dict) and not ist_privat(row)
    ]
