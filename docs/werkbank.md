# Die Werkbank

Was offen ist. Nichts sonst.

Erledigtes steht nebenan in `werkbank-archiv.md`, mit der Begründung,
aus der es entstand - dort wird nichts gelöscht, und dort schlägt nach,
wer im Code auf «Punkt NNN der Werkbank» stösst und die Vorgeschichte
sucht.

**Die Nummern bleiben, wo sie sind.** Nie umnummerieren, auch nicht bei
Erledigtem oder Gestrichenem: Ein späterer «Punkt 273» zeigte sonst auf
etwas anderes als gemeint. Neues bekommt die nächste freie Nummer -
zurzeit **740**. Ist ein Punkt gebaut, wandert er samt Begründung ins
Archiv; er wird nicht hier abgehakt. Dass jede Nummer genau einmal
vorkommt, prüft `scripts/werkbank.py` (und mit ihr der Prüflauf).

## Was offen ist

| Bereich | Offen | Punkte |
| --- | --- | --- |
| App allgemein | 15 | 422, 424, 425, 427, 428, 429, 659, 660, 661, 662, 663, 664, 665, 666, 667 |
| Bedienung | 10 | 431, 432, 433, 434, 435, 436, 437, 438, 439, 440 |
| User Experience | 8 | 668, 669, 671, 672, 673, 675, 676, 677 |
| Gestaltung | 14 | 441, 446, 447, 449, 450, 678, 679, 680, 681, 682, 683, 684, 685, 686 |
| Gutscheine | 12 | 453, 458, 687, 688, 689, 690, 691, 692, 693, 694, 695, 696 |
| Abläufe | 12 | 468, 469, 697, 698, 699, 700, 701, 702, 703, 704, 705, 706 |
| Push-Benachrichtigungen | 13 | 473, 474, 476, 707, 708, 709, 710, 711, 712, 713, 714, 715, 716 |
| Alarmanlage | 10 | 483, 717, 718, 719, 720, 721, 722, 723, 724, 725 |
| Selbst gewählt | 22 | 492, 493, 494, 496, 499, 500, 501, 502, 726, 727, 728, 729, 730, 731, 732, 733, 734, 735, 736, 737, 738, 739 |
| Aus früheren Runden | 4 | 223, 237, 268, 353 |
| Nützlich im Alltag | 1 | 588 |
| App und Hub | 1 | 589 |
| Funktionalität | 1 | 618 |

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
Funktionalität, Familie, Profil und Geräte, aus dem Code gelesen und
gegen alle 578 früheren Punkte geprüft. Zweiundfünfzig davon sind in
derselben Sitzung gebaut worden und stehen im Archiv (Teil XIII), samt
den zehn nebenbei gefundenen Fehlern. Was hier steht, ist der Rest.

### Nützlich im Alltag (584-588)

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

### Funktionalität (614-618)

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
## Einundachtzig Vorschläge (659–739)

Auf Zuruf erstellt, September 2026: zehn je Bereich für App allgemein,
User Experience, Gestaltung, Gutscheine, Abläufe, Push-Benachrichtigungen
und Alarmanlage, dazu fünfzehn selbst gewählte - dieselbe Form wie schon
die Runde 421-505.

Vier der ursprünglich fünfundachtzig Vorschläge sind beim Gegenprüfen
schon gebaut aufgetaucht und stehen deshalb **nicht** als eigene Nummer
hier: die «Was ist neu»-Anzeige nach einem Update (`components/WhatsNew.tsx`,
`lib/wiederkehr.ts`), das Berücksichtigen von «Bewegung reduzieren»
(`hooks/useBewegungReduziert.ts`, Runde 579), die gestaffelte Eskalation
der Alarmanlage (Punkt 255, `integrations/alarm.py`) und die
Wartungserinnerungen für Filter und Batterien (`core/maintenance.py`).
Ein fünfter Fall - interaktive Antwortknöpfe in der Push - ist zur
Hälfte gebaut (`lib/mitteilungsknoepfe.ts`) und steht darum unten bei
Punkt 707 mit der Einschränkung, gegen die er sonst liefe.

### App allgemein (659-667)

**659. Geführtes Onboarding für ein neues Familienmitglied statt leerer
Startseite.** Die Einführung (`lib/einfuehrung.ts`) erklärt beim ersten
Öffnen die Leiste und was das Haus von selbst tut - dieselben Schritte
für jeden, der die App zum ersten Mal sieht. Was fehlt, ist der Schritt
davor: Rolle wählen, Favoriten aus den vorhandenen Räumen/Geräten
zusammenstellen, Benachrichtigungskategorien einmal bewusst setzen -
statt mit den Voreinstellungen eines fremden Haushalts zu starten. Die
Einladung (`core/einladung.py`, `lib/einladung.ts`) kennt die Person
bereits, bevor sie sich zum ersten Mal anmeldet; der Assistent knüpft
dort an. Stellen: `hub/homepilot/core/einladung.py`,
`app/src/lib/einladung.ts`, `app/src/lib/einfuehrung.ts`,
`app/src/components/Einfuehrung.tsx`, `app/src/lib/favoriten.ts`.
Aufwand: mittel · App+Hub.

**660. Sichtbarer «Datenstand»-Hinweis, wenn nur noch der lokale
Zwischenspeicher zu sehen ist.** Punkt 439 verlangt bereits, dass eine
Fehlermeldung sagt, wann der nächste Versuch kommt - das deckt den
Moment ab, in dem gar nichts mehr zu sehen ist. Der hier gemeinte Fall
ist der davor: Die App zeigt weiterhin Zimmer und Zustände, aber aus dem
letzten bekannten Stand (`lib/familiecache.ts`, die Warteschlange), und
das sieht identisch aus wie eine Verbindung, die steht. «Stand vor 4
Minuten» statt einer Karte, die vorgibt, live zu sein, verhindert die
falsche Sicherheit, mit der man sonst eine Store hochfährt, die längst
wieder zugefahren ist. Nähe: 439. Stellen: `app/src/lib/familiecache.ts`,
`app/src/hooks/useHub.ts`, `app/src/components/TopStrip.tsx`. Aufwand:
klein · App.

**661. Ein-Klick-Export der eigenen Daten (Gutscheine, Familienlisten,
Verlauf) als ZIP.** `core/familienbuch.py` macht aus dem Datenbestand
bereits eine druckbare HTML-Seite - für den Fall, dass der Hub einmal
nicht mehr läuft. Was fehlt, ist der Weg für den einzelnen Nutzer, der
einfach seine eigenen Daten mitnehmen will (Gutscheine, Ämtli-Verlauf,
Rezepte, eigene Ereignisse), ohne den ganzen Haushalt zu exportieren
oder eine Sicherung einzuspielen. Ein Knopf unter Einstellungen, der
serverseitig zusammenstellt, was zur angemeldeten Person gehört, und als
ZIP anbietet. Nähe: `core/familienbuch.py`, `core/snapshots.py`. Stellen:
`hub/homepilot/core/familienbuch.py`,
`hub/homepilot/api/routes/users.py`, `app/src/screens/SettingsScreen.tsx`.
Aufwand: mittel · Hub+App.

**662. Sitzungsübersicht: welche Telefone/Wandpanels sind angemeldet,
zuletzt aktiv wann, Fernabmeldung möglich.** `core/sessions.py` führt
seit der Anmeldung mit E-Mail/Passwort ein Token je Sitzung - das trägt
heute nur die Anmeldeprüfung, es gibt keine Seite, die diese Liste
zeigt. Das Zugriffsprotokoll (`AccessLog.tsx`, `core/audit.py`)
beantwortet «wer hat geschaltet», nicht «welche Geräte sind gerade
angemeldet» - ein verlorenes altes Wandpanel oder ein ausgemustertes
Telefon bleibt sonst unbemerkt mit gültigem Token. Stellen:
`hub/homepilot/core/sessions.py`, `hub/homepilot/api/routes/auth.py`,
`app/src/screens/UsersScreen.tsx`, `app/src/components/AccessLog.tsx`.
Aufwand: mittel · Hub+App.

**663. Regelmässiger Erreichbarkeitstest des Hubs von ausserhalb
(VPN/Portfreigabe), mit Warnung bei Änderung.** `core/portalport.py`
löst ein verwandtes, aber anderes Problem (den Gäste-WLAN-Portal-Umweg
über Port 80); eine eigene Prüfung, ob der Hub von einem Punkt
ausserhalb des Haus-WLANs überhaupt erreichbar ist, gibt es nicht. Ein
Router-Update, das die Portfreigabe stillschweigend zurücksetzt, oder
ein abgelaufenes VPN-Zertifikat fällt heute erst auf, wenn jemand
unterwegs die App öffnet und «Hub nicht erreichbar» sieht. Ein
periodischer Selbsttest mit Push bei Statusänderung schliesst die
Lücke. Stellen: `hub/homepilot/core/watchdog.py`,
`hub/homepilot/core/verbindungen.py`, `app/src/screens/SystemScreen.tsx`.
Aufwand: mittel · Hub.

**664. Siri-Kurzbefehle/App Intents für die zehn häufigsten Aktionen.**
Die Handgriffe stehen bereits an einer Stelle beisammen:
`lib/schnellaktionen.ts` liefert dieselbe Liste fürs Homescreen-Symbol
wie fürs Widget. App Intents/Siri brauchen eine eigene native Anbindung
(kein Expo-Modul von der Stange) - dieselbe Sorgfalt wie beim letzten
nativen Modul gilt hier doppelt: `runtimeVersion` steigt im selben
Commit, ein TestFlight-Build folgt unmittelbar, sonst bekommt niemand im
Haus die Kurzbefehle, obwohl die OTA-Fassung sie schon anbietet.
Stellen: `app/src/lib/schnellaktionen.ts`, `app/targets/widget/`,
`app/app.json`. Aufwand: gross · App (nativ).

**665. Sandbox-Testmodus für neue Mitglieder (z. B. Babysitter), der
Aktionen simuliert statt echte Geräte zu schalten.** Der
Babysitter-Modus (`core/babysitter.py`) pausiert Abläufe, damit «Alles
aus» nicht mitten in den Schlaf der Kinder fährt - er verhindert nicht,
dass ein Tipp auf einen Schalter ihn wirklich schaltet. Ein
Sandbox-Modus, der Befehle entgegennimmt, im Log als «simuliert»
markiert und die Kachel entsprechend zurückmeldet, ohne den Befehl an
die Integration weiterzureichen, wäre die Ergänzung für die erste halbe
Stunde, in der jemand die App überhaupt erst kennenlernt. Nähe:
`core/babysitter.py`. Stellen: `hub/homepilot/core/babysitter.py`,
`hub/homepilot/api/server.py`. Aufwand: mittel · Hub.

**666. Familien-weite Nutzungsstatistik (Pushes/Tag, Abläufe/Tag) als
Ergänzung zur bestehenden Bildschirm-Nutzung.** `useKachelnutzung`/
`useRaumnutzung` zählen, was am eigenen Gerät oft bedient wird - für die
Sortierung, verblassend, nie geteilt. Eine zweite, hub-seitige Zählung
(wie viele Push-Nachrichten und Ablaufläufe pro Tag insgesamt anfallen)
beantwortet eine andere Frage: nicht «was benutze ich», sondern «wird
das Haus lauter». `core/metrics.py` zählt bereits Systemwerte im
Arbeitsspeicher - um zwei Zähler erweitert, genügt dieselbe schlichte
Idee. Nähe: `app/src/hooks/useKachelnutzung.ts`,
`app/src/hooks/useRaumnutzung.ts`. Stellen: `hub/homepilot/core/metrics.py`,
`app/src/screens/HausRueckblick.tsx`. Aufwand: klein · Hub.

**667. Automatischer wöchentlicher Gesundheitscheck-Bericht des Hubs
(Speicher, offene Verbindungen, Log-Fehler).** `core/metrics.py` hält
die Zahlen (Speicher, Prozessorlast) bereits vor, gelesen wird nur auf
Zuruf über die System-Seite. Ein Bericht, der einmal wöchentlich
automatisch zusammengefasst wird - Speicherverlauf, wie oft welche
Integration neu verbunden hat (Punkt 494 nennt dieselbe Lücke für die
einzelne Anbindung), Anzahl Log-Fehler seit letzter Woche - und als Push
oder im Rückblick landet, macht aus «bei Bedarf nachschauen» ein
Gewohntes. Nähe: 494. Stellen: `hub/homepilot/core/metrics.py`,
`hub/homepilot/core/watchdog.py`, `hub/homepilot/core/logbuffer.py`.
Aufwand: mittel · Hub.

### User Experience (668-677)

**668. Mehrstufiges Undo (letzte 5 Aktionen) statt nur der letzten, für
kritische Listen.** `lib/rueckgaengig.ts` bietet das Zurücknehmen einer
Schaltung, acht Sekunden lang, und Punkt 432 hält bereits fest, dass
Rückgängig nur beim Schalten existiert - ein gelöschter Kontakt oder ein
archivierter Gutschein bleibt weg. Dieser Punkt ist die Erweiterung in
die andere Richtung: nicht mehr nur die eine letzte Aktion, sondern ein
kurzer Stapel (fünf) für die Listen, bei denen ein Fehlgriff teuer ist -
Familienlisten, Abläufe, Gutscheine. Nähe: 432. Stellen:
`app/src/lib/rueckgaengig.ts`, `hub/homepilot/core/trash.py`. Aufwand:
mittel · App+Hub.

**669. Sprachsteuerung mit Rückfrage bei Mehrdeutigkeit («Bürolicht
oder Gästezimmer?») statt falscher Ausführung.** `docs/sprachbefehle.md`
beschreibt, was die Sprachbefehle können - unklar ist, was geschieht,
wenn ein Name zu mehreren Entitäten passt (zwei Räume mit «Licht»).
Heute entscheidet vermutlich die erste Übereinstimmung still; sichtbar
wird der Fehlgriff erst am falsch geschalteten Gerät. Eine Rückfrage
statt eines Ratens ist an dieser Stelle die einzige Antwort, die dem
gesprochenen Wort gerecht wird. Nähe: 500 (Sprachbefehle als Liste ohne
Prüfstand). Stellen: `docs/sprachbefehle.md`,
`hub/homepilot/api/routes/`, `app/src/lib/suchbefehl.ts`. Aufwand:
mittel · Hub.

**671. App-weiter «Fokus»-Modus (Badges/Vorschläge stumm während eines
Meetings), unabhängig von Push-Ruhezeiten.** Die Push-Ruhezeiten
(`core/pushruhe.py`) gelten je Person und Wochentag - für die geplante
Ruhe. Ein Fokus-Modus ist die spontane Variante: für die nächste Stunde,
ausgelöst von Hand oder aus dem Kalender, ohne dass jemand danach eine
Ruhezeit-Regel wieder abschalten muss. Er betrifft mehr als Push - auch
Badges und automatische Vorschläge auf der Startseite sollen in dieser
Stunde nicht aufblitzen. Nähe: `core/pushruhe.py`. Stellen:
`hub/homepilot/core/pushruhe.py`, `app/src/lib/pushruhe.ts`,
`app/src/components/TopStrip.tsx`. Aufwand: mittel · App+Hub.

**672. Kurzhilfe beim ersten Öffnen eines Moduls («Was ist das?»)
statt direkt im leeren Formular zu landen.** Die Seitenhilfe
(`lib/seitenhilfe.ts`, `components/Seitenhilfe.tsx`) gibt es bereits, je
Seite ein Blatt mit einem Fragezeichen zum Antippen - auf Abruf. Was
fehlt, ist das automatische Zeigen beim allerersten Besuch einer Seite,
bevor überhaupt eine Frage gestellt wird: Wer zum ersten Mal den
Ablauf-Editor öffnet, landet direkt im leeren Formular. Derselbe
Gesehen-Mechanismus wie bei der Einführung (`lib/einfuehrung.ts`) liesse
sich je Seite statt einmalig fürs Ganze anwenden. Stellen:
`app/src/lib/seitenhilfe.ts`, `app/src/components/Seitenhilfe.tsx`,
`app/src/lib/einfuehrung.ts`. Aufwand: klein · App.

**673. Diktierfunktion für Textfelder (Gutschein-Notiz, Ablauf-Name)
statt nur Tippen.** Sprachnotizen für ganze Erinnerungen gibt es bereits
(`lib/sprachnotiz.ts`, Punkt 223 zum Aufnahmeweg selbst). Hier gemeint
ist Kleineres und Alltäglicheres: das native Diktat-Mikrofon der
Tastatur (iOS/Android bringen das selbst mit) in den Textfeldern nicht
ungeprüft zu blockieren, plus ein eigenes Mikrofon-Symbol für Stellen,
an denen die App eigene Texteingaben zeichnet statt der
System-Tastatur. Nähe: 223. Stellen: `app/src/lib/sprachnotiz.ts`,
`app/src/screens/family/gutscheine.tsx`,
`app/src/screens/automations/editor.tsx`. Aufwand: klein · App.


**675. Wischgesten zwischen Hauptbereichen (Übersicht ↔ Familie ↔
Räume) für einhändige Bedienung am Wandpanel.** Die Leiste
(`components/Rail.tsx`) verlangt heute einen Tipp auf den jeweiligen
Reiter; am Wandpanel im Flur, oft mit einer Hand voller Einkaufstüten
bedient, wäre eine seitliche Wischgeste zwischen benachbarten
Hauptbereichen der kürzere Weg. Muss mit dem Wegwischen offener Blätter
(`lib/zurueckwischen.ts`) zusammenspielen, damit ein Wisch nicht mit
einem anderen kollidiert. Stellen: `app/src/components/Rail.tsx`,
`app/src/screens/DashboardScreen.tsx`, `app/src/lib/zurueckwischen.ts`.
Aufwand: mittel · App.

**676. Kleines Info-Symbol bei automatischen Vorschlägen (z. B.
Wäschetag-Hinweis, Laden-Vorlage), das die Regel dahinter in einem Satz
erklärt.** Vorschläge wie der Wäschetag-Hinweis (Punkt 588) oder eine
Laden-Vorlage (`lib/vorschlag.ts`, `lib/ladenlernen.ts`) erscheinen ohne
Begründung - wer nicht weiss, warum «Draussen trocknet's» gerade jetzt
auftaucht, hält es für Zufall statt für eine Rechnung aus Wetterdaten.
Ein Info-Symbol, das denselben Satz zeigt, den ein Entwickler beim Lesen
des Codes verstehen würde, macht aus der Blackbox eine nachvollziehbare
Regel. Nähe: 588. Stellen: `app/src/lib/vorschlag.ts`,
`app/src/components/SceneSuggestion.tsx`. Aufwand: klein · App.

**677. Einheitliche, testbare Bestätigungsdialog-Texte (aktuell
vermutlich pro Bildschirm unterschiedlich formuliert).** Bestätigungen
stehen heute verteilt - `TuerRueckfrage.tsx`, `Rueckfragen.tsx`
(Dashboard), einzelne Aufrufe in Screens. Eine gemeinsame reine
Funktion, die aus (Handlung, Ziel, Folge) einen Satz macht - «Gutschein
löschen? Das lässt sich nicht rückgängig machen.» statt an einer Stelle
«Wirklich löschen?» und an der nächsten «Bist du sicher?» - liesse sich
wie `lib/meldung.ts` aufbauen und testen. Stellen:
`app/src/components/TuerRueckfrage.tsx`,
`app/src/screens/dashboard/Rueckfragen.tsx`, `app/src/lib/meldung.ts`.
Aufwand: mittel · App.

### Gestaltung (678-686)

**678. Automatischer Kontrast-Check für frei wählbare Akzentfarben,
damit ein zu heller Ton auf Weiss nicht unlesbar wird.** `lib/kontrast.ts`
rechnet den WCAG-Kontrast für die feste Theme-Palette bereits nach -
heute als Entwickler-Prüfung im Testlauf, nicht als Warnung im Moment,
in dem jemand in den Einstellungen eine Farbe wählt. Sobald eine
Akzentfarbe frei wählbar wird, gehört dieselbe Rechnung an die
Auswahlstelle selbst, live statt erst im nächsten Testlauf. Nähe:
`lib/kontrast.ts`. Stellen: `app/src/lib/kontrast.ts`,
`app/src/theme.tsx`. Aufwand: klein · App.

**679. Abschaltbare, dezente saisonale Farbthemen statt eines fixen
Jahresdesigns.** Das Erscheinungsbild ist heute ein festes Theme
(`theme.tsx`) mit hell/dunkel - keine Variante, die sich mit der
Jahreszeit dezent verschiebt. Gemeint ist kein Weihnachtsmodus mit
Schneeflocken, sondern eine leise Verschiebung in Akzentton oder
Kartenrand (wärmer im Winter, kühler im Sommer), abschaltbar unter
Einstellungen. Stellen: `app/src/theme.tsx`,
`app/src/lib/einstellungsgruppen.ts`. Aufwand: mittel · App.

**680. Eigene kleine Illustrationen je Modul für Leerzustände statt
generischer Icons.** `components/Leerzustand.tsx` und `lib/leerzustand.ts`
liefern bereits einen einheitlichen leeren Zustand (Punkt 447 hält fest,
dass er noch nicht überall gleich viel wert ist) - heute mit Icon und
Text. Eine kleine, moduleigene Illustration statt des generischen
Symbols (ein leerer Gutscheinstapel statt eines Umrisses) würde den
ersten Eindruck eines neuen Nutzers gestalterisch ernst nehmen. Nähe:
447. Stellen: `app/src/components/Leerzustand.tsx`,
`app/src/lib/leerzustand.ts`. Aufwand: mittel · App.

**681. Design-Lint-Regel für Schriftgrössen ausserhalb der definierten
Skala (analog zu den padding-Werten).** Punkt 441 zählt 913 nackte
`padding`-Zahlen und schlägt eine Regel für neue Dateien vor; dieselbe
Wildwuchs-Gefahr gibt es bei Schriftgrössen. `lib/schrift.ts` und
`lib/schriftmass.test.ts` legen die Skala fest - eine ESLint-Regel, die
eine literale Zahl in `fontSize` beanstandet, hält neue Dateien von
Anfang an daran. Nähe: 441. Stellen: `app/src/theme.tsx`,
`app/src/lib/schrift.ts`. Aufwand: klein · App.

**682. Echtes Mehrspalten-Layout für Listen (Gutscheine, Rezepte) im
iPad-Querformat statt Telefon-Spalte skaliert.** `RecipeBook.tsx` und
`family/gutscheine.tsx` zeichnen vermutlich dieselbe einspaltige Liste,
nur breiter - auf einem 11-Zoll-iPad quer (1180 Punkte, das Mass aus der
Browser-Probe) bleibt der Rest der Fläche leer, statt eine zweite oder
dritte Spalte zu zeigen. Die Browser-Probe misst bereits Überlauf bei
dieser Breite; eine Prüfung auf verschenkte Breite wäre die logische
Ergänzung. Stellen: `app/src/screens/RecipeBook.tsx`,
`app/src/screens/family/gutscheine.tsx`, `scripts/probe.mjs`. Aufwand:
mittel · App.

**683. Sichtbarer «Test-Modus»-Rahmen, wenn eine Szene/ein Ablauf nur
testweise läuft.** Der Trockenlauf/Simulator (Punkt 697 dieser Runde)
und die bestehende Zeitraum-Simulation (`ablaufsimulation.py`) rechnen
nach, ohne Geräte zu schalten - liefe testweise dennoch einmal scharf
gegen echte Geräte (etwa beim Einrichten einer neuen Szene mit
`SzeneAufnehmen.tsx`), gäbe es keinen optischen Hinweis, der das von
einem echten Lauf unterscheidet. Ein auffälliger Rahmen oder Banner,
solange ein Testlauf aktiv ist, verhindert, dass jemand einen Testeffekt
für die Wirklichkeit hält. Nähe: 697. Stellen:
`app/src/components/SzeneAufnehmen.tsx`,
`app/src/screens/automations/editor.tsx`. Aufwand: klein · App.

**684. Feinere Zwischenfarbe für «bald abgelaufen» statt binär
Orange/Rot.** Die Gutschein- und Vorrat-Listen (`lib/vorrat.ts`,
`family/gutscheine.tsx`) kennen vermutlich zwei feste Zustände für die
Ablauffrist. Ein Farbverlauf statt eines Sprungs (grün → gelb → orange →
rot, gebunden an die verbleibenden Tage) liest sich auf einen Blick
genauer, ohne einen dritten Text daneben zu brauchen. Stellen:
`app/src/theme.tsx`, `app/src/lib/vorrat.ts`,
`app/src/screens/family/gutscheine.tsx`. Aufwand: klein · App.

**685. Wählbare Kachelgrössen (klein/mittel/gross) auf der Übersicht,
nicht nur Reihenfolge.** `favoritenordnung.ts` und die Drag-Mechanik
(`DraggableList.tsx`, `DragGrid.tsx`) erlauben heute, Kacheln zu
sortieren - nicht, ihre Grösse zu ändern. Eine Kachel mit besonders
wichtigem Zustand (die Wetterkarte, ein Timer) grösser zu ziehen als
eine, die nur an/aus zeigt, ist eine Erwartung, die aus vielen anderen
Homescreens (Widgets, Launcher) mitgebracht wird. Stellen:
`app/src/lib/favoritenordnung.ts`, `app/src/components/DragGrid.tsx`,
`app/src/components/EntityCard.tsx`. Aufwand: gross · App.

**686. Eigenes, kontrastreiches Erscheinungsbild speziell für den
Kassenmodus statt nur «hell und wach».** `lib/kassenlicht.ts` (Punkt
532) dreht Helligkeit hoch und hält den Bildschirm wach - das löst die
Lesbarkeit für den Scanner, nicht die für das menschliche Auge in
schlechtem Licht an der Kasse. Ein eigenes, bewusst kontrastreiches
Farbschema (grosse, schwarz-auf-weiss gesetzte Ziffern statt der
gewohnten Kartenfarben) für Kassencode und Türcode wäre die
gestalterische Ergänzung zur bereits vorhandenen technischen Lösung.
Nähe: 532, `lib/kassenlicht.ts`. Stellen: `app/src/components/Kassencode.tsx`,
`app/src/lib/kassenlicht.ts`, `app/src/theme.tsx`. Aufwand: mittel · App.

### Gutscheine (687-696)

**687. Gesamtwert-Kachel auf der Übersicht: «Noch 340 CHF in
Gutscheinen offen».** `core/gutscheine.py` summiert das Restguthaben
bereits für die Gutscheinliste selbst; eine eigene kleine Kachel auf der
Startseite, die diese Summe zeigt, fehlt - heute sieht man den Wert erst
nach dem Öffnen des Familienmoduls. Stellen:
`hub/homepilot/core/gutscheine.py`, `app/src/screens/DashboardScreen.tsx`,
`app/src/lib/favoriten.ts`. Aufwand: klein · App+Hub.

**688. Hinweis beim Einkaufsplanen, wenn ein Artikel zu einem Laden mit
offenem Gutschein passt.** Der Einkaufszettel lernt bereits Läden
(`lib/ladenlernen.ts`, `core/shopping.py`) und meldet sich im Laden
selbst (`core/gutscheinort.py`). Beim Erfassen eines Postens -
«Turnschuhe» → Ochsner Sport - wäre der frühere, planende Zeitpunkt der
bessere: ein kleiner Hinweis direkt in der Einkaufsliste, nicht erst vor
Ort. Nähe: `core/gutscheinort.py`, `core/shopping.py`. Stellen:
`hub/homepilot/core/gutscheine.py`, `hub/homepilot/core/shopping.py`,
`app/src/lib/einkauf.ts`. Aufwand: mittel · Hub+App.

**689. «Verschenken»-Export (PDF/Bild mit Betrag & Code) für Gutscheine
an Personen ausserhalb der Familie, ohne den Datensatz zu übergeben.**
Heute gibt es entweder die Karte in der App (nur für Familienmitglieder
mit Zugriff) oder nichts. Ein Export, der Betrag, Laden und Code als
eigenständiges Bild oder PDF herausgibt - ohne Zugriffsrechte auf die
App zu vergeben -, deckt den Fall «ich schenke die Hälfte des Gutscheins
weiter» ab, den es heute gar nicht sauber gibt. Stellen:
`hub/homepilot/core/gutscheine.py`,
`hub/homepilot/api/routes/family.py`,
`app/src/screens/family/gutscheine.tsx`. Aufwand: mittel · Hub+App.

**690. Jahresrückblick «ungenutzt verfallenes Guthaben» analog zum
Haus-Rückblick.** `HausRueckblick.tsx`/`lib/hausrueckblick.ts` fasst
bereits jährliche Zahlen zum Haus zusammen; eine Zeile «287 CHF sind
dieses Jahr verfallen, ohne eingelöst zu werden» aus `core/gutscheine.py`
gehört als eigene Kachel dazu - dieselbe Ehrlichkeit, mit der der
Rückblick sonst auch unschöne Zahlen zeigt. Nähe: `lib/hausrueckblick.ts`.
Stellen: `hub/homepilot/core/gutscheine.py`,
`app/src/lib/hausrueckblick.ts`, `app/src/screens/HausRueckblick.tsx`.
Aufwand: klein · Hub+App.

**691. Wiederkehrende Gutscheine als Vorlage (z. B. jährlicher
Arbeitgeber-Gutschein), die der Hub rechtzeitig als «erwartet»
markiert.** Ähnlich den Vorlagen bei Abläufen
(`screens/automations/vorlagen.ts`) fehlt für Gutscheine eine Vorlage,
die sich jährlich wiederholt: Kommt der Arbeitgeber-Gutschein im
Dezember normalerweise, meldet der Hub im Januar «noch nicht
eingetroffen» statt einfach nichts zu sagen. Stellen:
`hub/homepilot/core/gutscheine.py`,
`hub/homepilot/core/erinnerungen.py`. Aufwand: mittel · Hub.

**692. Kombination Kalender + Bestand: «Geburtstag von X in 2 Wochen –
passender Gutschein vorhanden?».** Der Kalender liegt dem Hub für
Termine bereits vor (`core/terminkontext.py`; `core/schulferien.py` für
die verwandte Feriensituation bei Punkt 453); ein Abgleich, der einen
bevorstehenden Geburtstag gegen die offenen Gutscheine hält und
rechtzeitig fragt statt zu warten, bis der Geburtstag da ist, schliesst
dieselbe Lücke, die Punkt 453 für Ferien bereits nennt. Nähe: 453.
Stellen: `hub/homepilot/core/gutscheine.py`,
`hub/homepilot/core/terminkontext.py`. Aufwand: mittel · Hub.

**693. Verknüpfung einer Kassen-Einlösung mit einem Haushaltsbudget
(falls vorhanden), statt Buchung isoliert im Modul.** Baut auf Punkt 734
dieser Runde auf (es gibt heute kein Budget-Modul): Eine Einlösung an
der Kasse bucht bislang nur den Gutscheinbestand herunter, ohne
Anschluss an eine Budgetkategorie. Nähe: 734. Stellen:
`hub/homepilot/core/gutscheine.py`. Aufwand: gross · Hub (abhängig von
Punkt 734).

**694. Liste «bald abgelaufen», sortiert nach Nähe zur aktuellen Route,
statt reiner Datumsliste.** `core/gutscheinort.py` und `core/losfahren.py`
(Punkt 458, offen) bauen bereits die Verbindung zwischen
Standort/Route und offenen Gutscheinen auf - dieselbe Grundlage liesse
sich für die Sortierung der «bald abgelaufen»-Liste selbst nutzen: nicht
nur nach Datum, sondern danach, welcher Gutschein auf dem Weg liegt, den
man ohnehin gerade fährt. Nähe: 458. Stellen:
`hub/homepilot/core/gutscheinort.py`, `hub/homepilot/core/losfahren.py`,
`app/src/screens/family/gutscheine.tsx`. Aufwand: mittel · Hub+App.

**695. Duplikaterkennung direkt beim Scannen einer Karte
(Code-Vergleich im Scan-Moment, nicht erst beim Speichern).**
`lib/gutscheinlesen.ts`/`lib/strichcode.ts` lesen den Code beim Scan; ob
derselbe Code schon einmal erfasst wurde, liesse sich in genau diesem
Moment gegen `core/gutscheine.py` prüfen und mit einer Warnung direkt im
Scan-Blatt zeigen, statt erst nach dem Ausfüllen von Betrag und Notiz
beim Speichern zu scheitern. Stellen: `app/src/lib/gutscheinlesen.ts`,
`app/src/lib/strichcode.ts`, `hub/homepilot/core/gutscheine.py`.
Aufwand: klein · App+Hub.

**696. Kategorien mit eigenem «Budget-Ziel» (z. B. «Restaurant-
Gutscheine bis Jahresende aufbrauchen») mit Fortschrittsbalken.**
Kategorien für Gutscheine gibt es bereits zur Einordnung; ein Ziel je
Kategorie mit einem Fortschrittsbalken (eingelöst vs. verfallen vs.
noch offen) macht aus der Liste ein Werkzeug, das zum Handeln auffordert,
statt nur zu verwalten. Stellen: `hub/homepilot/core/gutscheine.py`,
`app/src/screens/family/gutscheine.tsx`. Aufwand: mittel · Hub+App.

### Abläufe (697-706)

**697. Trockenlauf/Simulator: Trigger und Bedingungen testweise
durchspielen, ohne echte Geräte zu schalten.** Zwei verwandte, aber
andere Werkzeuge gibt es bereits: `core/ablaufsimulation.py` rechnet,
wie oft ein Ablauf in der Vergangenheit gefeuert *hätte* (Zeitraum,
keine Live-Interaktion), `core/ablaufpruefung.py` prüft beim Speichern
nur, ob die Bausteine bekannt sind (Punkt 378). Gemeint ist hier ein
dritter, interaktiver Fall: einen Ablauf gegen den *aktuellen* Zustand
auswerten und anzeigen, welche Aktionen jetzt ausgelöst würden - ohne
sie an die Integrationen zu senden. Nähe: `core/ablaufsimulation.py`,
`core/ablaufpruefung.py`. Stellen: `hub/homepilot/core/automation.py`,
`hub/homepilot/core/ablaufsimulation.py`. Aufwand: mittel · Hub.

**698. Versionsverlauf je Ablauf (wer hat wann was geändert), mit
Rücksprung auf ältere Fassung.** `core/editversions.py` und
`core/confighistory.py` klingen bereits nach diesem Mechanismus für
Konfiguration allgemein - ob er schon Abläufe im Speziellen mit
Rücksprungmöglichkeit abdeckt oder nur die grosse `config.yaml`, lohnt
die Prüfung vor dem Bauen. Falls nicht: ein Verlauf je Ablauf-ID mit den
geänderten Feldern und einem Knopf «diese Fassung wiederherstellen».
Nähe: `core/editversions.py`, `core/confighistory.py`. Stellen:
`hub/homepilot/core/editversions.py`,
`hub/homepilot/api/routes/automations.py`. Aufwand: mittel · Hub.

**699. Konfliktprüfung, wenn zwei aktive Abläufe dieselbe Entität
widersprüchlich ansteuern könnten.** `core/konflikte.py` existiert
bereits - vermutlich für einen verwandten, aber nicht identischen Fall
(gleichzeitige Befehle, siehe auch `core/gleichzeitig.py`). Ob er auch
die *Einrichtungszeit* eines neuen Ablaufs prüft («dieser Ablauf
schaltet dasselbe Licht wie ‹Gute Nacht›, gegenteilig, zur selben Zeit»)
oder nur zur Laufzeit greift, ist vor dem Bauen zu klären. Nähe:
`core/konflikte.py`, `core/gleichzeitig.py`. Stellen:
`hub/homepilot/core/konflikte.py`,
`hub/homepilot/api/routes/automations.py`. Aufwand: mittel · Hub.

**700. Ablauf-Vorschläge aus beobachtetem, wiederkehrendem manuellem
Verhalten (z. B. immer 22 Uhr dieselben drei Lichter aus).**
`lib/kachellernen.ts`/`lib/ladenlernen.ts` lernen bereits Reihenfolgen
aus der Hand; ein Hub-seitiges Gegenstück, das aus dem
Ereignisprotokoll (`core/eventlog.py`) wiederkehrende manuelle Muster
liest und daraus einen vorausgefüllten Ablauf-Entwurf vorschlägt («Diese
drei Lichter gehen fast immer gemeinsam um 22 Uhr aus - als Ablauf
anlegen?»), gibt es noch nicht. Stellen: `hub/homepilot/core/eventlog.py`,
`hub/homepilot/core/suggest.py`,
`app/src/screens/automations/vorlagen.ts`. Aufwand: gross · Hub.

**701. Vorab-Push bei potenziell störenden Abläufen («in 5 Min.
schaltet der Nachtmodus alles aus – abbrechen?»).** Es gibt bereits
Vorwarnungen in verwandten Fällen (Erinnerungen, Waschküche); für
Abläufe mit spürbarer Wirkung (alle Storen runter, alle Lichter aus)
fehlt eine Ankündigung kurz vor dem Lauf mit Abbruchmöglichkeit direkt
aus der Push. Setzt Punkt 707 dieser Runde (interaktive
Push-Antwortknöpfe) voraus, um wirklich nützlich zu sein. Nähe: 707.
Stellen: `hub/homepilot/core/automation.py`, `hub/homepilot/core/push.py`.
Aufwand: mittel · Hub.

**702. Gemeinsamer einfacher Variablenspeicher zwischen Abläufen, ohne
Umweg über Geräte-Entitäten.** Abläufe tauschen Zustand heute über
echte Entitäten aus (`core/platzhalter.py` deutet in diese Richtung) -
ein eigener kleiner Schlüssel-Wert-Speicher, den ein Ablauf setzt und
ein anderer liest, spart den Umweg über eine Entität, die es nur gibt,
um eine Zahl zu merken. Nähe: `core/platzhalter.py`. Stellen:
`hub/homepilot/core/automation.py`, `hub/homepilot/core/platzhalter.py`.
Aufwand: mittel · Hub.

**703. Geo-Fence-Trigger kombinierbar mit mehreren Personen UND
Kalender («alle weg UND niemand für 2h erwartet»).** `core/presence.py`,
`core/alarmanwesenheit.py` und `core/terminkontext.py` liegen alle
bereits vor - die Kombination aus «alle Personen weg» und «laut Kalender
kommt in den nächsten zwei Stunden niemand» als ein einziger
Auslösertyp für Abläufe fehlt. Nähe: `core/alarmanwesenheit.py`
(dieselbe Vorsicht gilt: automatisches Auslösen ist die heikle
Richtung). Stellen: `hub/homepilot/core/presence.py`,
`hub/homepilot/core/terminkontext.py`, `hub/homepilot/core/automation.py`.
Aufwand: mittel · Hub.

**704. Kategorien/Tags zur Gruppierung der Ablauf-Liste (Sicherheit,
Komfort, Energie) statt nur alphabetisch.** Die Ablaufliste
(`AutomationsScreen.tsx`) sortiert heute vermutlich alphabetisch oder
nach zuletzt geändert; eine freiwillige Kategorie je Ablauf mit
Filterleiste darüber (ähnlich `Kategoriezeile.tsx`, das es für einen
anderen Bereich schon gibt) erleichtert das Wiederfinden, sobald ein
Haushalt über zwanzig Abläufe hat. Nähe: `components/Kategoriezeile.tsx`.
Stellen: `app/src/screens/AutomationsScreen.tsx`,
`hub/homepilot/core/automation.py`. Aufwand: klein · Hub+App.

**705. Vorbereitung für dynamische Stromtarife als eigener
Bedingungstyp.** `core/energy.py` verwaltet den Energieverbrauch, kennt
aber vermutlich noch keinen externen Tarif, der sich stündlich ändert.
Ein Bedingungstyp «Stromtarif unter X Rp./kWh» würde Abläufe wie
«Waschmaschine erst starten, wenn der Strom günstig ist» ermöglichen,
sobald ein Datenanbieter angebunden ist - dieser Punkt ist bewusst nur
die Vorbereitung (Bedingungstyp, keine Anbindung); Punkt 229 zu
demselben Thema ist laut Archiv bereits einmal gestrichen worden, ein
neuer Anlauf lohnt sich trotzdem, sobald echte Tarifdaten verfügbar
sind. Stellen: `hub/homepilot/core/energy.py`,
`hub/homepilot/core/automation.py`. Aufwand: gross · Hub.

**706. Ersatzaktion bei Fehlschlag eines Kettenschritts (Gerät
offline), statt stillem Abbruch der restlichen Kette.** Punkt 465 hat
den stillen Teil bereits behoben: Ein gestolpertes «Gute Nacht» meldet
sich heute per Push (`_melde_fehlschlag` in `core/automation.py`). Was
weiterhin fehlt, ist die Ersatzaktion selbst - die Kette bricht nach dem
hängenden Schritt weiterhin ab, statt mit einem definierten
Alternativschritt fortzufahren (z. B. ein zweites, redundantes Gerät
ansteuern, wenn das erste offline ist). Nähe: 465. Stellen:
`hub/homepilot/core/automation.py`. Aufwand: mittel · Hub.

### Push-Benachrichtigungen (707-716)

**707. Interaktive Antwortknöpfe direkt in der Push (z. B. «Scharf
schalten») ohne App-Öffnung.** Gibt es in Teilen bereits:
`lib/mitteilungsknoepfe.ts` + `core/push.py` (`knoepfe`) legen
Sperrbildschirm-Knöpfe an - bewusst nur für zwei harmlose Griffe
(«Später», «Erledigt»), mit der ausdrücklichen Begründung, dass
Schadenspotenzial («aufschliessen, entschärfen») nicht auf einen
Bildschirm gehört, den jeder sieht, der das Telefon vom Tisch nimmt. Das
Beispiel aus diesem Punkt («Scharf schalten») widerspricht also der
bestehenden Regel - zu prüfen wäre eher ein dritter, biometrisch
abgesicherter Knopftyp (Auslösen erst nach Face ID/Touch ID, bevor der
Befehl den Hub erreicht), statt die Regel einfach zu umgehen. Nähe:
`lib/mitteilungsknoepfe.ts`, `core/push.py`. Stellen:
`app/src/lib/mitteilungsknoepfe.ts`, `hub/homepilot/core/push.py`.
Aufwand: gross · App (nativ) + Hub.

**708. Eskalationsstufe: bleibt eine kritische Meldung X Minuten
ungelesen, geht sie an eine zweite Person/Rolle.** Die Alarmanlage kennt
eine Eskalation bereits (Punkt 255, `integrations/alarm.py`: erst Frist,
dann Sirene) - das ist eine Eskalation der *Aktion*, nicht des
*Empfängers*. Gemeint ist hier: Bleibt eine kritische Push (Wasser,
Alarm) X Minuten ungelesen, geht dieselbe Meldung zusätzlich an eine
zweite hinterlegte Person - für den Fall, dass die erste das Telefon
gerade nicht bei sich hat. Nähe: 255 (andere Art Eskalation, gleicher
Name). Stellen: `hub/homepilot/core/push.py`,
`hub/homepilot/core/pushziel.py`, `hub/homepilot/core/pushverlauf.py`.
Aufwand: mittel · Hub.

**709. Optionale abendliche Tages-Zusammenfassung für alle Kategorien,
für alle, die tagsüber ungestört bleiben wollen.** `core/pushbuendel.py`
bündelt bereits, was innerhalb einer Wächter-Runde anfällt
(Minutentakt) - eine Zusammenfassung über einen ganzen Tag ist eine
andere Grössenordnung und bewusst optional: Punkt 474 verlangt bereits
eine Sammlung dessen, was während der Ruhezeit anfiel; dieser Punkt ist
die freiwillige Variante davon für den ganzen Tag statt nur die
Ruhezeit. Nähe: 474. Stellen: `hub/homepilot/core/pushbuendel.py`,
`hub/homepilot/core/pushruhe.py`. Aufwand: mittel · Hub.

**710. Automatische Dämpfung basierend auf Standort/Kalender («bei der
Arbeit»), statt fixer Ruhezeiten je Wochentag.** `core/pushruhe.py`
kennt feste Ruhezeiten je Person und Wochentag; eine Dämpfung, die
stattdessen aus dem bekannten Standort (`core/presence.py`) oder einem
Kalendertermin («im Büro», «im Meeting») abgeleitet wird, passt sich an
einen Tag an, der nicht jede Woche gleich verläuft. Nähe:
`core/pushruhe.py`, `core/presence.py`. Stellen:
`hub/homepilot/core/pushruhe.py`, `hub/homepilot/core/presence.py`,
`hub/homepilot/core/terminkontext.py`. Aufwand: mittel · Hub.

**711. Wählbare, diskrete Sperrbildschirm-Vorschau je Kategorie
(«Neue Meldung» statt Klartext) für sensible Inhalte.** Die
Push-Einstellungen (`PushPrefs.tsx`, `PushRules.tsx`) legen heute
vermutlich je Kategorie fest, ob und wann eine Meldung kommt - nicht,
wie viel davon auf dem gesperrten Bildschirm steht. Für Kategorien wie
Alarm oder Klingel, die seit Punkt 618 ein Kamerabild anhängen, wäre
eine Wahl zwischen «Klartext» und «nur ‹Neue Meldung›» sinnvoll, wenn
das Telefon oft in fremden Händen liegt. Nähe: 618. Stellen:
`app/src/components/PushPrefs.tsx`, `hub/homepilot/core/push.py`.
Aufwand: mittel · App+Hub.

**712. Testmodus für neue Kategorien: zuerst nur an sich selbst senden,
bevor sie für alle aktiv wird.** `core/pushbeispiel.py` klingt bereits
nach einer Test-Sende-Funktion - falls sie schon einen Weg bietet, eine
neue Kategorie zunächst nur an eine Person zu schicken, ist dieser
Punkt bereits weitgehend gedeckt; falls nicht, gehört die Beschränkung
«nur an mich» als Schalter direkt neben die Kategorie-Einstellung,
bevor sie für den ganzen Haushalt live geht. Nähe: `core/pushbeispiel.py`.
Stellen: `hub/homepilot/core/pushbeispiel.py`,
`hub/homepilot/core/push.py`. Aufwand: klein · Hub.

**713. Zustellstatistik je Kategorie (Erfolgsquote der letzten 30
Tage), um tote Push-Token früh zu erkennen.** `core/pushgeraet.py`
verwaltet die Geräte-Token; Expo meldet bei jedem Versand, ob ein Token
noch gültig ist. Diese Rückmeldung über 30 Tage gesammelt und je
Kategorie ausgewertet («Kategorie Alarm: 98 % zugestellt») macht ein
totes Token sichtbar, bevor es im Ernstfall auffällt. Stellen:
`hub/homepilot/core/pushgeraet.py`, `hub/homepilot/core/push.py`,
`app/src/screens/SystemScreen.tsx`. Aufwand: mittel · Hub.

**714. Dauerhafte Speicherung des angehängten Bildes in der
Push-Historie, statt nur Minuten wie bei Live-Schnappschüssen.**
`core/pushverlauf.py` speichert die Meldungen selbst dauerhaft; das
angehängte Bild (etwa vom Klingel-Schnappschuss, Punkt 618) liegt nur so
lange, wie ein Live-Schnappschuss ohnehin lebt. Ein Kopieren des Bilds
beim Eintragen in den Posteingang, statt nur zu verlinken, würde «wer
hat um 14:02 geklingelt» auch Monate später noch mit Bild beantwortbar
machen. Nähe: 618. Stellen: `hub/homepilot/core/pushverlauf.py`,
`hub/homepilot/core/bildarchiv.py`, `hub/homepilot/core/bildspeicher.py`.
Aufwand: mittel · Hub.

**715. «Höchstens 1×/Stunde gesammelt» als Option für niedrigpriore
Kategorien mit vielen Einzelbündeln am Tag.** `core/pushbuendel.py`
bündelt heute je Wächter-Runde (eine Minute) - für Kategorien, die
trotzdem noch oft genug feuern, um zu nerven (mehrere Bündel pro
Stunde), wäre ein je Kategorie wählbarer, längerer Sammelrhythmus die
Ergänzung. Nähe: `core/pushbuendel.py`. Stellen:
`hub/homepilot/core/pushbuendel.py`, `hub/homepilot/core/pushruhe.py`.
Aufwand: klein · Hub.

**716. Durchsage kritischer Push-Kategorien über Lautsprecher im
jeweiligen Raum, wählbar je Kategorie.** `lib/durchsage.ts`/`core/say.py`
können das Haus bereits ansprechen (Morgenbriefing, Erinnerungen); eine
Kopplung, die für ausgewählte kritische Kategorien (Wasser im Keller,
Rauchmelder) automatisch eine Durchsage im betroffenen oder in allen
Räumen auslöst, statt nur eine stumme Push zu schicken, würde die
Reaktionszeit verkürzen, wenn niemand gerade aufs Telefon schaut. Nähe:
`core/say.py`, `lib/durchsage.ts`. Stellen: `hub/homepilot/core/say.py`,
`hub/homepilot/core/push.py`, `hub/homepilot/core/watchdog.py`. Aufwand:
mittel · Hub.

### Alarmanlage (717-725)

**717. Zeitlich befristeter Gastzugriff auf Live-Bild bei
Alarmauslösung für eine Vertrauensperson, ohne volle App-Rechte.**
`core/guestpass.py` und `core/gastspur.py` regeln bereits befristete
Gastzugriffe (fürs Gäste-WLAN, Punkt 632 für Zigbee/Matter-Geräte); ein
eigener, engerer Zugriffstyp, der nur im Alarmfall für eine begrenzte
Zeit das Live-Bild einer Person ausserhalb der Familie freigibt
(Nachbarin, die nach dem Rechten sehen soll), fehlt. Nähe:
`core/guestpass.py`. Stellen: `hub/homepilot/core/guestpass.py`,
`hub/homepilot/integrations/alarm.py`, `hub/homepilot/core/streams.py`.
Aufwand: gross · Hub+App.

**718. Abgleich mit Sturmwarnung: Fenstersensor-Alarm bei Sturm
zunächst als «möglicherweise Wind» statt sofort volle Eskalation.**
`integrations/meteoalarm.py` liefert bereits amtliche
Unwetterwarnungen für den eigenen Standort - heute unabhängig von der
Alarmanlage. Eine Verknüpfung, die einen Fenstersensor-Alarm während
einer aktiven Sturmwarnung mit einer milderen ersten Stufe
(«möglicherweise Wind» statt sofortiger voller Eskalation nach Punkt
255) einordnet, nutzt Daten, die der Hub bereits hat. Nähe:
`integrations/meteoalarm.py`, Punkt 255. Stellen:
`hub/homepilot/integrations/meteoalarm.py`,
`hub/homepilot/integrations/alarm.py`. Aufwand: mittel · Hub.

**719. Jahres-/Quartalsbericht der Anlage (Scharfschaltungen,
Fehlalarme, durchschnittliche Reaktionszeit).** `core/alarmbericht.py`
schreibt bereits einen Nachbericht je einzelnem Alarmereignis; ein
zusammenfassender Bericht über einen längeren Zeitraum (wie oft scharf
geschaltet, wie viele Fehlalarme, mittlere Zeit bis zum Entschärfen)
fasst diese Einzelberichte zu einer Kennzahl zusammen - ähnlich dem
Haus-Rückblick, nur für die Anlage allein. Nähe: `core/alarmbericht.py`.
Stellen: `hub/homepilot/core/alarmbericht.py`,
`app/src/screens/HausRueckblick.tsx`. Aufwand: mittel · Hub.

**720. Live-Bild-Vorschau aller Innenkameras direkt beim
Scharfschalten «Ausser Haus», bevor man das Haus verlässt.**
`Kamerawand.tsx` zeigt bereits alle Kameras gleichzeitig - eingebettet
in den Scharfschalten-Vorgang selbst, als letzter Blick vor dem
Verlassen («ist wirklich niemand mehr drin, ist der Herd aus»), fehlt
sie. Stellen: `app/src/components/Kamerawand.tsx`,
`app/src/screens/AlarmScreen.tsx`. Aufwand: klein · App.

**721. Zusätzliche Push-Bestätigung bei Fern-Entschärfung von
ausserhalb des W-LANs (Zwei-Faktor gegen gestohlenes Telefon).** Die
Anmeldung läuft bereits über Sitzungen (`core/sessions.py`); eine
zweite, kurze Bestätigung speziell für den Moment des Entschärfens von
unterwegs (Push mit Bestätigungsknopf an ein zweites, bekanntes Gerät,
oder eine erneute biometrische Abfrage in der App) wäre der gezielte
Schutz gegen genau den Fall, dass ein entsperrtes, gestohlenes Telefon
die Anlage stumm entschärft. Stellen: `hub/homepilot/integrations/alarm.py`,
`hub/homepilot/core/sessions.py`, `app/src/screens/AlarmScreen.tsx`.
Aufwand: mittel · Hub+App.

**722. Wochentagsabhängige Ein-/Ausgangsverzögerung statt einer festen
Zeit für alle Tage.** Die Verzögerungszeiten liegen vermutlich als feste
Werte in der Alarm-Konfiguration; am Wochenende, wenn morgens niemand
zur festen Zeit aus dem Haus geht, ist eine andere Verzögerung sinnvoll
als am Werktag mit dem hektischen Aufbruch um Viertel vor acht. Stellen:
`hub/homepilot/integrations/alarm.py`, `hub/homepilot/core/config.py`.
Aufwand: klein · Hub.

**723. Zeitlich befristeter Gast-Anwesenheitsstatus (Handwerker,
Übernachtungsgast), der von der «alle weg»-Logik ausgenommen wird.**
`core/babysitter.py` löst denselben Grundkonflikt für den
Babysitter-Abend (Anwesenheit ohne Telefon); ein allgemeinerer,
befristeter Gast-Status - mit Enddatum statt eines manuell wieder
abzuschaltenden Modus - würde denselben Schutz auch für einen
Handwerker über mehrere Tage oder einen Übernachtungsgast ohne eigenes
Telefon im Haus bieten. Nähe: `core/babysitter.py`, `core/guestpass.py`.
Stellen: `hub/homepilot/core/babysitter.py`,
`hub/homepilot/core/alarmanwesenheit.py`. Aufwand: mittel · Hub.

**724. Nach Kritikalität gestaffelte Batteriewarnung (Sensor in
aktiver Zone vor Sensor in selten genutztem Raum).**
`core/batterie.py`/`core/batterieprognose.py` melden schwache Batterien
bereits, vermutlich mit derselben Dringlichkeit für jeden Sensor. Ein
Sensor an der Eingangstür oder im Wohnzimmer ist für den Betrieb der
Anlage wichtiger als einer im selten betretenen Cheller - dieselbe Zahl
«überwacht von der Alarmanlage», die `watchdog.py` bereits für
ausgefallene Geräte nutzt, liesse sich für die Reihenfolge der
Batteriewarnungen wiederverwenden. Nähe: `core/watchdog.py`,
`core/batterieprognose.py`. Stellen: `hub/homepilot/core/batterie.py`,
`hub/homepilot/core/batterieprognose.py`,
`hub/homepilot/core/watchdog.py`. Aufwand: klein · Hub.

**725. PDF-Export eines Alarmereignisses (Zeitstempel, Sensoren,
Bilder, wer entschärft hat) für Versicherung/Polizei.**
`core/alarmbericht.py` fasst das Ereignis bereits als Absatz zusammen;
ein PDF-Export desselben Inhalts, ergänzt um die Schnappschüsse der
beteiligten Kameras, macht daraus ein Dokument, das man einer
Versicherung oder der Polizei ohne Nacherzählen weitergeben kann. Nähe:
`core/alarmbericht.py`. Stellen: `hub/homepilot/core/alarmbericht.py`,
`hub/homepilot/core/bildarchiv.py`. Aufwand: mittel · Hub.

### Selbst gewählt (726-739)

**726. Taschengeld-Tracker, gekoppelt an erledigte Ämtli-Sterne.**
`lib/aemtlisterne.ts` und `core/chores.py` führen die Ämtli und ihre
Sterne bereits; ein Taschengeld-Modul, das aus gesammelten Sternen einen
Betrag je Kind errechnet und einen einfachen Kontostand führt (kein
echtes Konto, eine geführte Zahl), baut direkt auf dieser vorhandenen
Zählung auf. Nähe: `lib/aemtlisterne.ts`, `core/chores.py`. Stellen:
`hub/homepilot/core/chores.py`, `app/src/lib/aemtlisterne.ts`,
`app/src/screens/family/kindseite.tsx`. Aufwand: mittel · Hub+App.

**727. Familien-Wunschliste/Geschenkideen-Modul nativ im Haus statt
externer Lösung.** Ähnlich den Gutscheinen (`core/gutscheine.py`) und
dem Fundbüro (`lib/fundbuero.ts`) als Vorbild für eine Familienliste mit
Privatsphäre-Regeln: Eine Wunschliste braucht dieselbe Eigenschaft wie
ein Gutschein - sichtbar für alle ausser der beschenkten Person selbst.
Stellen: `hub/homepilot/core/familie.py`, `hub/homepilot/core/gutscheine.py`
(als Vorbild für Privatsphäre je Eintrag),
`app/src/screens/FamilyScreen.tsx`. Aufwand: mittel · Hub+App.

**728. Gäste-Modus per QR-Code: befristeter Zugriff auf WLAN-Info,
Klingel, ausgewählte Räume.** Das Gäste-WLAN hat mit
`core/wlanschein.py`/`lib/wlanaufkleber.ts` bereits einen QR-Weg; dieser
Punkt erweitert dieselbe Idee über das WLAN hinaus auf einen
befristeten, eingeschränkten App-Zugriff (Klingel sehen, ausgewählte
Räume steuern) ohne vollständiges Familienkonto. Nähe: `core/wlanschein.py`,
`core/guestpass.py`. Stellen: `hub/homepilot/core/wlanschein.py`,
`hub/homepilot/core/guestpass.py`, `app/src/lib/gastzugang.ts`. Aufwand:
gross · Hub+App.

**729. Energie-Rangliste der Geräte (Top 3 Verbraucher/Monat, Trend
zum Vormonat) auf der Übersicht.** `core/energy.py` sammelt die
Verbrauchsdaten bereits; eine Rangliste der drei grössten Verbraucher
mit Vergleich zum Vormonat als eigene Startseiten-Kachel macht aus dem
gesammelten Wert eine Handlungsaufforderung («die Klimaanlage zieht seit
letztem Monat 30 % mehr»). Stellen: `hub/homepilot/core/energy.py`,
`app/src/screens/EnergyScreen.tsx`, `app/src/screens/DashboardScreen.tsx`.
Aufwand: mittel · Hub+App.

**730. Ausflugsvorschläge (Anbindung an ausflugfinder.ch) im
Wochenkalender, je nach Wetter.** Wetterdaten liegen dem Hub für den
Stundenverlauf bereits vor (`core/regen.py`, genutzt bei Punkt 588 für
den Wäschetag); eine Anbindung an einen externen Ausflugsdienst,
gefiltert nach der Wettervorhersage fürs Wochenende, wäre eine neue
Integration nach dem Muster der bestehenden externen Anbindungen
(`integrations/`). Stellen: `hub/homepilot/integrations/`,
`hub/homepilot/core/regen.py`, `app/src/screens/FamilyScreen.tsx`.
Aufwand: mittel · Hub.

**731. Sprach-Diktat für die Einkaufsliste am Wandpanel per Zuruf.**
Der Einkaufszettel (`lib/einkauf.ts`, `core/shopping.py`) nimmt
Einträge heute über Tippen entgegen; ein Mikrofon-Knopf am Wandpanel,
der einen zugerufenen Artikel per Spracherkennung direkt einträgt, wäre
die Wandpanel-Variante der ohnehin schon vorgeschlagenen Diktierfunktion
(Punkt 673 dieser Runde) - hier mit eigener Betonung auf «ohne die Hände
zu benutzen», mitten im Kochen. Nähe: 673. Stellen: `app/src/lib/einkauf.ts`,
`app/src/lib/sprachnotiz.ts`. Aufwand: mittel · App.

**732. Vereinfachte Gäste-/Grosseltern-Startseite: nur Wetter, nächster
Termin, wer ist da.** `KidsView.tsx` zeigt bereits, dass es eine
vereinfachte, altersgerechte Alternativ-Startseite für eine Zielgruppe
gibt - eine zweite, noch knappere Fassung für Grosseltern oder Gäste
(drei Kacheln, gross beschriftet, ohne Bedienelemente, die Fehlgriffe
zulassen) folgt demselben Muster für eine andere Zielgruppe. Nähe:
`components/KidsView.tsx`. Stellen: `app/src/components/KidsView.tsx`,
`app/src/lib/rollen.ts`, `app/src/lib/benutzergruppen.ts`. Aufwand:
mittel · App.

**733. Automatisches Morgenbriefing als Durchsage (Wetter, Termine,
offene Ämtli, Gutschein-Erinnerungen).** `core/morgen.py` und
`lib/durchsage.ts`/`core/say.py` liefern bereits die Bausteine
(Morgen-Logik, Durchsagefähigkeit); ob `core/morgen.py` das Briefing
schon als Durchsage ausgibt oder nur als Kartentext in der App, ist vor
dem Bauen zu prüfen - falls Letzteres, ist die Durchsage die
naheliegende Ergänzung, inklusive der Ämtli (`core/chores.py`) und
fälliger Gutscheine (`core/gutscheine.py`), die heute vermutlich noch
nicht im Morgenbriefing stehen. Nähe: `core/morgen.py`, `core/say.py`.
Stellen: `hub/homepilot/core/morgen.py`, `hub/homepilot/core/say.py`.
Aufwand: mittel · Hub.

**734. Haushaltsbudget-Modul für Fixkosten mit Fälligkeitserinnerung,
als Schwesterprojekt zu den Gutscheinen.** Kein eigenes Budget-Modul
vorhanden; `core/gutscheine.py` und `core/erinnerungen.py` liefern das
Vorbild für Struktur (Beträge, Fristen, Erinnerungen) und
Privatsphäre-Regeln. Ein Fixkosten-Modul (Miete, Versicherungen, Abos)
mit Fälligkeitserinnerung wäre der nächste Schritt zu einem
vollständigeren Haushaltsüberblick - und die Voraussetzung für Punkt 693
dieser Runde (Verknüpfung von Gutschein-Einlösungen mit einem Budget).
Nähe: `core/gutscheine.py`, `core/erinnerungen.py`, 693. Stellen:
`hub/homepilot/core/gutscheine.py` (als Vorbild), neue Datei
`hub/homepilot/core/budget.py`. Aufwand: gross · Hub+App.

**735. Einfaches Familien-Abstimmungstool für Alltagsentscheidungen
(Ausflugsziel, Znacht) mit Push an alle.** Kein bestehendes
Abstimmungs-Modul gefunden; eine kleine Familienliste nach dem Muster
der bestehenden (`core/familie.py`, `core/shopping.py` als Vorbild für
eine geteilte, live aktualisierte Liste) mit Frage, Optionen und einer
Push an alle Familienmitglieder, die per Tipp in der Push selbst
abstimmen können. Nähe: 707 (interaktive Push-Knöpfe). Stellen:
`hub/homepilot/core/familie.py`, `hub/homepilot/core/push.py`,
`app/src/screens/FamilyScreen.tsx`. Aufwand: mittel · Hub+App.

**736. Migrationswerkzeug für bestehende Home-Assistant-YAML-
Automationen als HomePilot-Vorlage.** `core/vorlagen.py`/
`screens/automations/vorlagen.ts` kennen bereits das Format einer
Ablauf-Vorlage; ein Einleser, der eine Home-Assistant-Automation-YAML
parst und so weit wie möglich in dieses Vorlagenformat übersetzt
(Trigger, Bedingungen, Aktionen mit bekannten Entsprechungen; alles
andere ehrlich als «nicht übersetzbar» markiert, nach demselben Prinzip
wie die Zeitraum-Simulation bei nicht simulierbaren Auslösern),
erleichtert den Umstieg für Familien, die von Home Assistant kommen.
Nähe: `core/ablaufsimulation.py` (dieselbe Ehrlichkeit bei
Nicht-Übersetzbarem). Stellen: `hub/homepilot/core/vorlagen.py`,
`app/src/screens/automations/vorlagen.ts`. Aufwand: gross · Hub.

**737. Monatliches Nachhaltigkeits-Dashboard (CO₂-Schätzung aus
Stromverbrauch).** `core/energy.py` misst den Verbrauch bereits; eine
Umrechnung in eine CO₂-Schätzung (mit dem Schweizer Strommix oder, falls
bekannt, dem tatsächlichen Anbieter-Mix) als monatliche Kennzahl neben
dem Haus-Rückblick macht aus einer Kilowattstunden-Zahl eine Grösse, die
sich einordnen lässt. Nähe: `core/energy.py`, `lib/hausrueckblick.ts`.
Stellen: `hub/homepilot/core/energy.py`, `app/src/lib/hausrueckblick.ts`.
Aufwand: mittel · Hub+App.

**738. Freitext-Frage an den Hub («Ist die Waschmaschine fertig?»)
statt feste Bildschirme zu durchsuchen.** Die grosse Suche
(`GlobalSearch.tsx`, Punkt 431 nennt die Lücke zur Familiensuche) findet
Räume, Geräte, Szenen und Seiten über den Namen - eine Freitext-Frage in
normaler Sprache, beantwortet aus dem aktuellen Zustand (Waschküche,
`core/waschkueche.py`) statt aus einer Namensliste, ist ein grösserer
Schritt in Richtung eines kleinen Sprachmodells oder einer
Regelsammlung, die Fragen auf Entitäten und Zustände abbildet. Nähe:
`components/GlobalSearch.tsx`, 431. Stellen: `hub/homepilot/api/server.py`,
`app/src/components/GlobalSearch.tsx`. Aufwand: gross · Hub.

**739. Tägliches freiwilliges Erinnerungsfoto übers Wandpanel,
gesammelt im Rückblick als kleines Familientagebuch.**
`core/bildarchiv.py`/`core/cliparchiv.py` archivieren bereits Bilder
(aus Kameras, Klingel); ein freiwilliger, täglicher Foto-Impuls am
Wandpanel (nicht automatisch, ein Knopf «heute festhalten») mit Sammlung
im Haus-Rückblick wäre eine neue, familienzentrierte Nutzung derselben
Archiv-Mechanik statt einer weiteren Kamera-Quelle. Nähe:
`core/bildarchiv.py`, `lib/hausrueckblick.ts`. Stellen:
`hub/homepilot/core/bildarchiv.py`, `app/src/screens/dashboard/`,
`app/src/lib/hausrueckblick.ts`. Aufwand: mittel · Hub+App.
