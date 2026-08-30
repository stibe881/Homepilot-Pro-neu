/**
 * Die Adresse der Aufnahme zu einem Zeitleisten-Ereignis (rein, testbar).
 *
 * Das Token steht in der Adresse, weil Videoplayer keine eigenen
 * Kopfzeilen mitschicken - derselbe Weg wie beim Live-Bild. Ohne
 * lesbaren Anfangszeitpunkt gibt es keine Adresse: Der Hub könnte mit
 * NaN nichts anfangen.
 */
export function aufnahmeUrl(
  basis: string,
  token: string,
  entityId: string,
  event: { start: string; end?: string | null }
): string | null {
  const start = Date.parse(event.start);
  if (Number.isNaN(start)) return null;
  const ende = event.end ? Date.parse(event.end) : NaN;
  const endeTeil = Number.isNaN(ende) ? '' : `&end=${ende}`;
  return (
    `${basis}/api/entities/${encodeURIComponent(entityId)}/clip` +
    `?start=${start}${endeTeil}&token=${encodeURIComponent(token)}`
  );
}
