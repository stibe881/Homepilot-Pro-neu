# Konsolenzeit der Kinder

Punkt 748 der Werkbank. Fixe Tage, Zeitfenster und Minuten pro Tag, dazu
eine Grenze pro Monat - für alle Konsolen eines Kindes **zusammen**.
Eingestellt wird auf der Seite des Kindes (Familie → Kind → Konsolenzeit),
gerechnet im Hub.

Code: Regeln `hub/homepilot/core/konsolenzeit.py` (rein), Uhr und
Abschalten `core/konsolenwache.py`, Routen `api/routes/konsolenzeit.py`;
App `app/src/screens/family/konsolenzeit.tsx` und `lib/konsolenzeit.ts`.
Die Switch hängt an `integrations/nintendo.py` (siehe `docs/nintendo.md`).

## Die Regeln

- **Pro Kind ein Wochenplan:** je Tag erlaubtes Fenster («16:00–19:00»)
  und «höchstens N Minuten» darin. In den Schulferien gelten an
  Werktagen die Zeiten des **Samstags** (`core/schulferien.py`).
- **Dazu eine Monatsgrenze.** Beides gilt, es zählt, was zuerst
  aufgebraucht ist. Es zählt der Kalendermonat; was übrig bleibt,
  verfällt.
- **Gemeinsame Zeit:** Wer 15 Minuten an der Switch spielt, hat sie an
  der PlayStation nicht mehr.
- **Geben, Heute frei, Sperren** sind Entscheidungen der Eltern. Geben
  und Heute frei gelten bis Mitternacht; geschenkte Minuten gelten auch
  **ausserhalb** des Fensters. «Heute frei» hebt Fenster und Tagesminuten
  auf, **nicht** die Monatsgrenze (die ändert man im Plan). Sperren hält,
  bis man entsperrt.

## Wer spielt? - das Grundproblem

Weder die PlayStation noch Nintendos Kindersicherung sagen, **wer am
Controller sitzt**. Darum meldet sich das Kind in der App an («Ich spiele
jetzt»); die Zeit läuft ab dem Tipp, solange die Konsole an ist. Ein Kind
ohne eigenes Gerät meldet ein Erwachsener an.

Läuft eine Konsole zwei Minuten lang, ohne dass sich jemand angemeldet
hat, fragt der Hub die Eltern (oder schaltet sie aus - Einstellung «Läuft
eine Konsole ohne Anmeldung?»). Spielen die Erwachsenen selbst, tippen sie
«Erwachsene spielen»: Dann wird weder gezählt noch gefragt.

## Was am Ende passiert

| Konsole | Wirkung |
| --- | --- |
| PlayStation 5 | Der Hub schickt sie in den Ruhemodus (Remote Play). Das Spiel bleibt pausiert. |
| Switch / Switch 2 | Der Hub kann sie **nicht ausschalten**. Er stellt die Höchstzeit von heute auf das, was Nintendo schon gezählt hat, und die Konsole beendet das Spiel selbst. |

Vorher kommen Vorwarnungen (Standard 10, 5 und 1 Minute) als Durchsage
auf den Lautsprechern **im Raum der Konsole** - ohne Lautsprecher dort
gibt es keine Durchsage - und die Eltern bekommen eine Push-Meldung
(Kategorie `konsolenzeit`).

## Grenzen, ehrlich

- **Keine harte Sperre.** Die PlayStation schickt der Hub schlafen, wenn
  er läuft und sie erreicht; ein Kind kann sie danach wieder einschalten
  und «Ich spiele jetzt» umgehen. Die Familienverwaltung der PS5 bleibt
  die zweite Sicherung.
- Die Nintendo-Grenze gilt für die **Konsole**, nicht pro Kind; ihre
  Spielzeit kommt verzögert und auf die Minute genau (Nintendos Cloud).
- Nach einem Hub-Neustart zählt eine Lücke über zwei Minuten **nicht**
  als gespielt: lieber zu wenig gebucht als zu viel.
- Nicht gebaut: PIN beim Anmelden (damit kein Geschwister mitläuft),
  Knöpfe unter der Push-Meldung («15 min geben»), Anmeldung bei Nintendo
  in der App (heute: `docs/nintendo.md`).

## Wo es liegt

Pläne, Tageszähler und Sitzungen in der Datendatei unter
`konsolenzeit_plaene`, `konsolenzeit_tage`, `konsolenzeit_sitzungen`,
`konsolenzeit_einstellungen`. Tageszähler älter als 120 Tage werden beim
Start verworfen.
