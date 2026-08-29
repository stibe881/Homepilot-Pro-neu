import { Scene } from '../api/types';

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
