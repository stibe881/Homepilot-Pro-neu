/**
 * Eine Sprachnotiz aufnehmen und auf die Boxen legen.
 *
 * «Levin, in fünf Minuten gehen wir» hat man schneller gesagt als
 * getippt – und aus der Box klingt es nach jemandem statt nach der
 * Vorlesestimme. Der Weg dahinter ist derselbe wie bei der Durchsage
 * (hub/core/sprachnotiz.py): aufnehmen, hochladen, abspielen.
 *
 * **Zwei Wege zum selben Ergebnis.** Im Browser und auf dem Wandpanel
 * nimmt der `MediaRecorder` auf, auf dem Telefon und dem iPad
 * `expo-audio` (lib/aufnahme-nativ.ts). Herauskommt beide Male ein
 * Blob, den der Hub auf die Boxen legt.
 *
 * Lange gab es nur den Browser-Weg, und das aus einem guten Grund: Ein
 * natives Aufnahmemodul heisst eine neue `runtimeVersion`, und die
 * kappt den OTA-Kanal für *alle* Telefone, bis jemand einen
 * TestFlight-Build installiert (CLAUDE.md, «Ausliefern»). Das war ein
 * hoher Preis für eine Kleinigkeit.
 *
 * Bezahlt wurde er trotzdem – aber nicht dafür: `expo-quick-actions`
 * kam als natives Modul dazu und machte einen neuen Build ohnehin
 * fällig. In derselben Runde kostet das Mikrofon nichts mehr extra.
 *
 * Wo es *doch* keines gibt (ein alter Browser ohne `MediaRecorder`),
 * zeigt die App den Knopf gar nicht erst, statt ihn auszugrauen: Ein
 * Knopf, der nie geht, ist ein Versprechen, das die App nicht hält.
 */
import { Platform } from 'react-native';


/** So lange darf eine Notiz höchstens laufen - danach stoppt sie
 *  selbst. Ein Zuruf, kein Vortrag; der Hub weist längeres ohnehin ab. */
export const HOECHSTENS_MS = 60_000;

/** Darunter war es ein Verrutschen am Knopf und keine Aufnahme. */
export const MINDESTENS_MS = 700;

/** Was der Browser aufnehmen soll, in der Reihenfolge der Vorliebe.
 *  Opus in WebM spielen Google-Cast-Boxen; das ist der Normalfall hier. */
const FORMATE = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

/**
 * Gibt es hier überhaupt ein Mikrofon, an das die App kommt?
 *
 * Nativ ja: Das Modul ist Teil der App-Hülle, und ob der Benutzer das
 * Mikrofon freigibt, entscheidet er beim ersten Druck - nicht hier.
 * Danach zu fragen, bloss um den Knopf zu zeigen, hiesse das Fenster
 * «HomePilot möchte auf das Mikrofon zugreifen» aufzumachen, bevor
 * jemand etwas sagen wollte.
 */
export function kannAufnehmen(): boolean {
  if (Platform.OS !== 'web') return true;
  return (
    typeof navigator !== 'undefined' &&
    !!navigator.mediaDevices?.getUserMedia &&
    typeof MediaRecorder !== 'undefined'
  );
}

/** Das erste Format, das dieser Browser kann - oder nichts (rein, testbar). */
export function bestesFormat(
  moeglich: (typ: string) => boolean,
  formate: string[] = FORMATE
): string | undefined {
  return formate.find((typ) => {
    try {
      return moeglich(typ);
    } catch {
      return false;
    }
  });
}

/**
 * «0:07» – die laufende Aufnahmedauer (rein, testbar).
 *
 * Mit Sekunden und nicht nur als Punkt: Wer aufnimmt, hat keinen
 * anderen Anhalt dafür, ob das Mikrofon wirklich läuft.
 */
export function dauerText(ms: number): string {
  const gesamt = Math.max(0, Math.floor(ms / 1000));
  return `${Math.floor(gesamt / 60)}:${String(gesamt % 60).padStart(2, '0')}`;
}

/**
 * Warum die Aufnahme nicht losging, auf Deutsch (rein, testbar).
 *
 * Die Namen kommen vom Browser und sagen einem Menschen nichts. Der
 * häufigste Fall ist der erste: Die Erlaubnis wurde abgelehnt oder das
 * Fenster mit der Frage weggeklickt.
 */
export function aufnahmeFehler(err: unknown): string {
  const name = (err as { name?: string })?.name ?? '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    // Zwei Welten, zwei Orte: Im Browser fragt die Adressleiste, auf dem
    // Telefon steht es in den Einstellungen. «Im Browser erlauben» half
    // dort niemandem.
    return Platform.OS === 'web'
      ? 'Das Mikrofon ist nicht freigegeben - im Browser erlauben und noch einmal versuchen.'
      : 'Das Mikrofon ist nicht freigegeben - in den Einstellungen des Telefons unter HomePilot erlauben.';
  }
  if (name === 'NotFoundError' || name === 'OverconstrainedError') {
    return 'Kein Mikrofon gefunden.';
  }
  if (name === 'NotReadableError') {
    return 'Das Mikrofon ist gerade von einem anderen Programm belegt.';
  }
  return 'Die Aufnahme ging nicht los.';
}

export interface Aufnahme {
  /** Beenden und die Aufnahme liefern. `null`, wenn nichts ankam. */
  stopp: () => Promise<Blob | null>;
  /** Wegwerfen - das Mikrofon wird trotzdem freigegeben. */
  abbrechen: () => void;
}

/**
 * Aufnahme starten. Wirft mit lesbarem Grund (siehe aufnahmeFehler).
 *
 * Die Spur wird am Ende ausdrücklich beendet: Sonst bleibt im Browser
 * der rote Aufnahmepunkt im Tab stehen, und auf dem Wandpanel sähe es
 * aus, als höre die Wohnung dauerhaft zu.
 *
 * Auf dem Telefon übernimmt `aufnahme-nativ.ts`. Nachgeladen und nicht
 * oben importiert: Sonst zöge der Web-Bau das native Modul mit.
 */
export async function starteAufnahme(): Promise<Aufnahme> {
  if (Platform.OS !== 'web') {
    const { starteNativ } = await import('./aufnahme-nativ');
    return starteNativ(HOECHSTENS_MS);
  }
  const spur = await navigator.mediaDevices.getUserMedia({ audio: true });
  const typ = bestesFormat((t) => MediaRecorder.isTypeSupported(t));
  const recorder = new MediaRecorder(spur, typ ? { mimeType: typ } : undefined);
  const stuecke: Blob[] = [];
  recorder.ondataavailable = (ereignis) => {
    if (ereignis.data && ereignis.data.size > 0) stuecke.push(ereignis.data);
  };
  recorder.start();

  const aufraeumen = () => spur.getTracks().forEach((track) => track.stop());

  // Selbstabschaltung: Wer den Knopf vergisst, soll nicht nach zehn
  // Minuten eine Aufnahme haben, die der Hub ohnehin abweist.
  const frist = setTimeout(() => {
    if (recorder.state === 'recording') recorder.stop();
  }, HOECHSTENS_MS);

  return {
    stopp: () =>
      new Promise<Blob | null>((fertig) => {
        clearTimeout(frist);
        const liefern = () => {
          aufraeumen();
          fertig(stuecke.length > 0 ? new Blob(stuecke, { type: typ ?? 'audio/webm' }) : null);
        };
        if (recorder.state === 'inactive') {
          liefern();
          return;
        }
        recorder.onstop = liefern;
        recorder.stop();
      }),
    abbrechen: () => {
      clearTimeout(frist);
      if (recorder.state !== 'inactive') recorder.stop();
      aufraeumen();
    },
  };
}
