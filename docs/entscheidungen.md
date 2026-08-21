# Warum es so aussieht und nicht anders

Der Code ist voll von Begründungen – aber sie stehen je in der Datei, um
die es geht. Die Fragen, die ein Späterer *zuerst* stellt, beantwortet
keine davon: Warum überhaupt selbst gebaut? Warum eine JSON-Datei statt
einer Datenbank?

Hier stehen sie. Jede Entscheidung mit dem, was dafür sprach, und ehrlich
mit dem, was sie kostet.

---

## Warum selbst gebaut statt Home Assistant

**Dafür:** Home Assistant kann alles, was hier steht, und mehr. Aber es
ist ein Baukasten für alle, und dieses Haus ist eines. Was hier zählt –
dass der Wandtaster im Flur das Licht mit Nachlauf schaltet, dass die
Einkaufsliste nach Ladengang sortiert ist, dass Livia und Stefan
verschiedene Dinge sehen – sind fünfzig kleine Entscheidungen, die in
einem allgemeinen System jede eine Erweiterung bräuchten.

**Kostet:** Jede Integration selbst. Kein Ökosystem, keine Community, kein
fertiger Blueprint. Wenn Homematic morgen sein Protokoll ändert, ist das
hier ein Abend Arbeit statt eines Updates.

**Wann es falsch wäre:** Wenn das Haus jemand übernimmt, der nicht
programmiert.

---

## Warum eine JSON-Datei statt einer Datenbank

**Dafür:** Der Haushalt umfasst ein paar hundert Einträge – Benutzer,
Abläufe, Szenen, Listen. Das passt in eine Datei, die man mit einem
Editor öffnen und mit `cp` sichern kann. Eine Datenbank daneben wäre ein
zweiter Dienst, der laufen, aktuell bleiben und mitgesichert werden
müsste.

Geschrieben wird über eine temporäre Datei mit `fsync` und einem
atomaren Umbenennen: Bei einem Stromausfall mitten im Schreiben bleibt
keine halbe Datei zurück, und der Hub kommt nicht ohne Benutzer wieder
hoch.

**Kostet:** Jede Änderung schreibt die ganze Datei neu. Bei einem
Einkaufsartikel sind das ein paar hundert Kilobyte samt `fsync` – auf
einer SD-Karte spürbar, wenn die Listen wachsen. Siehe Punkt 19 der
Werkbank-Liste.

**Wann es falsch wäre:** Sobald etwas je Sekunde geschrieben werden muss.
Der Energieverlauf ist deshalb bewusst ein Zahlenpaar je Tag und keine
Messreihe.

---

## Warum Supabase freiwillig ist

**Dafür:** Anmeldung mit E-Mail und Passwort, Einladungen und eine
Sicherung ausserhalb des Hauses sind die drei Dinge, die man nicht
selbst bauen will. Für alles andere wäre eine Cloud ein Ausfallpunkt für
etwas, das lokal funktioniert.

Deshalb hängt daran genau das – und kein Gerät, kein Ablauf, keine
Szene. Ein Supabase-Ausfall kostet keine Funktion im Haus. Die Tabelle
steht in [`aufbau.md`](aufbau.md).

**Kostet:** Zwei Wege zur Anmeldung, die beide gepflegt sein wollen.

---

## Warum Expo und nicht nativ

**Dafür:** iPhone, iPad und Browser aus einer Quelle. Bei einer Person,
die das nebenher pflegt, ist das nicht Bequemlichkeit, sondern die
Bedingung dafür, dass es alle drei überhaupt gibt. Und die Web-Fassung
ist ausserdem der Weg auf jedes Wandpanel, ohne etwas zu installieren.

**Kostet:** Alles Native geht über eine Brücke – Widgets, Face ID,
Haptik, Hintergrundarbeit. Was Expo nicht kennt, braucht einen eigenen
Build. Und die OTA-Aktualisierung hat ihre eigene Falle (siehe unten).

---

## Warum der Hub die Wahrheit hält und die App nichts rechnet

**Dafür:** Es gibt drei Anzeigegeräte und einen Hub. Läge die Logik in
der App, gäbe es sie dreimal, und beim vierten Gerät wieder. Ausserdem
müssen Abläufe laufen, wenn kein Telefon eingeschaltet ist.

**Kostet:** Die App fühlt sich bei schlechter Verbindung träge an, weil
sie auf die Antwort wartet, statt selbst zu raten.

---

## Warum die Kommentare so lang sind

**Dafür:** Der teuerste Fehler an einem selbstgebauten System ist nicht
der Absturz, sondern die Änderung, die etwas kaputt macht, was niemand
mehr als Absicht erkennen konnte. Ein Kommentar, der sagt *warum*,
verhindert genau das – und je seltener man in eine Datei schaut, desto
mehr.

Deshalb steht in `automation.py` nicht «setzt last_press», sondern warum
ein Wandtaster ohne diesen Zeitstempel genau einmal funktioniert hätte.

**Kostet:** Mehr Zeilen Kommentar als Code an manchen Stellen.

---

## Warum der Update-Knopf in der App sitzt

**Dafür:** Ein Update, für das man SSH braucht, macht man nicht. Eines,
das man vom Sofa aus anstösst, macht man.

**Kostet:** Ein Dienst mit Docker-Rechten auf dem Host
(`deploy/update-listener.py`). Er liegt bewusst ausserhalb des
Hub-Containers: So bleibt der weitreichende Zugriff bei einem Dienst,
der nichts aus dem Internet holt und dessen ganze Aufgabe in einem Aufruf
besteht.

**Was dabei überrascht:** Das Bau-Skript frischt sich selbst auf –
Änderungen daran greifen erst beim übernächsten Lauf. Und die
`runtimeVersion` hängt an der App-Version: Solange die auf `0.1.0` steht,
passt jede je veröffentlichte OTA-Fassung auf jeden neuen Build.

---

## Warum es keine Tests für die Oberfläche gibt

**Dafür:** Getestet wird, wo eine Entscheidung fällt – welcher Gang,
welcher Kanal, welcher Vorschlag. Das sind reine Funktionen, und die
liegen in `core/` und `src/lib/`. Ein Test, der prüft, ob ein Knopf blau
ist, bricht bei jeder Gestaltungsänderung und findet nie einen Fehler.

**Kostet:** Ein kaputter Bildschirm fällt erst im Betrieb auf. Dagegen
hilft das Auffangnetz (`components/Auffangnetz.tsx`), nicht ein Test.

**Womit man Layout trotzdem prüft:** Der Weg mit Demo-Hub und Browser
steht in der [CLAUDE.md](../CLAUDE.md).

---

## Was hier nicht steht

Entscheidungen, die noch offen sind, stehen in der Werkbank-Liste – 100
durchnummerierte Punkte, aus dem Code gelesen. Was davon umgesetzt ist,
trägt dort den Commit daneben.
