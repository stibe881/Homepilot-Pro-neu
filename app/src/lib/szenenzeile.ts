/**
 * Die Szenenzeile in der Ablaufliste – was daraufsteht und was ein
 * Tippen tut.
 *
 * Die Zeile war eine Sackgasse: Name, «19 Aktion(en)» und ein Stift.
 * Die Klammerform stand da, weil niemand die Mehrzahl bilden wollte,
 * und die Karte selbst tat nichts – wer eine Szene schalten wollte,
 * musste auf die Startseite zurück. Eine Liste von Szenen, auf der man
 * keine Szene starten kann, ist eine Liste zum Anschauen.
 *
 * Hier steht, was stattdessen dasteht: der Raum, die Anzahl in
 * richtigem Deutsch, und ob die Szene gerade steht.
 */
import { Scene } from '../api/types';

/** Läuft die Szene gerade – und lässt sie sich zurücknehmen? (rein) */
export function laeuft(scene: Scene): boolean {
  return !!scene?.active && scene?.toggles !== false;
}

/** «19 Aktionen», «1 Aktion» (rein, testbar). */
export function aktionenText(scene: Scene): string {
  const anzahl = scene?.actions?.length ?? scene?.entity_ids?.length ?? 0;
  return anzahl === 1 ? '1 Aktion' : `${anzahl} Aktionen`;
}

/**
 * Die kleine Zeile unter dem Namen (rein, testbar).
 *
 * Der Raum zuerst: Bei «Kino» und «Schlafen» nebeneinander ist er das,
 * was die beiden unterscheidet – die Anzahl der Aktionen sagt darüber
 * nichts.
 */
export function unterzeile(scene: Scene): string {
  const teile: string[] = [];
  const raum = String(scene?.room ?? '').trim();
  if (raum) teile.push(raum);
  teile.push(aktionenText(scene));
  return teile.join(' · ');
}

/**
 * Was ein Tippen auf die Zeile tut (rein, testbar).
 *
 * `null` heisst: nichts – dann bleibt die Zeile ein Eintrag zum
 * Öffnen. Das gilt für Szenen, die keinen Zustand herstellen und
 * darum auch keinen zurücknehmen können, sobald sie schon liefen.
 */
export function tippAktion(scene: Scene): 'starten' | 'zuruecknehmen' {
  return laeuft(scene) ? 'zuruecknehmen' : 'starten';
}

/** Die Beschriftung für Vorlesegeräte – ein Symbol allein sagt nichts. */
export function tippLabel(scene: Scene): string {
  const name = String(scene?.name ?? 'Szene');
  return tippAktion(scene) === 'zuruecknehmen'
    ? `${name} zurücknehmen`
    : `${name} starten`;
}
