/**
 * Der Anrufbeantworter des Hauses (Punkt 259 der Werkbank).
 *
 * Eine Sprachnotiz «fürs nächste Heimkommen»: Im Durchsage-Blatt
 * aufgesprochen, beim Hub hinterlegt - und wer als Nächstes ankommt,
 * hört sie auf der gewählten Box. Danach ist sie verbraucht.
 *
 * Hier steht nur das Rechnen fürs Blatt: was die liegende Nachricht
 * anzeigt und was nach dem Hinterlegen dasteht. Wann sie spielt und wer
 * sie nicht verbraucht (der Hinterleger selbst, die Neustart-Welle),
 * entscheidet der Hub (hub/core/heimgruss.py) - die App zeigt nur an.
 */

/** Was der Hub über die liegende Nachricht sagt (GET /api/heimgruss). */
export interface HeimgrussStand {
  /** Wer sie hinterlegt hat. */
  by: string;
  /** Wann, in Sekunden seit 1970 - der Hub rechnet in Sekunden. */
  at: number;
  /** Wann sie verfällt (48 h nach dem Hinterlegen), ebenfalls Sekunden. */
  until: number;
  /** Die gewählten Boxen; leer heisst alle. */
  speakers: string[];
}

/**
 * «noch 2 Std.» - wie lange die Nachricht noch liegt (rein, testbar).
 *
 * Unter zwei Stunden in Minuten: «noch 0 Std.» klänge, als sei sie
 * schon weg. Abgelaufen (der Hub räumt erst bei der nächsten Ankunft
 * oder Abfrage auf): leer, dann zeigt das Blatt die Zeile gar nicht.
 */
export function restText(untilSekunden: number, jetztMs: number): string {
  const rest = untilSekunden - jetztMs / 1000;
  if (rest <= 0) return '';
  const minuten = Math.max(1, Math.round(rest / 60));
  if (minuten < 120) return `noch ${minuten} Min.`;
  return `noch ${Math.round(minuten / 60)} Std.`;
}

/** Liegt (noch) etwas auf dem Band? (rein, testbar) */
export function istOffen(
  stand: HeimgrussStand | null | undefined,
  jetztMs: number
): stand is HeimgrussStand {
  return !!stand && stand.until > jetztMs / 1000;
}

/**
 * Die Zeile über der liegenden Nachricht (rein, testbar).
 *
 * Wer sie hinterlegt hat, gehört dazu: «Zurückziehen» drückt man
 * anders, wenn man weiss, dass es Papas Nachricht ist. Die Restzeit
 * sagt, warum man sich nicht beeilen muss - oder doch.
 */
export function standZeile(stand: HeimgrussStand, jetztMs: number): string {
  const wer = stand.by ? `Nachricht von ${stand.by}` : 'Eine Nachricht';
  const rest = restText(stand.until, jetztMs);
  const kopf = `${wer} wartet aufs nächste Heimkommen`;
  return rest ? `${kopf} · ${rest}` : kopf;
}

/**
 * Was nach dem Hinterlegen dasteht (rein, testbar).
 *
 * Mit dem Ziel, wie bei der Bestätigung einer Durchsage: Eine
 * hinterlegte Nachricht sieht sonst genauso aus wie eine, die eben
 * durchs Haus geschallt ist - und genau das ist sie nicht.
 */
export function hinterlegtText(zielName: string): string {
  return `Hinterlegt - wer als Nächstes heimkommt, hört deine Nachricht (${zielName}).`;
}
