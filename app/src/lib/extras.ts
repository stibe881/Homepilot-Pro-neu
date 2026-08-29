/**
 * Was der Hub kann – und was ihm dafür fehlt.
 *
 * Ein paar Bibliotheken sind bewusst nicht im Grundbestand des Abbilds:
 * Sie sind schwer, brauchen eine neuere Python-Fassung oder werden nur
 * von einem Gerät verlangt, das die meisten nicht haben.
 *
 * Fehlt eine, bleibt genau eine Funktion dunkel, und zwar still. Genau
 * so lief es beim Durchsage-Knopf: Er tat nichts, weil dem Hub gTTS
 * fehlte, und das stand nirgends, wo jemand nachgesehen hätte.
 *
 * Die Regeln stehen im Hub (core/extras.py) – er weiss, was installiert
 * ist und was hier überhaupt gebraucht wird. Hier steht nur, in welcher
 * Reihenfolge es dasteht.
 */

export interface Extra {
  key: string;
  title: string;
  detail: string;
  installed: boolean;
  /** Ob dieses Teil im Haus überhaupt gebraucht wird. */
  needed: boolean;
}

export type Zustand = 'fehlt' | 'da' | 'ungenutzt';

/** Wie dieses Teil dasteht (rein, testbar). */
export function zustand(extra: Extra): Zustand {
  if (!extra.needed) return 'ungenutzt';
  return extra.installed ? 'da' : 'fehlt';
}

const RANG: Record<Zustand, number> = { fehlt: 0, da: 1, ungenutzt: 2 };

/**
 * Erst die Lücken, dann was läuft, zuletzt das Ungenutzte (rein,
 * testbar).
 *
 * Ungenutztes ganz nach unten und nicht weg: Wer den Pelletgrill
 * anbinden will, soll vorher sehen können, dass dem Hub das Paket dafür
 * fehlt – sonst sucht er den Fehler später beim Grill.
 */
export function geordnet(zeilen: Extra[]): Extra[] {
  return [...zeilen].sort(
    (a, b) =>
      RANG[zustand(a)] - RANG[zustand(b)] || a.title.localeCompare(b.title, 'de')
  );
}

/** Wie viele Teile fehlen, die hier gebraucht werden (rein, testbar). */
export function luecken(zeilen: Extra[]): number {
  return zeilen.filter((zeile) => zustand(zeile) === 'fehlt').length;
}
