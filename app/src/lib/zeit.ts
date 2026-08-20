/**
 * Zeitpunkte, die vom Hub als ISO-Text kommen, lesbar machen.
 *
 * Der Hub stempelt in UTC (`…Z`) – richtig so, das ist eindeutig und
 * überlebt jeden Wechsel der Sommerzeit. Nur anzeigen darf man das nicht:
 * «gebaut 2026-08-19T05:02:43Z» ist weder lesbar noch stimmt es, wenn man
 * es für Ortszeit hält. In Zell sind das 07:02.
 */

/** Fehlt die Zeitzone, ist UTC gemeint.
 *
 *  Der Hub stempelt immer in UTC. JavaScript liest einen ISO-Text *ohne*
 *  Zonenangabe aber als Ortszeit – im Sommer wären das zwei Stunden
 *  daneben, und zwar lautlos. Lieber hier ergänzen als sich darauf
 *  verlassen, dass jeder Stempel das Z mitbringt. */
function asUtc(iso: string): string {
  return /[Zz]|[+-]\d{2}:?\d{2}$/.test(iso) ? iso : `${iso}Z`;
}

/** ISO-Zeitstempel als Schweizer Ortszeit, z.B. «19.08.2026, 07:02».
 *
 *  Gibt den Rohtext zurück, wenn er sich nicht lesen lässt – falsch
 *  formatiert ist immer noch besser als eine Zeile, die «Invalid Date»
 *  behauptet oder ganz verschwindet. */
export function localTime(iso: string | null | undefined): string {
  if (!iso || iso === 'unbekannt') return '';
  const stamp = new Date(asUtc(iso));
  if (Number.isNaN(stamp.getTime())) return String(iso);
  return stamp.toLocaleString('de-CH', {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

/** Wie lange ist das her? – «vor 3 Stunden», «vor 5 Tagen».
 *
 *  Beim Bau-Zeitpunkt ist das die eigentliche Frage: Nicht wann genau
 *  gebaut wurde, sondern ob der Stand von eben ist oder von letzter
 *  Woche. Leer, wenn sich nichts sagen lässt. */
export function timeAgo(iso: string | null | undefined, now: number = Date.now()): string {
  if (!iso || iso === 'unbekannt') return '';
  const stamp = new Date(asUtc(iso)).getTime();
  if (Number.isNaN(stamp)) return '';
  return agoFrom(stamp, now);
}

/** Dasselbe für Unix-Sekunden, wie sie Entitäten und Protokolle tragen. */
export function epochAgo(at: number | null | undefined, now: number = Date.now()): string {
  if (!at || !Number.isFinite(at)) return '';
  return agoFrom(at * 1000, now);
}

/** Unix-Sekunden als kurze Ortszeit, z.B. «20. Aug., 14:19». */
export function epochTime(at: number | null | undefined): string {
  if (!at || !Number.isFinite(at)) return '';
  return new Date(at * 1000).toLocaleString('de-CH', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function agoFrom(stamp: number, now: number): string {
  const seconds = Math.round((now - stamp) / 1000);
  // Kleine Abweichungen in die Zukunft kommen von ungleich gestellten
  // Uhren – als «gerade eben» zu zeigen ist ehrlicher als «in -2 Minuten».
  if (seconds < 90) return 'gerade eben';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `vor ${minutes} Minuten`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return hours === 1 ? 'vor einer Stunde' : `vor ${hours} Stunden`;
  const days = Math.round(hours / 24);
  return days === 1 ? 'vor einem Tag' : `vor ${days} Tagen`;
}
