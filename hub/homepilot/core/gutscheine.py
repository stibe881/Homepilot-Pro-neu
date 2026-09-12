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

#: Was ein Gutschein zählt: Geld oder Stück (ein Kinoeintritt, ein
#: Eintritt ins Kinderparadies).
#:
#: Euro kam mit Punkt 451 dazu. Vorher trug ein in Konstanz gekaufter
#: Gutschein seinen Betrag als blosse Zahl, und die Summe oben zählte
#: Euro zu Franken - eine Zahl, die nirgends stimmte und trotzdem
#: dastand. Keine Umrechnung: Ein Kurs, der beim Erfassen galt, wäre
#: beim Einlösen falsch, und ein Gutschein wird nicht in Franken
#: eingelöst, sondern dort, wo er gekauft wurde.
UNITS: tuple[str, ...] = ("chf", "stk", "eur")
#: Welche davon Geld sind - Stück nicht. Was hier steht, darf summiert
#: werden, aber nur mit seinesgleichen.
WAEHRUNGEN: tuple[str, ...] = ("chf", "eur")
#: Wer ihn sieht.
SHARED: tuple[str, ...] = ("privat", "familie")
#: Womit die Kasse liest (Punkt 420 der Werkbank). Die App entscheidet,
#: welches Bild sie zeichnet; der Hub hält nur fest, was dort steht -
#: und dass es eines der beiden Wörter ist.
CODES: tuple[str, ...] = ("strich", "qr")

#: Wie viele Nummern ein Gutschein höchstens trägt (Punkt 452 der
#: Werkbank). Eine Zehnerkarte fürs Hallenbad hat zehn, ein Kinoabo
#: sechs; wer mehr einträgt, hat vermutlich eine ganze Liste in ein
#: Formular gekippt, und hundert Nummern an einem Eintrag sind keine
#: Gutscheinverwaltung mehr.
CODES_MAX = 50

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


def ist_geld(unit: Any) -> bool:
    """Zählt dieser Gutschein Geld? (rein, testbar)

    Nur Geld lässt sich addieren - und auch das nur je Währung. «Stück»
    ist die Ausnahme, die es hier gibt, seit es Kinokarten gibt.
    """
    return str(unit or "").strip().lower() in WAEHRUNGEN


def waehrung(entry: dict[str, Any]) -> str:
    """Die Währung eines Gutscheins in Grossbuchstaben (rein, testbar)."""
    unit = str(entry.get("unit") or "").strip().lower()
    return unit.upper() if unit in WAEHRUNGEN else "CHF"


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

    # Die Nummern des Gutscheins (Punkt 452 der Werkbank). Immer gesetzt,
    # auch für den Eintrag von vor der Frage: Der bekommt aus seiner
    # einen `number` eine Liste mit einem Eintrag, und ab da gibt es nur
    # noch einen Ort, an dem Nummern stehen. `number` bleibt daneben
    # bestehen und trägt die erste - Familienbuch, Suche und die alte
    # Kassenansicht lesen sie, und eine Liste, die dieselbe Zahl ein
    # zweites Mal an anderer Stelle führt, läuft irgendwann auseinander.
    # Deshalb wird sie hier abgeleitet und nicht getrennt gepflegt.
    sauber["codes"] = _codes_bereinigen(
        sauber.get("codes"), str(sauber.get("number") or "")
    )
    sauber["number"] = sauber["codes"][0]["value"] if sauber["codes"] else ""

    # Die angehängte Datei (Punkt 266 der Werkbank): Was keine Adresse
    # hat, ist keine - der Block fliegt raus und wird null, statt als
    # halbe Wahrheit am Gutschein zu bleiben. Das ist zugleich die
    # Stelle, an der ein data-URI hängen bliebe, wenn das Ablegen nicht
    # stattgefunden hat: Er käme sonst in die Datendatei, und genau
    # davor sollen die Dateien ja bewahren (siehe core/dateien.py).
    if "file" in sauber:
        sauber["file"] = dateien.bereinigen(sauber.get("file"))
    # Mehrere Belege (Punkt 520): dieselbe Bereinigung je Block, und
    # was keiner ist, fliegt still heraus.
    if "files" in sauber:
        bloecke = [dateien.bereinigen(eintrag) for eintrag in (sauber.get("files") or [])]
        sauber["files"] = [b for b in bloecke if b is not None]
    return sauber


def _codes_bereinigen(raw: Any, number: str) -> list[dict[str, Any]]:
    """Die Nummernliste in Form bringen (rein, testbar) - Punkt 452.

    Eine Zehnerkarte fürs Hallenbad trägt zehn Nummern, ein Kinoabo
    sechs, und bis hierher passte davon genau eine ins Formular. Wer
    mehr hatte, schrieb sie in die Notiz - und an der Kasse las man aus
    einem Fliesstext vor, welche wohl noch gilt.

    Doppelte fliegen raus (dieselbe Nummer zweimal ist ein
    Kopierfehler, kein zweiter Eintritt), Leeres ebenso. Was schon als
    gebraucht markiert war, bleibt es: Diese Marke ist die einzige
    Auskunft darüber, welcher Eintritt schon an der Kasse war.
    """
    roh = raw if isinstance(raw, list) else []
    gesehen: set[str] = set()
    sauber: list[dict[str, Any]] = []
    for eintrag in roh:
        if isinstance(eintrag, dict):
            wert = str(eintrag.get("value") or "").strip()
            benutzt = str(eintrag.get("used") or "").strip() or None
        else:
            wert = str(eintrag or "").strip()
            benutzt = None
        if not wert or wert in gesehen:
            continue
        gesehen.add(wert)
        sauber.append({"value": wert, "used": benutzt})
        if len(sauber) >= CODES_MAX:
            break
    # Der Eintrag von vor der Frage: seine eine Nummer wird der erste
    # Listeneintrag, damit es danach nur noch eine Quelle gibt.
    if not sauber and number.strip():
        sauber.append({"value": number.strip(), "used": None})
    return sauber


def offene_codes(entry: dict[str, Any]) -> list[str]:
    """Welche Nummern noch nicht an der Kasse waren (rein, testbar)."""
    return [
        str(eintrag.get("value") or "")
        for eintrag in entry.get("codes") or []
        if isinstance(eintrag, dict) and not eintrag.get("used")
    ]


def naechster_code(entry: dict[str, Any]) -> str:
    """Welche Nummer die Kasse als Nächstes sehen soll (rein, testbar).

    Die erste unbenutzte. Sind alle gebraucht, kommt trotzdem die
    letzte zurück und nicht nichts: Ein leerer Bildschirm an der Kasse
    lässt offen, ob die App nichts weiss oder der Gutschein leer ist -
    die Zahl mit dem Hinweis «schon eingelöst» sagt beides.
    """
    offen = offene_codes(entry)
    if offen:
        return offen[0]
    codes = [e for e in entry.get("codes") or [] if isinstance(e, dict)]
    if codes:
        return str(codes[-1].get("value") or "")
    return str(entry.get("number") or "")


def code_verbrauchen(
    entry: dict[str, Any], wert: str, jetzt: Any
) -> dict[str, Any]:
    """Eine Nummer als gebraucht markieren (rein, testbar).

    Von Hand und nicht automatisch beim Abziehen: Ob die Kasse den Code
    wirklich angenommen hat, weiss nur der Mensch davor - und eine
    Nummer, die die App eigenmächtig verbraucht, obwohl das Gerät sie
    nicht las, ist ein Eintritt, den niemand mehr findet.
    """
    gesucht = str(wert or "").strip()
    if not gesucht:
        return entry
    neu = dict(entry)
    neu["codes"] = [
        (
            {**eintrag, "used": jetzt.isoformat(timespec="seconds")}
            if isinstance(eintrag, dict)
            and str(eintrag.get("value") or "") == gesucht
            and not eintrag.get("used")
            else eintrag
        )
        for eintrag in entry.get("codes") or []
    ]
    return neu


#: Ab wann ein Restbetrag «fast leer» heisst (Punkt 457 der Werkbank).
#:
#: Zwölf Franken bei Interdiscount sind praktisch verfallen: Man löst
#: sie nie ein, weil man nie etwas für zwölf Franken braucht. Zwanzig
#: ist die Grenze, an der aus «da ist noch was» ein «das nehme ich beim
#: nächsten Mal mit» wird.
FAST_LEER = 20.0


def fast_leer(entry: dict[str, Any]) -> bool:
    """Ist nur noch ein Rest drauf, den man liegen lässt? (rein, testbar)

    Nur für Geld und nur für angebrochene Gutscheine: Ein frisch
    geschenkter Zwanziger ist kein Rest, sondern ein Gutschein - ihn als
    «fast leer» zu zeigen, hiesse den Schenker zu beleidigen und die
    Warnung abzunutzen. Erst wer schon abgezogen hat, hat einen Rest.
    """
    if not ist_geld(entry.get("unit")):
        return False
    if aufgebraucht(entry):
        return False
    rest = _zahl(entry.get("left"), False)
    if rest > FAST_LEER:
        return False
    return rest < _zahl(entry.get("total"), False)


def doppelte(rows: Any, entry: dict[str, Any]) -> list[dict[str, Any]]:
    """Gutscheine, die derselbe sein dürften (rein, testbar) - Punkt 456.

    Zwei Personen tragen dieselbe Karte ein - einmal privat, einmal für
    die Familie -, und ab dann stimmt keine Summe mehr. Sie fällt auch
    nicht auf: Die private Hälfte sieht nur einer, die geteilte alle.

    Die sichere Spur ist die Nummer: Gleiche Nummer heisst derselbe
    Gutschein, egal wie die Läden geschrieben sind. Ohne Nummer wird es
    eine Vermutung, und die soll eng sein - Laden, Betrag und
    Ablaufdatum müssen zusammenpassen, sonst gilt jeder zweite
    Zwanziger von Coop als Dublette. Ein Hinweis, keine Ablehnung: Zehn
    gleiche Kinokarten gibt es wirklich.
    """
    eigene_id = str(entry.get("id") or "")
    nummern = {n.lower() for n in offene_codes(entry)} | {
        str(entry.get("number") or "").strip().lower()
    }
    nummern.discard("")
    laden = str(entry.get("shop") or "").strip().lower()
    treffer: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict) or row.get("archived"):
            continue
        if str(row.get("id") or "") == eigene_id and eigene_id:
            continue
        andere = {n.lower() for n in offene_codes(row)} | {
            str(row.get("number") or "").strip().lower()
        }
        andere.discard("")
        if nummern and andere & nummern:
            treffer.append(row)
            continue
        if nummern or andere:
            # Eine Nummer auf einer Seite und eine andere auf der
            # anderen ist ein Gegenbeweis, keine fehlende Angabe.
            continue
        if not laden or str(row.get("shop") or "").strip().lower() != laden:
            continue
        if str(row.get("unit") or "") != str(entry.get("unit") or ""):
            continue
        if _zahl(row.get("total"), False) != _zahl(entry.get("total"), False):
            continue
        if str(row.get("expires") or "") != str(entry.get("expires") or ""):
            continue
        treffer.append(row)
    return treffer


def lange_leer(rows: Any, heute: date, tage: int = 30) -> list[dict[str, Any]]:
    """Aufgebrauchte Gutscheine, die lange genug herumliegen (rein,
    testbar) - Punkt 455 der Werkbank.

    Ein leerer Gutschein steht nicht mehr in der offenen Liste, aber in
    der eingeklappten Gruppe «leer» darunter - und dort bleibt er, bis
    ihn jemand von Hand archiviert. Getan hat das nie jemand: Die
    Gruppe ist zu, man sieht sie nicht, und was man nicht sieht, räumt
    man nicht auf. Nach einem Monat ist eine Rückfrage beim Laden ohnehin
    keine mehr, die man aus dem Gedächtnis stellt.

    Die Frist läuft ab der letzten Buchung, nicht ab dem Eintragen: Der
    Gutschein, der gestern leer wurde, soll noch eine Weile greifbar
    bleiben - genau dann fragt man an der Kasse nach.
    """
    treffer: list[dict[str, Any]] = []
    for row in rows or []:
        if not isinstance(row, dict) or row.get("archived"):
            continue
        if not aufgebraucht(row):
            continue
        zeitpunkte = [
            str(t.get("at") or "")
            for t in row.get("transactions") or []
            if isinstance(t, dict)
        ]
        letzte = max(zeitpunkte) if zeitpunkte else str(row.get("created") or "")
        wann = datum(letzte[:10])
        # Ohne jeden Zeitstempel bleibt er liegen: Ein Eintrag, dessen
        # Alter niemand kennt, soll nicht auf Verdacht verschwinden.
        if wann is None:
            continue
        if (heute - wann).days < max(1, int(tage)):
            continue
        treffer.append(row)
    return treffer


def bilanz(rows: Any, von: date, bis: date) -> dict[str, Any]:
    """Was in einem Zeitraum eingelöst, verfallen und erfasst wurde
    (rein, testbar) - Punkt 454 der Werkbank.

    Die eine Zahl, die das ganze Modul rechtfertigt oder widerlegt:
    «2026: 340 Franken eingelöst, 80 verfallen». Ohne sie weiss niemand,
    ob sich das Eintragen lohnt - und eine Liste, die man pflegt, ohne
    je zu sehen, was sie bringt, pflegt man irgendwann nicht mehr.

    Je Währung getrennt gezählt, aus demselben Grund wie in
    `verfallen_zeitraum`. Stück-Gutscheine haben keinen Betrag; von
    ihnen zählt, wie oft eingelöst wurde - eine Zahl ohne Einheit wäre
    hier eine Behauptung über Geld, die es nicht gibt.

    Storniertes zählt nicht als eingelöst: Ein Abzug, den jemand
    zurückgenommen hat, ist kein Einkauf. Weil der Storno seinen Betrag
    negativ trägt, ergibt das blosse Zusammenzählen der Buchungen im
    Zeitraum genau das - vorausgesetzt, beide liegen darin. Liegt der
    Storno später, steht er in seinem eigenen Zeitraum, und das ist
    richtig so: Im Juni wurde eingelöst, im Juli zurückgenommen.
    """
    eingeloest: dict[str, float] = {}
    eingeloest_stk = 0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        geld = ist_geld(row.get("unit"))
        einheit = waehrung(row) if geld else ""
        for buchung in row.get("transactions") or []:
            if not isinstance(buchung, dict):
                continue
            art = str(buchung.get("art") or "abzug")
            if art not in ("abzug", "storno"):
                continue
            wann = datum(str(buchung.get("at") or "")[:10])
            if wann is None or not (von <= wann <= bis):
                continue
            betrag = _zahl(buchung.get("amount"), not geld)
            if geld:
                eingeloest[einheit] = round(
                    eingeloest.get(einheit, 0.0) + betrag, 2
                )
            else:
                eingeloest_stk += int(betrag)

    erfasst = 0
    for row in rows or []:
        if not isinstance(row, dict):
            continue
        wann = datum(str(row.get("created") or "")[:10])
        if wann is not None and von <= wann <= bis:
            erfasst += 1

    verfallen = verfallen_zeitraum(rows, von, bis)
    return {
        "eingeloest": eingeloest,
        "eingeloest_stk": eingeloest_stk,
        "verfallen": verfallen["je_waehrung"],
        "verfallen_anzahl": verfallen["anzahl"],
        "erfasst": erfasst,
    }


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
    Nur Geld zählt: Stück-Gutscheine haben keinen Betrag, den man
    verlieren könnte, nur eine Zahl Einlösungen.

    ``summe`` bleibt die Franken-Summe und heisst weiter so - daran
    hängen Rückblick und Tests seit Punkt 372. Was in einer anderen
    Währung verfallen ist, steht daneben in ``je_waehrung`` (Punkt 451);
    zusammengezählt wird nie, denn ein Kurs, den hier jemand annähme,
    wäre eine erfundene Zahl in einer Zeile, die Verlust behauptet.
    """
    treffer = []
    je_waehrung: dict[str, float] = {}
    for row in rows or []:
        if not isinstance(row, dict) or not ist_geld(row.get("unit")):
            continue
        wann = datum(row.get("expires"))
        if wann is None or not (von <= wann <= bis):
            continue
        rest = _zahl(row.get("left"), False)
        if rest <= 0:
            continue
        treffer.append(row)
        einheit = waehrung(row)
        je_waehrung[einheit] = round(je_waehrung.get(einheit, 0.0) + rest, 2)
    return {
        "summe": je_waehrung.get("CHF", 0.0),
        "anzahl": len(treffer),
        "je_waehrung": je_waehrung,
    }


def restwert(entry: dict[str, Any]) -> str:
    """«80 CHF», «40 EUR» oder «1 Stück» - wie ein Mensch es sagt (rein,
    testbar). Die Währung steht dabei, seit es zwei gibt (Punkt 451):
    «40» allein wäre in einer Erinnerung die falsche Zahl für den, der
    an Franken denkt."""
    ganz = str(entry.get("unit") or "").lower() == "stk"
    left = _zahl(entry.get("left"), ganz)
    if ganz:
        return f"{int(left)} Stück"
    einheit = waehrung(entry)
    # Ganze Franken ohne «.00»: «80 CHF», aber «12.50 CHF».
    return (
        f"{int(left)} {einheit}"
        if float(left).is_integer()
        else f"{left:.2f} {einheit}"
    )


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
    # Die Nummernliste (Punkt 452) wird auf ihre Werte eingedampft: Auf
    # einer gedruckten Seite hilft «{'value': 'A', 'used': None}»
    # niemandem. Eine einzelne Nummer steht schon als `number` da und
    # käme hier ein zweites Mal - die fällt weg.
    codes = [
        str(eintrag.get("value") or "")
        for eintrag in schmal.get("codes") or []
        if isinstance(eintrag, dict)
    ]
    if len(codes) > 1:
        schmal["codes"] = codes
    else:
        schmal.pop("codes", None)

    anhang = schmal.get("file")
    namen = [
        str(eintrag.get("name") or "").strip()
        for eintrag in dateien.anhaenge(schmal)
        if str(eintrag.get("name") or "").strip()
    ]
    schmal.pop("files", None)
    if len(namen) > 1:
        # Mehrere Belege (Punkt 520): alle Namen, durch Komma - im Buch
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
