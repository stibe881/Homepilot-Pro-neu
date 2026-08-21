/**
 * Befehle, die getippt wurden, während der Hub weg war.
 *
 * Die App zeigt ohne Verbindung den letzten bekannten Stand – richtig so.
 * Tippte man dann aber auf einen Schalter, lief der Befehl ins Leere, und
 * nichts sagte es. Hier stehen die zwei Entscheidungen, die eine
 * Warteschlange braucht: was hineinkommt und was beim Wiederverbinden
 * noch hinausgeht.
 *
 * Bewusst rein und ohne React: Beides ist entscheidbar und lässt sich nur
 * prüfen, wenn es für sich steht.
 */

/**
 * So lange darf ein Befehl warten, bis die Verbindung wiederkommt.
 *
 * Zwei Minuten sind der Punkt, an dem «ich habe gerade auf Licht getippt»
 * in «ich weiss nicht mehr, was ich wollte» übergeht. Ein Befehl, der
 * nach zwanzig Minuten im Keller nachträglich das Licht anmacht, ist kein
 * Dienst, sondern ein Spuk.
 */
const QUEUE_MAX_AGE = 120000;
/** So viele wartende Befehle höchstens – darüber ist etwas anderes kaputt. */
const QUEUE_LIMIT = 20;
/** Ein Befehl, der auf die Verbindung wartet. */
export interface QueuedCommand {
  entityId: string;
  command: string;
  data?: Record<string, any>;
  at: number;
}

/**
 * Die Warteschlange nach einem neuen Befehl (rein, testbar).
 *
 * Zwei Regeln, beide aus dem Alltag:
 *
 * **Je Gerät und Befehlsart bleibt der letzte.** Wer im Funkloch fünfmal
 * auf dasselbe Licht tippt, will einmal Licht – nicht fünf Schaltungen,
 * die nacheinander durchlaufen und es am Ende wieder ausmachen.
 *
 * **Zu alt fällt weg.** Wozu die Frist gut ist, steht bei
 * ``QUEUE_MAX_AGE``.
 */
export function enqueue(
  queue: QueuedCommand[],
  befehl: QueuedCommand,
  maxAge = QUEUE_MAX_AGE,
  limit = QUEUE_LIMIT
): QueuedCommand[] {
  const frisch = queue.filter(
    (eintrag) =>
      befehl.at - eintrag.at < maxAge &&
      !(eintrag.entityId === befehl.entityId && eintrag.command === befehl.command)
  );
  return [...frisch, befehl].slice(-limit);
}

/** Was beim Wiederverbinden noch gesendet wird (rein, testbar). */
export function stillFresh(
  queue: QueuedCommand[],
  jetzt: number,
  maxAge = QUEUE_MAX_AGE
): QueuedCommand[] {
  return queue.filter((eintrag) => jetzt - eintrag.at < maxAge);
}
