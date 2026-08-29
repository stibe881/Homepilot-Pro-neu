# Was auf welchem Gerät geht

Dieselbe Quelle wird zu drei Programmen: iPhone und iPad (nativ),
Android (baubar – der Weg steht in [android.md](android.md)) und
Browser. Das meiste ist überall gleich. Was nicht, steht hier.

Die Frage dahinter ist fast immer dieselbe: **«Warum sehe ich das im
Browser nicht?»**

## Die Tabelle

| | iPhone/iPad | Browser | Warum |
| --- | --- | --- | --- |
| Geräte schalten, Abläufe, Szenen, Listen | ja | ja | – |
| Kurzes Vibrieren beim Schalten | ja | nein | Der Browser kennt die Schnittstelle nicht |
| Face ID vor dem Türöffner | ja | nein | Braucht `expo-local-authentication` |
| Push, wenn die App zu ist | ja | nein | Im Browser gibt es nur die offene Seite |
| Sperrbildschirm-Widget, Kurzbefehle, NFC | ja | nein | iOS-eigen |
| QR-Code mit der Kamera | ja | nein | Kamerazugriff nur über HTTPS; der Hub läuft ohne Zertifikat |
| Escape schliesst ein Fenster | – | ja | Auf dem Telefon gibt es die Taste nicht |
| Live-Bild der Kameras | expo-video | hls.js | Safari kann HLS, Chrome und Firefox nicht |
| «Diese Fassung wurde nachgeladen» | ja | – | Im Browser sagt das die `version.json` neben dem Bündel |

## Wo das im Code steht

In [`app/src/lib/plattform.ts`](../app/src/lib/plattform.ts) – als
**Fähigkeiten**, nicht als Plattformnamen:

```typescript
if (!kann.widgets) return null;      // nicht: Platform.OS !== 'ios'
```

Der Unterschied ist nicht Geschmack. `Platform.OS === 'ios'` an einer
Widget-Abfrage heisst nicht «auf dem iPhone», sondern «dort, wo es
Widgets gibt». Käme Android je dazu, ändert sich eine Zeile in
`plattform.ts` und keine in einem Bildschirm.

**Wer eine neue Abhängigkeit einführt**, trägt sie dort ein und hier in
die Tabelle. Eine `Platform.OS`-Abfrage mitten in einem Bildschirm ist
der Anfang der nächsten verstreuten Zwanzig.

## Die Einstellungen: dieselben Punkte, zwei Formen

Was hinter «Einstellungen» liegt, steht als eine Liste in
`DashboardScreen.tsx` – gezeigt wird sie je nach Platz verschieden.

| Breite | Form |
|---|---|
| ab 1000 | Menüspalte links, Inhalt rechts. Überschrift «Administrator» trennt Bedienen von Einrichten (`lib/einstellungsmenue.ts`). |
| darunter | Eine Kopfzeile, und der Seitenname ist der Wechsler: Ein Tipp öffnet ein Blatt von unten mit allen Bereichen (`components/einstellungen/`). |

Auf dem Telefon gilt ausserdem:

- Ein Tipp auf «Einstellungen» führt gleich auf die Seite von letztem
  Mal. Nur beim allerersten Mal geht die Übersicht auf – sie ist dort
  die Karte (`einstiegsSeite`, dritter Parameter).
- Die Übersicht ist gruppiert, durchsuchbar und trägt an einigen Zeilen
  eine Plakette («Scharf», «3»). Gruppen, Farben und Stichwörter stehen
  in [`lib/einstellungsgruppen.ts`](../app/src/lib/einstellungsgruppen.ts)
  – **wer einen Punkt hinzufügt, trägt ihn dort in eine Gruppe ein**,
  sonst landet er unter «Weitere».
- Eine Tür «Administrator» gibt es dort nicht mehr: Sie sparte einen
  Bildschirm und kostete zwei Tipps.

## Die zwei Ausnahmen

Zwei Stellen prüfen weiterhin direkt, und mit Absicht:

- **`CameraLive.tsx` / `CameraLive.web.tsx`** – hier entscheidet nicht
  eine Abfrage, sondern der Bündler: Er nimmt auf dem Web die
  `.web`-Fassung. So landet `hls.js` gar nicht erst im App-Bündel. Das
  ist der saubere Weg für alles, was ganze Bibliotheken unterscheidet.
- **`lib/origin.ts`** – im Browser steht die Hub-Adresse in der URL, aus
  der die Seite kam. Auf dem Telefon gibt es keine, und dort steht eine
  Vorgabe.

## Was nur am Gerät prüfbar ist

Der Weg mit Demo-Hub und Browser (in der [CLAUDE.md](../CLAUDE.md))
beantwortet Layoutfragen zuverlässig. **Nicht** beantwortet er: Tastatur,
Haptik, Widgets, Face ID, Push und die Sicherheitsabstände oben und
unten. Dafür führt kein Weg am iPhone vorbei.
