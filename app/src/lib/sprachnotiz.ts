/**
 * Eine Sprachnotiz aufnehmen und auf die Boxen legen.
 *
 * «Levin, in fünf Minuten gehen wir» hat man schneller gesagt als
 * getippt – und aus der Box klingt es nach jemandem statt nach der
 * Vorlesestimme. Der Weg dahinter ist derselbe wie bei der Durchsage
 * (hub/core/sprachnotiz.py): aufnehmen, hochladen, abspielen.
 *
 * **Warum nur im Browser und auf dem Wandpanel.** Aufnehmen braucht ein
 * Mikrofon-Modul, und die App hat keines. Eines nachzurüsten hiesse ein
 * neues Expo-Modul – also eine neue `runtimeVersion`, und damit wäre
 * der OTA-Kanal für *alle* Telefone gekappt, bis jemand einen
 * TestFlight-Build installiert (siehe CLAUDE.md, «Ausliefern»). Das ist
 * ein hoher Preis für eine Kleinigkeit, und der Browser kann es ohnehin.
 *
 * Auf dem Telefon zeigt die App den Knopf deshalb gar nicht erst, statt
 * ihn auszugrauen: Ein Knopf, der nie geht, ist ein Versprechen, das
 * die App nicht hält.
 */

/** So lange darf eine Notiz höchstens laufen - danach stoppt sie
 *  selbst. Ein Zuruf, kein Vortrag; der Hub weist längeres ohnehin ab. */
export const HOECHSTENS_MS = 60_000;

/** Darunter war es ein Verrutschen am Knopf und keine Aufnahme. */
export const MINDESTENS_MS = 700;

/** Was der Browser aufnehmen soll, in der Reihenfolge der Vorliebe.
 *  Opus in WebM spielen Google-Cast-Boxen; das ist der Normalfall hier. */
const FORMATE = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg'];

/** Gibt es hier überhaupt ein Mikrofon, an das die App kommt? */
export function kannAufnehmen(): boolean {
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
    return 'Das Mikrofon ist nicht freigegeben - im Browser erlauben und noch einmal versuchen.';
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
 */
export async function starteAufnahme(): Promise<Aufnahme> {
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
