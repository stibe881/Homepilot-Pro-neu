/**
 * «Wenn …» und «Wiederholen» als Schritte, dazu die neuen Auslöser
 * «Person kommt/geht» und «Wetterwarnung» (Punkte 251/252 der Werkbank).
 *
 * Hier liegt die reine Logik hinter dem Editor: die Grenzen, die der Hub
 * durchsetzt (Tiefe 3, höchstens 50 Durchgänge), und die Sätze, mit
 * denen die neuen Bausteine in der Zusammenfassung stehen. Die Grenzen
 * stehen bewusst auch in der App: Ein Editor, der 200 Durchgänge
 * speichern lässt, die der Hub still auf 50 stutzt, verspricht etwas,
 * das nie passiert.
 */

import { ZUHAUSE, ortsWort } from './ortsausloeser';

/** Höchstzahl der Durchgänge eines «Wiederholen»-Schritts – dieselbe
 *  harte Grenze wie im Hub (core/automation.py: REPEAT_LIMIT). Hart,
 *  weil eine Grenze mit Ausnahme keine ist: Eine Bedingung, die nie
 *  kippt, liefe sonst für immer. */
export const REPEAT_LIMIT = 50;

/** Wie tief sich «wenn» und «wiederholen» ineinander stecken dürfen –
 *  wie NEST_DEPTH im Hub. Drei Ebenen decken jeden Fall, den jemand
 *  noch lesen kann. */
export const MAX_SCHACHTELUNG = 3;

/**
 * Eine getippte Durchgangszahl auf das Erlaubte bringen (rein, testbar).
 *
 * Leeres, Unlesbares und Null werden zur Vorgabe statt zu 0: Ein
 * «Wiederholen»-Schritt mit 0 Durchgängen sähe im Editor fertig aus und
 * täte beim Ablaufen nichts – der stillste aller Fehler. Nach oben
 * deckelt REPEAT_LIMIT, wie im Hub auch eine ausdrücklich grössere
 * Angabe.
 */
export function begrenzteAnzahl(value: unknown, fallback: number): number {
  const zahl = Math.round(Number(value));
  if (!Number.isFinite(zahl) || zahl <= 0) {
    return Math.max(1, Math.min(REPEAT_LIMIT, fallback));
  }
  return Math.max(1, Math.min(REPEAT_LIMIT, zahl));
}

// ── Die neuen Auslöser ───────────────────────────────────────────────────

/** Die Warnstufen von MeteoAlarm, schwächste zuerst – dieselbe Reihe wie
 *  im Hub (core/automation.py: WARNSTUFEN). Gespeichert wird das
 *  englische Wort, gelesen das deutsche. */
export const WARNSTUFEN: { key: string; label: string }[] = [
  { key: 'Minor', label: 'gering' },
  { key: 'Moderate', label: 'mässig' },
  { key: 'Severe', label: 'schwer' },
  { key: 'Extreme', label: 'extrem' },
];

/** Die Auswahl im Editor: «jede Warnung» plus die Schwellen. */
export const WARNSTUFEN_WAHL: { key: string; label: string }[] = [
  { key: '', label: 'jede Warnung' },
  ...WARNSTUFEN.map(({ key, label }) => ({ key, label: `ab «${label}»` })),
];

/** Das deutsche Wort zu einer Stufe – Unbekanntes bleibt stehen, wie bei
 *  den Platzhaltern: lieber lesbar falsch als stumm weg (rein, testbar). */
export function warnstufeWort(key: unknown): string {
  const gesucht = String(key ?? '');
  return WARNSTUFEN.find((stufe) => stufe.key === gesucht)?.label ?? gesucht;
}

/** Der Wetterwarnungs-Auslöser als Satzteil (rein, testbar) – für
 *  «Wenn …, dann …» und die Listenzeile. */
export function wetterwarnungSatz(minSeverity?: unknown): string {
  const stufe = String(minSeverity ?? '').trim();
  return stufe
    ? `eine neue Wetterwarnung eintrifft (ab «${warnstufeWort(stufe)}»)`
    : 'eine neue Wetterwarnung eintrifft';
}

/**
 * Aus einer Personen-Angabe ein lesbares Wort (rein, testbar).
 *
 * Der Hub nimmt Kennung («livia»), Entitäts-Kennung («geofence.livia»)
 * und Namen («Livia Gross») entgegen – im Satz soll in allen drei Fällen
 * ein Name stehen, keine Kennung.
 */
export function personWort(person: unknown): string {
  const roh = String(person ?? '').trim();
  if (!roh) return '?';
  const kennung = roh.startsWith('geofence.')
    ? roh.slice('geofence.'.length)
    : roh;
  // Ein getippter Name bleibt, wie er ist – nur eine Kennung wird zum
  // Wort («livia_gross» → «Livia Gross»).
  return /^[a-z0-9_]+$/.test(kennung) ? ortsWort(kennung) : kennung;
}

/** Der Anwesenheits-Auslöser als Satzteil (rein, testbar) – dieselbe
 *  Wortwahl wie beim Ortsauslöser (ortsausloeser.ortsSatz), denn für
 *  die lesende Person ist es dieselbe Sache. */
export function presenceSatz(
  person: unknown,
  event: unknown,
  zone?: unknown
): string {
  const wer = personWort(person);
  // Dieselbe Grosszügigkeit wie im Hub (presence_trigger_matches): Wer
  // «leave» in die config.yaml schreibt, meint das Gehen.
  const geht = ['leaves', 'leave', 'left', 'exit', 'geht'].includes(
    String(event ?? '')
      .trim()
      .toLowerCase()
  );
  const ort = String(zone ?? '').trim() || ZUHAUSE;
  if (ort === ZUHAUSE) return geht ? `${wer} geht weg` : `${wer} kommt heim`;
  const wo = ortsWort(ort);
  return geht ? `${wer} verlässt ${wo}` : `${wer} kommt bei ${wo} an`;
}

// ── Die neuen Schritte als Sätze ─────────────────────────────────────────

/**
 * Ein «Wenn …»-Schritt als Satzteil (rein, testbar).
 *
 * Bedingungen und Zweige kommen fertig formuliert herein – wer sie
 * formuliert (ablaufsatz.ts), kennt Geräte und Szenen; hier wird nur
 * zusammengesetzt. «wenn dunkel: Licht Flur ein; sonst Nachricht».
 */
export function wennSchrittSatz(
  bedingungen: string[],
  match: 'all' | 'any',
  dann: string[],
  sonst: string[]
): string {
  const wenn =
    bedingungen.filter(Boolean).join(match === 'any' ? ' oder ' : ' und ') ||
    // Leer heisst beim Hub «gilt immer» – das gehört gesagt, sonst liest
    // sich der Schritt als fertig, obwohl die Bedingung noch fehlt.
    'immer';
  const dannTeil = dann.filter(Boolean).join(', ') || 'nichts';
  const satz = `wenn ${wenn}: ${dannTeil}`;
  const sonstTeil = sonst.filter(Boolean).join(', ');
  return sonstTeil ? `${satz}; sonst ${sonstTeil}` : satz;
}

/** Ein «Wiederholen»-Schritt als Satzteil (rein, testbar).
 *
 *  «3× Lampe ein, Lampe aus» bzw. «solange Türe ist offen: Durchsage
 *  (höchstens 10×)». Die Obergrenze steht bei der solange-Form immer
 *  dabei – sie ist der Unterschied zwischen «mahnt, bis zu ist» und
 *  «mahnt für immer». */
export function wiederholenSatz(
  angaben: { count?: unknown; while?: string[]; max?: unknown },
  schritte: string[]
): string {
  const drin = schritte.filter(Boolean).join(', ') || 'nichts';
  if (angaben.while) {
    const solange = angaben.while.filter(Boolean).join(' und ') || '…';
    const grenze = begrenzteAnzahl(angaben.max, REPEAT_LIMIT);
    return `solange ${solange}: ${drin} (höchstens ${grenze}×)`;
  }
  return `${begrenzteAnzahl(angaben.count, 1)}× ${drin}`;
}

/** Der «Wenn …»-Schritt in der Listenzeile – dort ist kein Platz für die
 *  Zweige, nur für die Form (rein, testbar). */
export function wennKurz(action: { then?: unknown; else?: unknown }): string {
  const dann = Array.isArray(action.then) ? action.then.length : 0;
  const sonst = Array.isArray(action.else) ? action.else.length : 0;
  if (sonst > 0) return `verzweigt (${dann} dann / ${sonst} sonst)`;
  return `verzweigt (${dann} Schritt${dann === 1 ? '' : 'e'})`;
}

/** Der «Wiederholen»-Schritt in der Listenzeile (rein, testbar). */
export function wiederholenKurz(action: {
  count?: unknown;
  while?: unknown;
}): string {
  if (Array.isArray(action.while)) return 'wiederholt nach Bedingung';
  return `wiederholt ${begrenzteAnzahl(action.count, 1)}×`;
}
