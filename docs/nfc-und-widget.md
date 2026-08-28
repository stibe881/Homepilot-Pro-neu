# NFC-Aufkleber und das iPhone-Widget

Zwei Wege, HomePilot zu bedienen, ohne die App zu suchen.

## NFC-Aufkleber

Ein Aufkleber am Eingang für «Alles aus», einer am Nachttisch für
«Schlafen». Kostet ein paar Franken (NTAG213 reicht) und ist schneller als
jede App.

**Vorbereitung.** In der App unter *System → Kurzbefehle* stehen alle
Szenen und Geräte fertig als Bausteine: Adresse, Methode, Kopfzeilen und
Rumpf, jeweils mit deinem Token. Den gewünschten Eintrag teilen und
bereithalten.

**Kurzbefehl anlegen.** Kurzbefehle-App → *+* → **Inhalte von URL
abrufen** → die Angaben aus dem geteilten Baustein eintragen (Methode
POST, Header `Authorization: Bearer …`, bei Geräten zusätzlich der
JSON-Rumpf). Kurzbefehl benennen, z.B. «Alles aus».

**Aufkleber beschreiben.** Kurzbefehle-App → *Automation* → *Neue
Automation* → **NFC** → *Scannen* → Aufkleber ans Telefon halten →
benennen → als Aktion den eben gebauten Kurzbefehl wählen → **«Sofort
ausführen»** einschalten, sonst kommt bei jedem Antippen eine Rückfrage.

Ab dann genügt es, das Telefon an den Aufkleber zu halten – auch bei
gesperrtem Bildschirm.

**Android:** Dieselbe Idee mit *NFC Tools* oder Tasker; der Aufkleber
bekommt die URL, den Header trägt die App bei.

## Widget auf Homescreen und Sperrbildschirm

Ab dem nächsten eigenen Build (`eas build`) bringt HomePilot zwei Arten
von Widgets mit: **HomePilot** – eine Leiste mit bis zu vier Knöpfen
(voreingestellt **Haustüre**, **Alles aus** und **Alarm**) – und
**HomePilot Karte**, eines je Gerät oder Szene.

**Einrichten.** Auf dem Homescreen lange drücken → *+* → «HomePilot» →
Grösse wählen. Für den Sperrbildschirm: Sperrbildschirm lange drücken →
*Anpassen* → Bereich unter der Uhr antippen → «HomePilot».

**Welche Knöpfe.** In der App unter *Einstellungen → Widgets*. Dort
lassen sich neben den drei Abkürzungen auch Szenen und einzelne Geräte
auf die Knöpfe legen, ordnen und wieder entfernen. Das gilt fürs ganze
Haus: Wer auf dem iPad umstellt, hat es auch auf dem Telefon – und alle
anderen ebenso. Eine Änderung ist sofort da, das Widget muss nicht neu
angelegt werden.

Den eigentlichen Knopf «Widget hinzufügen» kann keine App anbieten – iOS
behält das Auflegen auf den Homescreen bei sich. Deshalb steht in der App
die Anleitung statt eines Knopfes, der nichts täte.

**Eigene Widgets.** Neben der Knopfleiste gibt es «HomePilot Karte»: ein
Widget für *ein* Gerät oder *eine* Szene, gross, mit Zustand und einem
Knopf. Zusammengestellt werden die Karten in der App unter *Einstellungen
→ Widgets* («Eigene Widgets») – ein Licht, ein Fühler, ein Schloss, eine
Szene. Auf dem Homescreen legt man dann so viele «HomePilot Karte»-Widgets
ab, wie man braucht, und wählt je Widget aus, welche Karte es zeigt:
langer Druck → *Widget bearbeiten* → *Karte*.

Braucht iOS 17 oder neuer: Erst dort lässt sich ein Widget je Exemplar
einstellen. Und es braucht «Hausstand im Widget» (siehe unten) – ohne die
Zugangsdaten im Widget kann eine Karte weder den Zustand zeigen noch
schalten, sie führt dann nur in die App.

**Was passiert beim Antippen.** Das Widget schaltet nichts direkt, es
öffnet die App an der richtigen Stelle: Bei «Haustüre» steht die
Rückfrage schon da und ein zweiter Tipp öffnet. Das ist Absicht – ein
Türöffner, der sich vom gesperrten Bildschirm aus mit einem einzigen
Tipp auslösen liesse, wäre genau der Knopf, den man nicht will.

Wer den direkten Weg trotzdem will, baut ihn sich als Kurzbefehl (siehe
oben) und legt diesen auf den Sperrbildschirm – dann liegt die
Entscheidung bei dir und nicht bei der App.

**Zustände im Widget – auf Wunsch.** Neben den Knöpfen kann das Widget
auch zeigen, ob eine Türe offen steht, wie viele Lichter brennen und was
als Nächstes im Kalender ansteht. Das ist ein Schalter in den
Einstellungen («Widget zeigt den Hausstand»), und er steht dort aus
gutem Grund: Dafür müssen Hub-Adresse und Token in einer geteilten
Ablage liegen, auf die auch das Widget zugreift – ein eigener Prozess,
also ein Ort mehr, an dem das Token liegt.

Für eine blosse Knopfleiste wäre das der falsche Preis; für den Blick
«steht bei uns eine Türe offen» ist die Rechnung eine andere. Wer sie
anders sieht, lässt den Schalter aus: Dann bleibt die Ablage leer, und
das Widget schreibt «in der App einschalten» – nicht «nicht erreichbar».
Der Unterschied ist Absicht: Das eine ist eine Entscheidung, das andere
eine Störung. «Nicht erreichbar» steht nur da, wenn der Schalter an ist
und der Hub trotzdem nicht antwortet – dann sagt das Widget das
ausdrücklich, statt den letzten Stand weiter als Tatsache auszugeben.

**Laufende Maschinen mit Balken.** Läuft die Waschmaschine, der
Tumbler oder der Geschirrspüler, steht das im selben Hausstand: Name,
Restzeit und ein Fortschrittsbalken. Auf dem Sperrbildschirm sticht die
Maschine den Kalendertermin – der steht dort ohnehin noch dreimal, die
Restzeit nirgends.

Den Balken gibt es erst, wenn der Hub das Gerät zweimal hat durchlaufen
sehen: Die meisten Maschinen melden nur «noch 23 Minuten», nie die
Programmlänge, und ohne die ist ein Balken geraten. Der Hub nimmt den
Median der letzten Läufe *desselben* Geräts – ein Tumbler läuft doppelt
so lang wie eine Kurzwäsche. Bis dahin steht nur die Zahl da, und das
ist ehrlicher.

Der Grill hat keinen Balken. Er ist technisch dasselbe («appliance»),
führt aber ein Temperaturziel statt einer Restzeit – für ihn wäre ein
Zeitbalken eine Erfindung.

Aktualisiert wird alle 15 Minuten – häufiger lässt iOS ohnehin nicht zu.
