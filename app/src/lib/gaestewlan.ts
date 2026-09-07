/**
 * Was die Gäste-WLAN-Karte zeigt – und wann sie gar nicht erst erscheint.
 *
 * Die Karte kann zwei Dinge: einen QR-Code aus `guest_wifi` und einen
 * Gutschein-Spender aus der UniFi-Anbindung. Beides ist unabhängig
 * voneinander eingerichtet, und beides kann fehlen.
 */

/** Was auf der Karte Platz hat. */
export type Gaesteansicht =
  /** Weder QR-Code noch Gutscheine – es gibt nur den Einrichtungshinweis. */
  | 'einrichten'
  /** Mindestens eines von beiden ist da; die Karte zeigt, was sie hat. */
  | 'karte';

/** Welche Ansicht die Gäste-Karte trägt (rein, testbar).
 *
 *  Der leere Vorrat ist der Fall, an dem die frühere Regel scheiterte:
 *  Wer das Gäste-Netz ausschliesslich über das UniFi-Portal betreibt,
 *  hat keinen `guest_wifi`-Abschnitt und anfangs auch keinen einzigen
 *  Gutschein. Zählte man die Gutscheine, stand dort der Hinweis, man
 *  möge `guest_wifi` eintragen – und die Knöpfe, mit denen man den
 *  ersten Gutschein anlegt, lagen hinter genau diesem Hinweis. Ein
 *  Anfang, aus dem es keinen Anfang gab.
 *
 *  Darum zählt nicht der Vorrat, sondern ob der Hub überhaupt eine
 *  UniFi-Anbindung hat: `null` heisst «keine», die leere Liste heisst
 *  «angebunden, nur gerade nichts da». */
export function gaesteansicht(
  hatWlan: boolean,
  vouchers: readonly unknown[] | null
): Gaesteansicht {
  return hatWlan || vouchers != null ? 'karte' : 'einrichten';
}

/**
 * Die Standarddauer eines Gutscheins, in Stunden.
 *
 * Acht Stunden decken den Fall ab, für den der Spender gedacht ist: ein
 * Besuch über einen Abend. Vier waren zu knapp - wer um sieben kommt,
 * fliegt um elf aus dem Netz -, und länger muss man bewusst wählen.
 */
export const STANDARD_STUNDEN = 8;

/** Die längeren Dauern, die als eigene Knöpfe danebenstehen.
 *
 *  Bewusst nur drei: Übernachtung, langes Wochenende, Ferienwoche. Jede
 *  weitere Zahl wäre eine Entscheidung mehr an einer Stelle, an der man
 *  meist in Eile steht. */
export const DAUERN = [
  { stunden: 24, label: '1 Tag' },
  { stunden: 72, label: '3 Tage' },
  { stunden: 168, label: '1 Woche' },
] as const;

/** «8 Std.», «1 Tag», «1 Woche» - aus den Minuten des Controllers
 *  (rein, testbar).
 *
 *  Die Woche als solche zu benennen, statt «7 Tage» zu rechnen: Auf dem
 *  Knopf steht «1 Woche», und wer ihn gedrückt hat, soll darunter
 *  dasselbe Wort wiederfinden. */
export function dauerName(minutes: number): string {
  if (minutes >= 10080 && minutes % 10080 === 0) {
    const wochen = minutes / 10080;
    return wochen === 1 ? '1 Woche' : `${wochen} Wochen`;
  }
  if (minutes >= 1440 && minutes % 1440 === 0) {
    const tage = minutes / 1440;
    return tage === 1 ? '1 Tag' : `${tage} Tage`;
  }
  return `${Math.round(minutes / 60)} Std.`;
}

/** Ein Gutschein, soweit die Auswahl ihn kennen muss. */
interface Wahlbar {
  id: string;
  used: boolean;
  created?: number | null;
}

/**
 * Welcher Gutschein im Spender gross dasteht (rein, testbar).
 *
 * Sonst der älteste noch nicht eingelöste - der Vorrat soll der Reihe
 * nach abgehen, nicht in umgekehrter Ordnung.
 *
 * Ausnahme ist der eben angelegte (`zuletzt`): Wer «+ 1 Woche» drückt,
 * tut das für einen bestimmten Gast, der danebensteht - und will genau
 * diesen Code vorlesen. Bisher blieb der ältere Gutschein aus dem
 * Vorrat stehen und der neue reihte sich stumm dahinter ein; man las
 * die falsche Dauer vor und merkte es erst, wenn der Gast am nächsten
 * Morgen aus dem Netz flog. Ist er eingelöst oder gelöscht, rückt
 * wieder der Vorrat nach.
 */
export function gezeigterGutschein<T extends Wahlbar>(
  vouchers: readonly T[],
  zuletzt: string | null
): T | null {
  const offen = vouchers.filter((voucher) => !voucher.used);
  if (zuletzt) {
    const eben = offen.find((voucher) => voucher.id === zuletzt);
    if (eben) return eben;
  }
  const nachAlter = [...offen].sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  return nachAlter[0] ?? null;
}
