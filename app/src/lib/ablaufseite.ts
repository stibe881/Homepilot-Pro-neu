/**
 * Ein Ablauf auf Papier – Punkt 367.
 *
 * «Was tut das Haus, wenn …» ist eine Frage, die man dem Babysitter nicht
 * mit dem Editor beantwortet: Sieben Felder, zwei Bildschirmhöhen, eine
 * Sprache voller Kennungen. Diese Seite zieht dieselben Sätze, die schon
 * im Editor mitlaufen (`ablaufsatz.ts`), auseinander in Zeilen - Wenn,
 * Nur wenn, Dann, Sonst - und legt sie neben das Rezeptblatt
 * (`rezeptseite.ts`), das denselben Weg schon für die Küche geht.
 *
 * Reines Rechnen: hinein ein Ablauf, hinaus eine druckbare Seite.
 */

import { Entity, Scene } from '../api/types';
import { aktionSatz, bedingungSatz, triggerSatz } from './ablaufsatz';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Roh = Record<string, any>;

function escape(text: unknown): string {
  return String(text ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

/**
 * Das Blatt als HTML (rein, testbar) – Titel, Wenn/Nur wenn/Dann/Sonst,
 * je ein Punkt pro Zeile statt eines Fliesssatzes: Auf Papier liest man
 * eine Liste schneller als einen Bandwurmsatz, und genau das unterscheidet
 * diese Seite vom mitlaufenden Satz im Editor.
 */
export function ablaufAlsSeite(
  automation: Roh,
  entities: Entity[],
  scenes: Scene[]
): string {
  const wenn = ((automation.triggers ?? []) as Roh[])
    .map((trigger) => triggerSatz(trigger, entities))
    .filter(Boolean);
  const nur = ((automation.conditions ?? []) as Roh[])
    .map((condition) => bedingungSatz(condition, entities))
    .filter(Boolean);
  const dann = ((automation.actions ?? []) as Roh[])
    .map((action) => aktionSatz(action, entities, scenes))
    .filter(Boolean);
  const sonst = ((automation.otherwise ?? []) as Roh[])
    .map((action) => aktionSatz(action, entities, scenes))
    .filter(Boolean);
  const triggerVerknuepfung = ' oder ';
  const bedingungVerknuepfung = automation.match === 'any' ? ' oder ' : ' und ';

  const teile: string[] = [
    '<!doctype html><html lang="de"><head><meta charset="utf-8">',
    '<meta name="viewport" content="width=device-width, initial-scale=1">',
    `<title>${escape(automation.alias)}</title>`,
    '<style>',
    'body{font:15pt/1.5 Georgia,"Times New Roman",serif;margin:0;padding:2.2cm 2cm;}',
    'h1{font-size:24pt;margin:0 0 .2cm;} .p{opacity:.65;margin:0 0 .8cm;}',
    'h2{font-size:13pt;letter-spacing:.06em;text-transform:uppercase;',
    '   margin:.9cm 0 .25cm;border-bottom:1px solid;padding-bottom:.1cm;}',
    'ul{margin:0;padding-left:1.1cm;} li{margin:0 0 .18cm;break-inside:avoid;}',
    '.n{font-style:italic;opacity:.8;margin-top:.8cm;}',
    '@page{margin:1.5cm;}',
    '</style></head><body>',
    `<h1>${escape(automation.alias) || 'Ablauf'}</h1>`,
  ];
  if (automation.enabled === false) {
    teile.push('<p class="p">Zurzeit ausgeschaltet - dieser Ablauf läuft nicht.</p>');
  }
  if (wenn.length > 0) {
    teile.push('<h2>Wenn</h2><ul>');
    wenn.forEach((satz, index) => {
      teile.push(`<li>${index > 0 ? `${escape(triggerVerknuepfung.trim())} ` : ''}${escape(satz)}</li>`);
    });
    teile.push('</ul>');
  }
  if (nur.length > 0) {
    teile.push('<h2>Nur wenn</h2><ul>');
    nur.forEach((satz, index) => {
      teile.push(`<li>${index > 0 ? `${escape(bedingungVerknuepfung.trim())} ` : ''}${escape(satz)}</li>`);
    });
    teile.push('</ul>');
  }
  if (dann.length > 0) {
    teile.push('<h2>Dann</h2><ul>');
    for (const satz of dann) teile.push(`<li>${escape(satz)}</li>`);
    teile.push('</ul>');
  }
  if (sonst.length > 0) {
    teile.push('<h2>Sonst</h2><ul>');
    for (const satz of sonst) teile.push(`<li>${escape(satz)}</li>`);
    teile.push('</ul>');
  }
  if (wenn.length === 0 || dann.length === 0) {
    teile.push('<p class="n">Dieser Ablauf ist noch unvollständig.</p>');
  }
  teile.push('</body></html>');
  return teile.join('');
}
