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
