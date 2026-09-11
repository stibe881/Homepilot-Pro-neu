# Die Werkbank

Was offen ist. Nichts sonst.

Erledigtes steht nebenan in `werkbank-archiv.md`, mit der Begründung,
aus der es entstand - dort wird nichts gelöscht, und dort schlägt nach,
wer im Code auf «Punkt NNN der Werkbank» stösst und die Vorgeschichte
sucht.

**Die Nummern bleiben, wo sie sind.** Nie umnummerieren, auch nicht bei
Erledigtem oder Gestrichenem: Ein späterer «Punkt 273» zeigte sonst auf
etwas anderes als gemeint. Neues bekommt die nächste freie Nummer -
zurzeit **544**. Ist ein Punkt gebaut, wandert er samt Begründung ins
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
