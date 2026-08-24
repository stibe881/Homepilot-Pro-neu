# Was sich geändert hat

Die Commit-Betreffzeilen erzählen jede Änderung einzeln. Hier steht das
Gegenstück: was die Anlage heute kann, was sie vorher nicht konnte.

Neueste zuoberst. Datum ist der Tag, an dem es im Haus lief.

## 2026-08-24

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

**Gäste-WLAN**

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
