# Was sich geändert hat

Die Commit-Betreffzeilen erzählen jede Änderung einzeln. Hier steht das
Gegenstück: was die Anlage heute kann, was sie vorher nicht konnte.

Neueste zuoberst. Datum ist der Tag, an dem es im Haus lief.

## 2026-09-01

**Neu**

- **Jedes Gerät kann ein Knopf auf der Raumkachel sein.** Hinter dem
  langen Druck auf eine Kachel standen bisher nur die Sammelknöpfe zur
  Wahl, die der Raum hergibt - in Levins Zimmer also nur «Licht», und
  hinzufügen liess sich nichts. Jetzt steht dort auch jedes schaltbare
  Gerät des Raums einzeln (samt Hue-Lichtszenen wie «Sternenhimmel»).
  Höchstens drei Knöpfe zusammen - mehr trägt die Kachel nicht, und das
  Blatt sagt es, statt stumm zu verweigern.
- **Der Ofen sagt Bescheid.** Endet am Backofen (oder Steamer) das
  Vorheizen, kommt eine Durchsage «Der Backofen ist parat» samt
  Nachricht - und beim Programmende «fertig». Bisher lief man dreimal
  in die Küche, um nachzusehen; die V-ZUG-Anbindung wusste es die
  ganze Zeit. Gilt nur für Kochgeräte - die Waschküche behält ihre
  spätere Erinnerung, und eine Geschirrspüler-Durchsage um 22:30
  will niemand. Abschaltbar unter Abläufe → Push.
- **Der Losfahr-Wecker.** Hat ein Termin im Kalender einen Ort,
  meldet sich das Haus, sobald es Zeit ist loszufahren:
  «Fussballtraining um 17:30 in Sursee - Fahrzeit etwa 25 Minuten.»
  Die Fahrzeit wird aus der Entfernung ab zuhause geschätzt, bewusst
  mit Reserve und einstellbarem Puffer; jede Adresse wird nur einmal
  nachgeschlagen und dann behalten. Termine ohne Ort, Ganztägiges
  und alles ums Egg bleiben still.
- **Auf dem Fernseher heisst Pause «Pause».** Die Kommando-Chips im
  Szenen- und Ablauf-Editor sprachen von «Musik an/aus» - wer den Film
  anhalten wollte, fand nichts Passendes. Auf einem Fernseher stehen
  die Chips jetzt als «Weiter» und «Pause» da. Und weil derselbe
  Fernseher zweimal in der Geräteliste steht (einmal als Android TV
  mit Apps und Fernbedienung, einmal als Chromecast für Musik und
  Durchsagen), trägt jeder Namensvetter seine Herkunft im Untertitel:
  «Fernseher · Android TV» neben «Fernseher · Chromecast».
- **Die Ablauf-Vorlagen sind gruppiert.** 32 Zeilen in einer flachen
  Liste liest niemand - jetzt stehen sie unter benannten
  Überschriften (Eigene, Kommen & Gehen, Licht, Storen & Wetter,
  Klingel & Kameras, Sicherheit, Haushalt), jede Zeile trägt ihr
  Symbol in einer getönten Scheibe. Die zwei einfachen
  Sonnen-Vorlagen sind in «Storen mit der Sonne auf/zu»
  aufgegangen - dieselbe Idee, aber mit Streuung und nicht vor
  sieben; zwei fast gleiche Paare nebeneinander verwirren nur.
- **Sechs neue Ablauf-Vorlagen und der Platzhalter `{termin}`.** Auf
  Wunsch dazugekommen: «Storen mit der Sonne auf/zu» (mit Streuung,
  morgens nicht vor sieben), «Hitzeschutz» (ab 26° alle Storen zu,
  Balkon und Terrasse stellen stattdessen die Lamellen halb schräg),
  «Wetterwarnung: Lamellen in Schutzstellung» (samt Nachricht),
  «Nachricht, wenn ein Kind heimkommt» (die Zone kann auch ein
  Bluetooth-Anhänger am Schulthek melden) und «Kameralicht bei
  Person in der Nacht». Dazu können Kommando-Schritte jetzt Lamellen
  stellen (set_tilt). Und wer in einer Durchsage oder Nachricht
  `{termin}` schreibt, bekommt den Titel des gerade laufenden
  Kalendertermins eingesetzt - «Das ist wohl {termin}» sagt an jedem
  Besuchstag den richtigen Namen, und ohne Termin schlicht «Besuch».
- **«Alle Geburtstage» zeigt die nächsten zehn - und liest sich wie
  eine Liste von Menschen.** Bisher stand dort oft nur einer: Der Hub
  kappte Termine und Geburtstage zusammen bei zwölf Einträgen, und in
  einer vollen Woche verdrängten die Termine jeden Geburtstag jenseits
  der nächsten Tage. Beide Listen haben jetzt ihr eigenes Mass (12
  Termine, 10 Geburtstage). Die Zeilen tragen den Namen statt des
  Satzes («Flo» statt «Flo hat Geburtstag»), ein Geschenk-Symbol, das
  Datum ausgeschrieben («Freitag, 4. September») und «in 5 Tagen» als
  Chip rechts - «heute! 🎉» leuchtet im Akzent.
- **«Alle Termine» liest sich jetzt als Woche.** Die flache Liste
  wiederholte den Tag in jeder Zeile («Di, 10:00», «Di, 18:00») -
  man las Daten statt Termine. Jetzt bündeln Tagesüberschriften
  (Heute, Morgen, Mittwoch, «Sonntag, 6. September») die Liste, und
  jede Zeile trägt nur noch ihre Uhrzeit in einer festen Spalte -
  die Titel fluchten. Der Ort steht mit Nadel-Symbol darunter, die
  Geburtstags-Liste trägt ihr «in 12 Tagen» als Chip rechts.
- **Die Haustür-Karte erscheint erst im Anmarsch.** Sie lag bisher
  den ganzen Arbeitstag auf dem Sperrbildschirm, sobald jemand weg
  war - ein Türöffner ohne Face ID nützt aber nur auf den letzten
  Metern. Jetzt startet sie erst näher als drei Kilometer (die
  Quartier-Zone) und endet zuhause wie bisher.
- **Tippen greift zuverlässiger.** Jede Meldung vom Hub (jeder
  Temperaturtick) zeichnete sofort die ganze Startseite neu - ein
  Tipp währenddessen ging verloren: «Ich muss oft zweimal drücken.»
  Zustands-Meldungen werden jetzt über 120 ms gesammelt und in einem
  Zug angewendet; die Verzögerung liegt unter dem, was ein Daumen
  bemerkt.
- **Szenen haben jetzt Auslöser.** Im Szenen-Editor steht der neue
  Abschnitt «Auslöser»: Er zeigt die Abläufe, die diese Szene
  starten, und legt auf Wunsch einen neuen an - vorbefüllt mit dem
  Schritt «Szene», den Rest (Zeit, Bewegung, Heimkommen) kann der
  Ablauf-Editor schon. Bewusst kein zweiter Auslöser-Editor: Es
  gibt einen, und zwei wachsen auseinander.
- **Szenen können sich nach einer Frist von selbst ausschalten.** Im
  Editor steht «Schaltet von selbst zurück» (Nie, 15/30 Min,
  1/2 Std) - der Sternenhimmel im Kinderzimmer soll nicht bis morgen
  leuchten, nur weil beim Einschlafen niemand mehr drückt. Nach der
  Frist geht alles *aus*, was die Szene verändert hat - bewusst
  nicht zurück in den vorherigen Zustand: «Vorher» ist nach einer
  Stunde kein Zustand mehr, den jemand zurückwill; der zweite Druck
  auf den Knopf stellt ihn weiterhin her, die Uhr nicht. Je Gerät
  der passende Aus-Befehl (aus, Pause, Stopp). Die Uhr läuft auf
  dem Hub, rechnet ab dem Auslösen und übersteht Neustarts; wer
  früher von Hand schaltet, ist schneller, und die Uhr tut nichts.
- **Welche Knöpfe auf der Raumkachel liegen, ist jetzt wählbar.** Im
  Blatt hinter dem langen Druck auf die Kachel (dort, wo auch das
  Foto gewählt wird) stehen neu Chips für Licht, Storen und Musik -
  angeboten wird nur, was der Raum hergibt. Die Wahl gilt wie das
  Bild für alle im Haus, und auch «gar keine Knöpfe» ist eine
  gültige Wahl. Ohne Wahl bleibt alles wie bisher.
- **«Terrasse steht offen» kommt nur noch einmal je Öffnung.** Die
  Mahnung war als «einmal je Öffnung» gedacht, aber ihr Merker lebte
  nur im Arbeitsspeicher - und jedes Update startet den Hub neu. Bei
  offener Türe kam die Nachricht darum nach jedem Neustart erneut.
  Der Merker liegt jetzt in hub.data und ist am Zeitpunkt der
  Öffnung verankert: Ein Neustart mahnt nicht mehr doppelt, eine
  neue Öffnung (zu, wieder auf, wieder lange offen) mahnt weiterhin.
- **Die Kacheln der Kamera-Zeitleiste zeigen jetzt die Aufnahme.**
  Bisher sagten sie nur «12:05, Person» - ansehen konnte man nichts.
  Ein Tipp öffnet jetzt die Aufnahme des Ereignisses als Video: Der
  Hub exportiert sie in dem Moment aus Protect (zwei Sekunden
  Vorlauf, mindestens sechs, höchstens neunzig Sekunden) und liefert
  sie mit Range-Unterstützung aus - ohne die spielt der iOS-Player
  gar nicht erst los. Kamera-Adresse und Zugangsdaten bleiben wie
  beim Live-Bild auf dem Hub. Antippbar sind die Kacheln nur, wenn
  die Integration Aufnahmen liefern kann.
- **Der Musik-Knopf der Raumkachel öffnet jetzt den Player.** Bisher
  schaltete er blind Play/Pause auf der Raumbox; für eine Playlist
  musste man auf die Startseite zurück und dort erst die Box wählen.
  Jetzt öffnet der Knopf denselben Player wie auf der Startseite als
  Blatt - mit der Box des Raums vorgewählt. Es ist bewusst derselbe
  Player (kein zweiter): Auch die Boxwahl-Regel, die Musik einmal
  auf der Terrasse statt im Büro hat spielen lassen, existiert
  weiterhin genau einmal (lib/boxwahl.ts). Das Knopf-Symbol ist neu
  eine Note statt Play/Pause - es verspricht kein Schalten mehr.
- **Die Storen-Kachel passt sich ihrer Breite an.** Auf der halben
  Telefonbreite brach «Beschattung» mitten im Wort, und das Fenster
  in voller Höhe machte die Kachel fast doppelt so hoch wie ihre
  Nachbarn. Jetzt misst die Kachel ihre Breite: Auf schmalen Kacheln
  wird die Chip-Schrift eine Stufe kleiner (und bleibt einzeilig),
  das Fenster niedriger. Auf dem iPad ändert sich nichts.
- **Durchsagen mit eigener Stimme kommen zurück - mit eigenem
  Aufnahmemodul.** Statt `expo-audio` (das die App beim Start
  anhielt) nimmt jetzt `modules/aufnahme` auf: rund 100 Zeilen Swift
  um den AVAudioRecorder, gebaut um genau eine Eigenschaft - beim
  App-Start läuft dort nichts, die Audio-Sitzung wird erst beim
  Druck auf den Aufnahmeknopf angefasst. Gleiche Aufnahme-Werte wie
  zuvor (AAC mono, 22 kHz, 48 kbit/s). Mit dem neuen Modul steigt
  die Laufzeit auf 4: Einmal TestFlight installieren, danach greift
  OTA wieder.
- **Der wortlose Schwarzstart ist gelöst: Es war `expo-audio`.** Die
  Diagnose-Fassung ohne das Paket lief auf Anhieb - damit ist es
  überführt. Sein nativer Teil fasst beim App-Start die AVAudioSession
  an; hängt das, zeichnet die App nie und kein Netz kann helfen. Mit
  eingeschalteten Updates machte expo-updates daraus zusätzlich einen
  sofortigen Abbruch - das waren die Abstürze vom 29. August. Das
  Paket bleibt draussen (Durchsagen mit eigener Stimme sind bis auf
  Weiteres abgeschaltet, Werkbank-Punkt 223), die OTA-Updates sind
  wieder eingeschaltet, und die Laufzeit bleibt bewusst auf 3: Das
  JavaScript braucht expo-audio nicht mehr und passt damit auf beide
  Baustände.
- **Diagnose-Fassung 1.4.11: ohne `expo-audio`.** Das Ausschluss-
  verfahren per ipa-Vergleich (laufender Build 29799716 gegen
  schwarzen Build 29801284) hat alles andere freigesprochen:
  identische Dateilisten, gleiches Manifest, Info.plist bis auf den
  Mikrofontext gleich, eigene Module beim Start untätig. Übrig
  bleibt als einzige native Änderung im Bruch-Fenster `expo-audio`.
  Diese Fassung nimmt es testweise ganz heraus; Durchsagen mit
  eigener Stimme sind darin abgeschaltet. Läuft sie, ist der Täter
  benannt und kommt kontrolliert zurück.
- **Der Start zeichnet zuerst und lädt danach.** In 1.4.9 blieb der
  Bildschirm schwarz, ohne dass der Startbericht erschien - der
  konnte gar nicht: Die App-Module wurden vor dem ersten Bild
  geladen, und ein Hängen dort liess auch die Wache nie zeichnen.
  Jetzt steht zuerst das Startbild («HomePilot startet …», mit den
  Etappen), und erst dann lädt `index.ts` die Module. Friert das
  Bild bei «Lade App-Module …» ein, hängt das Laden; bleibt der
  Bildschirm trotz allem schwarz, läuft nicht einmal JavaScript -
  dann liegt es am Bündel oder an der nativen Hülle.
- **Ein hängender Start erklärt sich selbst.** 1.4.8 hat gezeigt: Der
  schwarze Bildschirm ist kein Fehler, sondern ein Hängen - die App
  zeichnet nichts, solange Einstellungen oder Symbolschrift nicht
  geladen sind, und wenn eines davon nie fertig wird, gibt es nichts
  zu fangen. Jetzt meldet der Start jede Etappe (JavaScript läuft,
  Module geladen, Schrift, Einstellungen, bereit), und bleibt die
  Marke «bereit» sieben Sekunden aus, legt die Startwache einen
  Bericht über den Bildschirm: die erreichten Etappen mit Zeiten -
  die Etappe nach der letzten Zeile ist die, die hängt. Wird die App
  doch noch fertig, verschwindet der Bericht von selbst.
- **Ein geschluckter Startfehler zeigt sich jetzt, statt schwarz zu
  bleiben.** Der Messbuild 1.4.7 hat bewiesen: Der Absturz ist ein
  JavaScript-Fehler - ohne expo-updates stirbt der Prozess nicht mehr.
  Aber der globale Fang schrieb die Meldung nur in die Konsole, die
  ohne Mac niemand liest, und React blieb mitten im ersten Aufbau
  stehen: schwarzer Bildschirm. Jetzt meldet der Fang den Fehler an
  eine Startwache über der Wurzel, die den Notfallbildschirm mit der
  Meldung zeigt - und ein nativer Alert tut es zusätzlich, falls
  selbst das Zeichnen nicht mehr geht.
- **Die System-Seite zeigt, was beim Start schiefging.** Das Netz aus
  `lib/startfehler.tsx` hielt gestolperte Anweisungen zwar fest, aber
  gelesen hat sie niemand: Die Sammelstellen trugen «für die
  System-Seite» im Kommentar, und auf der System-Seite stand nichts
  davon. Jetzt steht es dort - im Normalfall gar nichts, und genau
  dann ist alles in Ordnung.
- **`updates.enabled` steht vorübergehend auf `false`.** Das ist eine
  Messung, keine Absicht: Der wortlose Absturz vom 29. August zeigt im
  Bericht nur die Ersatz-Ausnahme, die `expo-updates` selbst wirft,
  nachdem seine Rettungskette aufgegeben hat - den ursprünglichen
  Fehler trägt sie nicht mit. Ohne `expo-updates` wird ErrorRecovery
  gar nicht erst scharfgestellt (nachgelesen in `StartupProcedure`),
  und der Bericht zeigt den echten Stapel. **Nach dem Befund gehört
  die Zeile wieder heraus** - ohne sie gibt es keine OTA-Fassungen.
- **Der Start der App wartet nicht mehr auf das Netz.** In `app.json`
  stand `fallbackToCacheTimeout: 3000`: Bei jedem Öffnen hielt
  `expo-updates` die App bis zu drei Sekunden an, um nachzusehen, ob
  eine neue Fassung da ist. Jetzt steht dort `0` - die App startet
  sofort mit dem Stand, den sie hat, und lädt im Hintergrund. Das ist
  ohnehin, was die Meldung des Update-Skripts seit je verspricht
  («angewendet wird sie beim übernächsten Start»), und es nimmt dem
  Start ein Zeitfenster, in dem er von aussen scheitern kann.
- **Das Widget stürzte ab, sobald ein Zähler abgelaufen war.** Auf der
  Karte mit Countdown stand `Date()...Date(timeIntervalSince1970: endet)`.
  Ein `ClosedRange` verlangt, dass die obere Grenze nicht vor der
  unteren liegt - lag `endet` in der Vergangenheit, brach Swift den
  Prozess ab (`brk 1`), ohne Ausnahme und ohne Auffangmöglichkeit. Bei
  jedem Zeichnen erneut, bis iOS die Erweiterung drosselte; auf dem
  Sperrbildschirm blieb die Karte leer. Jetzt endet die Spanne im
  Jetzt und der Zähler steht auf 0:00 - was fachlich auch stimmt. Die
  Uhr machte es von Anfang an so (`targets/watch/App.swift`), das
  Widget als Einziges nicht.
- **Die OTA-Veröffentlichung läuft wieder.** Sie scheiterte seit vier
  Tagen bei jedem einzigen Lauf, und zwar an einer Zeile im
  Update-Skript: `app_abbild: command not found`. Der Block stand vor
  der Funktion, die er aufruft - die Bash kennt keine
  Vorwärtsdeklaration, also war die Funktion an dieser Stelle
  schlicht noch nicht da. Dazu lag er im Zweig «dieser Stand läuft
  schon» und blieb damit ausgerechnet dann aus, wenn es etwas Neues
  zu liefern gab. Beides ist behoben: Der Block steht jetzt hinter
  `app_abbild()` und ausserhalb der Abfrage. Das ist der Grund,
  warum die Telefone tagelang keine einzige Korrektur bekamen -
  nicht die Korrekturen selbst.
- **Eine gescheiterte OTA-Veröffentlichung nennt jetzt ihren Grund.**
  Sie scheiterte vier Tage lang bei jedem Update-Lauf, und das Skript
  schrieb dazu nur «Details: expo.dev» - den eigentlichen Fehler warf
  es weg. Auf dem Kanal lagen deshalb nur noch Fassungen einer alten
  Laufzeit (0.7.0), während die Telefone auf 3 liefen: Kein Gerät
  bekam mehr etwas, und niemandem fiel es auf. Jetzt landen die
  entscheidenden Zeilen im Log, und die Erfolgsmeldung nennt die
  Laufzeit mit - denn sie allein entscheidet, welche Builds eine
  Fassung überhaupt annehmen.
- **Jede Anweisung beim Start einzeln abgesichert.** In `App.tsx`
  laufen vier Dinge schon beim Laden des Moduls (Mitteilungs-Handler,
  Android-Kanäle, Mitteilungsknöpfe, die Ortungs-Aufgabe) - sie müssen
  dort stehen, weil sie fertig sein müssen, bevor die erste Nachricht
  eintrifft. Bisher nahm eine davon im Fehlerfall die ganze App mit.
  Jetzt hält jede ihren eigenen Fehler fest, und der Start geht weiter:
  im schlimmsten Fall fällt eine Nebensache aus statt des ganzen Hauses.
- **Ein Netz für Fehler beim Start.** Die App schloss sich am 29. August
  auf iPhone und Wandpanel wortlos, keine Sekunde nach dem Antippen. Im
  Absturzbericht stand als auslösende Queue
  `expo.controller.errorRecoveryQueue`: die Fehler-Rettung von
  `expo-updates`, die bei einem fatalen JS-Fehler beim Start greift und
  den Prozess abbricht, wenn sie nichts Heiles zum Nachladen findet.
  Der Fehler selbst stand nirgends - das `Auffangnetz` liegt *innerhalb*
  des Baums und fängt nur, was beim Zeichnen passiert; ein Release-Build
  zeigt keine rote Seite. Jetzt lädt `index.ts` die App in einem `try`,
  und ein globaler Fang nimmt fatale Fehler im Startfenster auf. Statt
  eines wortlosen Absturzes steht die Meldung samt Stapel auf dem
  Bildschirm. Nachgewiesen mit einem absichtlich eingebauten
  Startfehler.

- **Grundriss-Ansicht** (Punkt 222): Die Räume-Seite kann zuoberst ein
  Foto des Wohnungsplans zeigen, darauf die Geräte als antippbare
  Punkte – antippen schaltet, der Zustand färbt den Punkt.
  Einschaltbar je Gerät in den Einstellungen beim App-Symbol (das
  Wandpanel will den Plan, das Telefon die Kacheln); Bild und Punkte
  liegen auf dem Hub und gelten für alle. Platziert wird mit zwei
  Tipps statt mit Ziehen – die Geste, die auf iOS zweimal getäuscht
  hat, kommt hier gar nicht erst vor.

**Betrieb**

- **`main` ist der Zweig, der im Haus läuft.** Alle Arbeitszweige sind
  zusammengeführt, und der Update-Knopf baut jetzt `main` statt eines
  `claude/…`-Zweigs. Ein Arbeitszweig heisst nach der Arbeit, die
  einmal darauf lag – ist sie erledigt, zieht die nächste woanders hin,
  und der Knopf baut weiter den alten Namen. Genau diese Falle steht
  schon zweimal in dieser Datei; `main` heisst nach nichts und bleibt
  deshalb richtig. **Der Portainer-Stack muss einmal von Hand auf
  `refs/heads/main` umgestellt werden** – sonst klont er weiter den
  alten Zweig (siehe `deploy/portainer.md`).
- Küchen-Timer überleben den Neustart. Der Update-Knopf wird gern
  abends gedrückt – genau dann, wenn etwas im Ofen ist, und der Wecker
  starb mit dem Hub. Ein während des Neustarts abgelaufener Timer
  meldet sich sofort nach, mit dem Hinweis «verspätet»; was älter als
  eine Stunde ist, wird verworfen.
- Der Android-Build ist vorbereitet (`docs/android.md`): Das
  Produktionsprofil baut eine direkt installierbare APK, der
  Firebase-Weg für Push ist dokumentiert statt geraten, und die
  `google-services.json` steht vorsorglich in der `.gitignore`.
  Kanäle, Symbole und Hintergrund-Ortung lagen schon bereit.
- Die Werkbank-Liste steht jetzt im Repo (`docs/werkbank.md`): alle
  221 Punkte aus den vier Werkbank-Seiten, mit Begründungen und
  Fundstellen. Bisher lag sie ausserhalb – wer im Code auf
  «Punkt 155 der Werkbank» stiess, konnte nicht nachschlagen.
- Drei Testlücken geschlossen (65 neue Tests): `test_say.py` war eine
  leere Datei – die Durchsagen-Logik (Vorrat, Piper, gTTS-Rückfall) ist
  jetzt abgedeckt; die Homematic-Kanal-Logik (welcher Kanal schaltet,
  was ein CCU-Wert bedeutet) und die Einmal-Türöffnung (Gültigkeit,
  ununterscheidbare Fehlwege) haben erstmals eigene Tests.
- Ziehen und Ordnen (Räume, Favoriten, Familienmodule, Kacheln): die
  Geste wird jetzt in der Erfassungsphase beansprucht, die ganze Zeile
  ist Greiffläche, und das Blatt scrollt nicht mit, solange etwas am
  Finger hängt. Der Browser konnte diesen Fehler nie zeigen – auf iOS
  nahm der native ScrollView die Geste, bevor der Griff gefragt wurde.

## 2026-08-27

**iPhone**

- **Sechs weitere Live-Karten auf dem Sperrbildschirm** - alle auf
  einem gemeinsamen Fundament (eine generische Karte, deren Inhalt der
  Hub bestimmt; eine neue Kartenart ist damit reiner Hub-Code):
  **Küchen-Timer** mit laufendem Countdown, **Waschmaschine und
  Geschirrspüler** mit Programm und Restzeit (am Ende bleibt kurz
  «Fertig - ausräumen» stehen), der **Grill** mit Ist- gegen
  Zieltemperatur samt Fortschrittsbalken, der **Saugroboter** mit
  Fläche und Akku, **fällige Erinnerungen** (verschwinden je Person,
  sobald sie bestätigt hat - dieselben Regeln wie das Vollbild) und
  die **Alarmanlage**: Countdown während der Scharfschalt-Verzögerung,
  Rot bei ausgelöstem Alarm. «Scharf» selbst bekommt bewusst keine
  Karte - eine Nacht ist länger als die zwölf Stunden, die iOS einer
  Live-Aktivität gibt. Countdowns zählen auf dem Telefon selbst,
  Updates (etwa die Grill-Temperatur) sind auf eine je 45 Sekunden
  gedrosselt - Apple deckelt das Budget ohnehin. Der Schalter im
  Profil heisst jetzt «Live-Aktivitäten» und gilt für alle Karten.
- **Jede Kartenart lässt sich einzeln abwählen.** Unter dem grossen
  Schalter stehen die sieben Karten mit eigenen Schaltern - nach dem
  Modell der Benachrichtigungen: abbestellen statt bestellen, damit
  eine künftige neue Kartenart erst einmal ankommt, statt unbemerkt zu
  fehlen. Gilt je Person auf allen ihren iPhones; der Hub setzt es
  durch, und eine gerade liegende Karte der abbestellten Art endet in
  derselben Runde.

- **Wer das Haus verlässt, bekommt die Haustüre auf den
  Sperrbildschirm** - als Live-Aktivität: eine kleine Karte «Unterwegs -
  Haustüre im Schnellzugriff», die beim Weggehen erscheint und beim
  Heimkommen von selbst verschwindet. Ein Tipp auf «Öffnen» führt in
  die App direkt zur Türe, mit der gewohnten Rückfrage - ein Knopf auf
  dem Sperrbildschirm darf nicht mehr als die App, dieselbe
  Entscheidung wie beim Türknopf im Widget.
- Gestartet wird die Karte vom **Hub**, nicht von der App: Im Moment
  des Weggehens läuft die App nicht im Vordergrund, und nur dort dürfte
  sie eine Live-Aktivität selbst aufstellen. Also schickt der Hub einen
  direkten Apple-Push («push-to-start», ab iOS 17.2) - dafür braucht er
  einmalig einen APNs-Schlüssel aus dem Entwicklerkonto (Anleitung in
  deploy/portainer.md, Block `apns:` in der config.yaml). Ohne den
  Block bleibt alles aus.
- **Ein Schalter im Profil** (Einstellungen → Konto, neben den
  Benachrichtigungen): «Haustüre als Live-Aktivität» lässt sich je
  Person ein- und ausschalten - auf allen eigenen iPhones zugleich, und
  der Hub hält sich sofort daran: Abschalten beendet auch eine gerade
  liegende Karte, nicht erst beim nächsten Heimkommen. Ist der Hub noch
  nicht eingerichtet, sagt es die Karte dazu, statt still nichts zu tun.
- Dazu gehört ein neuer nativer Baustein in der App (ActivityKit).
  Er wird erst mit dem nächsten TestFlight-Build wirksam; bis dahin
  ändert sich auf den Telefonen nichts, und alle bisherigen Updates
  kommen weiter an - die runtimeVersion bleibt deshalb absichtlich
  stehen, die App prüft den Baustein zur Laufzeit.

**Abläufe**

- **Die Auslöser-Diagnose unterscheidet «kaputt» von «hatte nichts zu
  melden».** Bei «wenn niemand mehr zuhause ist» stand als orange
  Warnung: «geofence.anyone_home hat sich noch nie gemeldet - stimmt
  die Kennung, ist das Gerät erreichbar?» Dabei war alles in Ordnung:
  Die Sammel-Entität meldet nur echte Wechsel, und solange seit dem
  Hub-Start niemand ging oder kam, herrscht zu Recht Stille. Jetzt
  sagt die Diagnose in diesem Fall ruhig: «ist da und steht auf ‹on› -
  seit dem Hub-Start gab es nur noch keinen Wechsel. Der Auslöser
  feuert beim nächsten.» Die Warnung bleibt für den Fall, für den sie
  gedacht war: eine Kennung, die ins Leere zeigt, oder ein Gerät, das
  nicht erreichbar ist.

**Familie**

- **Erinnerungen lassen sich bearbeiten.** Der Stift auf der Zeile
  füllt das Formular unten mit dem Eintrag - Text, Datum, Uhrzeit,
  Wiederholung, die beiden Schalter und die Push-Empfänger stehen
  darin und lassen sich ändern; «Änderungen speichern» schreibt in
  denselben Eintrag zurück, «Abbrechen» verwirft. Vorher blieb nur
  Löschen und neu Anlegen. Eine bearbeitete Erinnerung gilt als frisch
  aufgesetzt: Ein schon verschickter Push und die «schon
  gesehen»-Vermerke gehörten zum alten Termin - wer die Zeit
  verschiebt, will wieder gemeldet werden.
- **Erinnerungen können sich wiederholen** - täglich, wöchentlich,
  monatlich oder jährlich, gewählt über dieselben Chips wie bei den
  Aufgaben. Eine wiederkehrende Erinnerung wird beim Bestätigen nicht
  erledigt, sondern auf den nächsten Termin weitergestellt - frisch:
  Niemand hat die neue schon weggedrückt, der nächste Push geht wieder
  raus. Eine reine Push-Erinnerung stellt der Hub nach dem Versand
  selbst weiter. Verpasste Termine werden übersprungen, nicht
  nachgeholt: Wer die Dienstags-Erinnerung erst am Freitag bestätigt,
  bekommt die vom nächsten Dienstag - nicht drei auf einmal. Und der
  Kalender stimmt: Die Erinnerung vom 31. rutscht im kurzen Monat auf
  dessen letzten Tag und kehrt danach auf den 31. zurück; 7 Uhr bleibt
  7 Uhr, auch über die Zeitumstellung.

**Profil**

- **Der Name im Profil ist jetzt der Benutzername.** Das Feld hiess
  «Dein Name (für die Begrüssung)» und lebte nur im Gerät - die
  Benutzerverwaltung zeigte weiter den alten Namen, und niemand
  wusste, welcher gilt. Jetzt benennt «Speichern & verbinden» den
  Hub-Benutzer um: Der neue Name steht sofort in der
  Benutzerverwaltung, in der Anwesenheit und bei den Push-Empfängern;
  Geräte-Anmeldungen, Abbestellungen und offene Erinnerungen ziehen
  mit um. Token und Rechte bleiben unverändert. Wer in der config.yaml
  steht, bekommt den Hinweis, den Namen dort zu ändern; Gäste benennt
  weiterhin, wer sie eingeladen hat. Am Wandpanel bleibt das Feld die
  Anrede des Panels («Küche») und fasst keinen Benutzer an.

**Anwesenheit**

- **«Jemand/niemand zuhause» zählt nur noch den Haushalt.** Der
  Life360-Kreis ortet auch Menschen, die hier nicht wohnen - deren
  Zuhause ist ein anderes. Bisher zählten ihre Zonen mit, und «niemand
  ist zuhause» wäre erst wahr geworden, wenn auch die Oma ihr eigenes
  Haus verlässt: Der Saug-Ablauf mit genau diesem Auslöser feuerte
  deshalb nie. Jetzt zählen die Zonen, hinter denen ein Benutzer des
  Hubs steht; wer eine weitere Zone mitzählen will, nennt sie in der
  config.yaml unter `geofence → haushalt: [kennung]`. Findet sich gar
  kein Haushalt, zählen zur Sicherheit wie bisher alle.
- **Wer nicht ausdrücklich zuhause ist, zählt als weg** - auch
  «unbekannt». Vorher hielt ein einziges stummes Telefon die Frage auf
  «jemand da», und der Ablauf wartete einen ganzen Tag umsonst. Die
  eine Ausnahme bleibt: Weiss der Hub von niemandem etwas (frisch
  gestartet, noch keine Meldung), bleibt es bei «jemand da» - sonst
  liefe nach jeder Auslieferung «alles aus», während die Familie am
  Tisch sitzt. Das Gleiche gilt fürs Schild «alle sind zuhause»: Es
  urteilt jetzt über den Haushalt, nicht über den ganzen Kreis.

## 2026-08-25

**Raumkacheln mit Foto**

- Die Seite «Räume» zeigt je Zimmer ein Bild statt einer Geräteliste. Man
  erkennt den Raum, bevor man den Namen liest. Darunter eine Zeile
  Zustand («21,3° · 47 % · 3 an») und höchstens drei Knöpfe für das, was
  man im Vorbeigehen tut: Licht, Storen, Musik. Jeder schaltet alles
  seiner Art im Raum – «Licht» meint die drei Lampen, nicht eine davon.
- Das Foto wählt man mit einem langen Druck auf die Kachel: aufnehmen
  oder aus den Fotos. Es gilt für alle im Haus; setzen darf es, wer hier
  wohnt (dieselbe Regel wie beim Namen eines Geräts), ein Gast nicht.
- **Ohne Foto ist die Kachel nicht kaputt**: Sie bekommt eine Farbe aus
  dem Namen des Zimmers und dessen Symbol – dasselbe Zimmer immer
  dieselbe Farbe. Ein graues «kein Bild» wäre genau der Fehler, den die
  neue Kachel vermeiden soll.
- **Was dabei weggeht, mit offenen Augen:** Aus der Übersicht lässt sich
  kein einzelnes Gerät mehr schalten. Wer die eine Lampe meint, öffnet
  den Raum – dort steht alles wie bisher. Dafür sind alle Kacheln gleich
  hoch, und das «+ 3 weitere …» ist verschwunden.
- Die Bilder liegen als Dateien neben der `homepilot-data.json`, nicht
  darin: Die wird bei jeder Änderung ganz geschrieben, ein halbes Dutzend
  Fotos hätten daraus einen Vorgang von Sekunden gemacht. Wird ein
  Zimmer umbenannt oder gelöscht, räumt der Hub sein Bild beim nächsten
  Start weg.

**Zimmer**

- Wetter und die Musik des Hauses stehen nicht mehr in der Spalte neben
  einem offenen Zimmer. Wer «Küche» öffnet, will die Küche sehen – und
  bekam daneben das Wetter von Zell und die Box, die im Wohnzimmer
  spielt. Auf dem Telefon schob beides die Lampen unter den Rand.
- Was bleibt: die Box **dieses** Raums – jetzt auch dann, wenn sie
  zugleich die spielende des Hauses ist; vorher wäre sie mit der grossen
  Karte verschwunden. Und die Wetterwarnung: Sie wegzuräumen, weil man
  gerade in einem Zimmer steht, hiesse sie genau dann zu verstecken, wenn
  man hinschaut.
- Bleibt nichts übrig, verschwindet die Spalte ganz, statt ihre 340
  Punkte für nichts zu beanspruchen. Die Raumübersicht («Alle») und die
  Startseite bleiben, wie sie waren.

**Haustüre**

- Die Rückfrage vor dem Öffnen («Wirklich öffnen?») lässt sich abstellen.
  Sie war fest eingebaut – richtig gegen den Ellbogen am Wandpanel, aber
  mit zwei Händen voll Einkauf ein Tipp zu viel, und der erste verfällt
  nach vier Sekunden. Der Schalter steht unter *Einstellungen → Konto &
  Verbindung* und gilt fürs ganze Haus: Eine Türe, die am Panel nachfragt
  und auf dem Telefon nicht, wäre keine Regel, sondern ein Ratespiel.
  Ändern darf ihn nur die Besitzerin.
- Abgestellt wird nur das **Öffnen**, an allen Stellen zugleich: Kachel,
  Übersichtskachel und der Bildschirm, der beim Klingeln aufgeht.
  Aufschliessen behält seine Rückfrage, ebenso ein einzeln gesperrtes
  Gerät und die Face-ID-Hürde. Der Türknopf im Widget fragt weiterhin
  immer – ein Knopf auf dem Sperrbildschirm soll nicht mehr dürfen als
  die App.

**Kacheln umbenennen**

- Ein langer Druck auf eine Kachel benennt sie um. Vorher führte der Weg
  über den Anpassen-Modus: Knopf oben, Stift auf der Kachel, tippen,
  speichern, Modus verlassen. Wo auf derselben Geste schon der Verlauf
  liegt, fragt eine kleine Auswahl; sonst geht es direkt.
- Der Name gilt für alle im Haus, und darum darf ihn nur die Besitzerin
  setzen. Bisher zeigte der Anpassen-Modus den Stift jedem – ein
  Mitbewohner tippte einen Namen ein und bekam ein «nicht erlaubt».

**Musik**

- Ein Tipp auf einen Titel in «was als Nächstes kommt» spielt ihn. Vorher
  liess sich die Liste nur lesen, und wer den dritten Titel wollte,
  tippte zweimal auf «Weiter» – beim vierten wusste man nicht mehr, wie
  oft. Die Playlist läuft danach normal weiter.

**Diagnose und Update**

- Life360 sagt in der Integrationsliste, wie viele Personen gemeldet
  haben und wer im Kreis gar nicht gefunden wurde. Vorher stand dort «0
  Geräte» – wahr, weil die Personen dem Geofence gehören, und trotzdem
  die falsche Auskunft.
- Der Pit-Boss-Grill kam gar nicht mehr an: Die Integration las die
  Bauart des Grills, bevor `pytboss` sie kennt, und stand mit einer
  Fehlermeldung statt mit einem Grill da.
- «Durchgelaufen, aber mit Hinweisen» steht nach einem Update nicht mehr
  in Rot – der Lauf ist ja durchgelaufen. Und der Hinweis von `eas build`
  über Expo Go steht gar nicht mehr dort: Er handelt von der
  App-Entwicklung, nicht vom Update.


**Ziehen und Ordnen**

- Räume ordnen, Favoriten ordnen und das Ziehen der Kacheln selbst
  funktionieren wieder. Alle drei hingen am selben Fehler: Der
  Ziehgriff wurde bei jeder Fingerbewegung neu aufgebaut und verlor
  dabei den Startpunkt der Geste. Gemeldet wurde deshalb nie der ganze
  Weg, sondern die letzten paar Punkte – wer eine Zeile zweihundert
  Punkte weit zog, verschob sie um zwölf, und beim Loslassen war das
  Ziel dieselbe Stelle.
- Im Browser gewinnt jetzt auch in der Liste der Griff und nicht die
  Wisch-Geste der Seite; für das Kachelraster galt das schon.

## 2026-08-24

**Haushaltsgeräte**

- Waschmaschine und Geschirrspüler standen als «unknown» da, sobald sie
  schliefen. V-ZUG-Geräte antworten im Standby mit einem 503 – der Hub
  wertet das zu Recht nicht als Ausfall, schrieb dabei aber nie einen
  Zustand. Weil die Maschinen fast immer schlafen und der Hub bei jedem
  Bauen neu startet, blieb der Platzhalter aus dem Start oft stundenlang
  stehen, und die Kachel gab ihn roh aus: das englische Wort unter
  «Waschmaschine».
- Jetzt steht dort **Standby**. Ausdrücklich nicht «Bereit»: Ob die
  Maschine ausgeräumt ist, weiss im Standby niemand – und hätte der Hub
  «fertig» geschrieben, hätte der Wächter daraus einen Programmlauf im
  Protokoll gemacht und irgendwann ein «ist noch voll» über eine
  Maschine geschickt, die seit Tagen leer dasteht. Eine echte Meldung
  von vorhin bleibt unangetastet.
- Übersichtskachel, Raumkachel und Gerätekarte sagen dasselbe Wort.
  Bisher entschied jede für sich zwischen «Läuft» und sonst «Bereit» –
  dasselbe Gerät stand damit an einer Stelle als «Standby» und an der
  anderen als «Bereit».

**Familie**

- **Neue Kachel «Erinnerungen»** (unter Alltag): ein Text, ein Datum,
  eine Uhrzeit - zur eingestellten Zeit erscheint die Erinnerung
  **gross auf jedem offenen Bildschirm** und bleibt stehen, bis jemand
  auf «Erledigt» drückt. Kein Wegwischen: Sie verschwindet nur über die
  Bestätigung, und die gilt für alle Bildschirme zugleich - auch fürs
  Wandpanel. Eine Erinnerung verfällt nicht von selbst; wer das Display
  erst abends sieht, findet die von mittags noch vor.
- Datum und Uhrzeit sind **Wähler statt Tippfelder**: ein Monatsraster
  (heute umrandet, Blättern über Pfeile) und zwei Spalten für Stunde
  und Minute. «26.08.2026» fehlerfrei einzutippen bringt am Wandpanel
  niemand zustande - und ein Vertipper hiess: die Erinnerung kommt nie.
  Vorgabe ist die nächste volle Stunde heute.
- **Eine Erinnerung kann auch als Push kommen.** Zwei Schalter im
  Formular: *Gross am Bildschirm anzeigen* (die Vorgabe - verschwindet
  überall, sobald die erste Person bestätigt) und *Push-Nachricht
  senden*. Beim zweiten wählt man aus, **an wen** - Mehrfachauswahl über
  die Haushaltsmitglieder, ohne Empfänger geht der Knopf nicht. Den
  Versand übernimmt der Hub zur eingestellten Zeit, die App muss dafür
  nicht offen sein; jede Erinnerung wird genau einmal verschickt, auch
  über einen Neustart hinweg. Eine reine Push-Erinnerung (Bildschirm
  aus) gilt nach dem Versand als erledigt - es gäbe keinen Bildschirm,
  auf dem sie jemand bestätigen könnte. In der Liste steht dabei, wer
  den Push bekommt.
- **Das Vollbild hat jetzt zwei Knöpfe: «Erledigt» und «Für alle
  erledigt».** «Für alle erledigt» räumt die Erinnerung überall ab -
  das war bisher der einzige Weg. «Erledigt» blendet sie nur beim
  Drückenden aus: Wer die Wäsche gesehen hat und weiss, dass er gleich
  geht, muss sie den anderen nicht wegnehmen - bei denen bleibt sie
  stehen, bis jemand für alle bestätigt. Das «schon gesehen» liegt beim
  Hub, überlebt also einen Neustart der App und gilt auf allen eigenen
  Geräten; ein kleiner Hinweis unter den Knöpfen erklärt den
  Unterschied direkt dort, wo man ihn braucht.

**Startseite und Musik**

- **Die Durchsage-Sätze lassen sich pflegen.** Der Stift im
  Durchsage-Fenster öffnet das Bearbeiten: eigene Sätze anlegen,
  umformulieren, löschen (bis zwölf). Die mitgelieferten bleiben aussen
  vor - gelöscht wären sie beim nächsten Update kommentarlos wieder da.
- Selbst Getipptes merkt sich die App nur noch **als genau einen Satz**,
  den letzten - und der lässt sich im Bearbeiten wieder anfassen.
  Vorher sammelten sich vier automatisch gemerkte an, die niemand
  wieder loswurde: nicht bearbeitbar, nicht löschbar, nur verdrängbar.

- **Durchsagen spielen auf 70 %**, wenn niemand eine Lautstärke nennt -
  vorher kam die Ansage so laut, wie die Box gerade stand: nach leiser
  Abendmusik ein Flüstern, nach einer Party ein Schreck. Die Box stellt
  die Lautstärke direkt vor der Ansage und danach wieder auf vorher
  zurück.
- **Nach der Durchsage spielt das Radio seinen Sender weiter.** Es
  verliert während der Ansage seinen Anspruch auf die Box und vergass
  dabei, was lief - ein blosses «weiter» spielte danach den ersten
  Sender der Liste. Der Hub merkt sich den Sender jetzt mit und stimmt
  ihn gezielt wieder an; bei Spotify genügt das «weiter» wie bisher.

- **Die gewählte Box gilt jetzt auch beim Abspielen.** Oben «Büro»
  wählen und eine Playlist starten liess die Musik auf der zuletzt
  aktiven Box weiterspielen - der Umzug bleibt bei stillem Spotify
  nicht haften, und der Startbefehl nannte kein Gerät. Die Wahl reist
  jetzt bis zum Start mit und wird dort ausdrücklich genannt; der Hub
  weckt die Box notfalls und bricht lieber ab, als im falschen Zimmer
  zu spielen. Gilt für Spotify und Radio.
- **Radiosender zeigen ihr Logo wieder.** Ein Sender, der schon eine
  TuneIn-Kennung trug (früh gespeichert, bevor Bilder mitkamen), wurde
  beim Abspielen nie mehr aufgelöst - sein Logo kam deshalb nie nach.
  Der Hub holt es jetzt beim ersten Abspielen nach, höchstens eine
  Anfrage je Sender, und nur bei übereinstimmender Kennung: Der eigene
  Icecast im Keller bekommt kein fremdes Logo angeheftet.
- **Der Update-Knopf versorgt jetzt auch die Telefone.** Bisher tauschte
  er nur die Web-Fassung; die iPhones bekamen neuen Code erst mit dem
  nächsten TestFlight-Build - und blieben sonst stumm auf Wochen altem
  Stand, bei gleicher Versionsnummer. Jeder Lauf veröffentlicht jetzt
  eine OTA-Fassung über EAS (sofern EXPO_TOKEN hinterlegt ist).
  Erreicht werden Builds mit derselben runtimeVersion; ältere brauchen
  einmal TestFlight, danach greift OTA wieder.

- Steht oben statt «jemand da» jetzt **«alle sind zuhause»**, wenn der
  Hub es von jedem Einzelnen weiss. Ein verstummtes Telefon macht daraus
  wieder das vorsichtige «jemand da» - über jemanden, von dem man nichts
  weiss, behauptet man kein «alle».
- Ein **langer Druck auf eine Favoriten-Kachel** öffnet das Umbenennen -
  bisher ging das dort gar nicht, auch nicht als Besitzer: Die Favoriten
  sind eigene Chips, und die kannten keinen langen Druck.
- **Umbenennen, Raum und Gruppe stehen jetzt auch Mitbewohnern zu**
  (neue Fähigkeit `edit_devices`), ebenso der «Anpassen»-Knopf unter
  Geräte. Ein Name, den alle täglich lesen, darf von allen stammen, die
  hier wohnen - Gäste weiterhin nicht.
- Die Boxen-Liste im Musikplayer ist eine ruhige Spalte statt Chips im
  Flattersatz: alphabetisch, die gewählte Box mit Häkchen, wo Musik
  läuft, sagt es das Symbol. «Zufall» und «Wiederholen» sind dezenter -
  aktiv heisst Akzent-Kante und -Schrift statt satter Füllung.

**Einstellungen**

- Die Kacheln sind gruppiert statt in einer langen Mischliste: zuoberst
  die Suche, dann **Haus** (Geräte, Abläufe, Alarmanlage, Lautsprecher,
  Energie), **Personen** (Familie und Freunde, Benutzerverwaltung),
  **Dieses Gerät** (Konto & Verbindung, Widgets) und zuunterst **Hub**
  (System, Zuletzt passiert). Vorher trennte das halbe Haus die
  Benutzerverwaltung von «Konto & Verbindung», obwohl beide von
  Zugängen handeln.
- «Konto & Verbindung» ist in vier Karten geteilt: Profil (Name,
  Abmelden), Erscheinungsbild (samt Wandpanel-Modus), Ortung und die
  Hub-Verbindung. Wer verbunden ist, findet die Zugangsdaten zuunterst –
  beim Einrichten stehen sie zuoberst, denn dann sind sie das Einzige,
  was zählt.

**Ortung**

- Wer nach Hause kam, blieb «unterwegs». Die App meldete bisher nur
  Grenzübertritte, und eine Meldung, die nicht ankommt, war für immer
  weg. Beim Ankommen trifft sie genau das Loch zwischen Mobilfunk und
  WLAN – der Hub steht im Heimnetz, das Telefon hängt beim Kreuzen der
  Grenze noch am Funkmast. Danach stand man bis zum nächsten Weggehen
  falsch da, und jeder Ablauf an der Ankunft lief nie.
- Die App meldet jetzt **laufend, sobald sie sich bewegt hat** – nach
  fünfzig Metern, nicht nach einer Uhr. Wer stillsteht, erzeugt nichts
  und verbraucht nichts. Gemeldet wird die Position, nicht mehr «ich
  habe eine Grenze gekreuzt»: Der Hub rechnet selbst, in welchen Orten
  jemand steckt. Damit rückt jede einzelne Meldung gerade, was von einer
  früheren fehlt.
- Was nicht durchkommt, wird aufgehoben und beim nächsten Anlass
  nachgereicht. Nachgereichtes kann nichts Neueres überschreiben – jede
  Meldung trägt den Zeitpunkt ihrer Messung mit.
- Die Zonenüberwachung bleibt daneben: Sie meldet den Übertritt scharf
  und sofort und kostet fast nichts.
- Holt man die App aus dem App-Switcher, meldet sie wieder. Bisher tat
  sie das nur beim Starten – und aus dem Switcher startet nichts. Das
  war der letzte Weg, auf dem sich ein verlorener Übertritt noch von
  selbst hätte richten können, und er war zu.
- Die Diagnose unter *System* sagt nicht mehr «Meldet sich regelmässig»
  zu einer Position von vorgestern. «Wann hat sich etwas geändert» und
  «wann kam zuletzt etwas an» waren dasselbe Feld; weil Life360 im
  Minutentakt meldet, sah alles immer frisch aus. Damit konnte auch das
  Sicherheitsnetz nie greifen, das ein eingefrorenes «weg» nach zwölf
  Stunden auf «unbekannt» stellt – und daran hängt, dass «alles aus»
  nicht läuft, während jemand im Haus ist.
- Nachtrag am selben Tag, zwei Fehler in der Reparatur selbst: Die App
  hatte eine Sperre, die gar nichts meldete, wenn die Messung gröber war
  als der halbe Radius des engsten Ortes. Drinnen sind 60 bis 100 Meter
  normal, und ein einziger erfasster Laden mit 50 Metern zieht die
  Schranke auf 25 – im eigenen Wohnzimmer meldete die App also nie. Die
  Streuung reist jetzt mit und wird beim Hub je Ort verrechnet, wo alle
  Orte bekannt sind. Und die laufende Aktualisierung meldete sich nur
  an, wenn jemand den Schalter anfasste; wer ihn seit dem Update in Ruhe
  liess, lief weiter bloss auf Grenzübertritten. Sie meldet sich jetzt
  bei jedem App-Start an.
- Der Erlaubnistext auf dem Telefon sagt jetzt, was wirklich passiert.
  Dort stand «kein laufender Standort», und das stimmt nicht mehr.
  **Dafür braucht es einen neuen Build, kein OTA.**

**Radio**

- Ein Sender liess sich antippen, und es passierte nichts – wenn der Hub
  keine Box kennt, die eine Tonadresse abspielen kann. Die Karte sah
  dabei völlig normal aus: Der Satz, der es erklärt, stand in der
  Boxenzeile, und die ist auf der Startseite ausgeblendet. Jetzt steht
  er dort, wo man ihn braucht – auf der Karte und im Senderfenster – und
  unterscheidet «gar keine Box gefunden» von «keine, die es kann».
- Hängt das einzige Cast-Gerät am Fernseher, spielt das Radio jetzt
  darauf, statt gar nicht. Fernseher bleiben zweite Wahl: Gibt es eine
  richtige Box, steht der Fernseher weiterhin nicht in der Liste.

**Startseite**

- Die Favoritenkacheln stehen auf jedem iPhone nebeneinander statt zu
  zweit oben und einer darunter. Sie waren als Einzige so breit wie ihr
  Inhalt – drei Zimmernamen ergeben zusammen mehr, als ein iPhone
  hergibt. Jetzt teilen sie sich die Reihe wie jedes andere Raster. Das
  Symbol steht über dem Namen statt daneben; daneben frass es die
  Breite, die «Wohnzimmer» braucht. Auf einem alten 320er bleiben es
  zwei Spalten – drei wären dort Kürzel statt Namen.

**Batteriewarnung**

- «Batterie schwach» kommt nicht mehr immer wieder. Der Merker, was schon
  gemeldet wurde, lag im Arbeitsspeicher und war nach jedem Neustart des
  Hubs weg – bei einer Batterie, die wochenlang schwach ist, hiess das:
  nach jedem Update dieselbe Meldung. Er liegt jetzt auf der Platte.
- Er fällt auch nicht mehr weg, wenn ein Funksensor sich neu anmeldet und
  einen Moment ohne Batterieangabe dasteht. Vergessen wird nur, wenn ein
  Gerät ausdrücklich «Batterie in Ordnung» meldet.
- Ein Tipp auf die Meldung führt direkt auf die Geräteseite mit
  aufgeklappter Batterienliste.
- Dort lässt sich jede Warnung quittieren: **bis morgen** stumm. Das ist
  ein Aufschub, kein Ausschalten – ist die Batterie morgen früh noch
  schwach, erinnert der Hub noch einmal.

**Erscheinungsbild**

- «Pink» heisst jetzt «Neonpink» und ist, was der Name sagt: schwarzer
  Grund, neonpinker Akzent, eine feine pinke Kante um jede Kachel.
  Zweimal lag es vorher daneben, und beide Male am selben Punkt – der
  Grund hatte eine Farbe (erst Aubergine, dann Weinrot), und die liest
  sich als Violett bzw. Kastanie. Das Pink kommt jetzt von dem, was auf
  dem Schwarz liegt, nicht vom Schwarz selbst.
- Die Beschriftung der gefüllten Knöpfe («Speichern & verbinden», die
  Primärknöpfe unter System) war in allen dunklen Erscheinungsbildern
  weiss auf Weiss und damit unsichtbar. Sie ist jetzt dunkel.

**Startseite**

- Im Musikplayer lassen sich Quelle und Box getrennt wählen: oben zwei
  Chips für Spotify und Radio, daneben der Wähler für die Box. Vorher
  steckte beides in einer Liste namens «Lautsprecher wählen», und die
  Quelle war weder benannt noch ohne Aufklappen zu sehen. Die Box gilt
  jetzt auch fürs Radio – vorher zog derselbe Wähler immer Spotify um.

- Der Musikplayer in der rechten Spalte zeigt keine Fernseher mehr –
  weder in der Boxenwahl noch als Karte, wenn dort gerade ein Film
  läuft. Ein Cast-fähiger Fernseher kennt weder Steuerkreuz noch
  App-Start und sah für den Hub aus wie ein Lautsprecher; jetzt sagt das
  Gerät selbst, dass ein Bild an ihm hängt. Aus demselben Grund
  verschwindet er aus der «Abspielen auf»-Zeile von Spotify und aus der
  Boxenliste des Radios.

**Radio**

- Neue Integration `tunein`: Internetradio auf den Boxen im Haus. Sie
  erscheint als Player «Radio» in der Musikkarte – dort, wo bisher nur
  Spotify stand.
- Sender lassen sich in der App suchen und merken: Was TuneIn zur
  Eingabe findet, steht unter der eigenen Liste; ein Tipp darauf spielt
  den Sender *und* behält ihn. Feste Sender gehen weiterhin über die
  config.yaml, auch mit eigener Adresse für den Icecast im Keller.
- Radio geht auch in **Szenen und Abläufe**: Der Chip «Sender» wählt den
  Sender und die Box – «Küche morgens: SRF 3 auf der Küchenbox».
- Gespielt wird auf einem Lautsprecher, der eine Tonadresse abspielen
  kann (Chromecast, Google Home). Startet dort jemand Spotify, gibt das
  Radio die Box frei, statt weiter «läuft» zu behaupten.

**Ortung**

- **Die gespeicherten Orte von Life360 sind jetzt Orte des Hubs.** Der
  Hub holt sie einmal je Stunde beim Kreis ab und rechnet den Übertritt
  danach selbst, aus Koordinaten und Radius. Damit stehen sie in
  Abläufen zur Auswahl: Der Auslöser *Ort* fragt jetzt nach Person,
  Richtung **und** Ort – «wenn Livia bei der Schule ankommt», «wenn
  Sandra die Arbeit verlässt». Vorher kannte der Hub einen solchen Ort
  erst, wenn jemand darin stand; für die Anzeige genügte das, für einen
  Ablauf nicht.
- **Eine Quelle je Person, und der Hub setzt es durch.** Wer bei Life360
  unter `members` steht, wird von dort geführt – jede andere Meldung für
  diese Person wird überhört. Vorher gewann, wer zuletzt sprach: Life360
  meldete «zuhause», ein vergessener Ortungs-Schalter auf einem Telefon
  schob «weg» nach, und auf dem Schirm stand «unterwegs», während die
  Person in der Küche sass. Das war die Ursache hinter «ich bin längst
  zuhause, und die App sagt unterwegs».
- Benutzt der ganze Haushalt Life360, gehören damit **alle** unter
  `members` – auch die Telefone mit HomePilot. Die Ortung der App hängt
  daran, dass iOS sie im Hintergrund weckt, und das tut sie nicht
  zuverlässig. Umstellen: alle eintragen, auf jedem Telefon
  Einstellungen → Ortung ausschalten. Steht in `docs/geofence.md`.
- Ein **Ankommen darf jeder melden**, auch wenn Life360 die Person
  führt: Das Telefon sieht den Übertritt sofort, Life360 erst bei der
  nächsten Abfrage – wer heimkommt und auf das Licht wartet, zählt die
  Minute mit. Überhört wird nur noch ein fremdes «weg», denn das war
  die giftige Hälfte. App-Ortung und Life360 zusammen ergeben so das
  schnellste Ankommen und ein Rückgrat, das Verschlafenes binnen einer
  Minute geraderückt.
- Die Ortungs-Diagnose sagt bei einer Telefon-Meldung nicht mehr
  «Meldet sich regelmässig» – das Telefon meldet nur beim Kommen und
  Gehen, und der Satz beruhigte genau dann, wenn eine Ankunft
  verlorengegangen war. Jetzt steht dort, wie alt die letzte Meldung ist,
  was sie sagte, und was zu tun ist.
- «Zuhause» sticht jetzt jeden Ort, nicht nur den weiteren. Solange die
  Life360-Orte ausserhalb der Ortsliste standen, genügte die alte
  Prüfung; als eigene Orte hätte ein enger Ort auf demselben Haus
  «zuhause» verdrängt – und daran hängen Alarmanlage und Abläufe.
- Sehr enge Life360-Orte werden auf 60 m aufgeweitet. Enger trifft keine
  Handy-Ortung zuverlässig; der Ort meldete sich sonst nie, ohne dass
  jemand wüsste, warum.

**Gäste-WLAN**

- Die UniFi-Anbindung liess sich anmelden und bekam danach auf jede
  Abfrage die HTML-Anmeldeseite zurück – mit Status 200, nicht mit 401.
  Im Log stand «unexpected mimetype: text/html», was nach einem kaputten
  Endpunkt aussieht. Das Anmelde-Cookie ging auf zwei Wegen verloren, und
  beide mussten weg: Von einer nackten IP-Adresse legt aiohttp Cookies
  nur mit `unsafe=True` ab (die Zeile stand in der Kamera-Anbindung und
  fehlte in der Netzwerk-Anbindung) – und selbst dann verwirft Pythons
  Cookie-Parser die ganze Zeile, weil UniFi OS sie mit `partitioned`
  schickt und er dieses Attribut nicht kennt. Der Hub liest den Token
  jetzt selbst aus der Kopfzeile. Beide UniFi-Anbindungen gehen
  denselben Weg, geprüft an der echten Zeile einer Konsole.
- «UniFi-Abfrage fehlgeschlagen: unexpected mimetype: text/html» heisst
  jetzt, was es heisst. Eine UniFi-Konsole trägt mehrere Anwendungen,
  jede unter `/proxy/<name>/`; fragt man nach einer, die auf **diesem**
  Gerät nicht läuft, kommt kein 404, sondern die Weboberfläche mit
  Status 200. Im Haus stand der Netzwerk-Controller auf dem Gateway,
  während `host` auf die Protect-Konsole zeigte – die Suche danach
  dauerte einen Abend. Der Hinweis nennt jetzt die gesuchte Anwendung
  und die zwei möglichen Gründe.
- Wer das Gäste-Netz ausschliesslich über das UniFi-Captive-Portal
  betreibt, kommt jetzt an den Gutschein-Spender heran, ohne vorher
  einen `guest_wifi`-Abschnitt einzutragen. Vorher zählte die Karte den
  Vorrat: kein Gutschein hiess «nicht eingerichtet» – und die Knöpfe,
  mit denen man den ersten anlegt, lagen hinter genau diesem Hinweis.
  Jetzt genügt die UniFi-Anbindung.

**Philips Hue**

- Die auf der Bridge gespeicherten Szenen stehen jetzt überall dort zur
  Auswahl, wo ein Gerät steht: in einer **Szene** des Hubs, in einem
  **Ablauf** und als Kachel im Raum. Vorher gab es sie nur als
  Namensliste im Ablauf-Editor – in eine Szene liess sich eine
  Hue-Szene gar nicht aufnehmen.
- Jede Bridge-Szene ist eine eigene Entität (`hue.scene_<Kennung>`,
  Art «Lichtszene») mit genau einem Befehl: aufrufen. Zurücknehmen kann
  die Bridge eine Szene nicht, also gibt es dafür auch keinen Knopf.
- Die Kachel zeigt, ob die Szene gerade gilt. Verstellt jemand eine der
  Lampen von Hand, meldet die Bridge das, und die Kachel sagt wieder
  «Bereit».
- Gleichnamige Szenen bekommen alle ihren Raum dazu – «Entspannen
  (Wohnzimmer)» und «Entspannen (Büro)», statt einmal «Entspannen» und
  einmal mit Zusatz.
- In der Hue-App angelegte oder gelöschte Szenen kommen und gehen ohne
  Neustart des Hubs.

## 2026-08-21

**Abläufe**

- Nachlauf für Bewegungslichter: Ein Ablauf kann bei erneutem Auslösen
  von vorn beginnen (`mode: restart`), statt den zweiten Auslöser zu
  verwerfen. Im Flur der Unterschied zwischen «geht nach der ersten
  Bewegung aus» und «bleibt an, solange sich etwas rührt».
- Die Geräteauswahl ist eine durchsuchbare Liste statt einer waagrechten
  Chip-Reihe, und jedes Gerät trägt seine Art daneben – Licht, Leuchte
  (mehrere Lampen), Bewegungsmelder, Saugroboter.
- Neue Vorlage «Licht bei Bewegung, mit Nachlauf».

**Startseite**

- Die Einkaufsliste ist immer erreichbar, nicht erst wenn etwas drauf
  steht – orange wird sie weiterhin nur dann. Im Fenster lassen sich
  Artikel eintragen und der Laden wählen; der Hub merkt sich, was schon
  einmal eingekauft wurde, und schlägt es vor.
- Fernseher tauchen im Musikplayer nicht mehr auf.

**Betrieb**

- Die App zeigt unter *System*, welchen Stand sie ausführt und ob er
  mitgeliefert oder über die Luft nachgeladen ist.
- `rebuild-hub.sh` schreibt hin, aus welchem Zweig und Commit es baut,
  und räumt den Arbeitsordner vor dem Klonen statt erst danach.

**Unter der Haube**

- Ruff, mypy und pytest-cov im Hub; ESLint und Prettier in der App; eine
  CI, die bei jedem Push Tests, Linter, Typen und den Web-Bau durchlaufen
  lässt.
- `hub/homepilot-data.json` und die Token-Dateien der Integrationen sind
  aus dem Repository genommen – dort standen im Betrieb Benutzer samt
  Tokens.
- Ein `HEALTHCHECK` im Abbild: Docker merkt jetzt, wenn der Hub hängt,
  statt nur zu sehen, dass der Prozess noch läuft.
