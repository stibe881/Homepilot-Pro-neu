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

Ab dem nächsten eigenen Build (`eas build`) bringt HomePilot ein Widget
mit drei Abkürzungen: **Haustüre**, **Alles aus** und **Alarm**.

**Einrichten.** Auf dem Homescreen lange drücken → *+* → «HomePilot» →
Grösse wählen. Für den Sperrbildschirm: Sperrbildschirm lange drücken →
*Anpassen* → Bereich unter der Uhr antippen → «HomePilot».

**Was passiert beim Antippen.** Das Widget schaltet nichts direkt, es
öffnet die App an der richtigen Stelle: Bei «Haustüre» steht die
Rückfrage schon da und ein zweiter Tipp öffnet. Das ist Absicht – ein
Türöffner, der sich vom gesperrten Bildschirm aus mit einem einzigen
Tipp auslösen liesse, wäre genau der Knopf, den man nicht will.

Wer den direkten Weg trotzdem will, baut ihn sich als Kurzbefehl (siehe
oben) und legt diesen auf den Sperrbildschirm – dann liegt die
Entscheidung bei dir und nicht bei der App.

**Warum keine Zustände im Widget.** Ein Widget, das «3 Lichter an»
anzeigt, müsste Adresse und Token in einer geteilten Ablage halten und
alle paar Minuten das Haus anfragen. Für drei Knöpfe ist das der falsche
Preis, und ein Token mehr im System ist eine Angriffsfläche mehr.
