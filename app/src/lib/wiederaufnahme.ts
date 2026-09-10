/**
 * Da weitermachen, wo man war.
 *
 * Die App öffnet immer auf der Startseite. Für den Normalfall ist das
 * richtig – man will sehen, wie es im Haus steht. Für den anderen Fall
 * ist es lästig, und der kommt öfter vor, als es scheint: Man steht in
 * den Abläufen, das Telefon sperrt sich, man entsperrt es wieder – und
 * ist auf der Startseite. Oder man wird beim Bearbeiten eines Ablaufs
 * angerufen. Was man gerade tat, ist weg, und man klickt sich denselben
 * Weg noch einmal.
 *
 * Deshalb: Wer eine Seite innerhalb der letzten paar Minuten verlassen
 * hat, kommt dorthin zurück. Wer die App gestern zuletzt offen hatte,
 * beginnt auf der Startseite – die Frage von gestern ist beantwortet.
 *
 * Zwei Dinge, die bewusst *nicht* wiederhergestellt werden:
 *
 * - **Blätter, Dialoge und halb Getipptes.** Ein Bearbeitungsblatt, das
 *   von selbst wieder aufgeht, ist erschreckend – man weiss nicht, ob
 *   man etwas gespeichert hat. Die Seite ja, der Zustand darin nein.
 * - **Das Wandtablet.** Dort ist die Startseite kein Standardwert,
 *   sondern der Zweck: Es hängt im Flur und soll zeigen, wie es im Haus
 *   steht, nicht die Einstellungsseite, auf der jemand gestern etwas
 *   nachgesehen hat. Dafür gibt es dort ohnehin die Rückkehr nach drei
 *   Minuten (DashboardScreen).
 *
 * Reines Rechnen; wer speichert, ist der Bildschirm.
 */
import type { Section } from './bereiche';

/**
 * Wo die zuletzt besuchte Seite liegt – im Speicher des Telefons.
 *
 * Die Ausnahme von der Regel in der CLAUDE.md («nie in den Speicher der
 * App»), und mit Grund: Was hier steht, ist keine Einstellung, sondern
 * eine Beobachtung über *dieses* Gerät. Auf dem zweiten Telefon wäre sie
 * falsch – dort war man woanders –, und nach zehn Minuten ist sie
 * ohnehin wertlos. Beim Hub abgelegt hinge sie an einem Abruf, den der
 * Start nicht braucht.
 */
export const SCHLUESSEL = 'homepilot.letzteSeite';

/**
 * So lange gilt «da war ich gerade».
 *
 * Zehn Minuten: lang genug für einen Anruf, ein Gespräch an der Türe
 * oder einen Weg in den Keller; kurz genug, dass das Telefon am nächsten
 * Morgen nicht dort aufmacht, wo man abends stehen geblieben ist.
 */
export const FRIST_MINUTEN = 10;

/** Was gespeichert wird. */
export interface Stand {
  section: Section;
  at: number;
}

/**
 * Seiten, zu denen nicht zurückgekehrt wird (rein, testbar).
 *
 * Der Massstab: Würde jemand erschrecken, wenn die App hier aufgeht?
 * Die Alarmanlage ja – sie sieht nach «etwas ist passiert» aus, auch
 * wenn nichts war. Die Benutzerverwaltung ebenso: Wer das Telefon
 * jemandem in die Hand gibt, will nicht, dass es dort aufmacht.
 */
export const NICHT_ZURUECK: Section[] = ['alarm', 'users', 'account', 'connection'];

/** Taugt diese Seite als Rückkehrziel? (rein, testbar) */
export function merkbar(section: Section): boolean {
  return section !== 'start' && !NICHT_ZURUECK.includes(section);
}

/**
 * Einen Stand einlesen (rein, testbar).
 *
 * Alles Unklare wird zu `null` statt zu einem Fehler: Eine kaputte Zeile
 * in den Einstellungen darf höchstens dazu führen, dass die App auf der
 * Startseite aufmacht – also genau dort, wo sie ohnehin aufmachte.
 */
export function lesen(roh: unknown): Stand | null {
  if (typeof roh !== 'object' || roh === null) return null;
  const zeile = roh as Record<string, unknown>;
  const section = typeof zeile.section === 'string' ? (zeile.section as Section) : null;
  const at = typeof zeile.at === 'number' ? zeile.at : null;
  if (!section || at === null) return null;
  return { section, at };
}

/**
 * Wohin die App aufmacht (rein, testbar).
 *
 * `null` heisst: auf die Startseite, wie bisher.
 */
export function zurueckZu(
  roh: unknown,
  jetzt: number,
  { tablet = false }: { tablet?: boolean } = {}
): Section | null {
  if (tablet) return null;
  const stand = lesen(roh);
  if (stand === null || !merkbar(stand.section)) return null;
  if (jetzt - stand.at > FRIST_MINUTEN * 60_000) return null;
  return stand.section;
}
