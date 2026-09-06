/**
 * Das eigene Konto: Passwort wechseln und die angemeldeten Geräte
 * (Punkt 244 der Werkbank).
 *
 * Bisher gab es dafür genau zwei Knöpfe: «Abmelden» und «Überall
 * abmelden». Für das vergessene iPad im Ferienhaus ist das zu grob –
 * wer es hinauswerfen wollte, warf sich selbst mit hinaus. Und das
 * Passwort liess sich nur wechseln, wenn der Hub es beim Anmelden
 * erzwang.
 *
 * Hier liegt die entscheidbare Hälfte (rein, testbar): Wie die
 * Sitzungen geordnet werden, was an einer Zeile steht, wann ein neues
 * Passwort taugt und was nach dem Wechsel gesagt wird. Die Anzeige
 * wohnt in components/KontoBlatt.tsx.
 */

import { vorWieLange } from './letzterlauf';

/** Eine Sitzung, wie GET /api/auth/sessions sie liefert. Lokal
 *  definiert und nicht in api/types.ts: Sie kommt nur hier vor. */
export interface Geraetesitzung {
  id: string;
  /** Die Sitzung, mit der gerade gefragt wird – «dieses Gerät». */
  current?: boolean;
  label?: string | null;
  /** Unix-Sekunden. */
  created?: number | null;
  /** Unix-Sekunden – wann sich das Gerät zuletzt gemeldet hat. */
  seen?: number | null;
  /** Läuft nie ab – Gemeinschaftsgeräte wie das Wandtablet. */
  keep?: boolean;
  user?: string;
  email?: string | null;
}

/**
 * Die Reihenfolge der Geräteliste (rein, testbar).
 *
 * Das eigene Gerät zuoberst: Es ist der Fixpunkt, an dem man alle
 * anderen misst («das hier bin ich – was ist der Rest?»). Danach die
 * zuletzt benutzten zuerst, denn das vergessene iPad, um das es beim
 * Aufräumen geht, steht dann zuunterst – dort, wo man es erwartet.
 */
export function sortiereSitzungen(sitzungen: Geraetesitzung[]): Geraetesitzung[] {
  const zuletzt = (s: Geraetesitzung) => Number(s.seen ?? s.created ?? 0);
  return [...(sitzungen ?? [])].sort(
    (a, b) =>
      Number(!!b.current) - Number(!!a.current) || zuletzt(b) - zuletzt(a)
  );
}

/** Wie das Gerät heisst (rein, testbar). Der Hub speichert das Label
 *  aus der Anmeldung – wo keines ankam, steht wenigstens etwas. */
export function geraeteName(sitzung: Geraetesitzung): string {
  const label = String(sitzung.label ?? '').trim();
  return label || 'Unbenanntes Gerät';
}

/**
 * Die Zeile unter dem Gerätenamen (rein, testbar).
 *
 * «Dieses Gerät» statt eines Zeitstempels: Wer aufräumt, braucht vor
 * allem die Zusicherung, dass er nicht das Gerät in der eigenen Hand
 * beendet. `keep` gehört genannt – eine Sitzung, die nie abläuft
 * (Wandtablet), sieht sonst aus wie eine vergessene.
 */
export function geraeteZeile(sitzung: Geraetesitzung, jetztMs: number): string {
  const teile: string[] = [];
  if (sitzung.current) {
    teile.push('dieses Gerät');
  } else {
    const zuletzt = Number(sitzung.seen ?? sitzung.created ?? 0);
    teile.push(
      zuletzt > 0 ? `zuletzt ${vorWieLange(jetztMs / 1000 - zuletzt)}` : 'nie benutzt'
    );
  }
  if (sitzung.keep) teile.push('bleibt angemeldet (Gemeinschaftsgerät)');
  return teile.join(' · ');
}

/**
 * Taugt die Eingabe für den Passwort-Wechsel? (rein, testbar)
 *
 * Null heisst «abschicken». Die Sätze stehen hier und nicht im
 * Bildschirm, damit sie geprüft sind – ein Fehlertext, den niemand
 * liest, weil er «Error» heisst, war der Anlass für diese Regeln.
 * Ob das *alte* Passwort stimmt, weiss nur der Hub; hier wird nur
 * gefangen, was gar nicht erst reisen muss.
 */
export function passwortProblem(alt: string, neu: string, wiederholt: string): string | null {
  if (!alt) return 'Bitte zuerst das bisherige Passwort eintragen.';
  if (neu.trim().length < 8) return 'Das neue Passwort braucht mindestens acht Zeichen.';
  if (neu === alt) return 'Das neue Passwort ist dasselbe wie das bisherige.';
  if (neu !== wiederholt) return 'Die beiden Eingaben des neuen Passworts stimmen nicht überein.';
  return null;
}

/**
 * Der Satz nach dem gelungenen Wechsel (rein, testbar).
 *
 * Der Hub beendet dabei alle *anderen* Sitzungen (`revoked`), und das
 * gehört ausgesprochen: Wer sein Passwort wechselt, tut das oft, weil
 * das alte irgendwo gelandet ist, wo es nicht hingehört – die Zahl ist
 * die Zusicherung, dass das fremde Gerät jetzt draussen ist.
 */
export function revokedSatz(revoked: number): string {
  const anzahl = Math.max(0, Math.round(Number(revoked) || 0));
  if (anzahl === 0) {
    return 'Passwort geändert. Sonst war kein Gerät angemeldet.';
  }
  if (anzahl === 1) {
    return 'Passwort geändert – das eine andere Gerät wurde abgemeldet.';
  }
  return `Passwort geändert – ${anzahl} andere Geräte wurden abgemeldet.`;
}
