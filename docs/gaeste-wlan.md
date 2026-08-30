# Gäste-WLAN: der Aufkleber im Flur

Besuch fragt nach dem WLAN. Bisher gab es dafür zwei halbe Antworten:
den QR-Code aus der `config.yaml` (der ins offene Gästenetz führt, mehr
nicht) und den Gutschein-Spender in der App – den aber nur bedienen
kann, wer selbst ein Konto hat. Der Gast stand daneben und wartete, bis
jemand ihm einen Code vorlas.

Jetzt hängt im Flur ein Aufkleber. Wer ihn mit der ganz normalen Kamera
scannt, landet auf einer Seite des Hubs, drückt einen Knopf und bekommt
seinen eigenen Zugangscode: **zwölf Stunden gültig, einmal einlösbar.**

## Der Weg des Gastes

1. QR-Code scannen – mit der Kamera, ohne App und ohne Konto.
2. Auf der Seite «Code holen» drücken.
3. Der Code steht gross da, darunter ein zweiter QR fürs Netz selbst.
4. Mit dem Netz verbinden, die Anmeldeseite geht von selbst auf, Code
   eintippen.

## Was dafür stehen muss

| Teil | Wofür | Ohne ihn |
| --- | --- | --- |
| `integration: unifi` | stellt die Gutscheine aus | keine Codes; die Seite sagt es und schickt den Gast ins Haus |
| `push.public_url` | die Adresse, die in den Aufkleber geht | der Aufkleber zeigt ins Hausnetz und wirkt nur dort |
| `guest_wifi.ssid` | der zweite QR zum Verbinden | die Seite nennt kein Netz, der Code gilt trotzdem |

Die Karte unter *Benutzerverwaltung → Gäste-WLAN → Aufkleber für Gäste*
zeigt den QR-Code zum Ausdrucken, die Adresse zum Nachlesen und sagt,
welcher dieser Teile gerade fehlt.

## Der Haken mit dem Mobilfunk

Der Gast scannt, **bevor** er im WLAN ist. Er hängt also am Mobilfunk –
und muss den Hub von aussen erreichen. Deshalb die `push.public_url`;
die Adresse im Haus (192.168.x.x) nützt ihm nichts.

Wer keinen Mobilfunk hat (Keller, Besuch aus dem Ausland), kommt so
nicht weiter. Dafür gibt es im UniFi-Controller die
**Pre-Authorization Access**-Liste der Gäste-Policy: Trägt man dort den
Host des Hubs ein, erreicht ein Gast die Seite auch, wenn er schon im
offenen Netz hängt, aber noch nicht angemeldet ist. Dann genügt: mit dem
Netz verbinden, Aufkleber scannen, Code holen, Code eintippen.

## Warum es so gebaut ist

**Im Aufkleber steht die Adresse, nicht der Code.** Ein Gutschein im
Aufkleber wäre *ein* Gutschein: Der Erste löst ihn ein, und weil er
einmalig ist (UniFi `quota: 1`), steht der Zweite vor einer toten Karte.
Gezogen wird deshalb bei jedem Besuch neu.

**Gezogen wird per Knopf, nicht beim Aufrufen.** Wer eine Adresse teilt
oder scannt, dessen Vorschau bauen Messenger, Mailserver und
Virenscanner mit einem ganz normalen GET. Ein GET, der zieht, verbrennt
Gutscheine, bevor ein Mensch die Seite gesehen hat – genau dieser Fehler
war beim Einmal-Link zur Türe schon einmal da (`core/guestpass.py`).

**Zwölf Stunden ab dem Ziehen, nicht ab der Anmeldung.** Der Controller
kann von sich aus nur das Zweite: Die Uhr startet, wenn sich jemand
anmeldet. Ein gezogener, nie benutzter Code läge dann für immer herum,
und der abfotografierte Aufkleber von letztem Sommer wäre eine
Dauerkarte. Der Hub führt deshalb Buch und räumt selbst auf – jede
Wächter-Runde löscht, was älter als zwölf Stunden ist.

## Wenn jemand den Aufkleber abfotografiert

Drei Bremsen:

- Die **Fehlversuchs-Bremse** gilt auch hier; wer Adressen durchprobiert,
  wird gesperrt.
- Höchstens **25 Codes gleichzeitig offen**. Danach sagt die Seite, man
  möge im Haus fragen – der Controller füllt sich nicht mit
  Karteileichen.
- **«Neuer Aufkleber»** in der App macht jeden ausgedruckten ungültig.
  Schon gezogene Codes laufen trotzdem nach ihren zwölf Stunden ab.

Wie viele Codes gerade offen sind, steht in derselben Karte. Wenn dort
dauerhaft ein Stapel liegt, benutzt jemand den Aufkleber, den man nicht
gemeint hat.

## Der Vorrat daneben

Der ältere Weg bleibt: Unter *Portal-Gutschein* legt man Codes von Hand
an (4 Stunden bis 1 Woche) und liest sie vor. Das ist der Weg für den
Gast ohne Kamera und für den Code, den man jemandem im Voraus geben
will.
