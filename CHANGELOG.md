# Was sich geändert hat

Die Commit-Betreffzeilen erzählen jede Änderung einzeln. Hier steht das
Gegenstück: was die Anlage heute kann, was sie vorher nicht konnte.

Neueste zuoberst. Datum ist der Tag, an dem es im Haus lief.

## 2026-08-24

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
