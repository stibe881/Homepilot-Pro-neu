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
import { ScrollView, Text, View } from 'react-native';

/** So lange nach dem Start gilt ein Fehler als Startfehler. Danach ist
 *  die App am Laufen, und ein fataler Fehler soll wieder normal
 *  behandelt werden - dauerhaft alles zu schlucken hiesse, echte
 *  Probleme unsichtbar zu machen. */
const STARTFENSTER_MS = 15000;

let letzter: unknown = null;

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
      // Landet im Gerätelog (Console.app) - der einzige Weg, an dem man
      // von aussen an die Meldung kommt, wenn das Bild schon steht.
      console.error('[HomePilot] Fehler beim Start:', titel, text);
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
