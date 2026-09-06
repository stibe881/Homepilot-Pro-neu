import { localTime } from './zeit';

/**
 * Welche Hülle läuft hier eigentlich? – die Zeile für die Befund-Kästen
 * der Widget-Einstellungen.
 *
 * Entstanden aus einer Schlaufe, die anders nicht zu durchbrechen war:
 * «Die installierte App kennt die Widget-Ablage noch nicht» stand da,
 * der neuste TestFlight-Build war installiert, und jedes Bildschirmfoto
 * der Warnung liess offen, auf *welchem* Build es entstanden war – die
 * Warnung sah auf der alten und der neuen Hülle gleich aus. Steht der
 * Build direkt in der Warnung, beantwortet ein einziges Foto beide
 * Fragen: Was sagt der Befund, und von welcher Hülle stammt er.
 */

/**
 * Der Bau-Zeitpunkt aus der Build-Nummer, als ISO-Text (rein, testbar).
 *
 * Die Nummer sind Minuten seit 1970 (deploy/rebuild-hub.sh setzt sie
 * so). Ältere Zählweisen – Commit-Anzahl, Handvergaben wie «2» – sind
 * um Grössenordnungen kleiner und ergeben kein Datum; sie kommen ohne
 * Zeitangabe zurück, statt als «1. Januar 1970» aufzutreten.
 */
export function bauZeitIso(nummer: string | null | undefined): string | null {
  if (!nummer || !/^\d+$/.test(nummer)) return null;
  const minuten = Number(nummer);
  // 19 Mio. Minuten ≈ 2006 – alles darunter ist keine Minuten-Nummer.
  if (minuten < 19_000_000) return null;
  return new Date(minuten * 60_000).toISOString();
}

/**
 * «Diese Hülle: Build 29811236 (gebaut 06.09.2026, 07:56) · Laufzeit 5»
 * (rein, testbar). Leer, wenn nichts über die Hülle bekannt ist – im
 * Browser etwa gibt es weder Build-Nummer noch Laufzeit.
 */
export function huelleZeile(
  buildNummer: string | null | undefined,
  laufzeit: string | null | undefined
): string {
  const teile: string[] = [];
  if (buildNummer) {
    const iso = bauZeitIso(buildNummer);
    const wann = iso ? localTime(iso) : '';
    teile.push(wann ? `Build ${buildNummer} (gebaut ${wann})` : `Build ${buildNummer}`);
  }
  if (laufzeit) teile.push(`Laufzeit ${laufzeit}`);
  return teile.length > 0 ? `Diese Hülle: ${teile.join(' · ')}` : '';
}
