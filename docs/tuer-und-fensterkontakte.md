# Matter: Tür- und Fensterkontakte, Türschloss

Der Aqara Door and Window Sensor P2 spricht Matter über Thread und braucht
deshalb **keinen Aqara-Hub** – aber zweierlei sonst: einen
Thread-Border-Router im Haus (HomePod mini, Apple TV 4K, Google Nest Hub 2,
Echo 4) und den Matter-Controller-Dienst neben dem Hub. Ohne
Border-Router kommt kein Thread-Gerät ins Netz; der Controller allein
genügt nicht.

Steht ein Kontakt offen, zeigt die App das oben auf der Startseite neben der
Begrüssung: „Tür offen" mit dem Namen des Geräts. Sind alle zu, verschwindet
der Hinweis ganz.

## 1. Matter-Dienst starten

Der Hub bringt keinen eigenen Matter-Stack mit; er spricht mit
**matterjs-server**. Der Block steht fertig in der
`docker-compose.portainer.yml` – es genügt **Update the stack → Deploy**.

Vorher einmalig auf dem Docker-Host, sonst darf der Dienst nicht in sein
Datenverzeichnis schreiben:

```bash
sudo mkdir -p /opt/homepilot/matter
sudo chown -R 1000:1000 /opt/homepilot/matter
```

Dort liegen die Schlüssel der Matter-Fabric. Der Ordner liegt bewusst
neben der `config.yaml` und nicht in einem Docker-Volume: So wandert er
mit `/opt/homepilot` ins Backup. **Geht er verloren, muss jedes Gerät neu
gekoppelt werden.**

Zwei Dinge müssen auf dem Rechner stimmen, sonst startet der Dienst gar
nicht oder findet nichts:

- **host-Netz.** Matter findet Geräte über mDNS, und das kommt durch kein
  Docker-Bridge-Netz. Steht schon so im Stack.
- **IPv6.** Der Dienst bindet mDNS an `[::]:5353` und bricht ohne IPv6
  beim Start ab (`Cannot bind to {::}:5353`). Prüfen mit
  `ip -6 addr` – kommt nichts, ist IPv6 auf dem Host abgeschaltet.

Im Netz selbst müssen Hub und Geräte einander sehen: gleiches VLAN, oder
mDNS-Weiterleitung im UniFi eingeschaltet.

**Bluetooth ist absichtlich aus.** Es wird nur für Geräte gebraucht, die
fabrikneu aus der Packung kommen; was schon in Apple oder Google Home
hängt, koppelt man über einen dort erzeugten Code, und der läuft übers
Netz. Auf einem Rechner ohne Adapter – jede virtuelle Maschine – ist es
nicht bloss nutzlos: Der Dienst sucht dann einen bluez-Dienst am
dbus-Socket, findet keinen, und der **ganze Container stirbt** mit
`Error: write EPIPE`. Nicht nur die Bluetooth-Funktion.

Ob der Rechner überhaupt einen hat: `ls /sys/class/bluetooth`. Kommt
nichts, bleibt es aus – die drei Zeilen dafür stehen auskommentiert im
Stack.

> **Warum nicht mehr `python-matter-server`?** Der ist seit dem 23. Juni
> 2026 eingestellt, 8.1.2 war die letzte Fassung. matterjs-server spricht
> dieselbe Schnittstelle und übernimmt beim ersten Start ein vorhandenes
> Datenverzeichnis – wer den alten laufen hat, kann also umstellen, ohne
> neu zu koppeln. Vorher eine Kopie des Datenverzeichnisses anlegen und
> nie beide gleichzeitig darauf laufen lassen.

## 2. Integration einschalten

```yaml
  - integration: matter
    url: ws://127.0.0.1:5580/ws
```

## 3. Sensoren koppeln

**Wichtig, wenn die Sensoren schon in Apple Home, Google Home oder Home
Assistant hängen:** Ein Matter-Gerät gehört immer nur einer Fabric – aber es
kann mehreren beitreten. Nicht zurücksetzen, sondern in der bestehenden App
einen zusätzlichen Kopplungscode erzeugen:

- **Apple Home:** Gerät → Zahnrad → *Gerät oder Zubehör teilen* → *Kopplungscode*
- **Google Home:** Gerät → Einstellungen → *Mit Matter-App verknüpfen*
- **Home Assistant:** Gerät → *Zu anderem Netzwerk hinzufügen*

Der angezeigte 11-stellige Code gilt einmalig und ein paar Minuten lang.
Damit im Container:

```bash
docker exec -it homepilot-hub \
  python -m homepilot.integrations.matter -c /config/config.yaml --pair 34970112332
```

Frisch aus der Packung geht es genauso, dann mit dem QR-Code-Inhalt vom
Gerät (`MT:...`) oder dem aufgedruckten Zahlencode.

Gekoppelte Geräte auflisten:

```bash
docker exec -it homepilot-hub \
  python -m homepilot.integrations.matter -c /config/config.yaml
```

## 4. Benennen und einsortieren

Der Sensor meldet sich mit dem Namen, der in der koppelnden App steht –
sprechende Namen wie `Balkontüre` oder `Küchenfenster` sparen später Arbeit,
denn daraus leitet die App ab, ob sie „Tür offen" oder „Fenster offen"
schreibt (Name enthält *Fenster* → Fenster, sonst Tür).

Raum zuordnen in der `config.yaml`:

```yaml
rooms:
  Wohnzimmer:
    - matter.12_1        # Balkontüre
```

Die Entitäts-IDs stehen unter **Einstellungen → Geräte**.

## Was der Sensor liefert

| Anzeige | Bedeutung |
|---|---|
| Offen / Geschlossen | Magnetkontakt |
| Batterie … % | unter 15 % mit dem Zusatz „schwach!" |

## Automationen

```yaml
automations:
  - id: fenster_offen_erinnerung
    alias: Fenster beim Verlassen offen
    trigger:
      - type: state
        entity_id: helpers.abwesend
        to: "on"
    condition:
      - type: state
        entity_id: matter.12_1
        equals: "on"        # 'on' heisst offen
    action:
      - type: notify
        to: all
        title: Fenster offen
        body: Beim Gehen war noch ein Fenster offen.
```

Auch ohne Matter funktioniert dasselbe: Jeder Kontakt, dessen Zustand
`device_class: contact` trägt – oder dessen Name nach Tür/Fenster klingt –
landet im Hinweis auf der Startseite. Beim Nuki Smart Lock Pro kommt der
eingebaute Türsensor dazu, der meldet „offen" ganz von selbst.

## Das Nuki Smart Lock über Matter

Der Nuki Smart Lock Pro spricht ebenfalls Matter – und das ist mehr als
eine Geschmacksfrage: Über die Nuki-Web-API läuft jede Antwort über die
Nuki-Cloud, und der Hub fragt nach, statt benachrichtigt zu werden.
Deshalb dauert es nach dem Auf- oder Abschliessen, bis die Kachel folgt.
Über Matter passiert alles im Haus, und das Schloss meldet sich von
selbst.

**Koppeln.** In der Nuki-App: *Einstellungen → Matter* → Kopplungscode
erzeugen. Dann wie oben:

```bash
docker exec -it homepilot-hub \
  python -m homepilot.integrations.matter -c /config/config.yaml --pair 34970112332
```

**Was die Kachel dann kann.** Dieselben drei Knöpfe wie über die
Nuki-Schnittstelle – abschliessen, aufschliessen, «Auf + öffnen» – dazu
Akkustand und, falls der Türsensor eingelernt ist, ob die Türe selbst
offen steht.

Der Unterschied zwischen den beiden «auf» steckt in Matter selbst:
*Aufschliessen* fährt nur den Riegel zurück, die Türe bleibt zu und muss
aufgedrückt werden. *Auf + öffnen* zieht zusätzlich die Falle. Kann ein
Schloss das nicht getrennt, zeigt die App den dritten Knopf gar nicht
erst – zwei Knöpfe, die dasselbe tun, sind ein Knopf zu viel.

**Verlangt das Schloss einen PIN?** In der Nuki-App lässt sich
einstellen, dass Befehle aus der Ferne einen Code brauchen. Dann in die
`config.yaml`:

```yaml
  - integration: matter
    url: ws://127.0.0.1:5580/ws
    pin: "123456"
```

**Umziehen von der alten Kachel.** Wer den Nuki schon über die
`nuki`-Integration eingebunden hat, bekommt sonst zwei Kacheln für
dieselbe Türe. In der App unter **Einstellungen → Geräte** steht oben die
Karte *Werkzeuge* mit dem Knopf **Gerät ersetzen**: dort das alte wählen,
dann das neue `matter.…`. Szenen, Abläufe, Favorit und Raumzuordnung
wandern mit.

Wichtig ist die Reihenfolge: Beide Integrationen müssen dabei in der
`config.yaml` stehen, sonst gibt es kein altes Gerät mehr, von dem
umzuziehen wäre. Erst danach den `nuki`-Block auskommentieren – samt
`NUKI_TOKEN`.

(Die Karte *Werkzeuge* zeigt sich nur der Besitzerrolle. Die Auswahl
darin listet alle Geräte, auch wenn oben ein Suchbegriff steht – das neue
Gerät heisst fast nie wie das alte. Der Nuki über Matter meldet sich zum
Beispiel als «Smart Lock Pro».)

Ein Gerät kann übrigens beides gleichzeitig: In der Nuki-App bleibt das
Schloss, wie es war, auch wenn es zusätzlich in unserer Matter-Fabric
steht.

