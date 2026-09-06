/**
 * Das Clip-Archiv: die dauerhaften Alarm-Mitschnitte der Kameras.
 *
 * Punkt 256 der Werkbank, App-Seite. Der Hub legt die Mitschnitte als
 * Dateien ab (core/cliparchiv.py) und liefert sie unter /api/clips –
 * hier steht das reine Aufbereiten für die Liste: Gruppierung nach Tag,
 * lesbare Grössen und Anlässe, die Video-Adresse mit Token.
 */
import type { Leerbild } from './leerzustand';
import { tagTitel } from './verlaufliste';

/** Ein archivierter Clip, wie /api/clips ihn liefert. */
export interface Clip {
  id: string;
  camera: string;
  /** Name und Raum der Kamera zum Aufnahmezeitpunkt – sie reisen mit,
   *  weil ein Clip seine Kamera überleben kann. */
  name: string;
  room?: string | null;
  integration?: string;
  anlass: string;
  /** Unix-Sekunden. */
  at: number;
  bytes: number;
}

export interface ClipAbschnitt {
  titel: string;
  clips: Clip[];
}

/**
 * Die Video-Adresse eines Clips (rein, testbar).
 *
 * Das Token steht in der Adresse, weil Videoplayer keine eigenen
 * Kopfzeilen mitschicken – derselbe Weg wie beim Live-Bild und bei den
 * Zeitleisten-Aufnahmen (lib/aufnahmeurl.ts).
 */
export function clipUrl(basis: string, token: string, id: string): string {
  return (
    `${basis}/api/clips/${encodeURIComponent(id)}` +
    `?token=${encodeURIComponent(token)}`
  );
}

/** «Alarm» statt «alarm» – der Anlass, wie er in der Liste steht
 *  (rein, testbar). */
export function anlassName(anlass: string): string {
  const namen: Record<string, string> = {
    alarm: 'Alarm',
    test: 'Probealarm',
    motion: 'Bewegung',
    ring: 'Klingel',
  };
  if (namen[anlass]) return namen[anlass];
  // Unbekanntes lesbar machen statt verstecken: Ein neuer Anlass im Hub
  // soll in der App nicht als leeres Feld ankommen.
  return anlass ? anlass.charAt(0).toUpperCase() + anlass.slice(1) : 'Aufnahme';
}

/**
 * Die Dateigrösse als Text (rein, testbar).
 *
 * Ein Mitschnitt ist Megabyte gross – die Grösse steht dabei, damit man
 * vor dem Antippen weiss, was über die Mobilfunkrechnung wandert.
 */
export function groesseText(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  const mb = bytes / (1024 * 1024);
  if (mb >= 1) return `${mb >= 10 ? Math.round(mb) : Math.round(mb * 10) / 10} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

/**
 * Die Clips in Tagesabschnitte (rein, testbar).
 *
 * Dieselbe Gruppierung wie im Rückblick (lib/hausrueckblick.ts), damit
 * sich beide Listen gleich lesen. Erwartet die Reihenfolge des Hubs:
 * jüngster zuerst.
 */
export function clipAbschnitte(clips: Clip[], jetzt: number = Date.now()): ClipAbschnitt[] {
  const abschnitte: ClipAbschnitt[] = [];
  for (const clip of clips) {
    const titel = tagTitel(clip.at, jetzt);
    const letzter = abschnitte[abschnitte.length - 1];
    if (letzter && letzter.titel === titel) letzter.clips.push(clip);
    else abschnitte.push({ titel, clips: [clip] });
  }
  return abschnitte;
}

/** «14 Tage» bzw. «1 Tag» – die Aufbewahrungsfrist als Text
 *  (rein, testbar). */
export function fristText(tage: number): string {
  return tage === 1 ? '1 Tag' : `${tage} Tage`;
}

/** Die wählbaren Aufbewahrungsfristen. 14 ist die Vorgabe des Hubs:
 *  lang genug für die Ferien, kurz genug gegen ein Bewegungsprofil. */
export const FRIST_WAHL = [7, 14, 30, 90];

/** Was die leere Liste sagt (rein, testbar) – im Stil von
 *  lib/leerzustand.ts: ein Satz, der erklärt, wie hier etwas hinkommt. */
export function clipLeerbild(): Leerbild {
  return {
    icon: 'film-outline',
    titel: 'Noch keine Aufnahmen',
    satz:
      'Löst der Alarm aus, legt der Hub den Kamera-Mitschnitt hier ab. ' +
      'Er bleibt, bis die Aufbewahrungsfrist abläuft.',
  };
}
