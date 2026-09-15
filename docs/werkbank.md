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
| App allgemein | 14 | 422, 424, 425, 427, 428, 429, 659, 660, 661, 662, 663, 664, 665, 667 |
| Bedienung | 10 | 431, 432, 433, 434, 435, 436, 437, 438, 439, 440 |
| User Experience | 7 | 668, 669, 671, 673, 675, 676, 677 |
| Gestaltung | 12 | 441, 446, 447, 449, 450, 678, 679, 680, 682, 683, 685, 686 |
| Gutscheine | 8 | 453, 458, 688, 689, 691, 692, 694, 696 |
| Abläufe | 11 | 468, 469, 697, 698, 699, 700, 701, 702, 703, 705, 706 |
| Push-Benachrichtigungen | 12 | 473, 474, 476, 707, 708, 709, 710, 711, 713, 714, 715, 716 |
| Alarmanlage | 7 | 483, 717, 718, 719, 721, 723, 725 |
| Selbst gewählt | 21 | 492, 493, 494, 496, 499, 500, 501, 502, 726, 727, 728, 729, 730, 731, 732, 733, 735, 736, 737, 738, 739 |
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
und Alarmanlage, dazu fünfzehn selbst gewählte - dieselbe Form wie die
Runde 421-505. Vier davon standen beim Gegenprüfen schon im Code und
fehlen darum hier bewusst: die «Was ist neu»-Anzeige nach einem Update
(`components/WhatsNew.tsx`), «Bewegung reduzieren»
(`hooks/useBewegungReduziert.ts`), die gestaffelte Alarm-Eskalation
(Punkt 255) und die Wartungserinnerungen (`core/maintenance.py`).
Zwölf weitere - 666, 670, 672, 674, 681, 684, 687, 695, 712, 720, 722
und 724 - sind inzwischen gebaut und stehen im Archiv. Zwei weitere - 693 und 734, das
Haushaltsbudget-Modul und die davon abhängige Verknüpfung mit den
Gutscheinen - sind auf Wunsch gestrichen; die Nummern bleiben frei.
Zwei weitere - 690 und 704 - waren beim genaueren Hinsehen schon
gebaut: Der Haus-Rückblick zeigt verfallenes Gutschein-Guthaben neben
dem Eingelösten seit Punkt 372/454 (`core/langzeit.py`, `bilanz()`),
und die Ablauf-Liste gruppiert und filtert schon nach `category`
(`AutomationsScreen.tsx`, `groupByCategory`) - beides lange bevor
diese Runde entstand.

Kurz gehalten, damit die Liste lesbar bleibt (Punkt 505) - die
ausführliche Abwägung je Punkt, falls es sie gab, steht dann im Archiv.

### App allgemein (659-667)

**659. Onboarding für ein neues Familienmitglied.** Die Einführung
(`lib/einfuehrung.ts`) erklärt die Leiste - der Schritt davor fehlt:
Rolle, Favoriten, Benachrichtigungen in einem Assistenten, anknüpfend an
die Einladung (`core/einladung.py`). Aufwand: mittel · App+Hub.

**660. «Stand vor 4 Minuten» statt nur «Hub nicht erreichbar».** Zeigt
die App noch den letzten bekannten Stand aus dem Zwischenspeicher
(`lib/familiecache.ts`), soll sie das sagen, nicht so tun, als wäre sie
live. Nähe: 439. Stellen: `app/src/hooks/useHub.ts`. Aufwand: klein · App.

**661. Ein-Klick-Export der eigenen Daten als ZIP.** Gutscheine,
Ämtli-Verlauf, Rezepte - `core/familienbuch.py` exportiert Familiendaten
bereits als HTML-Seite, hier fehlt der ZIP-Weg für die eigenen Daten
einer einzelnen Person. Aufwand: mittel · Hub+App.

**662. Sitzungsübersicht der angemeldeten Geräte.** `core/sessions.py`
führt die Sitzungen bereits, ohne Seite, die sie zeigt oder eine
Fernabmeldung erlaubt. Stellen: `hub/homepilot/core/sessions.py`,
`app/src/screens/UsersScreen.tsx`. Aufwand: mittel · Hub+App.

**663. Erreichbarkeitstest des Hubs von aussen.** Regelmässiger
Selbsttest von ausserhalb des Haus-WLANs (VPN/Portfreigabe), mit Push
bei Statusänderung - fehlt heute ganz. Aufwand: mittel · Hub.

**664. Siri-Kurzbefehle/App Intents.** Für die Aktionen aus
`lib/schnellaktionen.ts` (dieselbe Liste wie Widget und App-Symbol), als
eigenes natives Modul - `runtimeVersion` und TestFlight-Build im selben
Commit. Aufwand: gross · App (nativ).

**665. Sandbox-Testmodus für neue Mitglieder.** Babysitter & Co.
schalten testweise, ohne dass der Befehl die Integration erreicht -
ergänzt den bestehenden `core/babysitter.py`. Aufwand: mittel · Hub.

**667. Wöchentlicher Gesundheitscheck-Bericht des Hubs.**
`core/metrics.py` kennt die Zahlen, aber nur auf Zuruf - ein
automatischer Wochenbericht (Speicher, Verbindungsfehler) macht daraus
eine Gewohnheit. Aufwand: mittel · Hub.

### User Experience (668-677)

**668. Mehrstufiges Undo (letzte 5) für kritische Listen.**
`lib/rueckgaengig.ts` kennt nur die letzte Schaltung; ein kurzer Stapel
für Familienlisten, Abläufe, Gutscheine erweitert das. Nähe: 432.
Aufwand: mittel · App+Hub.

**669. Sprachsteuerung mit Rückfrage bei Mehrdeutigkeit.** «Bürolicht
oder Gästezimmer?» statt der ersten stillen Übereinstimmung, wenn ein
Name zu mehreren Entitäten passt. Aufwand: mittel · Hub.

**671. App-weiter «Fokus»-Modus** (Badges/Vorschläge stumm während
eines Meetings), unabhängig von den Push-Ruhezeiten (`core/pushruhe.py`).
Aufwand: mittel · App+Hub.

**673. Diktierfunktion für Textfelder.** Das native Diktat-Mikrofon der
Tastatur nicht blockieren, plus eigenes Mikrofon-Symbol dort, wo die App
eigene Eingabefelder zeichnet. Nähe: 223. Aufwand: klein · App.

**675. Wischgesten zwischen Hauptbereichen** (Übersicht ↔ Familie ↔
Räume) für einhändige Bedienung am Wandpanel - ergänzt die Wischgeste
zwischen Zimmern (Punkt 583). Aufwand: mittel · App.

**676. Info-Symbol bei automatischen Vorschlägen.** Ein Satz, der die
Regel dahinter erklärt (z. B. Wäschetag-Hinweis, Punkt 588) - sonst hält
man den Vorschlag für Zufall. Aufwand: klein · App.

**677. Einheitliche, testbare Bestätigungsdialog-Texte.** Heute
vermutlich pro Bildschirm unterschiedlich formuliert
(`TuerRueckfrage.tsx`, einzelne `Alert.alert`) - eine gemeinsame reine
Funktion vereinheitlicht sie. Aufwand: mittel · App.

### Gestaltung (678-686)

**678. Live-Kontrast-Check für frei wählbare Akzentfarben.**
`lib/kontrast.ts` rechnet den WCAG-Kontrast heute nur im Testlauf für
die feste Palette - sobald eine Farbe frei wählbar wird, gehört die
Warnung an die Auswahlstelle selbst. Aufwand: klein · App.

**679. Abschaltbare, dezente saisonale Farbthemen** statt eines fixen
Jahresdesigns - eine leise Verschiebung in Akzentton/Kartenrand,
abschaltbar. Aufwand: mittel · App.

**680. Eigene kleine Illustrationen je Modul für Leerzustände** statt
generischer Icons in `components/Leerzustand.tsx`. Nähe: 447. Aufwand:
mittel · App.

**682. Echtes Mehrspalten-Layout für Listen im iPad-Querformat**
(Gutscheine, Rezepte) statt einer breiter skalierten Telefon-Spalte.
Aufwand: mittel · App.

**683. Sichtbarer «Test-Modus»-Rahmen**, solange ein Trockenlauf (Punkt
697) scharf gegen echte Geräte liefe, damit niemand den Testeffekt für
echt hält. Aufwand: klein · App.

**685. Wählbare Kachelgrössen (klein/mittel/gross)** auf der Übersicht,
nicht nur die Reihenfolge aus `lib/favoritenordnung.ts`. Aufwand: gross
· App.

**686. Eigenes, kontrastreiches Erscheinungsbild für den Kassenmodus**
statt nur «hell und wach» (`lib/kassenlicht.ts`, Punkt 532) - grosse,
schwarz-auf-weiss gesetzte Ziffern. Aufwand: mittel · App.

### Gutscheine (688-696)

**688. Hinweis beim Einkaufsplanen bei offenem Gutschein** zum
passenden Laden - früher als der bestehende `core/gutscheinort.py`, der
sich erst vor Ort meldet. Aufwand: mittel · Hub+App.

**689. «Verschenken»-Export (PDF/Bild mit Betrag & Code)** für
Gutscheine an Personen ausserhalb der Familie, ohne Zugriffsrechte zu
vergeben. Aufwand: mittel · Hub+App.

**691. Wiederkehrende Gutscheine als Vorlage** (z. B. jährlicher
Arbeitgeber-Gutschein), die der Hub rechtzeitig als «erwartet»
markiert. Aufwand: mittel · Hub.

**692. Kombination Kalender + Bestand:** «Geburtstag von X in 2 Wochen -
passender Gutschein vorhanden?», mit `core/terminkontext.py`. Nähe: 453.
Aufwand: mittel · Hub.

**694. «Bald abgelaufen» nach Nähe zur Route sortieren** statt reiner
Datumsliste, mit `core/gutscheinort.py`/`core/losfahren.py`. Nähe: 458.
Aufwand: mittel · Hub+App.

**696. Kategorien mit eigenem Budget-Ziel** («Restaurant-Gutscheine bis
Jahresende aufbrauchen») mit Fortschrittsbalken. Aufwand: mittel ·
Hub+App.

### Abläufe (697-706)

**697. Trockenlauf/Simulator gegen den aktuellen Zustand.** Anders als
die bestehende Zeitraum-Simulation (`core/ablaufsimulation.py`, rechnet
rückwirkend) und die Speicher-Prüfung (`core/ablaufpruefung.py`, prüft
nur bekannte Bausteine): hier interaktiv auswerten, welche Aktionen
*jetzt* liefen, ohne sie zu senden. Aufwand: mittel · Hub.

**698. Versionsverlauf je Ablauf mit Rücksprung.** Vor dem Bauen prüfen,
ob `core/editversions.py` das schon für Abläufe im Speziellen kann.
Aufwand: mittel · Hub.

**699. Konfliktprüfung beim Einrichten eines Ablaufs**, wenn er
dieselbe Entität wie ein anderer aktiver Ablauf widersprüchlich
ansteuert. `core/konflikte.py` prüft bisher nur zur Laufzeit. Aufwand:
mittel · Hub.

**700. Ablauf-Vorschläge aus beobachtetem Verhalten** («immer 22 Uhr
dieselben drei Lichter aus»), aus dem Ereignisprotokoll
(`core/eventlog.py`) gelesen. Aufwand: gross · Hub.

**701. Vorab-Push bei potenziell störenden Abläufen** («in 5 Min.
Nachtmodus - abbrechen?»); braucht Punkt 707 für den Abbruch-Knopf.
Nähe: 707. Aufwand: mittel · Hub.

**702. Gemeinsamer Variablenspeicher zwischen Abläufen** ohne Umweg
über Platzhalter-Entitäten (`core/platzhalter.py`). Aufwand: mittel ·
Hub.

**703. Geo-Fence-Trigger kombiniert mit Personen UND Kalender**
(«alle weg UND niemand für 2h erwartet»), mit `core/terminkontext.py`.
Aufwand: mittel · Hub.

**705. Bedingungstyp für dynamische Stromtarife**, als Vorbereitung
ohne Anbindung - Punkt 229 zum selben Thema wurde einmal gestrichen.
Aufwand: gross · Hub.

**706. Ersatzaktion bei Fehlschlag eines Kettenschritts.** Punkt 465
hat die stille Seite behoben (Push bei Fehlschlag) - die Kette bricht
danach weiterhin ab, statt einen Alternativschritt zu fahren. Nähe: 465.
Aufwand: mittel · Hub.

### Push-Benachrichtigungen (707-716)

**707. Interaktive Antwortknöpfe, auch für heikle Aktionen.**
`lib/mitteilungsknoepfe.ts` erlaubt bewusst nur harmlose Knöpfe
(«Später», «Erledigt») - für «Scharf schalten» bräuchte es einen
biometrisch abgesicherten dritten Typ, nicht einfach die Regel brechen.
Aufwand: gross · App (nativ) + Hub.

**708. Eskalation an eine zweite Person bei ungelesener kritischer
Push.** Andere Art Eskalation als die der Alarmanlage (Punkt 255).
Aufwand: mittel · Hub.

**709. Optionale abendliche Tages-Zusammenfassung** für alle
Kategorien - die freiwillige Variante von Punkt 474 (Sammlung während
der Ruhezeit). Nähe: 474. Aufwand: mittel · Hub.

**710. Automatische Dämpfung nach Standort/Kalender** («bei der
Arbeit») statt fixer Ruhezeiten je Wochentag. Aufwand: mittel · Hub.

**711. Diskrete Sperrbildschirm-Vorschau je Kategorie** («Neue
Meldung» statt Klartext) für sensible Inhalte, z. B. mit Kamerabild
(Punkt 618). Aufwand: mittel · App+Hub.

**713. Zustellstatistik je Kategorie** (Erfolgsquote 30 Tage) aus
`core/pushgeraet.py`, um tote Token früh zu erkennen. Aufwand: mittel ·
Hub.

**714. Dauerhafte Speicherung des Push-Bilds** im Posteingang statt nur
so lange wie ein Live-Schnappschuss. Nähe: 618. Aufwand: mittel · Hub.

**715. «Höchstens 1×/Stunde gesammelt»** als Option für niedrigpriore
Kategorien, ergänzt `core/pushbuendel.py` (bündelt heute je Minute).
Aufwand: klein · Hub.

**716. Durchsage kritischer Push-Kategorien im Raum**, wählbar je
Kategorie, über `core/say.py`. Aufwand: mittel · Hub.

### Alarmanlage (717-725)

**717. Befristeter Gastzugriff auf Live-Bild bei Alarmauslösung** für
eine Vertrauensperson, ohne volle App-Rechte. Nähe: `core/guestpass.py`.
Aufwand: gross · Hub+App.

**718. Sturmwarnung dämpft Fenstersensor-Alarm** auf «möglicherweise
Wind» statt sofortiger voller Eskalation - `integrations/meteoalarm.py`
liefert die Daten bereits, nur unverknüpft. Aufwand: mittel · Hub.

**719. Jahres-/Quartalsbericht der Anlage** (Scharfschaltungen,
Fehlalarme, Reaktionszeit), aus den Einzelberichten von
`core/alarmbericht.py`. Aufwand: mittel · Hub.

**721. Zwei-Faktor bei Fern-Entschärfung von ausserhalb des W-LANs**
gegen ein gestohlenes, entsperrtes Telefon. Aufwand: mittel · Hub+App.

**723. Befristeter Gast-Anwesenheitsstatus** (Handwerker,
Übernachtungsgast) ausserhalb der «alle weg»-Logik - allgemeinere
Variante von `core/babysitter.py`. Aufwand: mittel · Hub.

**725. PDF-Export eines Alarmereignisses** (Zeitstempel, Sensoren,
Bilder, wer entschärft hat) für Versicherung/Polizei, aus
`core/alarmbericht.py`. Aufwand: mittel · Hub.

### Selbst gewählt (726-739)

**726. Taschengeld-Tracker, gekoppelt an Ämtli-Sterne** aus
`core/chores.py`/`lib/aemtlisterne.ts`. Aufwand: mittel · Hub+App.

**727. Familien-Wunschliste/Geschenkideen-Modul**, nach dem Vorbild der
Gutscheine (Privatsphäre je Eintrag). Aufwand: mittel · Hub+App.

**728. Gäste-Modus per QR-Code** (WLAN-Info, Klingel, ausgewählte
Räume) - erweitert `core/wlanschein.py` über das WLAN hinaus. Aufwand:
gross · Hub+App.

**729. Energie-Rangliste der Geräte** (Top 3 Verbraucher/Monat, Trend)
auf der Übersicht, aus `core/energy.py`. Aufwand: mittel · Hub+App.

**730. Ausflugsvorschläge (ausflugfinder.ch)** im Wochenkalender, nach
Wetter gefiltert. Aufwand: mittel · Hub.

**731. Sprach-Diktat für die Einkaufsliste am Wandpanel per Zuruf.**
Nähe: 673. Aufwand: mittel · App.

**732. Vereinfachte Gäste-/Grosseltern-Startseite** (Wetter, nächster
Termin, wer ist da) nach dem Muster von `KidsView.tsx`. Aufwand: mittel
· App.

**733. Automatisches Morgenbriefing als Durchsage** - prüfen, ob
`core/morgen.py` das schon tut oder nur als Kartentext zeigt. Aufwand:
mittel · Hub.

**735. Familien-Abstimmungstool** für Alltagsentscheidungen, mit Push
an alle. Nähe: 707. Aufwand: mittel · Hub+App.

**736. Migrationswerkzeug für Home-Assistant-YAML-Automationen** als
HomePilot-Vorlage, mit ehrlichem «nicht übersetzbar» statt Rätselraten.
Aufwand: gross · Hub.

**737. Monatliches Nachhaltigkeits-Dashboard (CO₂-Schätzung)** aus dem
Stromverbrauch (`core/energy.py`). Aufwand: mittel · Hub+App.

**738. Freitext-Frage an den Hub** («Ist die Waschmaschine fertig?»)
statt feste Bildschirme zu durchsuchen. Aufwand: gross · Hub.

**739. Tägliches freiwilliges Erinnerungsfoto übers Wandpanel**,
gesammelt im Rückblick als kleines Familientagebuch. Aufwand: mittel ·
Hub+App.
