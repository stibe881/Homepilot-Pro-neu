import { Scene } from '../api/types';
import { TASTERDRUECKE } from '../screens/automations/entwurf';

/**
 * Wo ein Gerät überall vorkommt: in welchen Abläufen und Szenen.
 *
 * Man steht vor einer Lampe, die abends von selbst angeht, und musste
 * bisher alle Abläufe durchlesen, um den Urheber zu finden. Der Hub
 * kennt die Verweise längst – «Gerät ersetzen» hängt sie alle in einem
 * Zug um. Hier werden sie nur gezählt und benannt.
 *
 * Gesucht wird überall im Ablauf – Auslöser, Bedingungen, beide
 * Aktionszweige – über einen strukturblinden Spaziergang durch die
 * Konfiguration: Die Formen je Auslöser-Art hier nachzubauen hiesse,
 * sie zu duplizieren.
 */

interface AblaufKopf {
  id: string;
  alias: string;
}

function sammleEntityIds(wert: unknown, gefunden: Set<string>): void {
  if (Array.isArray(wert)) {
    for (const eintrag of wert) sammleEntityIds(eintrag, gefunden);
    return;
  }
  if (wert !== null && typeof wert === 'object') {
    for (const [key, value] of Object.entries(wert)) {
      if (key === 'entity_id' && typeof value === 'string') gefunden.add(value);
      // «Gemeinsam umschalten» nennt seine Geräte in einer Liste – ohne
      // diesen Zweig fehlte die Lampe in «in 2 Abläufen», und man suchte
      // den Urheber wieder von Hand.
      else if (key === 'entity_ids' && Array.isArray(value)) {
        for (const eintrag of value) {
          if (typeof eintrag === 'string') gefunden.add(eintrag);
        }
      } else sammleEntityIds(value, gefunden);
    }
  }
}

/** Abläufe und Szenen, die dieses Gerät anfassen (rein, testbar). */
export function verweiseAuf<A extends AblaufKopf>(
  entityId: string,
  automations: A[],
  scenes: Scene[]
): { ablaeufe: A[]; szenen: Scene[] } {
  const ablaeufe = automations.filter((automation) => {
    const ids = new Set<string>();
    sammleEntityIds(automation, ids);
    return ids.has(entityId);
  });
  const szenen = scenes.filter((scene) => scene.entity_ids.includes(entityId));
  return { ablaeufe, szenen };
}

/** Die Zeile auf der Kachel: «in 2 Abläufen und 1 Szene» (rein, testbar). */
export function verweisText(anzahlAblaeufe: number, anzahlSzenen: number): string {
  if (anzahlAblaeufe === 0 && anzahlSzenen === 0) return '';
  const teile = [];
  if (anzahlAblaeufe > 0) {
    teile.push(anzahlAblaeufe === 1 ? '1 Ablauf' : `${anzahlAblaeufe} Abläufen`);
  }
  if (anzahlSzenen > 0) {
    teile.push(anzahlSzenen === 1 ? '1 Szene' : `${anzahlSzenen} Szenen`);
  }
  return `in ${teile.join(' und ')}`;
}

/**
 * Welche anderen Abläufe dieselben Geräte anfassen (rein, testbar).
 *
 * Für den Editor: Der Hub meldet Widersprüche erst hinterher, als Liste
 * unter «Abläufe». Da steht der neue Ablauf längst und schaltet nachts
 * gegen einen anderen an. Hier steht der Hinweis, während man ihn baut -
 * und zwar der milde: nicht «das ist falsch», sondern «da ist noch wer».
 *
 * Der eigene Ablauf gehört nicht dazu; er wird über `ausser`
 * ausgenommen. Ohne das meldete jeder gespeicherte Ablauf sich selbst.
 */
export function mitschalter<A extends AblaufKopf>(
  entityIds: string[],
  automations: A[],
  ausser?: string
): A[] {
  const gesucht = new Set(entityIds.filter(Boolean));
  if (gesucht.size === 0) return [];
  return automations.filter((automation) => {
    if (ausser && automation.id === ausser) return false;
    // Nur die Handlungszweige, nicht Auslöser und Bedingungen: Ein
    // Ablauf, der die Lampe bloss *abfragt*, schaltet sie nicht - und
    // «schaltet auch» wäre über ihn eine falsche Aussage.
    const ids = new Set<string>();
    const roh = automation as unknown as Record<string, unknown>;
    sammleEntityIds(roh.actions, ids);
    sammleEntityIds(roh.otherwise, ids);
    for (const id of gesucht) if (ids.has(id)) return true;
    return false;
  });
}

/** Der Satz dazu (rein, testbar). Leer, wenn niemand mitschaltet. */
export function mitschalterSatz(namen: string[], hoechstens = 3): string {
  if (namen.length === 0) return '';
  const gezeigt = namen.slice(0, hoechstens).map((name) => `«${name}»`);
  const rest = namen.length - gezeigt.length;
  const liste = rest > 0 ? `${gezeigt.join(', ')} und ${rest} weitere` : gezeigt.join(', ');
  return `Dieselben Geräte schaltet auch ${liste}. Das kann gewollt sein – wenn nicht, kommt euch einer zuvor.`;
}

/**
 * Was ein Druck auf diesen Taster auslöst (Punkt 629 der Werkbank).
 *
 * Die Kachel sagte nur «Kurz gedrückt · vor 3 Std.», und ob «doppelt»
 * überhaupt belegt ist, stand allein in den Abläufen - als `trigger.to`
 * mit dem Wortschatz des Editors (`TASTERDRUECKE`). Wer vor dem
 * Wandtaster im Flur steht, soll es auf der Kachel lesen.
 */
export interface TasterBelegung {
  /** Der Druck, wie der Hub ihn meldet: `single`, `hold`, `short` … */
  druck: string;
  /** Das kurze Wort dazu: «einmal», «halten», «kurz». */
  wort: string;
  /** Der Ablauf, der darauf läuft. */
  ablauf: AblaufKopf;
}

/** Was Homematic meldet - der Editor kennt dafür eigene Wörter. */
const HOMEMATIC_DRUECKE: Record<string, string> = { short: 'kurz', long: 'lang' };

/**
 * Das kurze Wort für einen Druck (rein, testbar).
 *
 * «einmal drücken → Flur an» ist auf einer halbbreiten Kachel zu lang;
 * das Verb steht ohnehin auf der Kachel. Übrig bleibt «einmal», «doppelt»,
 * «halten» - und was der Editor nicht kennt, steht so da, wie das Gerät
 * es meldet.
 */
export function druckWort(druck: string): string {
  if (HOMEMATIC_DRUECKE[druck]) return HOMEMATIC_DRUECKE[druck];
  const label = TASTERDRUECKE.find((eintrag) => eintrag.key === druck)?.label;
  if (!label) return druck;
  if (label === 'gedrückt halten') return 'halten';
  return label.replace(/ drücken$/, '');
}

/**
 * Je Druck der Ablauf, der darauf läuft (rein, testbar).
 *
 * In der Reihenfolge des Editors, damit «einmal» vor «halten» steht -
 * so, wie man die Taste auch benutzt. Ein Ablauf ohne `to` läuft bei
 * jedem Druck und steht als solcher da. Ruhende Abläufe fehlen: Ein
 * Druck, der nichts tut, ist keine Belegung.
 */
export function tasterBelegung<A extends AblaufKopf>(
  entityId: string,
  automations: A[]
): TasterBelegung[] {
  const gefunden: TasterBelegung[] = [];
  for (const automation of automations) {
    const roh = automation as unknown as Record<string, unknown>;
    if (roh.enabled === false) continue;
    for (const trigger of Array.isArray(roh.triggers) ? roh.triggers : []) {
      if (!trigger || typeof trigger !== 'object') continue;
      const t = trigger as Record<string, unknown>;
      if (t.type !== 'state' || t.entity_id !== entityId) continue;
      const druck = typeof t.to === 'string' && t.to ? t.to : '*';
      if (gefunden.some((e) => e.druck === druck && e.ablauf.id === automation.id)) continue;
      gefunden.push({
        druck,
        wort: druck === '*' ? 'jeder Druck' : druckWort(druck),
        ablauf: { id: automation.id, alias: automation.alias },
      });
    }
  }
  const rang = (druck: string) => {
    if (druck === '*') return -1;
    const index = TASTERDRUECKE.findIndex((eintrag) => eintrag.key === druck);
    return index < 0 ? TASTERDRUECKE.length : index;
  };
  return gefunden.sort((a, b) => rang(a.druck) - rang(b.druck));
}

/** Die Zeile dazu: «einmal → Flur an · halten → Alles aus» (rein, testbar). */
export function belegungZeile(belegung: TasterBelegung[]): string {
  return belegung.map((eintrag) => `${eintrag.wort} → ${eintrag.ablauf.alias}`).join(' · ');
}
