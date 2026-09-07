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

**Hängt er schon im offenen Gästenetz** (der Regelfall, wenn die
Pre-Authorization-Liste steht):

1. QR-Code scannen.
2. Auf der Seite «Code holen» drücken.
3. Fertig – der Hub schaltet genau dieses Gerät frei. Nichts abzutippen.

Der Code steht trotzdem auf der Seite: Das zweite Gerät (Tablet des
Kindes, Laptop) ist damit noch nicht freigeschaltet, und dafür ist er da.

**Kommt er vom Mobilfunk**, kennt der Hub sein Gerät nicht – dann bleibt
es beim Abtippen:

1. QR-Code scannen.
2. «Code holen» drücken.
3. Der Code steht gross da, darunter ein zweiter QR fürs Netz selbst.
4. Mit dem Netz verbinden, die Anmeldeseite geht von selbst auf, Code
   eintippen.

Das Freischalten geht denselben Weg, den das Portal nach dem Eintippen
eines Codes auch ginge (`authorize-guest`). Freigeschaltet wird nur, wer
in der Client-Liste des Controllers als **Gast** steht – käme die
Anfrage über einen Gegenlauf-Server im Haus, träfe die Adresse dessen
eigenes Gerät, und der Hub schaltete den Falschen frei.

## Was dafür stehen muss

| Teil | Wofür | Ohne ihn |
| --- | --- | --- |
| `integration: unifi` | stellt die Gutscheine aus | keine Codes; die Seite sagt es und schickt den Gast ins Haus |
| `push.public_url` | die Adresse, die in den Aufkleber geht | der Aufkleber zeigt ins Hausnetz und wirkt nur dort |
| `guest_wifi.ssid` | der zweite QR zum Verbinden | die Seite nennt kein Netz, der Code gilt trotzdem |

Die Karte unter *Benutzerverwaltung → Gäste-WLAN → Aufkleber für Gäste*
zeigt den QR-Code zum Ausdrucken, die Adresse zum Nachlesen und sagt,
welcher dieser Teile gerade fehlt.

## Die UniFi-Anbindung einrichten

Drei Orte, und die Reihenfolge ist nicht beliebig.

**1. Im UniFi-Controller, einmalig:**

- Einen **lokalen** Benutzer anlegen (UniFi OS: *Settings → Admins &
  Users → Add Admin*, «Restrict to local access only»). Kein
  Ubiquiti-Cloud-Konto und **keine Zwei-Faktor-Anmeldung** – die
  API-Anmeldung des Hubs kann keinen zweiten Faktor beantworten. Zugriff
  auf die *Network*-App als Site Admin: Der Hub liest die Geräteliste
  und stellt Gutscheine aus, die schmale «Hotspot»-Rolle reicht dafür
  nicht.
- Das Gastnetz mit **Gutschein-Portal** betreiben: *Settings → WiFi* für
  das Gästenetz, dazu unter *Hotspot Portal* die Authentifizierung
  «Voucher». Ohne Voucher-Portal gelten die Codes nirgends.

**2. Auf dem Hub-Rechner, vor dem Konfigurieren:** zwei Zeilen in die
`secrets.env` **neben der config.yaml** –

```
UNIFI_NET_USER=hub
UNIFI_NET_PASSWORD=…
```

Erst die Datei, dann die Konfiguration: Der Hub prüft beim Speichern die
ganze config.yaml und weist eine `${VARIABLE}` zurück, die er nirgends
findet. Wer die Zugangsdaten stattdessen im Klartext in die config.yaml
schreibt, findet sie später in jeder Fassung der
Konfigurations-Historie wieder – deshalb der Umweg.

**3. In der App** (*System → Konfiguration*), unter `integrations:`

```yaml
- integration: unifi
  host: 192.168.1.1            # UDM/Cloud Gateway; Standalone: host:8443
  username: "${UNIFI_NET_USER}"
  password: "${UNIFI_NET_PASSWORD}"
  site: default
```

Vor `host` gehört kein `https://` – das setzt die Integration selbst,
und sie erkennt beim Anmelden von allein, ob ein UniFi-OS-Gerät (UDM,
Cloud Gateway, Cloud Key Gen2) oder ein alter Standalone-Controller
antwortet. `track` mit MAC-Adressen ist optional und ergibt
«Gerät im WLAN»-Sensoren; für die Gutscheine braucht es das nicht.

Danach den Hub neu starten (der Update-Knopf tut das ohnehin). Die
Karte *Gäste-WLAN* wechselt dann von selbst auf den Gutschein-Spender;
für den Aufkleber fehlen sonst höchstens noch `push.public_url` und
`guest_wifi.ssid` aus der Tabelle oben – die Karte sagt, welcher Teil
es ist.

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
an und liest sie vor. Das ist der Weg für den Gast ohne Kamera und für
den Code, den man jemandem im Voraus geben will.

Acht Stunden sind dort der Standard - ein Abendbesuch -, daneben stehen
1 Tag, 3 Tage und 1 Woche für die bewusste Wahl. Der eben angelegte Code
steht sofort oben; erst wenn er eingelöst oder gelöscht ist, rückt der
Vorrat der Reihe nach nach.
