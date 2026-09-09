/**
 * Was das Kamera-Vollbild gerade zeigt - und was es dazu sagt.
 *
 * Gemeldet als «es geht zum Teil lange, bis das Bild kommt»: Das
 * Vollbild zeigte *entweder* den Livestrom *oder* das Standbild, und
 * wenn die Kamera einen Strom kann, gewann der. Bis der läuft, vergehen
 * aber Sekunden - der Hub zapft die Kamera erst an, wenn jemand
 * zuschaut (hub/core/streams.py, on-demand), und mediamtx oder ffmpeg
 * müssen erst anlaufen. So lange stand man vor einer schwarzen Fläche,
 * obwohl das Standbild längst da gewesen wäre.
 *
 * Die Entscheidung, welche Schicht wann sichtbar ist, steht deshalb
 * hier und nicht in der Bildschirm-Datei: Sie hat vier Zustände, und
 * einer davon (Strom bricht ab, nachdem er lief) hat die Fläche schon
 * einmal ganz leer gelassen.
 */

export interface Kamerastand {
  /** Meldet sich die Kamera überhaupt? */
  online: boolean;
  /** Gibt es eine Adresse für das Standbild? */
  standbildDa: boolean;
  /** Kann ein Livestrom laufen: Adresse da, Kamera meldet ihn, kein
   *  Fehlschlag bisher. */
  liveMoeglich: boolean;
  /** Läuft er wirklich - erst dann hat er ein Bild zu zeigen. */
  liveLaeuft: boolean;
  /** Die Frist ist um und es kam kein Bild - und auch kein Fehler.
   *  Kein Abbruch: Der Strom bleibt eingehängt und darf später doch
   *  noch anlaufen. Nur sagen muss man es, sonst steht «Live-Bild
   *  startet …» in alle Ewigkeit da. */
  liveHaengt?: boolean;
}

/** Welche Schichten das Vollbild zeigt (rein, testbar). */
export interface Bildschichten {
  /** Das Standbild - sichtbar, solange kein Strom läuft. */
  standbild: boolean;
  /** Der Strom - eingehängt, sobald er möglich ist, aber erst sichtbar,
   *  wenn er läuft. Eingehängt sein muss er vorher: Sonst beginnt er gar
   *  nicht zu laden. */
  live: boolean;
  /** Sichtbar heisst hier: nicht mehr durchsichtig. */
  liveSichtbar: boolean;
  /** Was statt eines Bildes dasteht - null, wenn eine Schicht trägt. */
  leer: 'offline' | 'kein-bild' | null;
}

export function bildschichten(stand: Kamerastand): Bildschichten {
  const standbild = stand.online && stand.standbildDa && !stand.liveLaeuft;
  const live = stand.online && stand.liveMoeglich;
  return {
    standbild,
    live,
    liveSichtbar: live && stand.liveLaeuft,
    // Leer ist es nur, wenn wirklich nichts trägt. Ein Strom, der noch
    // anläuft, zählt dabei nicht als Bild - aber auch nicht als Fehler:
    // Dann steht die Meldung «Live-Bild startet …» darunter.
    leer: !stand.online
      ? 'offline'
      : !standbild && !live
        ? 'kein-bild'
        : null,
  };
}

/**
 * Die Zeile unter dem Bild (rein, testbar).
 *
 * Sie sagt, was man sieht und warum - besonders in der Wartezeit: Ohne
 * sie sieht ein Standbild, hinter dem gerade ein Strom anläuft, aus wie
 * ein Strom, der nicht kommt.
 */
export function kameraSatz(
  stand: Kamerastand,
  liveFehler?: string | null,
  bewegung = false
): string {
  const kopf = stand.liveLaeuft
    ? '● Live'
    : stand.liveMoeglich && stand.online && stand.liveHaengt
      ? // Die Frist ist um. Nicht «nicht verfügbar»: Er kann noch
        // kommen - aber warten soll niemand mehr darauf.
        'Live-Bild kommt nicht – es bleibt beim Standbild'
      : stand.liveMoeglich && stand.online
        ? 'Standbild – Live-Bild startet …'
        : liveFehler
          ? `Live-Bild nicht verfügbar (${liveFehler}) – Standbild alle 3 Sekunden`
          : 'Standbild alle 3 Sekunden';
  return bewegung ? `${kopf} · Bewegung erkannt` : kopf;
}
