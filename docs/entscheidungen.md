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

## Warum «ausschalten, was schon aus ist» kein Fehler ist

**Dafür:** «Musik aus» auf einer Box, auf der nichts läuft, ist ein
erfüllter Wunsch. Trotzdem meldeten die Integrationen der Reihe nach
einen Fehler: Google Cast («Failed to execute pause.»), das Radio («Es
läuft gerade kein Radio»), Spotify (kein aktives Gerät), der Fernseher
(nicht erreichbar). Vier verschiedene Meldungen für dasselbe Nichts.

Im Ablauf «Niemand mehr zuhause» stehen sechzig solcher Schritte, und
das Türschloss steht am Ende. Solange ein Fehler den Lauf anhielt, war
das teuer; seit er es nicht mehr tut, ist es Lärm im Protokoll. Beides
sind gute Gründe, das Nichts nicht als Fehler zu behandeln.

Die Regel gilt nur für Medien und nur in eine Richtung: Wer *abspielen*
will, wo nichts ist, erfährt das weiterhin – da ist die Frage offen und
die Antwort nützlich.

Beim Fernseher kommt eine Unterscheidung dazu: Ein **gekoppelter**
Fernseher, den der Hub nicht erreicht, ist vom Netz und damit aus – «mach
ihn aus» ist erledigt. Eine **fehlende Kopplung** ist dagegen ein
Einrichtungsfehler, den man sehen muss; da hilft kein Schweigen.

**Kostet:** Der Hub verlässt sich dabei auf seinen eigenen Stand. Ist der
veraltet – die Box spielt, der Hub weiss es noch nicht –, geht das Pause
ins Leere und niemand erfährt es. Bei Lampen wäre das untragbar (dort
drückt man «aus» oft *gerade weil* die Anzeige nicht stimmt), deshalb
gilt die Regel ausdrücklich nicht für sie.

**Wann es falsch wäre:** Bei einem Gerät, dessen Zustand der Hub nur
selten erfährt. Dort ist ein Befehl ins Blaue besser als ein
übersprungener.

---

## Warum der Handstart nur manchmal nachfragt

**Dafür:** Jeder Ablauf hat in der Liste einen Knopf, der ihn sofort
ausführt – beim Einrichten drückt man ihn zehnmal hintereinander. Eine
Rückfrage bei jedem Druck wäre genau das, worüber man sich beim elften
Mal ärgert.

Aber ein Fehlgriff auf «Niemand mehr zuhause» schliesst die Türe und
schaltet den Alarm scharf, und das nimmt man nicht in einer Sekunde
zurück. Also fragt der Knopf nur dort: bei Abläufen, die ein Schloss
oder die Alarmanlage anfassen. Dieselbe Grenze zieht das Suchfeld
(`lib/suchbefehl.ts`) – die zwei Dinge, die man nicht nebenbei schaltet.

Die Rückfrage sagt dabei etwas, das man von selbst nicht erwartet: Der
Handstart übergeht die Bedingungen. Er führt aus, auch wenn der Ablauf
im Alltag gestoppt hätte – beim Ausprobieren will man das Ergebnis
sehen, nicht die Bedingung prüfen.

**Kostet:** Die Liste der heiklen Befehle steht im Code und nicht in
einer Einstellung. Kommt ein Gerät dazu, dessen Fehlgriff wehtut (ein
Garagentor, ein Wasserhahn), muss jemand sie ergänzen.

**Wann es falsch wäre:** In einem Haushalt, in dem alle Abläufe harmlos
sind – dort ist jede Rückfrage eine zu viel. Und in einem, in dem alle
wehtun: Dann wäre eine Rückfrage für alle ehrlicher als eine Liste, die
den halben Bestand vergisst.

---

## Warum ein hängender Schritt einen Ablauf nicht anhält

**Dafür:** «Niemand mehr zuhause» schaltet sechzig Geräte ab, schaltet
die Alarmanlage scharf und schliesst zuletzt die Türe. Bricht der Lauf
beim ersten Fehler ab, entscheidet der unwichtigste Schritt über die
wichtigsten – eine Box, auf der ohnehin nichts lief, liess die Wohnung
offen und unscharf. Genau so ist es passiert.

Ein Ablauf ist keine Transaktion. Es gibt kein «alles oder nichts»: Die
vierzig Lichter, die schon aus sind, gehen nicht wieder an. Wenn ohnehin
ein Teil getan ist, ist der grössere Teil besser als der kleinere – und
die Reihenfolge in der Liste ist keine Rangfolge der Wichtigkeit,
sondern die, in der man sie eingetippt hat.

**Kostet:** Ein Ablauf, der auf halbem Weg stolpert, läuft weiter,
obwohl die Voraussetzung für den Rest vielleicht nicht mehr stimmt. Wer
«Fenster schliessen, dann Alarm scharf» schreibt, bekommt den scharfen
Alarm auch bei offenem Fenster – die Alarmanlage meldet das dann selbst,
aber der Ablauf tut es nicht mehr.

Und: Ein Fehler fällt weniger auf. Deshalb steht er weiter am Ablauf,
jetzt aber mit dem Gerät im Satz («Nest Gang Musik: … Der Rest lief
durch.») statt als blosses «Fehlgeschlagen», und die Schritt-Spur
markiert die hängende Zeile.

**Wann es falsch wäre:** Bei einem Ablauf, dessen Schritte wirklich
aufeinander aufbauen. Dafür gibt es «Warten bis» – eine Bedingung, die
den Lauf anhält, ist etwas anderes als ein Gerät, das nicht antwortet.

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
