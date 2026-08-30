/**
 * Das Netz für Fehler, die vor dem ersten Bild passieren.
 *
 * **Warum es das gibt.** Am 29. August schloss sich die App auf iPhone
 * und Wandpanel wortlos, keine Sekunde nach dem Antippen. Im
 * Absturzbericht stand als auslösende Queue
 * `expo.controller.errorRecoveryQueue`: Das ist die Fehler-Rettung von
 * `expo-updates`. Sie greift bei einem fatalen JS-Fehler beim Start,
 * versucht eine heile Fassung nachzuladen - und bricht den Prozess
 * ab, wenn das nicht gelingt (`ErrorRecovery.crash()`).
 *
 * Das Ärgerliche daran war nicht der Fehler, sondern die Stille: Das
 * `Auffangnetz` liegt *innerhalb* des Baums und fängt nur, was beim
 * Zeichnen passiert. Alles, was schon beim Laden der Module schiefgeht,
 * lief daran vorbei - und ein Release-Build zeigt dafür keine rote
 * Seite. Es blieb nur ein Absturzbericht ohne die JS-Meldung.
 *
 * Diese Datei schliesst genau diese Lücke, an zwei Stellen:
 *
 *  - `index.ts` lädt die App in einem `try`. Wirft schon das Laden,
 *    steht der Grund auf dem Bildschirm statt nirgends.
 *  - Der globale Fehlerfang nimmt fatale Fehler im Startfenster auf,
 *    statt sie zu `RCTFatal` durchzulassen. Damit bricht `expo-updates`
 *    den Prozess nicht ab, und man sieht, was los ist.
 *
 * Bewusst ohne Theme, ohne Symbolschrift, ohne eigene Bausteine: Was
 * einen kaputten Start erklären soll, darf nicht selbst an dem hängen,
 * was gerade kaputt ist.
 */
import React from 'react';
import { Alert, ScrollView, Text, View } from 'react-native';

/** So lange nach dem Start gilt ein Fehler als Startfehler. Danach ist
 *  die App am Laufen, und ein fataler Fehler soll wieder normal
 *  behandelt werden - dauerhaft alles zu schlucken hiesse, echte
 *  Probleme unsichtbar zu machen. */
const STARTFENSTER_MS = 15000;

let letzter: unknown = null;

/** Der eine Fehler, der den Start wirklich verhindert hat - falls es ihn gab. */
let fataler: unknown = null;

const zuhoerer = new Set<() => void>();

/** Wann dieses Modul geladen wurde - die Sekunden im Startbericht zählen ab hier. */
const geladenUm = Date.now();

/** Jede erreichte Etappe des Starts, mit Zeitpunkt. */
const marken: { name: string; nachMs: number }[] = [];

/** Wächst bei jeder Meldung - useSyncExternalStore braucht einen neuen Wert. */
let stand = 0;

function wecken(): void {
  stand += 1;
  for (const melden of [...zuhoerer]) {
    try {
      melden();
    } catch {
      // Ein kaputter Zuhörer darf die Meldung an die anderen nicht verhindern.
    }
  }
}

function standNummer(): number {
  return stand;
}

/**
 * Eine Etappe des Starts als erreicht melden.
 *
 * Der schwarze Bildschirm vom 30. August war kein Fehler, sondern ein
 * Hängen: App.tsx zeichnet nichts, solange Einstellungen oder
 * Symbolschrift nicht geladen sind - bleibt eines davon stecken, wird
 * nie ein Fehler geworfen, und es gibt nichts zu fangen. Die Marken
 * machen das Hängen lesbar: Der Startbericht zeigt, welche Etappe die
 * letzte war, und die fehlende ist der Ort des Problems.
 */
export function startmarke(name: string): void {
  if (marken.some((m) => m.name === name)) return;
  marken.push({ name, nachMs: Date.now() - geladenUm });
  wecken();
}

/** Alle erreichten Etappen - für Startbericht und System-Seite. */
export function startmarken(): { name: string; nachMs: number }[] {
  return [...marken];
}

/** Von der Startwache benutzt; testbar ohne React. */
export function startfehlerAbo(melden: () => void): () => void {
  zuhoerer.add(melden);
  return () => zuhoerer.delete(melden);
}

/** Der Fehler, der den Start verhindert hat - oder null. */
export function fatalerStartfehler(): unknown {
  return fataler;
}

/**
 * Einen geschluckten fatalen Fehler sichtbar machen.
 *
 * Nur schlucken reichte nicht: Am 29. August blieb nach dem Schlucken
 * ein schwarzer Bildschirm - React stand mitten im ersten Aufbau, und
 * die Meldung lag einzig in der Konsole, die ohne Mac niemand liest.
 * Deshalb zwei Wege, die beide ohne den kaputten Baum auskommen:
 * Die Startwache tauscht die Wurzel gegen den Notfallbildschirm, und
 * der native Alert zeigt die Meldung selbst dann, wenn auch das
 * nicht mehr zeichnet.
 */
function fatalMelden(fehler: unknown): void {
  fataler = fehler;
  wecken();
  // Den Alert erst nach einer Gnadenfrist, und nur wenn die App dann
  // wirklich nicht läuft: Der Entwicklungsmodus meldet auch Fehler als
  // fatal, die ein try/catch längst verkraftet hat (Metro ruft
  // reportFatalError beim Auswerten eines Moduls, bevor das catch
  // greift). Erreicht der Start «bereit», war es keiner.
  setTimeout(() => {
    if (marken.some((m) => m.name === 'bereit')) return;
    const { titel, text } = fehlerZeilen(fehler);
    try {
      Alert.alert('HomePilot: Fehler beim Start', text ? `${titel}\n\n${text}` : titel);
    } catch {
      // Ohne Alert bleibt der Notfallbildschirm.
    }
  }, 3000);
}

/** Was zuletzt beim Start schiefging - für die System-Seite. */
export function letzterStartfehler(): unknown {
  return letzter;
}

/** Was beim Start einzeln schiefging, mit dem Namen der Stelle. */
const gestolpert: { stelle: string; titel: string }[] = [];

/** Alle Stellen, die beim Start gestolpert sind - für die System-Seite. */
export function startfehlerListe(): { stelle: string; titel: string }[] {
  return [...gestolpert];
}

/**
 * Eine gestolperte Stelle festhalten, ohne den Start abzubrechen.
 *
 * Für die Anweisungen auf Modulebene in `App.tsx`: Sie müssen dort
 * stehen (ein Kanal oder ein Mitteilungsknopf muss angemeldet sein,
 * bevor die erste Nachricht eintrifft) - aber eine davon darf nicht
 * die ganze App mitnehmen. Der Name der Stelle steht mit dabei, sonst
 * sucht man ihn im Log zwischen allem anderen.
 */
export function startfehlerMerken(stelle: string, fehler: unknown): void {
  const { titel, text } = fehlerZeilen(fehler);
  gestolpert.push({ stelle, titel });
  letzter = fehler;
  console.error(`[HomePilot] ${stelle} beim Start gescheitert:`, titel, text);
}

/**
 * Aus einem geworfenen Ding zwei lesbare Zeilen machen (rein, testbar).
 *
 * Geworfen wird nicht immer ein `Error`: Ein `throw 'text'` oder ein
 * abgelehntes Versprechen mit einem Objekt kommt genauso an. Was hier
 * herauskommt, muss auf einen Bildschirm passen und den Ursprung nennen
 * - eine Meldung ohne die erste Stack-Zeile hat schon einmal eine
 * Stunde gekostet.
 */
export function fehlerZeilen(fehler: unknown): { titel: string; text: string } {
  if (fehler instanceof Error) {
    const stapel = (fehler.stack ?? '')
      .split('\n')
      .slice(1, 9)
      .map((zeile) => zeile.trim())
      .filter(Boolean)
      .join('\n');
    return { titel: fehler.message || fehler.name || 'Unbekannter Fehler', text: stapel };
  }
  if (typeof fehler === 'string') return { titel: fehler, text: '' };
  try {
    return { titel: 'Unbekannter Fehler', text: JSON.stringify(fehler, null, 2).slice(0, 800) };
  } catch {
    return { titel: 'Unbekannter Fehler', text: String(fehler) };
  }
}

/**
 * Fatale Fehler im Startfenster aufnehmen, statt die App sterben zu
 * lassen. Ausserhalb des Fensters übernimmt wieder, wer vorher dran war.
 */
export function globalenFangInstallieren(): void {
  const utils = (globalThis as { ErrorUtils?: {
    getGlobalHandler?: () => (fehler: unknown, fatal?: boolean) => void;
    setGlobalHandler?: (handler: (fehler: unknown, fatal?: boolean) => void) => void;
  } }).ErrorUtils;
  if (!utils?.setGlobalHandler) return;
  const vorher = utils.getGlobalHandler?.();
  const gestartet = Date.now();
  utils.setGlobalHandler((fehler, fatal) => {
    if (fatal && Date.now() - gestartet < STARTFENSTER_MS) {
      letzter = fehler;
      const { titel, text } = fehlerZeilen(fehler);
      console.error('[HomePilot] Fehler beim Start:', titel, text);
      fatalMelden(fehler);
      return;
    }
    vorher?.(fehler, fatal);
  });
}

/** Der Bildschirm, wenn die App gar nicht erst geladen werden konnte. */
export function Notfallbildschirm({ fehler }: { fehler: unknown }) {
  const { titel, text } = fehlerZeilen(fehler);
  return (
    <View style={{ flex: 1, backgroundColor: '#0F1115', paddingTop: 72, paddingHorizontal: 22 }}>
      <Text style={{ color: '#E9EDF4', fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
        HomePilot startet nicht
      </Text>
      <Text style={{ color: '#97A2B6', fontSize: 14, lineHeight: 20, marginBottom: 18 }}>
        Die App konnte nicht geladen werden. Der Hub läuft davon unberührt
        weiter - im Browser unter der Hub-Adresse ist das Haus bedienbar.
      </Text>
      <ScrollView style={{ flex: 1 }}>
        <Text selectable style={{ color: '#F0656A', fontSize: 14, fontWeight: '600', marginBottom: 8 }}>
          {titel}
        </Text>
        <Text selectable style={{ color: '#6C7688', fontSize: 12, lineHeight: 17 }}>
          {text}
        </Text>
      </ScrollView>
    </View>
  );
}

/** Eine Wurzelkomponente, die nur den Fehler zeigt - für `index.ts`. */
export function notfallWurzel(fehler: unknown): () => React.JSX.Element {
  letzter = fehler;
  const { titel, text } = fehlerZeilen(fehler);
  console.error('[HomePilot] Die App liess sich nicht laden:', titel, text);
  return function Notfall() {
    return <Notfallbildschirm fehler={fehler} />;
  };
}

/**
 * Die Wurzel über der Wurzel: zeigt die App - bis ein fataler
 * Startfehler gemeldet wird, dann den Notfallbildschirm mit der
 * Meldung. Sie ist bewusst winzig: Je weniger sie selbst braucht,
 * desto sicherer steht sie noch, wenn darunter alles liegt.
 */
/** So lange darf der Start still bleiben, bevor der Bericht erscheint. */
const BERICHT_NACH_MS = 7000;

export function Startwache({ children }: { children: React.ReactNode }) {
  React.useSyncExternalStore(startfehlerAbo, standNummer, standNummer);
  const [wartetLange, setWartetLange] = React.useState(false);
  React.useEffect(() => {
    const wecker = setTimeout(() => setWartetLange(true), BERICHT_NACH_MS);
    return () => clearTimeout(wecker);
  }, []);

  const bereit = marken.some((m) => m.name === 'bereit');
  // Der Notfallbildschirm nur, solange die App nicht fertig gestartet
  // ist: Am 31. August hielt er in Expo Go die ganze App an, weil der
  // Entwicklungsmodus einen verkrafteten Import-Fehler (App-Symbol-
  // Wechsler fehlt in Expo Go) zusätzlich als fatal meldete. Kommt
  // «bereit» doch noch, läuft die App - der Fehler bleibt für die
  // System-Seite festgehalten.
  if (fataler != null && !bereit) return <Notfallbildschirm fehler={fataler} />;
  return (
    <View style={{ flex: 1 }}>
      {children}
      {wartetLange && !bereit ? <Startbericht /> : null}
    </View>
  );
}

/**
 * Der Bericht, wenn der Start hängt statt zu scheitern.
 *
 * Als Schicht über der App, nicht statt ihr: Die App bleibt darunter
 * gemountet und darf fertig werden - meldet sie «bereit», nimmt die
 * Wache den Bericht wieder weg. Aufbau wie der Notfallbildschirm:
 * ohne Theme, ohne Symbolschrift, ohne eigene Bausteine.
 */
function Startbericht() {
  const liste = startmarken();
  const gestolperte = startfehlerListe();
  const { titel, text } = fehlerZeilen(letzter);
  return (
    <View
      style={{
        position: 'absolute',
        top: 0,
        left: 0,
        right: 0,
        bottom: 0,
        backgroundColor: '#0F1115',
        paddingTop: 72,
        paddingHorizontal: 22,
      }}
    >
      <Text style={{ color: '#E9EDF4', fontSize: 20, fontWeight: '700', marginBottom: 10 }}>
        HomePilot hängt beim Start
      </Text>
      <Text style={{ color: '#97A2B6', fontSize: 14, lineHeight: 20, marginBottom: 18 }}>
        Kein Fehler, aber es geht nicht weiter. So weit ist der Start
        gekommen - die Etappe nach der letzten Zeile ist die, die hängt.
      </Text>
      <ScrollView style={{ flex: 1 }}>
        {liste.map((marke) => (
          <Text key={marke.name} selectable style={{ color: '#E9EDF4', fontSize: 14, lineHeight: 22 }}>
            {`+${(marke.nachMs / 1000).toFixed(1)}s  ${marke.name}`}
          </Text>
        ))}
        {liste.length === 0 ? (
          <Text selectable style={{ color: '#F0656A', fontSize: 14 }}>
            Keine einzige Etappe erreicht - schon das Laden der App-Module hängt.
          </Text>
        ) : null}
        {gestolperte.map((eintrag) => (
          <Text
            key={eintrag.stelle}
            selectable
            style={{ color: '#F0B056', fontSize: 13, lineHeight: 20, marginTop: 8 }}
          >
            {`gestolpert: ${eintrag.stelle} - ${eintrag.titel}`}
          </Text>
        ))}
        {letzter != null ? (
          <>
            <Text selectable style={{ color: '#F0656A', fontSize: 14, fontWeight: '600', marginTop: 14 }}>
              {titel}
            </Text>
            <Text selectable style={{ color: '#6C7688', fontSize: 12, lineHeight: 17 }}>
              {text}
            </Text>
          </>
        ) : null}
      </ScrollView>
    </View>
  );
}

/**
 * Das erste Bild überhaupt: dunkler Grund, eine Zeile, die Etappen.
 *
 * Es steht auf dem Bildschirm, *bevor* die App-Module geladen werden
 * (index.ts lädt sie erst nach dem ersten Zeichnen). Hängt das Laden,
 * friert genau dieses Bild ein - und die letzte Etappe darauf sagt, wie
 * weit es kam. Der schwarze Bildschirm vom 30. August konnte das nicht:
 * Damals lief das Laden vor dem ersten Zeichnen, und ein Hängen dort
 * liess nichts als Schwarz zurück.
 */
export function Startbild() {
  React.useSyncExternalStore(startfehlerAbo, standNummer, standNummer);
  const liste = startmarken();
  return (
    <View style={{ flex: 1, backgroundColor: '#0F1115', paddingTop: 72, paddingHorizontal: 22 }}>
      <Text style={{ color: '#97A2B6', fontSize: 15 }}>HomePilot startet …</Text>
      <View style={{ marginTop: 16 }}>
        {liste.map((marke) => (
          <Text key={marke.name} selectable style={{ color: '#6C7688', fontSize: 13, lineHeight: 20 }}>
            {`+${(marke.nachMs / 1000).toFixed(1)}s  ${marke.name}`}
          </Text>
        ))}
      </View>
    </View>
  );
}
