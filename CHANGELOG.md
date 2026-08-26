# Was sich geändert hat

Die Commit-Betreffzeilen erzählen jede Änderung einzeln. Hier steht das
Gegenstück: was die Anlage heute kann, was sie vorher nicht konnte.

Neueste zuoberst. Datum ist der Tag, an dem es im Haus lief.

## 2026-08-25

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
