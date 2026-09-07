/**
 * «Geht in 12 Min aus» - die Restzeit eines Ablaufs, lesbar gemacht.
 *
 * Ein Ablauf schaltet das Licht nach dreissig Minuten wieder aus. Der
 * Hub weiss das die ganze Zeit; im Haus wusste es niemand - man stand
 * im Kinderzimmer und riet, ob es gleich ausgeht oder erst in einer
 * halben Stunde. Trägt der Ablauf den Schalter «Restzeit anzeigen»,
 * schickt der Hub den Zeitpunkt als `off_at` im Zustand mit
 * (hub/core/abschaltung.py); heruntergezählt wird hier.
 *
 * Rein und ohne Netz: Der Zeitpunkt kommt einmal, die Anzeige rechnet
 * daraus bei jedem Takt neu - so kostet ein laufender Countdown keine
 * einzige Meldung mehr.
 */

/** Wie viele Sekunden noch - `null`, sobald es vorbei ist. */
export function restSekunden(offAt: unknown, jetzt: number): number | null {
  if (typeof offAt !== 'number' || !Number.isFinite(offAt)) return null;
  const rest = offAt * 1000 - jetzt;
  return rest > 0 ? Math.round(rest / 1000) : null;
}

/**
 * Die Restzeit in Worten (rein, testbar).
 *
 * Unter einer Minute sekundengenau, darüber in Minuten aufgerundet:
 * «noch 1 Min» ist ehrlicher als «noch 0 Min», solange überhaupt etwas
 * übrig ist. Ab einer Stunde mit Stunde und Minute - «noch 92 Min»
 * rechnet sonst jeder selbst um.
 */
export function restText(sekunden: number): string {
  if (sekunden < 60) return `${Math.max(1, Math.round(sekunden))} s`;
  const minuten = Math.ceil(sekunden / 60);
  if (minuten < 60) return `${minuten} Min`;
  const stunden = Math.floor(minuten / 60);
  const rest = minuten % 60;
  return rest === 0 ? `${stunden} Std` : `${stunden} Std ${rest} Min`;
}

/** «geht in 12 Min aus» - der ganze Satz, oder `null`. */
export function abschaltSatz(
  state: { off_at?: number | null } | null | undefined,
  jetzt: number
): string | null {
  const rest = restSekunden(state?.off_at, jetzt);
  return rest === null ? null : `geht in ${restText(rest)} aus`;
}

/** Die kürzeste laufende Restzeit einer Geräteliste (rein, testbar).
 *
 *  Für die Raumkarte: Brennen zwei Lichter mit Frist, ist die nächste
 *  die Auskunft, auf die es ankommt - «noch 3 Min» sagt mehr über den
 *  Raum als «noch 25 Min». */
export function naechsteAbschaltung(
  items: { state?: { off_at?: number | null } }[],
  jetzt: number
): number | null {
  const reste = items
    .map((item) => restSekunden(item.state?.off_at, jetzt))
    .filter((rest): rest is number => rest !== null);
  return reste.length === 0 ? null : Math.min(...reste);
}
