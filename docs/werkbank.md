# Die Werkbank

Was offen ist. Nichts sonst.

Erledigtes steht nebenan in `werkbank-archiv.md`, mit der Begründung,
aus der es entstand - dort wird nichts gelöscht, und dort schlägt nach,
wer im Code auf «Punkt NNN der Werkbank» stösst und die Vorgeschichte
sucht.

**Die Nummern bleiben, wo sie sind.** Nie umnummerieren, auch nicht bei
Erledigtem oder Gestrichenem: Ein späterer «Punkt 273» zeigte sonst auf
etwas anderes als gemeint. Neues bekommt die nächste freie Nummer -
zurzeit **634**. Ist ein Punkt gebaut, wandert er samt Begründung ins
Archiv; er wird nicht hier abgehakt. Dass jede Nummer genau einmal
vorkommt, prüft `scripts/werkbank.py` (und mit ihr der Prüflauf).

## Was offen ist

| Bereich | Offen | Punkte |
| --- | --- | --- |
| App allgemein | 6 | 422, 424, 425, 427, 428, 429 |
| Bedienung | 10 | 431, 432, 433, 434, 435, 436, 437, 438, 439, 440 |
| Gestaltung | 5 | 441, 446, 447, 449, 450 |
| Gutscheine | 2 | 453, 458 |
| Abläufe | 2 | 468, 469 |
| Push-Benachrichtigungen | 3 | 473, 474, 476 |
| Alarmanlage | 1 | 483 |
| Selbst gewählt | 8 | 492, 493, 494, 496, 499, 500, 501, 502 |
| Aus früheren Runden | 4 | 223, 237, 268, 353 |
| User Experience | 5 | 579-583 |
| Nützlich im Alltag | 5 | 584-588 |
| App und Hub | 5 | 589-593 |
| Abläufe (Runde 579) | 5 | 594-598 |
| Push (Runde 579) | 5 | 599-603 |
| Live-Aktivitäten, Widget, Watch | 5 | 604-608 |
| Gestaltung (Runde 579) | 5 | 609-613 |
| Funktionalität | 5 | 614-618 |
| Familie | 5 | 619-623 |
| Profil und Benutzer | 5 | 624-628 |
| Geräte | 5 | 629-633 |

## Aus früheren Runden

Vier Punkte aus Teil V bis VIII, die nie fertig wurden. Sie stehen hier
und nicht im Archiv, weil sie offen sind - die vollständige
Vorgeschichte der Runden, aus denen sie stammen, steht dort.

### 223. Durchsagen mit eigener Stimme zurückbringen ⏳ Probelauf offen

*Aufwand: mittel · App*

Die Aufnahme am Telefon lief über `expo-audio` - und genau dieses Paket
hat die App vom 29. bis 31. August auf jedem Gerät wortlos schwarz
starten lassen: Sein nativer Teil fasst schon beim App-Start die
AVAudioSession an, und gegen ein Hängen dort hilft kein JavaScript-Netz.
Es ist deshalb ganz aus dem Build genommen; die Vorlesestimme und der
Browser-Weg (MediaRecorder) gehen weiter.

Zurück darf die Funktion nur mit einer Fassung, deren Start nachweislich
nichts anfasst - neuere expo-audio-Version prüfen (das OnCreate mit
`AVAudioSession.sharedInstance()` ist der kritische Punkt) oder ein
eigenes schlankes Aufnahme-Modul, das erst beim Druck auf den
Aufnahmeknopf initialisiert. In jedem Fall: erst ein TestFlight-
Probelauf auf iPhone **und** Wandpanel, dann ausrollen. Die
Absturzgeschichte steht im CHANGELOG (2026-09-01) und in
`app/src/lib/aufnahme-nativ.ts`.

Umgesetzt als eigenes Modul `modules/aufnahme` (AVAudioRecorder, ~100
Zeilen Swift): kein `OnCreate`, kein Beobachter, kein Zugriff auf die
AVAudioSession vor dem Druck auf den Aufnahmeknopf. Mit dem Modul
steigt die Laufzeit auf 4 - der TestFlight-Probelauf auf iPhone und
Wandpanel steht noch aus; erst danach gilt der Punkt als erledigt.

Stellen: `app/modules/aufnahme/`, `app/src/lib/aufnahme-nativ.ts`, `app/src/lib/sprachnotiz.ts`

### 237. «0» heisst manchmal «keine Auskunft»

*Aufwand: klein · Hub*

Life360 schickt den Akkustand «0» auch dann, wenn es nichts weiss.
Gelesen als Zahl ergab das ein leeres Telefon und eine Push im
Minutentakt, während in der App daneben 65 % standen. Behoben – offen
bleibt die Frage für jede andere Quelle: Wo bedeutet eine Null noch
«kein Wert»?

Stellen: `hub/homepilot/integrations/life360.py`, `hub/homepilot/integrations/geofence.py`

### 268. DashboardScreen.tsx aufteilen ◐ begonnen (4cb7895)

4373 Zeilen, davon eine einzige Funktion von rund 4000. Der erste
Schnitt ist gemacht: Die vierzehn Zustände für Blätter, Menüs und
Vollbilder liegen samt `allesZu()` in `screens/dashboard/blaetter.ts`.
Vorher standen sie im Bauteil verstreut und weiter unten dieselben
vierzehn Setzer noch einmal von Hand aufgezählt – die klassische Stelle,
an der man sich vergisst. Und es *war* schon passiert: Die Seitenhilfe
und das Suchfeld standen nicht in der zweiten Liste und blieben beim
Bereichswechsel offen liegen.

Der Schnitt, der wirklich teilt, sind die Zweige von `content()` – je
Bereich ein Bauteil. Er geht nicht ohne vorheriges Bündeln der
Requisiten, sonst tauscht man 4000 Zeilen gegen 4000 Zeilen Requisiten.

Stellen: `app/src/screens/dashboard/blaetter.ts`, `app/src/screens/DashboardScreen.tsx`

### 353. Der Lauftext misst je nach Zahl der Aufbauten anders ○ offen

Beim Bauen von Punkt 280 gefunden: Ein einziger zusätzlicher Abruf beim
Start der Startseite genügte, damit die wandernde Terminzeile
stehenblieb – die Browser-Probe wurde rot («wandert nach links – nur 0
Punkte»).

Die Ursache liegt in `components/Lauftext.tsx`: Der Text misst sich in
einem 4000-Punkte-Kasten, der nach der Messung auf die gemessene Breite
schrumpft; ein weiterer Layout-Durchgang lässt `onLayout` erneut feuern,
und dann meldet der Text die Breite des Fensters statt seine eigene. Aus
«muss wandern» wird «passt», und die Zeile bleibt mit Pünktchen stehen,
als wäre der Lauftext nie eingebaut worden.

Zwei Versuche (nur in der Messphase annehmen, `flexShrink: 0`) haben es
nicht behoben und wurden zurückgenommen – halb verstanden ist an dieser
Stelle schlechter als gar nicht. Punkt 280 liegt jetzt im
Telefonspeicher und braucht den Abruf nicht mehr; die Zerbrechlichkeit
bleibt und trifft den Nächsten, der auf der Startseite etwas hinzufügt.

Zu tun: Messung und Anzeige trennen – ein unsichtbarer Messkasten, der
immer 4000 Punkte breit bleibt, und daneben der animierte Kasten mit der
gemessenen Breite. Danach mit einem künstlichen Zusatz-Aufbau
gegenprüfen, dass die Probe grün bleibt.

Stellen: `app/src/components/Lauftext.tsx`, `scripts/probe.mjs`

## Fünfundachtzig Vorschläge (421–505)

Auf Zuruf erstellt: zehn je Bereich für App allgemein, Bedienung,
Gestaltung, Gutscheine, Abläufe, Push und Alarmanlage, dazu fünfzehn
selbst gewählte. Achtundvierzig davon sind gebaut und stehen im Archiv;
was hier steht, ist der Rest.

Vorweg geprüft, damit nichts doppelt dasteht: Was die Suche schon
findet, was die Warteschlange schon auffängt, was die Alarmanlage an
Zonen, Zwangs-PIN und Sensortest schon kann und was bei den Gutscheinen
mit Storno, Übergabe, Beleg und Kassencode bereits erledigt ist, steht
hier nicht noch einmal. Übrig bleibt, was wirklich fehlt.

### App allgemein (421-430)

**422. Wie lange der kalte Start dauert, weiss niemand.** Die Probe
misst Überlauf und stehende Blätter, aber keine Zeit. Dabei ist «die
App braucht ewig» die einzige Beschwerde, die im Haus regelmässig
fällt, und die einzige Zahl, die nirgends steht. Erst mit einer Messung
darf sie schlechter werden; ohne merkt es niemand, bis es weh tut.
Stellen: `scripts/probe.mjs`, `app/src/hooks/useHub.ts`

**424. Die Warteschlange gilt nur für Gerätebefehle.**
`lib/warteschlange.ts` fängt einen Tipp auf einen Schalter auf, wenn
der Hub gerade weg ist. Ein Ablauf, den man in derselben Minute
speichert, ein Gutschein-Abzug an der Kasse, ein Scharfschalten an der
Tür: die laufen ins Leere, mit einer roten Meldung und ohne zweiten
Versuch. Die Familienlisten haben dafür ihre eigene Ablage - drei
Lösungen für dasselbe Problem, und an den zwei wichtigsten Stellen
keine. Stellen: `app/src/lib/warteschlange.ts`,
`app/src/screens/family/ablage.ts`, `app/src/api/client.ts`

**425. Es gibt keinen Lastprüfstand für den Hub.**
Zweihundertsiebenundzwanzig Testdateien prüfen Logik; keine prüft, was
bei dreihundert Entitäten und zehn offenen WebSockets passiert. Der
Fall kommt nicht vom Wachstum, sondern von einem Fehler: eine Anbindung,
die im Sekundentakt Zustände meldet, und der Hub schickt jedem Telefon
jede davon einzeln. Stellen: `hub/homepilot/api/server.py`, `hub/tests/`

**427. Die Grösse der Web-Fassung steht nirgends.** Der Export läuft in
der Prüfung, aber niemand liest, wie gross das Ergebnis geworden ist.
Ein versehentlich mitgezogenes Paket verdoppelt das Bündel, und das
Wandpanel lädt ab dann spürbar länger - bemerkt wird das erst am Gerät,
Wochen später. Eine Zeile «Bündel: 4,2 MB (+900 kB)» in der Prüfung
genügt. Stellen: `.github/workflows/pruefung.yml`, `scripts/probe.sh`

**428. Das Absturzbuch meldet sich nicht von selbst.** Es schreibt
zuverlässig mit - nachlesen muss man es. Ein Absturz, der am selben Tag
dreimal an derselben Stelle passiert, ist eine Push-Meldung wert; sonst
steht er dort, bis jemand zufällig hinschaut. Stellen:
`app/src/lib/absturzbuch.ts`, `hub/homepilot/core/push.py`

**429. Die mypy-Liste wächst nicht von selbst.** Bindend sind die
Module in `mypy-sauber.txt`, der Rest läuft «zur Ansicht». Ohne Regel
bleibt es beim Vorsatz. «Jede Datei, die du ohnehin anfasst, kommt
dazu» macht daraus ein Verfahren, das sich von selbst durchzieht.
Stellen: `hub/tools/mypy_sauber.py`, `hub/mypy-sauber.txt`

### Bedienung (431-440)

**431. Zwei Suchen, die einander nicht kennen.** Die grosse Suche
findet Räume, Geräte, Szenen, Abläufe und Seiten; die Suche der
Familienseite findet Rezepte, Einkauf, Kontakte und Gutscheine. Wer
«Coop» sucht, muss vorher wissen, welche der beiden er aufmacht - und
das ist genau die Frage, die eine Suche beantworten soll. Stellen:
`app/src/components/GlobalSearch.tsx`, `app/src/screens/FamilyScreen.tsx`

**432. Rückgängig gibt es nur beim Schalten.** Acht Sekunden lang kann
man ein Licht zurücknehmen. Ein gelöschter Kontakt, ein verschobener
Ämtli-Stern, ein archivierter Gutschein: weg. Der Papierkorb hilft den
Listen, die einen haben, und nicht dem Rest. Stellen:
`app/src/lib/rueckgaengig.ts`, `hub/homepilot/core/trash.py`

**433. Formulare fragen nicht nach, wenn man sie verlässt.** Ein halb
ausgefüllter Ablauf, ein Gutschein mit Betrag und ohne Nummer - ein
Wisch nach rechts, und alles ist fort. Es braucht keinen Entwurf-Modus,
nur die eine Rückfrage, wenn wirklich etwas drinsteht. Stellen:
`app/src/hooks/useZurueckWischen.ts`, `app/src/screens/automations/editor.tsx`

**434. Die App weiss nicht, wer gerade davorsteht.** Am Wandpanel im
Flur ist «zuletzt geöffnet» eine andere Antwort als auf dem Telefon in
der Hand: dort will man die Startseite und nichts anderes, hier die
Stelle von vorhin. Punkt 280 macht überall dasselbe. Stellen:
`app/src/lib/persoenlich.ts`, `app/src/hooks/usePrefs.ts`

**435. Es gibt keinen Weg zurück zur letzten Meldung.** Wer eine
Push-Nachricht wegwischt, findet sie nur in den Push-Einstellungen
unter «Zuletzt gemeldet» wieder - drei Bildschirme tief, ohne Bild und
ohne Knopf. Punkt 389 nennt das «teilweise da»; gemeint war der
Posteingang. Stellen: `hub/homepilot/core/pushverlauf.py`,
`app/src/components/PushBlatt.tsx`

**436. Lange Listen haben keinen Anker.** Rezepte, Kontakte,
Gutscheine, Geräte: wer unten war und zurückkommt, steht wieder oben.
Bei zwanzig Einträgen egal, bei zweihundert die häufigste kleine
Verärgerung des Tages. Stellen: `app/src/screens/RecipeBook.tsx`,
`app/src/screens/family/gutscheine.tsx`

**437. Mehrfachauswahl fehlt überall.** Fünf erledigte Einkaufsposten,
drei abgelaufene Gutscheine, zwei tote Geräte - jedes einzeln
antippen, jedes einzeln bestätigen. Langdrücken ist seit Punkt 282
einheitlich; eine Auswahl daraus zu machen ist der kleine Schritt, der
noch fehlt. Stellen: `app/src/lib/langdruck.ts`,
`app/src/components/DraggableList.tsx`

**438. Der erste Tipp nach dem Aufwachen geht oft ins Leere.** Die App
kommt aus dem Hintergrund, zeigt den letzten Stand, und der WebSocket
braucht noch eine Sekunde. Was man in dieser Sekunde tippt, landet in
der Warteschlange - richtig -, aber die Kachel sieht aus wie immer. Ein
sichtbarer Zustand «verbindet noch» für diese eine Sekunde ist ehrlicher
als eine Kachel, die so tut, als wäre sie wach. Stellen:
`app/src/hooks/useHub.ts`, `app/src/components/EntityCard.tsx`

**439. Fehlermeldungen sagen, was nicht ging, nicht wann es wieder
geht.** «Hub nicht erreichbar» ist richtig und hilft nicht. «Hub nicht
erreichbar - zuletzt gesehen vor 4 Minuten, nächster Versuch in 10
Sekunden» sagt, ob man warten oder in den Keller gehen soll. Stellen:
`app/src/api/client.ts`, `app/src/components/Auffangnetz.tsx`

**440. Der Einkaufsmodus ist der einzige Modus für draussen.** Grosse
Zeilen und wacher Bildschirm gibt es beim Einkaufszettel. An der Kasse
mit dem Gutschein, an der Tür mit der PIN, im Auto mit der Knopfwand
ist die Lage dieselbe - eine Hand, schlechtes Licht, wenig Zeit - und
die Oberfläche dieselbe wie auf dem Sofa. Stellen:
`app/src/lib/einkauf.ts`, `app/src/components/Kassencode.tsx`

### Gestaltung (441-450)

**441. Neunhundertdreizehn nackte `padding`-Zahlen** stehen im Code,
das Raster kennt zwei Werte (`gap`, `page`). Punkt 363 hat den Umbau
zu Recht abgelehnt - aber die Richtung stimmt: ein drittes und viertes
Mass im Raster, und die Regel gilt nur für neue Dateien. Dann schrumpft
der Rest von selbst. Stellen: `app/src/theme.tsx`

**446. Symbole ohne Wort.** Die Symbolsprache steht (Punkt 294), aber
an den engen Stellen steht das Symbol allein. Wer die App zweimal im
Jahr benutzt - Babysitter, Gast, Grossmutter - rät. Stellen:
`app/src/components/entity/`, `app/src/components/TopStrip.tsx`

**447. Die Leerzustände sind nicht gleich viel wert.** Manche Liste
sagt «nichts da», manche zeigt nur weissen Raum, manche einen Umriss,
der nie verschwindet. Der leere Zustand ist der erste, den ein neuer
Benutzer sieht - und der einzige, den niemand gestaltet. Stellen:
`app/src/components/Leerzustand.tsx`

**449. Es gibt keinen Bilddiff.** Jede Gestaltungsfrage endet bei
«sieht das richtig aus?» und damit bei einer Person vor einem
Bildschirm. Ein Satz gespeicherter Bilder je Erscheinungsbild und
Grösse würde aus dieser Frage eine Messung machen - dieselbe Wendung
wie damals bei der Probe. Stellen: `scripts/probe.mjs`

**450. Druck und Teilen sehen aus wie der Bildschirm.** Ein Rezept auf
Papier, ein Ablauf als Blatt, ein Babysitter-Zettel: alle erben Farben
und Abstände einer Oberfläche, die es auf Papier nicht gibt. Ein
eigenes, karges Papier-Erscheinungsbild spart Tinte und liest sich
besser. Stellen: `app/src/screens/RecipeBook.tsx`

### Gutscheine (451-460)

**453. Die Erinnerung kennt den Kalender nicht.** Ein Gutschein, der
im Mai verfällt, wird dreissig und sieben Tage vorher gemeldet -
unabhängig davon, ob die Familie in diesen Wochen in den Ferien ist
oder der Laden Betriebsferien hat. Der Hub weiss beides. Stellen:
`hub/homepilot/core/gutscheine.py`, `hub/homepilot/core/schulferien.py`

**458. Der Ort erinnert nur im Laden selbst.** `gutscheinort.py` führt
Gutschein und Laden über den Namen zusammen - und meldet sich, wenn man
davorsteht. Vor der Fahrt wäre es nützlicher: «Du fährst nach Sursee,
dort gelten zwei Gutscheine» weiss der Hub aus dem Kalender, bevor
jemand im Auto sitzt. Stellen: `hub/homepilot/core/gutscheinort.py`,
`hub/homepilot/core/losfahren.py`

### Abläufe (461-470)

**468. Ein eigener Ablauf lässt sich nicht weitergeben.** Vorlagen gibt
es; das Ausleihen des eigenen nicht. Was hier gut läuft, ist weder zu
sichern noch nach einem Gerätetausch neu aufzubauen noch jemandem zu
zeigen. Ein Ablauf als Datei, mit Geräten als Platzhaltern, ist der
ehrliche Weg. Stellen: `app/src/screens/automations/vorlagen.ts`,
`hub/homepilot/api/routes/automations.py`

**469. Ein Ablauf, der seit einem halben Jahr nie lief, meldet sich
nicht.** Verwaiste Abläufe kennt Punkt 262 - die zeigen auf Geräte, die
es nicht mehr gibt. Der andere Fall ist der stille: alle Geräte da,
Bedingung nie erfüllt, seit Februar nichts. Stellen:
`hub/homepilot/core/verwaist.py`, `hub/homepilot/core/automation.py`

### Push-Benachrichtigungen (471-480)

**473. Der Tagesdeckel zählt, sagt aber nichts.** Wird die achte Meldung
einer Art verschluckt, erfährt das niemand - weder der Empfänger noch
die Einstellungen. Eine Zeile «heute 3 Meldungen zurückgehalten» macht
aus einer stillen Bremse eine sichtbare. Stellen:
`hub/homepilot/core/pushruhe.py`, `app/src/components/PushPrefs.tsx`

**474. Was in der Ruhezeit anfällt, verschwindet.** Zurückgehalten ist
nicht nachgeholt: Am Morgen kommt keine Sammlung dessen, was die Nacht
über liegen blieb. Genau dafür gäbe es `pushbuendel.py` schon - es
bündelt heute nur, was in derselben Runde entsteht. Stellen:
`hub/homepilot/core/pushruhe.py`, `hub/homepilot/core/pushbuendel.py`

**476. Es gibt keinen zweiten Weg.** Fällt Expo aus oder ist das
Telefon ohne Netz, endet die Kette. Eine Mail an dieselbe Adresse
kostet wenig und wäre für genau drei Kategorien - Alarm, Wasser,
Ausfall - der Unterschied zwischen «gemeldet» und «niemand wusste es».
Stellen: `hub/homepilot/core/push.py`, `hub/homepilot/core/pushziel.py`

### Alarmanlage (481-490)

**483. Niemand erinnert ans Scharfschalten.** Alle weg, 22 Uhr, Anlage
unscharf: Der Hub weiss beides (`alarmanwesenheit.py`) und sagt nichts.
Automatisch scharf zu schalten wäre zu viel; die Frage zu stellen ist
genau richtig. Stellen: `hub/homepilot/core/alarmanwesenheit.py`,
`hub/homepilot/core/watchdog.py`

### Selbst gewählt (491-505)

**492. Der Hub weiss nicht, wann er zuletzt gesichert wurde.** Sichern
und Zurückholen gibt es (Punkt 275). Eine Sicherung, an die sich seit
März niemand erinnert hat, ist keine - und der einzige Zeitpunkt, an dem
das auffällt, ist der schlechteste. Stellen:
`hub/homepilot/core/snapshots.py`, `app/src/screens/SystemScreen.tsx`

**493. Das Zurückholen wird nie geprobt.** Eine Sicherung, die noch nie
eingespielt wurde, ist eine Vermutung. Ein Probelauf gegen einen
zweiten, leeren Hub - einmal im Quartal, automatisch - macht daraus
eine Tatsache. Stellen: `hub/homepilot/core/snapshots.py`,
`.github/workflows/pruefung.yml`

**494. Die Anbindungen haben kein gemeinsames Mass.** Jede meldet
Fehler auf ihre Art; `verbindungen.py` und das Flattern (Punkt 232)
fassen zusammen, was sich fassen lässt. Was fehlt, ist die eine Zahl je
Anbindung - seit wann läuft sie, wie oft hat sie diese Woche neu
verbunden, wie lange braucht sie im Schnitt. Stellen:
`hub/homepilot/core/verbindungen.py`, `hub/homepilot/core/metrics.py`

**496. `hub/config.yaml` ist von Hand geschrieben und ungeprüft.** Ein
Tippfehler im Zimmernamen führt zu einem leeren Raum, ein falsch
eingerückter Eintrag zu einer Anbindung, die es nicht gibt. Bemerkt
wird beides beim Neustart, im Log. Ein `--pruefen`, das die Datei liest
ohne zu starten, gehört zu einer Datei, die man im Betrieb ändert.
Stellen: `hub/homepilot/core/config.py`, `deploy/rebuild-hub.sh`

**499. Das Zugriffsprotokoll wird nie gelesen.** Es schreibt mit, wer
wann was geschaltet hat - und niemand schaut hinein, weil es keinen
Anlass gibt. Eine Zeile im Monatsrückblick («diesen Monat 4 Anmeldungen
von neuen Geräten») gibt ihm einen. Stellen:
`hub/homepilot/core/audit.py`, `app/src/screens/HausRueckblick.tsx`

**500. Die Sprachbefehle sind eine Liste ohne Prüfstand.**
`docs/sprachbefehle.md` beschreibt, was gehen soll. Ob es geht, weiss man
erst, wenn man es sagt - und wer eine Entität umbenennt, merkt den
Bruch nie. Stellen: `docs/sprachbefehle.md`,
`hub/homepilot/api/routes/`

**501. Der Stromausfall-Ablauf wird nie geprüft.**
`core/stromrueckkehr.py` erkennt den Kaltstart, der Auslöser «Nach
Stromausfall» hängt daran. Was dann gilt, steht in einem Ablauf, den
niemand ausprobiert hat - und ausprobieren heisst heute: den Strom
abstellen. Ein auslösbarer Probelauf ist ein Knopf. Stellen:
`hub/homepilot/core/stromrueckkehr.py`,
`hub/homepilot/core/automation.py`

**502. Die App zählt keine Wege.** `useKachelnutzung` und
`useRaumnutzung` merken sich, was oft gebraucht wird - für die
Sortierung. Was nie gebraucht wird, folgt daraus ebenso, und das ist die
interessantere Hälfte: Ein Bildschirm, den in sechs Monaten niemand
geöffnet hat, gehört weg oder an einen anderen Ort. Stellen:
`app/src/hooks/useKachelnutzung.ts`, `app/src/hooks/useRaumnutzung.ts`

## Fünfundfünfzig Vorschläge (579–633)

Auf Zuruf erstellt, September 2026: fünf je Bereich für User Experience,
Alltag, App und Hub, Abläufe, Push, Live-Aktivitäten, Gestaltung,
Funktionalität, Familie, Profil und Geräte. Jeder Punkt ist aus dem Code
gelesen und gegen alle 578 früheren Punkte geprüft - was schon gebaut,
schon vorgeschlagen oder bewusst gestrichen ist (Heizung, Abfuhrkalender,
Siri, Variablen, Gutschein-Widget), steht hier nicht noch einmal. Wo ein
Vorschlag einem alten Punkt nahekommt, ist gesagt, warum er trotzdem
neu ist.

Was dabei als *Fehler* aufgefallen ist - Stellen, die heute anders tun,
als der Archivtext oder der Kommentar behauptet - steht am Ende ohne
Nummer, damit die Zahl der Vorschläge nicht mit Reparaturen aufgefüllt
wird.

### User Experience (579-583)

**579. Ein hinausgeworfenes Gerät hält sich für «ohne Netz».** Der Hub
schliesst den WebSocket bei ungültigem Token mit Code 4401
(`api/server.py:347`), die App liest den Code nie (`useHub.ts:297`,
`onclose` ohne Ereignis) und verbindet in Endlosschleife neu. Kopfzeile
und Balken sagen «Keine Verbindung - gezeigt wird der letzte bekannte
Stand», obwohl der Hub erreichbar ist; der einzige Weg zurück ist Konto
→ Abmelden. Genau das passiert, wenn jemand unter «Meine Geräte»
(Punkt 244) das vergessene iPad beendet oder das Passwort wechselt.
Vorschlag: `onclose` liest `event.code`; bei 4401 ein vierter Zustand
`abgemeldet` ohne Wiederverbinden, der Balken sagt «Dieses Gerät wurde
abgemeldet» mit dem Knopf «Neu anmelden»; ein 401 des HTTP-Clients löst
denselben Zustand aus. Nähe: 244 ist die Hub-Seite des Beendens, 439 setzt
einen echten Ausfall voraus. Stellen: `app/src/hooks/useHub.ts`,
`app/src/lib/verbindungsstand.ts`, `app/src/api/client.ts`. Aufwand:
klein · App.

**580. Nach «Das Gerät antwortet nicht» behauptet die Kachel weiter den
Wunschzustand.** Beim Tippen setzt `send()` sofort `expectedState`
(`useHub.ts:377`); läuft das Zeitlimit ab oder meldet der Hub `ok:false`,
wird nur `pending` gelöscht - der optimistische Zustand bleibt stehen,
bis zufällig ein `state_changed` kommt, und der Hub schickt bei einem
gescheiterten Befehl keinen Zustand nach (`server.py:436`). Eine
Homematic-Lampe mit Funk-Timeout steht damit als «an» am Wandpanel,
obwohl sie aus ist; die Meldung nennt dazu kein Gerät. Vorschlag: den
Zustand von vorher je pendentem Befehl mitführen, bei Absage
zurückschreiben und die Kachel bis zum nächsten echten Zustand als
«unbestätigt» kennzeichnen (Fragezeichen statt Punkt, wie «Stand HH:MM»
aus 271); der Toast nennt das Gerät. Nähe: 68 ist die Phase davor, 438
die Verbindungsphase. Stellen: `app/src/hooks/useHub.ts`,
`app/src/lib/kachelstand.ts`, `app/src/components/EntityCard.tsx`.
Aufwand: klein · App.

**581. Eine Absage hinter einem offenen Blatt sieht niemand - auch nicht
an der Haustür.** Fehler- und Bestätigungs-Toasts liegen im Wurzel-View
(`DashboardScreen.tsx:4615`); native Modals decken sie zu. Deshalb
bekommt die Fernbedienung als Einzige `fehler={error}` (`:2181`, der
Kommentar sagt es). Alle übrigen Vollbilder nicht: `Klingelvollbild.tsx`
schickt «aufschliessen» über `onCommand` und hat kein einziges
Fehler-Element - ein abgelehnter Türöffner bei laufender Klingel ist
unsichtbar; Grillvollbild, Musikblatt, Kameravollbild ebenso. Vorschlag:
ein `MeldungsProvider` im `HubContext` mit `useMeldung()` und einem
`<Meldungsband/>`, das im obersten offenen Blatt gerendert wird, sonst
im Wurzel-View; Klingel und Grill zuerst, weil man dort vor dem Gerät
steht. Nähe: 287 betrifft den Text, nicht den Ort. Stellen:
`app/src/components/Toast.tsx`, `app/src/hooks/HubContext.tsx`,
`app/src/screens/dashboard/Klingelvollbild.tsx`. Aufwand: mittel · App.

**582. Die Drei-Minuten-Rückkehr am Wandpanel zählt Tipps in Blättern
nicht - und beendet den Kochmodus mittendrin.** `lastTouch` wird nur
über `onTouchStart` des Wurzel-Views gesetzt (`DashboardScreen.tsx:4005`);
Tipps in nativen Modals kommen dort nicht an. Der Kochmodus ist ein
Modal (`RecipeBook.tsx:969`): Am Panel springt `useTakt` nach 180 s auf
die Startseite, und das Rezept ist weg, während man darin blättert.
Dieselbe Rückkehr ruft `allesZu()` nicht, und `allesZu` kennt
Grillblatt, Fernbedienung, Musikblatt, Posteingang und Push-Blatt gar
nicht (`blaetter.ts:92-107` gegen `DashboardScreen.tsx:552-612`) - sie
bleiben über der Startseite liegen. Vorschlag: `beruehrt()` im
HubContext, ein Hook in jedem Modal; ein Flag «hält wach» (Kochmodus,
laufende Klingel, Grillblatt) setzt die Rückkehr aus; die fünf
fehlenden Blätter ziehen nach `blaetter.ts`, damit `blaetter.test.tsx`
sie zählt. Nähe: 130 ist nur Keep-awake, 280/434 die Wiederaufnahme.
Stellen: `app/src/screens/DashboardScreen.tsx`,
`app/src/screens/dashboard/blaetter.ts`, `app/src/screens/RecipeBook.tsx`.
Aufwand: mittel · App.

**583. Vom Zimmer ins Nachbarzimmer führt nur der Umweg über die
Raumliste.** Im offenen Zimmer heisst Wischen von der Kante «zurück»
(`DashboardScreen.tsx:2047`), das Bereichswischen ist dort ausdrücklich
aus (`:2055`); ein waagrechtes Wischen mitten auf der Seite ist im
Zimmer unbelegt, `RoomTabs` gibt es nur im Anpassen-Modus. Wer abends
Wohnzimmer → Küche → Flur abklappert, geht dreimal zurück zur Liste,
obwohl die Räume eine Reihenfolge haben. Vorschlag: `useBereichWischen`
im Zimmer mit der Raumliste als Nachbarschaft (`nachbarBereich` aus
`lib/bereiche.ts` verallgemeinern); Wischdimmer und Storen-Leiste
behalten Vorrang wie in 522; im Raumkopf kleine «‹ ›»-Pfeile mit dem
Namen des Nachbarn als sichtbarer Weg. Nähe: 522 nennt das Zimmer als
Ausnahme, 507 ordnet die Räume-Seite. Stellen: `app/src/lib/bereiche.ts`,
`app/src/hooks/useBereichWischen.ts`, `app/src/screens/DashboardScreen.tsx`.
Aufwand: klein · App.

### Nützlich im Alltag (584-588)

**584. Der Morgengruss warnt vor UV, aber nicht vor Regen - die
Regenjacke fehlt im Thek.** `morgen.zeilen()` (`core/morgen.py:56`) hat
genau einen Wetter-Posten, den UV-Index. Dabei liegt in derselben
Wetter-Entität `days[0].rain`, `hours[].rain` und `rain.hours`
(`integrations/weather.py:218`, `core/regen.py:70`). Die Regen-Vorwarnung
schaut nur zwei Stunden voraus und ist für die Wäsche gedacht, nicht für
den Schulweg um 7:20 und den Heimweg um 15:40. Vorschlag: reine Funktion
`schulweg_hinweis(hours, jetzt)` in `core/regen.py` - trocken jetzt, Regen
zwischen 11 und 17 Uhr → «Regen ab etwa 13 Uhr - Regenjacke mitgeben»;
nach derselben Regel wie UV nur, wenn etwas zu tun ist, als letzte Zeile
im Morgengruss und als Chip auf der Wetterkarte. Stellen:
`hub/homepilot/core/regen.py`, `hub/homepilot/core/morgen.py`,
`hub/homepilot/core/watchdog.py`, `app/src/components/SidePanel.tsx`.
Aufwand: klein · Hub (+ App für den Chip).

**585. Bei Schnee rechnet der Losfahr-Wecker wie im Juli - und der Morgen
sagt nicht, dass man kratzen muss.** `losfahren.fahrminuten()`
(`core/losfahren.py:118`) kennt nur Kilometer und zwei Tempi; `weather.py`
übersetzt Schnee-Codes zwar in Text, holt aber weder `snowfall_sum` noch
`snowfall` stündlich, und der Morgengruss hat keine Winterzeile. In Zell
heisst «5 cm über Nacht»: Auto freikratzen, Kinder mit Stiefeln, zehn
Minuten früher los - der Hub weiss es um 6 Uhr und sagt es nicht.
Vorschlag: `snowfall_sum`/`snowfall` mit abrufen, im Zustand
`snow_tonight_cm` und `winter_code`; `fahrminuten(km, winter=False)` mit
Faktor 1.4 und zehn festen Minuten fürs Kratzen («Fahrzeit etwa 35
Minuten (Schnee)»); Morgenzeile «Über Nacht 6 cm Schnee - Auto
freikratzen, früher los» ab 2 cm oder bei gefrierendem Regen. Nähe: 340
ist MeteoAlarm, der Frost-Hinweis gilt den Pflanzen. Stellen:
`hub/homepilot/integrations/weather.py`, `hub/homepilot/core/losfahren.py`,
`hub/homepilot/core/morgen.py`. Aufwand: klein · Hub.

**586. Der Losfahr-Wecker kennt Adresse und Kalender, gibt aber weder
Route noch Empfänger weiter.** `_check_losfahren` schickt ohne `to` und
ohne `data` (`watchdog.py:2166`); der Tipp führt nur in den Kalender
(`pushziel.py:56`), obwohl die App Routen längst öffnen kann
(`TopStrip.tsx:69`, `appleMapsRoute`). Und `calendar_ids`
(`google_calendar.py:298`) ist eine Liste ohne Person - der Wecker geht
an alle, auch an den, der im Büro sitzt. Vorschlag: Push mit
`data={"ziel": "route", "location": ort}`, `lib/pushziel.ts` öffnet die
Karten-App mit dem Ziel; je Kalender optional `person:` in der
Konfiguration, dann geht der Wecker mit `to=` nur an diese Person -
die Termin-Erinnerung `_remind_soon` nimmt dieselbe Zuordnung. Nähe: 158
ist der Ablauf-Schritt, 458 die Gutscheine vor der Fahrt. Stellen:
`hub/homepilot/core/watchdog.py`, `hub/homepilot/core/pushziel.py`,
`hub/homepilot/integrations/google_calendar.py`, `app/src/lib/pushziel.ts`.
Aufwand: mittel · Hub + App.

**587. Das Abendessen steht im Wochenplan - und nirgends sonst.**
`family_meals` liest in der App nur `FamilyScreen.tsx`; im Hub schaut der
Wächter nur nachts für den Koch-Stempel hinein (`watchdog.py:1787`), und
der Sonntagabend-Ausblick (`familie.week_ahead`, `familie.py:378`) listet
Termine, Ämtli, Geburtstage - nicht die geplanten Gerichte. Wer um 17 Uhr
am Wandpanel steht, geht vier Tipps tief, um zu sehen, was heute kochen
heisst. Vorschlag: im `TopStrip`/`SidePanel` ab 15 Uhr eine Zeile «Heute:
Lasagne» (Tipp öffnet das Rezept im Kochmodus); in `week_ahead` ein Block
«Essen: Mo Lasagne · Di Reis …» und am Sonntag die Zeile «Für Mittwoch
fehlt noch ein Plan». Nähe: 139/146 spielen innerhalb der Familienseite,
204 kennt kein Essen. Stellen: `app/src/components/TopStrip.tsx`, neu
`app/src/lib/tagesgericht.ts`, `hub/homepilot/core/familie.py`. Aufwand:
klein · Hub + App.

**588. Die Waschmaschine ist fertig, und der Hub weiss, dass es bis 19
Uhr trocken bleibt - er sagt es nicht.** Beim Übergang laufend → fertig
bekommt nur das Kochgerät eine Durchsage (`watchdog.py:2059`); ein
Wäschegerät hört man erst nach den `hours` als «ist noch voll»
(`waschkueche.mahnsatz`, `waschkueche.py:222`), und der Satz sagt nichts
zum Wetter, obwohl `hours[]` mit Regen und Temperatur je Stunde daliegt.
Die Regen-Vorwarnung kann nur die Umkehrung («hereinholen»), nicht «jetzt
lohnt sich die Leine statt der Tumbler». Vorschlag: reine Funktion
`waeschetag(hours, jetzt)` - bis Sonnenuntergang kein Regen, Höchstwert
≥ 15 °C → «Draussen trocknet's: bis 19 Uhr kein Regen, 23 °C» als Zusatz
zur ersten Wäsche-Meldung; bei Regen in der nächsten Stunde «Regen kommt
- lieber Tumbler». Nur tagsüber, nie beim Tumbler selbst. Nähe: 229
(Tarif) ist gestrichen und ein anderes Thema. Stellen:
`hub/homepilot/core/waschkueche.py`, `hub/homepilot/core/regen.py`,
`hub/homepilot/core/watchdog.py`. Aufwand: klein · Hub.

### App und Hub (589-593)

**589. Eine unlesbare Datendatei wird beim ersten Schreiben durch eine
leere ersetzt - und dann gesichert.** `DataStore.load()` gibt bei
kaputtem JSON nur eine Warnung aus und liefert `EMPTY`
(`persistence.py:214`). Direkt danach schreibt der Start `data.set("lauf",
…)` (`hub.py:184`), und `_write()` ersetzt die kaputte Datei per
`os.replace` - Benutzer, Abläufe, Gutscheine, Familienlisten sind weg,
obwohl 14 Tagessicherungen daneben liegen; die nächste Tagessicherung
kopiert den leeren Stand, nach 14 Tagen ist die letzte gute Sicherung
ausgerottet. Dazu setzt `_write()` `_dirty = False` *vor* dem Schreiben
(`:261`): Schlägt es fehl (volle Platte), ist die Änderung bis zum
nächsten `set()` still weg. Vorschlag: die unlesbare Datei nach
`homepilot-data.json.kaputt-<Stempel>` verschieben, die jüngste lesbare
Sicherung laden, im Status und als Push melden, im Notlauf keine neue
Sicherung schreiben und nichts nach Supabase laden; das Dirty-Flag erst
nach Erfolg zurücksetzen, den letzten Schreibfehler im Status ausweisen.
Nähe: 6, 275, 492, 493 betreffen das Anlegen und Prüfen von Sicherungen,
nicht den Moment des Überschreibens. Stellen:
`hub/homepilot/core/persistence.py`, `hub/homepilot/core/hub.py`,
`hub/tests/test_persistence.py`. Aufwand: mittel · Hub.

**590. Der Neustart-Knopf sieht für den Hub aus wie ein Stromausfall.**
`/api/system/restart` und das Zurückspielen einer Sicherung beenden den
Prozess über `threading.Timer(0.8, _exit_for_restart)`
(`routes/system.py:333, 948`), und das ist `os._exit(0)`
(`server.py:132`). `hub.stop()` läuft nie: kein Vermerk «beendet», kein
Weglegen des Log-Rings, kein `data.flush()`. Beim nächsten Start gilt
der liegengebliebene Vermerk «läuft» als Kaltstart
(`stromrueckkehr.py:56`), und der Ablauf «Nach Stromausfall» räumt das
Haus ab - nach einem Tipp auf «Neustart» am Nachmittag. Beim
Zurückspielen kommt dazu: `restore_backup()` ruft `save()`, das innerhalb
der Sammelsekunde nur vormerkt - ob der Flush vor dem `os._exit` nach
0,8 s noch feuert, ist Zufall. Vorschlag: geordnetes Ende (SIGTERM an den
eigenen Prozess oder `await hub.stop()` vor dem Exit), in
`restore_backup()` direkt `_write()`; als zweites Signal in
`stromrueckkehr` die Betriebszeit des Rechners (`/proc/uptime`) - lief
der Host schon Stunden, war es kein Stromausfall. Nähe: 501 will den
Ablauf *auslösen* können, hier wird er fälschlich ausgelöst; 88/89
setzen ein geordnetes Ende voraus, das der Knopf nicht auslöst. Stellen:
`hub/homepilot/api/server.py`, `hub/homepilot/api/routes/system.py`,
`hub/homepilot/core/stromrueckkehr.py`. Aufwand: klein · Hub.

**591. Die Bremse gegen Fehlversuche gilt nicht für den WebSocket - und
traut jedem `X-Forwarded-For`.** Der WebSocket-Handschlag prüft das Token
ohne die Bremse (`server.py:342`): Wer über `/ws` rät, wird nie gesperrt,
während `/api/*` nach zehn Versuchen dichtmacht. Und `client_address()`
nimmt den Kopf `X-Forwarded-For` bedingungslos (`throttle.py:155`) - die
Doku setzt einen Proxy voraus, nichts prüft, ob die Anfrage von ihm
kommt. Wer den Kopf selbst setzt, umgeht die Sperre mit einer neuen
Adresse je Versuch, sperrt fremde Adressen aus, und dieselbe Adresse
landet im Zugriffsprotokoll von Türe und Alarm. Vorschlag: Liste
`api.trusted_proxies` in der Konfiguration, der Kopf zählt nur von dort;
den Handschlag durch dieselbe Bremse führen wie `current_user` (gesperrt
→ 4429). Dazu gehört: Türe und Alarm über den WebSocket hinterlassen
heute gar keine Adresse im Protokoll (`server.py:426` ruft
`audit.record` ohne sie, nur der REST-Weg reicht sie mit) - beim
Annehmen einmal bestimmen und jedem Eintrag mitgeben. Nähe: 34, 33, 35,
244 - die Bremse selbst hat keinen Punkt. Stellen:
`hub/homepilot/core/throttle.py`, `hub/homepilot/api/server.py`,
`hub/homepilot/core/audit.py`, `docs/app-ohne-vpn.md`. Aufwand: klein ·
Hub.

**592. Das Wandpanel merkt nicht, dass seine Verbindung tot ist.** Die
App verbindet nur neu, wenn `onclose` feuert oder sie aus dem Hintergrund
zurückkommt (`useHub.ts:297-332`). Einen Ping schickt sie nie - der Hub
kennt `{"type":"ping"}` (`server.py:361`), die App kennt nur den Typ
`pong`, sendet aber nichts. Das iPad im Flur geht nie in den Hintergrund:
Nach einem Neustart des Accesspoints oder einem NAT-Timeout bleibt der
Socket halboffen, der Punkt bleibt grün, der Stand bleibt stehen, und ein
Tipp endet nach 6 s in «Das Gerät antwortet nicht» - ohne dass daraufhin
neu verbunden würde. Vorschlag: solange «verbunden», alle 30 s ein Ping
über `useTakt`; bleibt der Pong 10 s aus, `ws.close()` - der bestehende
`onclose`-Zweig verbindet neu; ebenso nach einem Befehl im
`PENDING_TIMEOUT`. «Verbunden» erst nach dem ersten Pong. Nähe: 438 ist
die Sekunde nach dem Aufwachen, 232 misst im Hub. Stellen:
`app/src/hooks/useHub.ts`, `app/src/hooks/useTakt.ts`,
`app/src/lib/verbindungsstand.ts`. Aufwand: klein · App.

**593. Die Sicherung sichert eine Datei - der Hub besteht aus einem
Dutzend.** Täglich und offsite gesichert wird nur `homepilot-data.json`
(plus Matter-Tar, Punkt 53): `persistence.backup()` (`:386`),
`_offsite_backup` (`hub.py:382`). Daneben liegen und fehlen:
`geraete-verlauf.json`, `gutscheindateien/` (die PDFs aus 266), Rezept-,
Personen- und Raumbilder, der Grundriss, der Anrufbeantworter-Ton, die
Token-Dateien von Google, Spotify, Ring, Roborock, `config.yaml`,
`secrets.env`, `config-history/`. Nach einem Plattenschaden zeigen
Gutscheine ins Leere, Rezepte haben kein Foto, vier Dienste wollen neu
angemeldet werden. Und der Rückweg: Herunterladen gibt es
(`system.py:803`), Hochladen einer Sicherung aus der App und «aus dem
Bucket zurückholen» nicht - nach dem Totalausfall führt der Weg über SSH
und das Supabase-Dashboard. Vorschlag: Sicherung als Tar mit denselben
Fristen, `restore_backup()` entpackt entsprechend; zwei Routen
`backups/upload` und `backups/offsite/{name}/fetch` unter System →
Sicherung. Nähe: 53 hat eine dieser Lücken geschlossen, 275 zählt auf,
was die App kann - Hochladen ist nicht darunter. Stellen:
`hub/homepilot/core/persistence.py`, `hub/homepilot/core/offsite.py`,
`hub/homepilot/api/routes/system.py`, `app/src/screens/SystemScreen.tsx`.
Aufwand: mittel · Hub + App.

### Abläufe (594-598)

**594. Der Hub versteht «nur wenn Livia daheim ist» - und weist es beim
Speichern ab.** Der Editor baut seit Commit `40cdc50` Kontext-Bedingungen
`presence`/`availability`/`weather_warning`/`calendar`
(`entwurf.ts:1001-1050`), der Motor prüft sie (`automation.py:3342ff`).
Die Speicherprüfung aus Punkt 378 kennt aber nur `CONDITION_TYPES =
{group, state, time, sun}` (`ablaufpruefung.py:53`) - die vier Typen kamen
einen Tag *nach* der Liste dazu. `pruefen({'condition': [{'type':
'presence', …}]})` ergibt «Unbekannter Bedingungstyp», die Route antwortet
400: Jeder Ablauf mit Person-, Termin-, Warnungs- oder
Erreichbarkeits-Bedingung lässt sich in der App nicht speichern. Nebenbei:
`ablaufpruefung.py:69` prüft bei `if`-Schritten den Schlüssel `condition`,
der Motor liest `conditions` (`automation.py:4185`) - Bedingungen in
Verzweigungen werden gar nicht geprüft. Vorschlag: `CONDITION_TYPES` auf
die acht Zweige von `_check_condition` erweitern, `condition` →
`conditions` bei `if`, ein Routen-Test, der einen Ablauf mit
Anwesenheits-Bedingung wirklich per POST anlegt, und ein Test, der die
Liste gegen den Motor hält. Stellen: `hub/homepilot/core/ablaufpruefung.py`,
`hub/tests/test_ablaufpruefung.py`, `hub/tests/test_automations.py`.
Aufwand: klein · Hub.

**595. Eine Bedingung kann nicht fragen, *seit wann* ein Zustand gilt -
obwohl der Hub es weiss.** `_check_condition` für `state` kennt nur
`equals/above/below` (`automation.py:3287`); «bleibt so für» gibt es nur
am Auslöser. Dabei führt jede Entität `last_change` (`entity.py:166`,
nach einem Neustart aus dem Ereignisprotokoll zurückgeholt), benutzt nur
für Anzeigen. Fälle: «Sauger starten, nur wenn seit 30 Min keine Bewegung
im Wohnzimmer», «Willkommenslicht nur, wenn seit über 1 h niemand da war»
(sonst meldet der Gang zum Briefkasten ein zweites Willkommen),
«Fernseher läuft seit über 2 h → Hinweis». Vorschlag: `min_age` (Minuten)
an der Zustandsbedingung; unbekanntes `last_change` heisst nicht erfüllt;
`describe_condition` sagt «Flur ist erst seit 4 Min aus, verlangt sind
30»; `wait_until` und `if` bekommen es geschenkt; im Editor ein Feld
«seit mindestens … Minuten». Nähe: 547 ist nur der Nachlauf, 578 nur die
Anzeige. Stellen: `hub/homepilot/core/automation.py`,
`app/src/screens/automations/entwurf.ts`,
`app/src/screens/automations/schritte.tsx`. Aufwand: klein · Hub + App.

**596. Der Hub sieht, dass ein Lauf wirkungslos war - und tut nichts
damit.** `_wirkung_planen` (`automation.py:2937`) sieht sechs Sekunden
nach dem Lauf nach (`core/wirkung.py`) und schreibt `effect:
wirkungslos/teilweise` in den Verlauf - mehr nicht. Die Fehlschlag-Push
aus 465 kommt nur bei Ausnahmen; ein verlorener Funkbefehl wirft keine.
«Gute Nacht» lässt die Stehlampe an, der Hub *weiss* es, und die Auskunft
liegt im aufgeklappten Verlauf, den niemand nachts liest. Vorschlag: bei
`fehlt` einmal nachfassen - für genau diese Geräte den Befehl noch einmal
schicken, erneut prüfen, `effect.nachgefasst = true`; bleibt es
wirkungslos, geht die Meldung über den 465-Weg («Ablauf ohne Wirkung:
Stehlampe blieb an», einmal täglich je Ablauf). Nähe: 465 (nur
Ausnahmen), 30 (Homematic-Sendespeicher). Stellen:
`hub/homepilot/core/automation.py`, `hub/homepilot/core/wirkung.py`,
`app/src/screens/automations/entwurf.ts` (`wirkungText`). Aufwand:
mittel · Hub.

**597. Ein Ablauf kann einen anderen starten, aber nicht ruhen lassen.**
Der Schritt `automation` führt nur die Aktionen des anderen aus
(`_run_other`, `automation.py:4113`). Ruhen lassen (`quiet_until`) gibt
es als Route und Hand-Knopf (159), ein/aus nur per Bearbeiten, der
Babysitter-Modus ist global. Fälle: «Termin ‹Gäste› beginnt →
Bewegungslicht Flur ruht, bis der Termin endet», «Szene Kino →
Bewegungslicht Wohnzimmer ruht 3 h», «Alarm auf ‹weg› →
Anwesenheitssimulation ein, beim Entschärfen aus». Vorschlag: den Schritt
um `do: run | snooze | enable | disable` und `minutes`/`until: "06:00"`
erweitern (`run` bleibt Vorgabe); `snooze`/`enable`/`disable` schreiben
wie die Route in `hub.data`, config.yaml-Abläufe nur zur Laufzeit;
Verlaufsnotiz «‹Flurlicht› ruht bis 06:00»; Editor-Chips im Schritt
«Ablauf starten». Nähe: 78 (starten), 75/159 (ruhen von Hand), 156
(Ferienmodus als Vorlage). Stellen: `hub/homepilot/core/automation.py`,
`app/src/screens/automations/entwurf.ts`,
`app/src/screens/automations/schritte.tsx`. Aufwand: klein · Hub + App.

**598. Die Zeitbedingung kennt Wochentage, Feiertage und Ferien - aber
keine Jahreszeit.** Der `time`-Zweig (`automation.py:3299`) prüft
`weekdays`, `except_holidays`, `except_school_holidays`, `after/before`;
einen Datums- oder Monatsbereich gibt es nicht, `valid_until` (464) ist
ein einmaliges Ende. Weihnachtsbeleuchtung 1.12.–6.1.,
Hitzeschutz-Abläufe Mai–September, Wecklicht nur Oktober–März: heute
jedes Jahr von Hand ein- und ausschalten. Vorschlag: `from: "MM-DD"`,
`to: "MM-DD"` an der Zeitbedingung, über den Jahreswechsel wie
`time_in_window` (rein: `datum_im_fenster(heute, von, bis)`);
`describe_condition` sagt «Heute ist der 14.3., verlangt ist
1.12.–6.1.»; die Simulation rechnet es mit; im Editor unter den
Wochentagen eine Zeile «Nur vom … bis …». Nähe: 154, 470, 464. Stellen:
`hub/homepilot/core/automation.py`, `hub/homepilot/core/ablaufsimulation.py`,
`app/src/screens/automations/entwurf.ts`, `editor.tsx`. Aufwand: klein ·
Hub + App.

### Push-Benachrichtigungen (599-603)

**599. Der Hub weiss, wer zuhause ist - aber kein Empfänger heisst «wer
zuhause ist».** `recipients()` kennt nur `all`, Rolle, Name und
`gruppe:<Name>` (`push.py:869-912`). Die Anwesenheit je Person liegt
daneben fertig (`presence.py:645`, `livekarten.nicht_zuhause`) und wird
für keine einzige Meldung als Empfängerfilter benutzt: «Fenster Bad steht
offen» geht um 22 Uhr auch an den, der in Zürich sitzt; «Es klingelt»
geht an alle, obwohl die Person im Flur die Klingel hört und nur die
Unterwegs-Person das Bild braucht. Vorschlag: zwei dynamische Ziele nach
dem Muster von `GRUPPE_PREFIX`: `anwesend` und `unterwegs`, im
Ablauf-Editor als Ziel, und für die Wächter-Regeln `open` und
`appliance` ein Schalter «nur an Anwesende». Fällt niemand in die Menge,
geht sie an alle - eine Meldung darf nicht an der Ortung scheitern.
Nähe: 158 (eine Person), 513 (statische Gruppen). Stellen:
`hub/homepilot/core/push.py`, `hub/homepilot/core/watchdog.py`,
`hub/homepilot/api/routes/push.py`,
`app/src/screens/automations/schritte.tsx`. Aufwand: mittel · Hub + App.

**600. Eine Klingel-Meldung, die eine Stunde später ankommt, ist
schlimmer als keine - und der Hub setzt kein Verfallsdatum.** Jede
Nachricht geht ohne `ttl` an Expo (`push.py:1004-1020`); Apple und Google
halten sie dann bis zu einem Monat zurück, wenn das Telefon ohne Netz
ist. Genau dieser Fall steht als Anlass in `pushcheck.py:6` - das
Werkzeug misst ihn, verhindert ihn aber nicht. Vorschlag: eine
namentliche Tabelle `VERFALL` in Sekunden: `doorbell` 90, `timer` 300,
`oven`/`grill` 600, `baby_cry` 300, `departure` bis Terminbeginn,
`camera_motion` 600; alles andere ohne Verfall (Alarm, Wasser, Rauch
sollen auch verspätet kommen). Test: Was in `IMMER_DURCH` steht, hat
keinen Verfall unter einer Stunde, ausser den namentlich als flüchtig
erklärten. Nähe: 512 ist *wie schnell*, nicht *wie lange gültig*.
Stellen: `hub/homepilot/core/push.py`, `hub/tests/test_pushtexte.py`.
Aufwand: klein · Hub.

**601. Die Fenster-Erinnerung sagt «im Winter» - auch im Juli, auch wenn
die ganze Familie am Lüften ist.** `_check_open` schickt nach n Stunden
fest «… im Winter geht so die Heizung zum Fenster hinaus»
(`watchdog.py:2429`), unabhängig von Aussentemperatur und Anwesenheit;
die Aussentemperatur liegt an der Wetter-Entität, und die Vorschau in
`pushbeispiel.py` verspricht sogar «draussen sind es 4 °C», was der
Ernstfall nicht liefert. Mit Deckel 6/Tag ist das im Sommer die häufigste
Lärmquelle. Vorschlag: reine Funktion `offen_lohnt(aussen_temp,
jemand_zuhause, regen_in_min)` in `watchrules.py` - über `warm_ab`
(Vorgabe 18 °C) und jemand zuhause: schweigen; niemand zuhause: immer
melden, aber mit dem passenden Satz («Niemand zuhause und das Fenster im
Bad offen»), und die Zahl aus dem Wetter im Text. Nähe: 112, 340 nennen
offene Fenster in anderen Warnungen. Stellen:
`hub/homepilot/core/watchrules.py`, `hub/homepilot/core/watchdog.py`,
`hub/homepilot/core/notifyrules.py`. Aufwand: klein · Hub.

**602. Wasser wird gemeldet und eskaliert - aber niemand erfährt, dass es
wieder trocken ist.** `_check_leaks` meldet «Wasser: …» und nach 15
Minuten «Immer noch nass» (391); wird der Melder trocken, wird nur der
Merker gelöscht (`watchdog.py:2486`), keine Meldung. Für Anbindung, Gerät
und Brandmeldeanlage gibt es das «wieder da» längst. Wer die Meldung
unterwegs bekam, ruft an oder fährt heim, obwohl längst aufgewischt ist.
Vorschlag: beim Übergang nass → trocken «Wieder trocken: {Melder}» mit
Dauer («war 23 Minuten nass») unter derselben Kategorie, nur wenn die
erste Meldung wirklich hinausging; Test gegen Flattern nass/trocken/nass.
Stellen: `hub/homepilot/core/watchdog.py`, `hub/homepilot/core/watchrules.py`,
`hub/tests/test_watchdog.py`. Aufwand: klein · Hub.

**603. Die selbst gestellten Erinnerungen laufen an allem vorbei, was
Push seit Punkt 318 kann.** `core/erinnerungen.py:195` schickt
`hub.push.send(tokens, "⏰ Erinnerung", text)` - ohne `category`, ohne
`data`. Folge: kein Ziel (Tipp öffnet nur die App), kein «Später»-Knopf,
keine Zeile in den Push-Einstellungen, kein Beispiel, keine Probe, und
auf dem Nachlese-Zettel steht `category: None`. Ausgerechnet die
Meldung, die jemand bewusst für sich gesetzt hat, kann man am
Sperrbildschirm nicht verschieben - die Wäsche-Mahnung schon.
Vorschlag: Kategorie `reminder` in `CATEGORIES`, Gruppe Familie, in
`IMMER_DURCH`, Knöpfe `KNOEPFE_SPAETER`, Ziel `familie:reminders`,
Beispiel in `pushbeispiel.py`; die bestehenden Tests (jede Kategorie hat
ein Ziel, ein Beispiel, eine Gruppe) ziehen sie von selbst mit. Nähe:
322/327 gingen über alle Kategorien - die Erinnerungen fehlten dort, weil
sie keine sind. Stellen: `hub/homepilot/core/erinnerungen.py`,
`hub/homepilot/core/push.py`, `hub/homepilot/core/pushziel.py`,
`hub/homepilot/core/pushbeispiel.py`. Aufwand: klein · Hub.

### Live-Aktivitäten, Widget, Watch (604-608)

**604. Brennt es, sagt die Sperrbildschirm-Karte «Alarmanlage» und führt
zur Einbruchanlage.** Die Brandmeldeanlage ist eine Entität der Art
`alarm` (`brand.py:59`) mit Zustand `ausgeloest`. `karten_alarm` prüft
nur `entity.kind != "alarm"` (`livekarten.py:891`) und baut für *jede*
solche Entität die Karte «Alarmanlage · Alarm ausgelöst!» mit
`homepilot://alarm`. Bei Rauch liegt also eine Karte, die die
Einbruchanlage nennt und in deren Bereich springt; die App trennt beides
längst über `integration === 'brand'`, der Adress-Handler kennt kein
`brand` (`DashboardScreen.tsx:1445`). Vorschlag: eigene Kartenart
`brand:<id>` mit Titel «Rauch»/«Gas», den auslösenden Meldern samt Raum,
rot, Griff `homepilot://brand`, Knopf «Stumm» (`POST /api/brand/stumm` -
harmlos; Quittieren bewusst nicht); `karten_alarm` schliesst die
Brand-Entität aus; App bekommt die Route und den `liveAus`-Eintrag. Nähe:
543 baut Push und Schaltbefehle, keine Karte. Stellen:
`hub/homepilot/core/livekarten.py`, `hub/tests/test_livekarten.py`,
`app/src/screens/DashboardScreen.tsx`,
`app/src/components/LiveTuerSchalter.tsx`. Aufwand: klein · Hub + App.

**605. Der Küchen-Timer verschwindet vom Sperrbildschirm in der Sekunde,
in der er klingelt - und hat keinen Knopf.** `_run` entfernt den Timer
*vor* der Meldung aus der Liste (`timers.py:138`), damit fällt die Karte
aus `karten_timer` heraus; sie hat kein `ende` (`livekarten.py:198`),
also `dismissal-date = jetzt`. Die Waschmaschine darf dagegen 15 Minuten
«Fertig» sagen. Und anders als Sauger und Fernseher trägt die Timer-Karte
keine `knoepfe` - Stoppen geht nur über App oder Uhr. Vorschlag: `ende`
«Abgelaufen - <Text>», orange, 600 s sichtbar; zwei Griffe «Stopp» und
«+5 min» - da `KartenBefehlIntent` nur POST kann, braucht es
`POST /api/timers/{id}/verlaengern` und `…/abbrechen` neben dem
bestehenden DELETE; `KitchenTimers.extend()` plant den Task neu. Nähe:
133/143 (Rezept-Uhr), 561/568 (Grill-Timer). Stellen:
`hub/homepilot/core/timers.py`, `hub/homepilot/api/routes/haus.py`,
`hub/homepilot/core/livekarten.py`. Aufwand: klein · Hub.

**606. Die Erinnerungs-Karte liegt, bis man die App öffnet - «Erledigt»
gibt es nur dort.** `karten_erinnerungen` liefert Titel, Text, Symbol,
aber weder `url` noch `knoepfe` (`livekarten.py:840`); der Tipp öffnet
die App-Wurzel. Quittieren läuft heute über ein PUT mit der ganzen
`quittiert`-Liste (`useFamilienlisten.ts:203`) - vom Widget-Prozess aus
nicht machbar. Die Push-Mitteilung derselben Kategorie trägt längst
«Erledigt» und «Später». Vorschlag: `POST /api/family/reminders/{id}/
quittieren` (Name aus dem Token, idempotent) und `…/spaeter`; die Karte
bekommt beide als Knöpfe und `url: homepilot://erinnerung/<id>`, die das
bestehende `Erinnerungsvollbild` öffnet. Nähe: 397, 514, 322 betreffen
Push-Mitteilungen, nicht die Karte. Stellen:
`hub/homepilot/api/routes/family.py`, `hub/homepilot/core/livekarten.py`,
`app/src/screens/DashboardScreen.tsx`. Aufwand: klein · Hub + App.

**607. Die Heimweg-Karte weiss nichts vom Haus - ihr Textfeld ist immer
leer.** `start_payload` schickt `content-state: {"text": ""}`
(`liveaktivitaet.py:668`), und das Widget zeichnet ohnehin nur den festen
Satz («… im Schnellzugriff», `index.swift:720`) - `ContentState.text`
wird auf keiner Seite je gefüllt oder gelesen. Dabei entsteht die Karte
300 m vor dem Haus, und der Hub weiss in diesem Moment, was man vor der
Türe wissen will: ob die Anlage scharf ist (Eingangsverzögerung!), ob
jemand zuhause ist, ob Licht brennt. Vorschlag: beim Start den Text aus
dem Hauszustand füllen - rein: `heimweg_text(alarm_state, anwesende,
lichter)` → «Alarm scharf · Livia ist zuhause» oder «Niemand zuhause · 2
Lichter an» (Quellen wie `/api/glance`); im Widget die Zeile aus
`context.state.text` mit Rückfall auf den heutigen Satz. Nähe: 127
(Alarm im Widget), 487 (Eingangsverzögerung als Ton). Stellen:
`hub/homepilot/core/liveaktivitaet.py`, `hub/tests/test_liveaktivitaet.py`,
`app/targets/widget/index.swift`. Aufwand: klein · Hub + App
(TestFlight-Build).

**608. Die Uhr sieht, dass die Anlage unscharf ist, kann sie aber nicht
scharf schalten.** `BlickView` zeigt «Alarm unscharf»
(`targets/watch/App.swift:82`) - und das war's. Die Uhr hat Türe (mit
Rückfrage) und Timer, aber keinen Griff für die Anlage; Widget und
Android Auto haben seit 486 den Knopf «Scharf» (`POST /api/alarm/arm
{mode: 'ausser_haus'}`). Beim Rausgehen mit vollen Händen - genau die
Situation, für die die Uhr laut ihrem Kopfkommentar da ist - bleibt nur
das Telefon. Vorschlag: unter der Alarm-Zeile ein Knopf «Scharf
schalten», nur bei `unscharf`, mit derselben Bestätigung wie die Türe
und derselben Regel wie 486 (nur die harmlose Richtung, nie unscharf);
die Antwort «offene Fenster» (400) als Zeile anzeigen statt verschlucken.
Nähe: 486 nennt Widget und Knopfwand, nicht die Uhr; 405 gilt als
«nicht umgesetzt», die App existiert inzwischen. Stellen:
`app/targets/watch/App.swift`, `app/targets/watch/HubClient.swift`.
Aufwand: klein · App (Swift, TestFlight).

### Gestaltung (609-613)

**609. Grün ist als Schrift unlesbar - «An», «Scharf», «Online» stehen in
der Symbolfarbe.** Punkt 442/444 hat für Orange die Regel «Symbole nehmen
`warn`, Text nimmt `warnInk`» eingeführt. Für Grün gibt es kein
Gegenstück: `on` steht an 31 Stellen als Schriftfarbe - der grosse Wert
der Schalterkachel (`entity/teile.tsx:39`, 26 pt fett), «Scharf · …»
(`AlarmScreen.tsx:178`), Erfolgszeilen in Login, Einstellungen, Gute
Nacht, Kontoblatt. Nachgerechnet mit `lib/kontrast.ts`: 1,71:1 im Hellen,
1,69:1 in Sand - unter jeder Schwelle, auch der 3:1 für grosse Schrift;
der Kontrasttest prüft `accent` und `danger` als Text, `on` nie. Dasselbe
Muster bei Weiss auf gefüllten Knöpfen: fest `'#FFFFFF'` auf `accent`
ergibt 2,69 (dunkel) und 2,72 (Mitternacht), auf `on`/`warn` («Geöffnet»,
«Bewegung», «Offen») 1,5–2,7 überall - und kein Test misst es.
Vorschlag: `onInk` in alle fünf Paletten plus Tokens `onAccent`/
`onSignal` für Schrift auf Flächen, je Palette so gewählt, dass 4,5:1
steht; zwei Testfälle in `kontrast.test.ts`; die 31 und die neun Stellen
umstellen, Zustandspunkt und Symbole bleiben bei `on`. Nähe: 442/444
lösten es für Orange, 366 für Weiss auf dem Verlauf. Stellen:
`app/src/theme.tsx`, `app/src/lib/kontrast.test.ts`,
`app/src/components/entity/teile.tsx`, `app/src/components/entity/stil.ts`.
Aufwand: klein · App.

**610. Am Wandpanel wächst nur die Lichtkachel - alle anderen Kacheln
bleiben in Telefonschrift.** Punkt 445 hat `typFuer(panel)`/`useTyp()`
gebaut; benutzt wird es genau einmal (`EntityCard.tsx:277`). `CardFooter`
- die Fusszeile jeder Schalter-, Sensor-, Storen-, Schloss- und
Boxenkachel - nimmt das statische `type.cardTitle` (`Card.tsx:219`),
`RoomCard` schreibt fest 21/13 (`:293, 369`), die Begrüssung fest 34/24
(`TopStrip.tsx:1599`), und selbst in der Kachel, der `typ` übergeben
wird, bleiben `detail` (12), `szeneName` (20), `pillText` (13) fest
(`entity/stil.ts:481ff`). Ergebnis an der Wand: Lichtname 19 pt neben
Schaltername 16 pt. Die Probe misst nur `theme: 'dark'` ohne Panel
(`probe.mjs:46, 89`). Vorschlag: `useTyp()` in `Card`, `RoomCard`,
`Kennzahl`, `TopStrip` durchziehen, die festen Zahlen in `stil.ts` an
`typ` hängen, `Typmass` um `detail` und `chip` erweitern; in `probe.mjs`
eine dritte Grösse «Wandpanel» mit `panel: true`, die misst, dass
Kachelname und Fusszeile dort dieselbe Höhe haben wie die Lichtkachel.
Nähe: 445 erledigte eine Kachelart und hinterliess die Ungleichheit.
Stellen: `app/src/components/Card.tsx`, `app/src/components/entity/stil.ts`,
`app/src/components/RoomCard.tsx`, `scripts/probe.mjs`. Aufwand:
mittel · App.

**611. Zwei Symbolwörterbücher für dieselbe Geräteart - im Grundriss ist
der Bewegungsmelder ein Radioknopf und der Feuchtefühler ein
Thermometer.** `lib/symbole.ts` (294) regelt Handlungen, nicht
Gerätearten. Dafür gibt es zwei Tabellen, die einander widersprechen:
`KIND_ICONS` in `RoomTile.tsx:21` (`sensor` → Thermometer, `binary_sensor`
→ `radio-button-on-outline`) und `deviceKindIcon` in `geraeteart.ts:172`
(`sensor` → Tachometer, `binary_sensor` nach `device_class`: Flamme,
Wasser, Türe, Fenster, Männchen), dessen Docstring «dasselbe Vokabular
wie die Kacheln» verspricht. Grundriss und Übersicht nehmen die erste,
Ablauf- und Szeneneditor die zweite; keine kennt die Einheit eines
`sensor` - Feuchte, Leistung, CO₂, Helligkeit sehen überall gleich aus,
ausgerechnet am Wandpanel-Grundriss. Vorschlag: `KIND_ICONS` löschen,
`deviceKindIcon` zur einzigen Quelle machen und um `sensor` nach
`device_class`/`unit` erweitern (`%` → Wasser, `W`/`kWh` → Blitz, `lx` →
Sonne, `ppm` → Blatt, `°C` → Thermometer); der Symboltest liest sie mit,
das Musterblatt bekommt eine Reihe «Gerätearten». Nähe: 294, 526, 446.
Stellen: `app/src/lib/geraeteart.ts`, `app/src/components/RoomTile.tsx`,
`app/src/components/Grundriss.tsx`, `app/src/lib/symbole.test.ts`.
Aufwand: klein · App.

**612. «Bewegung» trägt vier Farben - rot auf der Kamerawand, orange auf
der Kamerakachel, grün auf der Raumkachel, weiss im Raumkopf.** Dieselbe
Auskunft, vier Signale: `Kamerawand.tsx:157` füllt das Männchen fest mit
`#E5484D` (Rot = Alarm), die Kamerakachel zeigt `Pill «Bewegung»
tone={colors.warn} solid` (`EntityCard.tsx:913`), die Raumkachel ein
grünes Männchen auf `onSoft` (`RoomCard.tsx:191`), der Raumkopf ein
weisses auf `surfaceSoft` (`dashboard/stile.ts:536`). 444 hat
argumentiert, Rot müsse für «jetzt aufstehen» reserviert bleiben - die
Kamerawand verwendet es für jede Katze im Garten. Vorschlag: eine
Funktion `bewegungsSignal(colors)` in `lib/bewegung.ts` (rein) für Farbe
und Grundfläche des Männchens, überall dieselbe, nach der Regel der
Raumkachel; Kamerawand und Kamerakachel darauf umstellen, die Pille wird
zum Männchen mit Wort; ein Quellen-Test wie `symbole.test.ts`. Nähe: 444,
578, 71. Stellen: `app/src/lib/bewegung.ts`,
`app/src/components/Kamerawand.tsx`, `app/src/components/EntityCard.tsx`,
`app/src/screens/dashboard/stile.ts`. Aufwand: klein · App.

**613. Der Ein/Aus-Knopf ist 34 Punkte gross, der Stift 32, die Garstufe
30 - und niemand misst die Trefffläche.** `PowerButton` 34×34 ohne
`hitSlop` (`Card.tsx:227`), `editButton` 32, `kameraRund` 32, `grillStep`
30 (`entity/stil.ts`), die Zeitraum-Chips im Verlauf nackte `Text` mit
`onPress`, rund 19 Punkte hoch, ohne Rolle (`HistoryChart.tsx:234`).
Apple verlangt 44×44, WCAG 2.5.8 mindestens 24. Der Ein/Aus-Knopf ist die
meistgedrückte Fläche im Haus - wer daneben tippt, tippt auf die Kachel,
und die öffnet je nach Bildschirm den Verlauf. `hitSlop` steht 143-mal im
Code, jede Stelle nach Gefühl; die Probe misst Überlauf, Blattstand,
Lauftext, Kachelhöhen - keine Trefffläche. Vorschlag: `theme.treffer =
{mindest: 44}`, in `Card.tsx` ein `hitSlop` aus `(44 − 34)/2`, dasselbe
für die drei anderen; die Verlaufs-Chips zu `Pressable` mit Rolle; in
`probe.mjs` eine Messung «keine Trefffläche unter 44 Punkten» über alle
`[role=button|switch|tab]`, Ausnahmen benannt - dieselbe Bauart wie
`messeUeberlauf`. Nähe: 189 (Kochmodus-Blättern), 282 (Langdrücken), 440
(Modus für draussen). Stellen: `app/src/theme.tsx`,
`app/src/components/Card.tsx`, `app/src/components/entity/stil.ts`,
`app/src/components/HistoryChart.tsx`, `scripts/probe.mjs`. Aufwand:
klein · App.

### Funktionalität (614-618)

**614. Die Anlage schaltet scharf, obwohl die Haustür nicht
abgeschlossen ist.** Die Bereitschaftsprüfung beim Scharfschalten kennt
nur «offen» und «blind» (`alarm.py:389-412`); beim Schloss zählt
ausdrücklich nur der Türsensor, nicht der Riegel (`alarm_rules.py:594`,
`sensor_open`). Eine zugezogene, aber unverschlossene Nuki-Tür geht ohne
Wort durch - bei «Abwesend» ist das Haus dann geschützt wie ohne Schloss.
`goodnight.py:38` kennt `unlocked_locks()` schon, nur der Gute-Nacht-Knopf
nutzt es. Vorschlag: `arm()` prüft zusätzlich `unlocked_locks()` (nach
`alarm_rules.py` ziehen) und gibt bei Abwesend/Ferien eine dritte Antwort
`reason: "unverschlossen"` mit den Türen zurück; in der App neben
«Trotzdem scharf» ein Knopf «Abschliessen und scharf», der erst `lock`
schickt, auf `locked` wartet und dann nochmals `arm()` ruft. Beim
Nachtmodus nur ein Hinweis - nachts geht man nochmals raus. Nähe: 112
(Kontakte, nicht Riegel), 483 (anderer Zeitpunkt), 126 (Anzeige).
Stellen: `hub/homepilot/integrations/alarm.py`,
`hub/homepilot/integrations/alarm_rules.py`, `hub/homepilot/core/goodnight.py`,
`app/src/screens/AlarmScreen.tsx`. Aufwand: klein · Hub + App.

**615. Bei Feuer nachts löst die Flucht die Einbruchmeldeanlage aus.**
Brandmeldeanlage und Alarmanlage kennen einander nicht: `brand.py`
erwähnt die Alarmanlage nirgends, `alarm.py:727-790` kennt als Ausnahmen
nur Sauger und Haustier. Schlägt um drei Uhr ein Rauchmelder an, während
«Nacht» scharf ist, weckt die Brandanlage alle mit Durchsage und Licht
(`brandmelder.py:44`) - und die erste Person im Flur löst über den
Bewegungsmelder den Einbruchalarm samt Sirene und Eskalation aus
(`alarm.py:951`). Mit `unlock_doors: true` öffnet die Brandanlage sogar
Türen, deren Türsensor Alarmsensor ist. Vorschlag: ein Brand-Alarm setzt
die Alarmanlage in einen Zustand «Brand» (analog `VERDACHT`): keine
Auslösung, laufende Eskalation abbrechen, Sirene aus, Verlaufseintrag
«wegen Brandalarm ausgesetzt»; bei Entwarnung zurück in den vorigen
Modus ohne Bereitschaftsprüfung (wie `_rearm`). Bei «Abwesend» bleibt der
Einbruchweg offen - nur Nacht und Zuhause werden ausgesetzt. Nähe: 543
schaltet Licht, Storen, Türen; 488/489 sind andere Ausnahmen. Stellen:
`hub/homepilot/integrations/alarm.py`, `hub/homepilot/integrations/brand.py`,
`hub/homepilot/integrations/alarm_rules.py`. Aufwand: mittel · Hub.

**616. Der Hub weiss, dass die Tür aufging - nicht, wer sie aufgeschlossen
hat.** `nuki.py:170-195` liest nur `/smartlock` (Zustand, Batterie,
Türsensor). Die Nuki-Web-API führt daneben `/smartlock/{id}/log` mit
`trigger` (Keypad, Fingerprint, App, Auto-Unlock, Knopf) und `name` des
Berechtigten; nichts davon kommt an. Das Zugriffsprotokoll hält nur
App-Befehle fest, die Kachel sagt «Aufgeschlossen» ohne Wer und
Seit-wann (`entity/koerper.tsx:70`). Ein Kind mit Keypad-Code kommt heim,
und das Haus erfährt es nur über das Telefon, das es nicht hat.
Vorschlag: beim Poll das Log ab dem letzten gesehenen Eintrag holen
(rein: `log_eintraege(payload, seit)`), als `last_unlock: {by, via, at}`
in den Zustand und als Bus-Ereignis `door_unlocked` - damit «wenn Livia
per Code aufschliesst» ein Auslöser wird und der Heimgruss (259) auch
ohne Telefon spielt; die Kachel zeigt «Aufgeschlossen · Livia (Code) ·
15:42»; Kategorie `door`, je Person abschaltbar. Nähe: 199 und 194–203
gehen übers Telefon, 499 zählt App-Befehle. Stellen:
`hub/homepilot/integrations/nuki.py`, `hub/homepilot/core/pushziel.py`,
`hub/homepilot/core/automation.py`, `app/src/components/entity/koerper.tsx`.
Aufwand: mittel · Hub + App.

**617. Die Kamera erkennt das Paket, das Haus sagt es niemandem.**
Protect meldet `package` als eigene Erkennung; der Hub führt
`detected_package`/`last_package` (`unifi_protect.py:245`). Genutzt wird
das nur als möglicher Ablauf-Auslöser; eine Push gibt es nicht, der
Wächter hört nur Klingeln und Baby-Schreien, die Kamera-Push der
Alarmanlage kommt nur bei scharfer Anlage und nur bei Bewegung, die
Vorlagen bieten nur «Person erkannt» (`vorlagen.ts:1073`). Vorschlag: wie
`_pruefe_weinen` ein `_pruefe_paket`: Wechsel off → on → Push «Paket vor
der Haustür» mit Bild, Kategorie `package`, Sperrfrist 10 min je Kamera;
dazu der Alltagsteil: Merker «Paket seit 14:12 draussen», und wenn es bis
20 Uhr weder von einer Person-Erkennung abgelöst wurde noch jemand
heimgekommen ist, «Das Paket liegt noch draussen». Nähe: 329–336
(Kamerabild in der Alarm-Nachricht), 578 (Erkennung bleibt hängen),
Einmal-Türlink für den Boten. Stellen: `hub/homepilot/core/watchdog.py`,
`hub/homepilot/core/watchrules.py`, `hub/homepilot/core/pushziel.py`,
`hub/homepilot/core/notifyrules.py`. Aufwand: klein · Hub.

**618. Die Klingel-Push kommt ohne Bild, obwohl der Hub die Kamera dazu
schon anwirft.** `_melde_klingeln` (`watchdog.py:354`) schickt «Jemand
steht vor der Türe.» ohne `image`; `_notify` hat den Parameter gar nicht
(`:2797`). Drei Zeilen weiter startet `_waerme_livebild` über
`kamera.camera_for()` den Strom genau dieser Kamera. Die Alarmanlage
(`alarm.py:948`, `_snapshot_url`) und der Ablauf-Schritt hängen längst
ein Bild an. Wer unterwegs die Push liest, sieht erst nach dem Tipp und
4–8 s Vorlauf, wer da steht. Vorschlag: `_snapshot_url` aus `alarm.py`
nach `core/kamera.py` verschieben, `_notify` bekommt `image`,
`_melde_klingeln` hängt den Schnappschuss der Klingel-Kamera an - mit
derselben Frist wie beim Alarm (4 s; kommt nichts, geht die Push ohne
Bild, aber nicht später); dasselbe Bild in den Posteingang, damit «wer
hat um 14:02 geklingelt» am Abend beantwortbar ist. Nähe: 215, 506, 518,
519 - das Bild in der Klingel-Push selbst fehlt überall. Stellen:
`hub/homepilot/core/watchdog.py`, `hub/homepilot/core/kamera.py`,
`hub/homepilot/integrations/alarm.py`, `hub/homepilot/core/pushverlauf.py`.
Aufwand: klein · Hub.

### Familie (619-623)

**619. Wochenplan, Sonntagabend-Ausblick, Wandpanel und Babysitter kennen
die Kinderwoche nicht.** Die Listen `lessons`, `activities` und `gear`
werden ausser auf der Kinderseite und im Packlisten-Push nirgends
gelesen. Der Wochenplan baut seine Tage aus Terminen, Essen, Ämtli,
Aufgaben und Geburtstagen (`FamilyScreen.tsx:2575`), `week_ahead`
bekommt nur events/tasks/chores/contacts (`familie.py:378`), das
Wandpanel-«HEUTE» nur Kalendertermine (`:4005`), und die Babysitter-Seite
weiss nicht, dass Levin um 17:30 Fussball hat (`:1991`). Wer im
Wochenplan «Levin» filtert, sieht weder Fussball noch «Nachmittag frei».
Vorschlag: `wochenliste()`/`heute()` aus `lib/kindseite.ts` in den
Wochenplan einziehen - je Tag die Wöchentlichen jedes Kindes und der
Schulschluss als Zeile «Levin: Schule bis 15:05 · Fussball 17:30»; im Hub
`week_ahead` um `activities` erweitern (nur mit Ort/Zeit, höchstens vier
Zeilen); auf Wandpanel und Babysitter-Seite je Kind den `heuteSatz`.
Nähe: 204, 171, 214 kennen nur Kalender, Ämtli, Routinen. Stellen:
`app/src/screens/FamilyScreen.tsx`, `hub/homepilot/core/familie.py`,
`hub/homepilot/core/watchdog.py`, `app/src/lib/kindseite.ts`. Aufwand:
mittel · Hub + App.

**620. Stundenplan, Packliste und «Heute»-Satz wissen nichts von den
Schulferien.** Der Hub kennt die Luzerner Schulferien
(`core/schulferien.py`, `schulferien.lage()`), und die Kinderseite zeigt
sie. `_check_packliste` (`watchdog.py:1618`) fragt ihn aber nicht:
`packliste.morgen_zeilen` (`packliste.py:38`) rechnet nur Wochentag und
A/B-Woche, also kommt in den Herbstferien und am Auffahrtsabend um 19 Uhr
«Levin braucht morgen: Turnsack». `heuteSatz` (`kindseite.ts:298`) sagt
«Schule 08:20–15:05», und darunter steht «Gerade sind Herbstferien -
keine Schule!» - zwei Sätze, die sich widersprechen. Auch der
Sonntagabend-Ausblick sagt nicht «Montag beginnen die Ferien».
Vorschlag: `morgen_zeilen` bekommt den Ferienstand und lässt Schulsachen
weg; je `gear`/`activities`-Eintrag ein Schalter «auch in den Ferien»
(Fussballtraining läuft oft weiter, Flöte nicht); in der App `heuteSatz`
mit `ferien`-Zustand aufrufen, Wöchentliche ohne den Schalter ausgegraut
«(Ferienpause)»; `week_ahead` mit einer Zeile am Ferienrand. Nähe: 470
(Abläufe), 154 (Feiertag), 453 (Gutscheine). Stellen:
`hub/homepilot/core/packliste.py`, `hub/homepilot/core/watchdog.py`,
`hub/homepilot/core/familie.py`, `app/src/lib/kindseite.ts`. Aufwand:
klein · Hub + App.

**621. Ein Termin des Kindes weiss nicht, wer fährt.** Ein Wöchentliches
trägt Tag, von/bis und einen Ort (`kindseite.tsx:242`), aber keine
Person, die bringt oder holt - die tägliche Familienfrage «wer fährt
Levin nach Sursee?» hat keinen Platz. Der Losfahr-Wecker
(`core/losfahren.py`) liest nur Kalendertermine, obwohl die Aktivitäten
den Ort schon haben. Vorschlag: Chips «bringt»/«holt» (Mitglieder) am
Aktivitäten-Formular; Kinderseite und Wochenplan zeigen «Fussball 17:30 ·
Stefan fährt»; unbesetzte Fahrten stehen im Sonntagabend-Ausblick («Do
Jugi: niemand fährt»); `losfahren.kandidaten` nimmt die heutigen
Aktivitäten mit Ort dazu und schickt «Zeit loszufahren» an die
eingetragene Person, nicht an alle. Nähe: 258 (Losfahr-Wecker nur
Google-Kalender), 158. Stellen: `app/src/screens/family/kindseite.tsx`,
`app/src/lib/kindseite.ts`, `hub/homepilot/core/losfahren.py`,
`hub/homepilot/core/watchdog.py`. Aufwand: mittel · Hub + App.

**622. Ein krankes Kind kennt der Hub nicht.** Es gibt keinen Zustand
«krank». Ist Levin mit Fieber im Bett, sagt der «Heute»-Satz «Schule
08:20–15:05», um 19 Uhr kommt «Levin braucht morgen: Turnsack», sein
Ämtli wird rot überfällig und steht am Wandpanel unter «ÄMTLI HEUTE»
(`FamilyScreen.tsx:4025`), und die Nummer der Schule für die
Absenzmeldung sucht man in den Kontakten - obwohl die Rolle «Schule/Hort»
existiert (`familie.ts:19`). Vorschlag: ein Knopf «Heute krank» auf der
Kinderseite (Feld `sick_until` am Mitglied). Solange er gilt: Kontakte
mit Rolle Schule/Hort ganz oben mit Anruf-Knopf «abmelden», kein
Schul-Satz, kein Packlisten-Push und kein Losfahr-Wecker für dieses Kind,
fällige Ämtli mit `rotate()` (`chores.py:94`) an den Nächsten
weitergegeben, und im Medikamente-Modul «Kur anlegen» mit dem Kind
vorbelegt. Um Mitternacht des Enddatums ist alles wieder normal. Nähe:
245/497 (Rechte), 214 (Abendroutine), 489 (Wartungsmodus - Alarm).
Stellen: `app/src/screens/family/kindseite.tsx`, `app/src/lib/kindseite.ts`,
`hub/homepilot/core/watchdog.py`, `hub/homepilot/core/packliste.py`.
Aufwand: mittel · Hub + App.

**623. Der Dokumentsafe kennt kein Ablaufdatum.** Ein Dokument ist Titel
plus Freitext (`family/module.tsx:755`); kein `expires`, keine Person,
keine Erinnerung. Kinderpässe gelten fünf Jahre, ID, Halbtax, Vignette
und Impfungen laufen ab - Gutscheine bekommen zwei Stufen Vorwarnung,
Filter eine Wartungsfrist, Dokumente nichts. Vorschlag: optionales Datum
«gültig bis» und Person je Dokument; der Wächter meldet 60 und 14 Tage
vorher (Kategorie `documents`, Ziel `familie:documents`, abbestellbar), die
Kachel zeigt «1 läuft bald ab», die Kinderseite «Pass gültig bis
03.2027»; Erneuert setzt das Datum neu und hält den Verlauf (Bauart
`maintenance.quittieren`). Nähe: 264/455/457 (nur Gutscheine), Wartung
(nur Geräte). Stellen: `app/src/screens/family/module.tsx`, neu
`hub/homepilot/core/dokumente.py` (rein, testbar),
`hub/homepilot/core/watchdog.py`, `hub/homepilot/core/pushziel.py`.
Aufwand: klein · Hub + App.

### Profil und Benutzer (624-628)

**624. Ausserhalb des Zeitfensters heisst es «Ungültiges Token».** Das
Zeitfenster `hours` ist «für Kinder gedacht: Licht im eigenen Zimmer ja,
um Mitternacht nicht» (`users.py:346`). Läuft es ab, liefert
`user_for_token` `None` (`server.py:213`), HTTP antwortet 401 «Ungültiges
Token», der WebSocket schliesst mit 4401 - und die App unterscheidet das
nicht von einem widerrufenen Token: Wiederverbindungsschleife, «nicht
verbunden». Das Kind um 20:01 sieht ein kaputtes Haus, nicht
«Feierabend». Vorschlag: `active()` um einen Grund erweitern
(`zugangsgrund()` - rein: `gesperrt`, `abgelaufen`, `fenster_zu bis
07:00`); für Fenster-zu antwortet der Hub 403 mit «Dein Zugang gilt ab
07:00 wieder» und Feld `gilt_ab`, der WebSocket mit 4403; die App zeigt
ein ruhiges Blatt («Gute Nacht - ab 07:00 geht's weiter») und verbindet
erst zum genannten Zeitpunkt neu. Gehört zu 579 (derselbe `onclose`, ein
weiterer Code). Nähe: 245/244 bauten Fenster und Kontoblatt, keiner sagt,
was die App *ausserhalb* zeigt. Stellen: `hub/homepilot/core/users.py`,
`hub/homepilot/api/server.py`, `app/src/hooks/useHub.ts`. Aufwand:
mittel · Hub + App.

**625. Der Verwalter sieht die Geräte der anderen nicht.** `GET/DELETE
/api/auth/sessions` gelten nur für den eigenen Namen (`routes/auth.py:403`);
`SessionStore.list_for` und `revoke_user` sind aber allgemein
(`sessions.py:174`). In der Benutzerverwaltung gibt es «Token erneuern»
(`UsersScreen.tsx:1358`), aber keine Geräteliste. Verliert Levin sein
Telefon, kann die Besitzerin nur den ganzen Benutzer sperren oder alle
seine Geräte abschiessen - und «hat sich das iPad des Babysitters je
abgemeldet?» beantwortet niemand. Vorschlag: `GET /api/users/{name}/
sessions` und `DELETE …/{sid}` hinter `MANAGE_USERS`; im Benutzer-Detail
eine Klappe «Angemeldete Geräte» («2 Geräte · zuletzt vor 3 Std.»), je
Zeile «Beenden» mit Rückfrage; `lib/konto.ts` (`geraeteZeile`,
`sortiereSitzungen`) wiederverwenden. Nähe: 244 ist ausdrücklich
Selbstverwaltung, 498 räumt Gäste. Stellen:
`hub/homepilot/api/routes/users.py`, `hub/homepilot/core/sessions.py`,
`app/src/screens/UsersScreen.tsx`, `app/src/lib/konto.ts`. Aufwand:
klein · Hub + App.

**626. Eine neue Anmeldung erfährt nur das Log.** Jede
Passwort-Anmeldung endet in `log.warning(…)` (`routes/auth.py:185, 271`),
abgelehnte Versuche ebenso; eine Sitzung merkt sich Label und Zeit, aber
keine Adresse (`sessions.py:110`); `pushziel.py` kennt keine Kategorie
dafür. Wer sich mit Stefans Passwort auf einem fremden Gerät anmeldet,
wird von niemandem bemerkt - und der Besitzer sieht nicht, dass der
Babysitter-Zugang gerade von einem dritten Gerät kommt. Vorschlag: nach
`sessions.create` eine Push an die Person selbst: «Neues Gerät angemeldet:
iPhone von Anna - warst du das?» mit Knopf «Nicht ich → Gerät abmelden»
(Knopf-Mechanik aus 478); bei Gast- und Kinderkonten zusätzlich an die
Besitzer; wird eine Adresse von der Bremse gesperrt, eine einzige Push «5
falsche Passwörter von 192.168.1.44»; Adresse in die Sitzungszeile;
Kategorie `login` → Ziel `bereich:personen`. Nähe: 499 (offen) will eine
Monatszeile aus dem Zugriffsprotokoll - das zählt Befehle, keine
Anmeldungen. Stellen: `hub/homepilot/api/routes/auth.py`,
`hub/homepilot/core/sessions.py`, `hub/homepilot/core/pushziel.py`,
`app/src/components/KontoBlatt.tsx`. Aufwand: mittel · Hub + App.

**627. Die Ortungspause kennt nur das eigene Telefon.** «Pausieren ist
Pausieren» steht im Hook, aber `pausiertBis` liegt nur im AsyncStorage
des Geräts (`useOrtung.ts:69, 148`); im Hub gibt es keinen Pausenbegriff.
Folge: Nach zwölf Stunden Stille schickt der Wächter «Meldet sich nicht
mehr - Akku, Flugmodus oder Ortung aus?» an die ganze Familie
(`watchdog.py:1536`, Schalter `silence` standardmässig an), die
Familienseite zeigt «meldet sich nicht», und das zweite eigene Gerät
weiss von der Pause nichts. Vorschlag: `POST /api/presence/{zone}/pause
{bis}` (nur die eigene Zone), Ablage `presence_pause` in `hub.data`;
`merged()` liefert `state: unknown, reason: paused, until`, der Wächter
überspringt Funkstille- und Akku-Meldung für pausierte Zonen,
`personen.aufenthalt` sagt «Ortung pausiert bis 06:00», die Profilzeile
aus 197 liest den Stand vom Hub. Nähe: 197 baute den Schalter nur in der
App; 202/219/220 schlagen bei einer Pause falsch an. Stellen:
`hub/homepilot/integrations/geofence.py`, `hub/homepilot/core/presence.py`,
`hub/homepilot/core/watchdog.py`, `app/src/hooks/useOrtung.ts`. Aufwand:
mittel · Hub + App.

**628. Wer den Haushalt verlässt, hinterlässt alles.** `DELETE
/api/users/{name}` ruft nur `hub.users.remove` und schreibt einen
Änderungseintrag (`routes/users.py:426`). Was nach Namen abgelegt ist,
bleibt: `umzug.py:35-49` zählt es selbst auf (`sessions`, `push_devices`,
`push_prefs`, `user_prefs`, `emails`, `person_prefs`, `presence_last`,
`presence_history`), dazu Personenbild und Ämtli-Reihen. Der
Gastspur-Aufräumer (498) nimmt nur abgelaufene Gäste. Zieht die Au-pair
aus, steht sie im Ämtli-Plan weiter «dran» (`chores.py:94 rotate`).
Vorschlag: `core/abschied.py` (rein): aus dem Datenbestand berechnen, was
ein Name berührt, die Listen aus `umzug.py` wiederverwenden; die
Löschroute bekommt `?aemtli_an=<Name>`; die App zeigt vor dem Löschen
«Anna entfernen? 2 Geräte, Bild, 3 Ämtli, 1 Erinnerung» und lässt die
Ämtli übergeben; «Zugang nur einfrieren» als sichtbarer Gegenpol. Nähe:
498 (Gäste), 495 (Gerätenamen), `umzug.py` (Umbenennen per CLI).
Stellen: `hub/homepilot/api/routes/users.py`, `hub/homepilot/core/umzug.py`,
`hub/homepilot/core/personenbilder.py`, `app/src/screens/UsersScreen.tsx`.
Aufwand: mittel · Hub + App.

### Geräte (629-633)

**629. Der Taster weiss, was er auslöst, und die Kachel sagt es nicht.**
Die Tasterkachel zeigt nur «Kurz gedrückt · vor 3 Std.»
(`EntityCard.tsx:1141`). Welcher Druck was tut, steht in den Abläufen als
`trigger.to` (`single`, `double`, `hold` - Wortschatz in
`entwurf.ts:323`), und die Geräteseite zählt sie nur: «in 2 Abläufen»
(`lib/verweise.ts:58`). Wer vor dem Wandtaster im Flur steht, muss die
Abläufe aufmachen, um zu wissen, ob «doppelt» überhaupt belegt ist.
Vorschlag: `verweise.ts` um `tasterBelegung(entityId, automations)`
erweitern (rein, testbar): je Ablauf die Auslöser dieses Tasters lesen,
`to` ins deutsche Wort übersetzen, dazu den Ablaufnamen; die Kachel zeigt
darunter «einmal → Flur an · halten → Alles aus», eine unbelegte Taste
bleibt weg, Tipp öffnet den Ablauf; dieselbe Zeile im Langdruck-Menü.
Nähe: 104 (nur Zählung), 314 (Drücke im Editor), 575. Stellen:
`app/src/lib/verweise.ts`, `app/src/components/EntityCard.tsx`,
`app/src/screens/automations/entwurf.ts`. Aufwand: klein · App.

**630. Das Einschaltverhalten nach Stromausfall stellt man am Gerät ein -
der Hub kennt den Schalter nicht.** `stromrueckkehr.py:9` sagt selbst:
«Wer den Blitz loswerden will, stellt es am Gerät ein (Hue: Verhalten
bei Stromrückkehr, Homematic: Einschaltwert)». Genau das kann der Hub
nicht: Zigbee2MQTT exponiert `power_on_behavior` (`schreibbare_merkmale`
in `zigbee2mqtt.py:180` sammelt es, `art_und_befehle:260` wirft es weg),
Hue v2 führt `powerup` an jeder Leuchte (`hue.py:219` liest nur
`on`/`dimming`), Homematic hat `POWERUP_…`-Parameter je Kanal.
Vorschlag: ein Befehl `set_power_on` (`previous`, `off`, `on`) in Zigbee,
Hue und Homematic, im Zustand als `power_on`; in der App eine Zeile im
Anpassen-Blatt («Nach Stromausfall: wie vorher / aus / an») und unter
System → Stromausfall ein Knopf «Alle Lampen auf ‹wie vorher› stellen»
mit der Liste derer, die es nicht können. Nähe: 501 und der Auslöser
«Nach Stromausfall» räumen *nachher* auf; das hier verhindert den Blitz
*vorher*. Stellen: `hub/homepilot/integrations/zigbee2mqtt.py`,
`hub/homepilot/integrations/hue.py`, `hub/homepilot/integrations/homematic.py`,
`app/src/components/entity/anpassen.tsx`. Aufwand: mittel · Hub + App.

**631. Empfindlichkeit, Nachlaufzeit und Temperatur-Abgleich eines
Zigbee-Geräts gibt es nur in Zigbee2MQTT.** `schreibbare_merkmale`
(`zigbee2mqtt.py:180`) kennt alle stellbaren Eigenschaften eines Geräts -
`occupancy_timeout`, `motion_sensitivity`, `temperature_calibration`,
`humidity_calibration`, `led_indication`; `art_und_befehle:260` macht
daraus nur Schaltbefehle und Sirene, `set_nutzlast:505` kennt keinen Weg
für Optionen. Wer den Melder im Flur unempfindlicher will oder den
Aqara-Fühler 0.8 Grad nach unten abgleichen, braucht die Z2M-Oberfläche
auf Port 8099 (`docs/zigbee.md:69`). Vorschlag: je Gerät eine kleine
Liste `options` im Zustand (Name, Typ, Bereich, Wert - aus den Exposes,
gefiltert auf eine Allowlist gängiger Namen mit deutscher Beschriftung)
und `set_option {name, value}` als Befehl; in der App ein Abschnitt
«Gerät einstellen» im Anpassen-Blatt: Schieber, Schalter, Chips. Der
Temperatur-Abgleich ist die wichtigste Zeile: Der Raumkopf (538) zeigt
sonst den Fehler des Fühlers als Zimmertemperatur. Nähe: 547 (Nachlauf
der Lampe), 548 (Einheit), 544 (Sirene - die erste Stellgrösse, aber nur
die eine). Stellen: `hub/homepilot/integrations/zigbee2mqtt.py`,
`hub/homepilot/api/models.py`, `app/src/components/entity/anpassen.tsx`.
Aufwand: mittel · Hub + App.

**632. Ein neues Gerät anlernen geht nur an der Zigbee2MQTT-Oberfläche
oder an der Kommandozeile.** Zigbee: «Permit join» in der Z2M-Weboberfläche
(`docs/zigbee.md:69`); der Hub sendet nie `bridge/request/permit_join`.
Matter: `pair(code)` existiert (`matter.py:860`), erreichbar nur über
`python -m homepilot.integrations.matter --pair`; keine Route ruft es.
Die `Einrichtungshilfe` setzt erst *nach* dem Anlernen an, und der
`QrScanner` ist seit 369 generisch, liest also einen Matter-Code schon
heute. Vorschlag: `POST /api/verbindungen/zigbee/anlernen {minuten}`
(publiziert `permit_join`, meldet die Restzeit, liest die
`device_interview`-Meldungen und antwortet «Aqara Türkontakt gefunden»)
und `POST /api/verbindungen/matter/koppeln {code}`; in der App unter
Einstellungen → Verbindungen je ein Abschnitt «Gerät hinzufügen» - neben
dem Fernseher-Koppeln, wo Einrichten zuhause ist; das gefundene Gerät
landet direkt in der Einrichtungshilfe. Nähe: 536 (Dongle), 54 (neu
laden), 248 (Erst-Start). Stellen:
`hub/homepilot/api/routes/verbindungen.py`,
`hub/homepilot/integrations/zigbee2mqtt.py`,
`hub/homepilot/integrations/matter.py`,
`app/src/screens/VerbindungenScreen.tsx`. Aufwand: mittel · Hub + App.

**633. Die Batteriewarnung sagt, *dass* eine leer ist, nicht *welche* man
kaufen muss.** Die Push lautet «Batterie schwach: Türkontakt Küche. Noch
12 %» (`watchdog.py:2621`). Ob da eine CR2032, CR2450, AAA oder ein Akku
drin steckt, weiss weder Hub noch App - kein Feld in `set_entity_meta`
(`hub.py:570`), nichts in `lib/batterien.ts`. Die Prognose (258) sagt
«reicht noch ~3 Wochen», der Einkauf dazu bleibt Kopfarbeit - im Haus mit
einem Dutzend Zigbee-Meldern jedes Mal dieselbe Frage. Vorschlag: ein
Meta-Feld `battery_type` (Vorschlagsliste CR2032/CR2450/CR2477/AA/AAA/
Akku), setzbar im Anpassen-Blatt und in der Geräte-Gesundheit; Push und
Zeile tragen es mit («… CR2032 wechseln»), unter der Meldung ein Knopf
«Auf die Einkaufsliste» (`mitteilungsknoepfe.ts`, dedupliziert nach 174);
die Gesundheitsliste bekommt «Für die nächsten 3 Monate: 2× CR2032, 1×
AAA» aus der Prognose. Nähe: 258, 478, 176, 174. Stellen:
`hub/homepilot/core/hub.py`, `hub/homepilot/core/watchdog.py`,
`app/src/components/DeviceHealth.tsx`, `app/src/lib/mitteilungsknoepfe.ts`.
Aufwand: klein · Hub + App.

### Nebenbei gefunden - Fehler ohne eigene Nummer

Beim Lesen aufgefallen und belegt, aber keine Vorschläge, sondern
Stellen, an denen der Code etwas anderes tut, als Archiv oder Kommentar
sagen. Wer einen davon behebt, gibt ihm die nächste freie Nummer.

- **Der Nachlese-Zettel rechnet an Punkt 471 vorbei.** `recipients()`
  berücksichtigt Abbestellen und Ruhezeit je *Gerät* (`push.py:895`); der
  Teil in `send()`, der aufschreibt, wem etwas entging, prüft nur je
  *Person* (`:958-966`). Hat nur das Telefon eine eigene Ruhezeit, steht
  die Meldung nirgends - weder unter «für dich zurückgehalten» noch in
  «die letzten Tage». Hat das iPad die Kategorie abbestellt und die
  Person eine Ruhezeit, steht «verpasst: Ruhezeit», obwohl das Telefon
  gebrummt hat. Das bricht die Zusage aus 324.
- **Der Tagesdeckel zählt Meldungen, die niemand bekam - und jede
  Probe.** `send()` ruft `self.bremse(category)` (`push.py:969`), *bevor*
  feststeht, ob ein Token übrig ist. Drei nächtliche `open`-Meldungen,
  die die Ruhezeit aller aufhält, verbrauchen drei von sechs Plätzen; wer
  die Batterie-Vorschau dreimal probiert, hat den Tag verbraucht.
  `deckel_erreicht` (lesen) vor der Empfängerwahl, `deckel_zaehlen` erst
  bei nicht leerem `messages` und nicht bei «Probe:».
- **Der Modus «der Reihe nach» geht im Editor verloren.** `MODES` kennt
  `queued` (77), der Editor bietet zwei Chips (`editor.tsx:1243`),
  `toDraft` rechnet `mode === 'restart' ? 'restart' : 'single'`
  (`entwurf.ts:2475`). Ein Ablauf aus der config.yaml, der in die App
  geholt wird (81), verliert beim ersten Speichern den Modus ohne Hinweis.
- **Ein Ende-Push für eine Live-Karte verfällt nach zehn Minuten.**
  `ApnsVersand.senden` setzt für Start, Update *und* Ende dieselbe
  `apns-expiration: jetzt + 600` (`liveaktivitaet.py:785`). Ist das
  Telefon so lange ohne Netz (Zug, Keller, Flugmodus), bleibt die
  Fernseher- oder Sauger-Karte bis zu acht Stunden liegen - der Hub hat
  200 bekommen und streicht die Zeile als beendet. Ende-Pushes brauchen
  eine lange Frist (4 h), Updates eine sehr kurze (60 s).
- **Der Zustandspunkt ignoriert «Bewegung reduzieren».** Archiv 527
  behauptet, wer es eingestellt hat, bekomme den Sprung;
  `useBewegungReduziert` wird nur von `Auftritt.tsx` importiert,
  `Zustandspunkt.tsx` animiert immer. `Lauftext.tsx:73` fragt dagegen
  selbst `AccessibilityInfo` ab - zwei Stellen, zwei Wege.
- **Ein abgelehnter Datensatz blockiert den Supabase-Verlauf für
  immer.** `Store.flush()` schreibt drei Tabellen in einem Zug; jede
  Ausnahme reiht *alles* wieder ein und versucht es alle 5 s
  (`store.py:150-172`). Ein dauerhaft abgelehnter Rumpf (400 nach einer
  Spaltenänderung) wird unendlich wiederholt, `_pending_runs` ist im
  Gegensatz zum Verlauf nicht gedeckelt, und 720 gleiche Warnungen pro
  Stunde füllen den Log-Ring von 300 Zeilen.
- **Geprüft wird Python 3.11, gebaut wird 3.12.** `pruefung.yml:31, 123`
  und `pyproject.toml:107` sagen 3.11, `hub/Dockerfile:6` sagt
  `python:3.12-slim`. Die 620 Tests haben den Interpreter, der im Haus
  läuft, nie gesehen; ein Abgleich-Test nach dem Muster von
  `test_extras_abbild.py` würde die Drift im Prüflauf fangen.
- **«Türklingel (nur sehen)» fehlt in der Benutzerverwaltung.** Der Hub
  kennt `klingel` (`users.py:165`), `FEATURE_LABELS` in
  `UsersScreen.tsx:78` nicht - nur der Babysitter-Weg setzt es, und ein so
  angelegter Gast zeigt in der Liste das rohe Wort.
- **`/api/glance?ids=` hat keinen Abnehmer.** Der Hub liefert je
  Widget-Knopf `on`/`text` (`dashboard.py:72, 114`), `index.swift` fragt
  nie mit `ids` - die Hub-Hälfte ist verwaist, seit die Karten-Widget-Art
  gestrichen wurde; die Knöpfe könnten das Symbol einfärben, wenn das
  Licht brennt.
- **`next_run` und das Tagesband kennen nur `time` und `sun`**
  (`automation.py:2491, 2527`): Zeitraum- und Kalender-Auslöser fehlen bei
  «Nächste Ausführung» und im Tagesband (163). Und `RUN_LIMIT = 100` gilt
  fürs ganze Haus (`:377`), nicht je Ablauf - ein Bewegungslicht im Flur
  verdrängt die Gute-Nacht-Spur in einer Nacht.
