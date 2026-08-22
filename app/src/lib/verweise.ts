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
      else sammleEntityIds(value, gefunden);
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
