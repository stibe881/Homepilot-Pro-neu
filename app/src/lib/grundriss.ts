/**
 * Die entscheidbare Hälfte der Grundriss-Ansicht (rein, testbar).
 *
 * Die Ansicht selbst (components/Grundriss.tsx) zeigt ein Foto des
 * Wohnungsplans mit den Geräten als Punkten darauf. Was hier steht,
 * braucht dafür weder Bild noch Berührung: welche Masse das Bild im
 * Rahmen bekommt, welcher Punkt mit einem Tipp gemeint ist, wie sich
 * die Punktliste ändert. Der Hub prüft dieselben Regeln noch einmal
 * (core/grundriss.py) - die App hält sie ein, damit nichts still
 * wegfällt.
 */

import { Entity, HubSettings } from '../api/types';

export interface GrundrissPunkt {
  entity_id: string;
  /** Brüche der Bildkanten (0…1) - dieselbe Stelle auf jedem Gerät. */
  x: number;
  y: number;
}

export interface GrundrissStand {
  bild: string | null;
  punkte: GrundrissPunkt[];
}

/**
 * Aus dem Hub-Pfad («/api/grundriss/bild?v=abc») eine ladbare Adresse.
 *
 * Derselbe Griff wie bei den Rezeptbildern: `<Image>` kann keinen
 * Authorization-Kopf mitschicken, also wandert das Token in die Adresse.
 */
export function bildAdresse(
  pfad: string | null | undefined,
  settings: Pick<HubSettings, 'url' | 'token'>
): string | null {
  const text = String(pfad ?? '').trim();
  if (!text.startsWith('/') || !settings.url) return null;
  const basis = settings.url.replace(/\/+$/, '');
  const trenner = text.includes('?') ? '&' : '?';
  return `${basis}${text}${trenner}token=${encodeURIComponent(settings.token ?? '')}`;
}

/**
 * Wie gross das Bild im Rahmen erscheint: volle Breite, aber nie höher
 * als `maxHoehe` - ein hochkant fotografierter Plan soll die Seite
 * nicht zu einem Tunnel machen.
 */
export function anzeigeMasse(
  rahmenBreite: number,
  maxHoehe: number,
  bildBreite: number,
  bildHoehe: number
): { width: number; height: number } {
  if (rahmenBreite <= 0 || bildBreite <= 0 || bildHoehe <= 0) {
    return { width: 0, height: 0 };
  }
  const hoehe = (bildHoehe / bildBreite) * rahmenBreite;
  if (hoehe <= maxHoehe) return { width: rahmenBreite, height: Math.round(hoehe) };
  return {
    width: Math.round((bildBreite / bildHoehe) * maxHoehe),
    height: Math.round(maxHoehe),
  };
}

/** Lässt sich dieses Gerät mit einem Tipp schalten? */
export function schaltbar(commands: string[]): boolean {
  return ['toggle', 'turn_on', 'turn_off'].some((cmd) => commands.includes(cmd));
}

/**
 * Wie der Punkt aussieht: leuchtend (an), ruhig (aus) oder verblasst
 * (nicht erreichbar). «offen» und «entriegelt» zählen als an - eine
 * offene Türe ist auf dem Plan genauso eine Meldung wie ein brennendes
 * Licht.
 */
export function punktArt(entity: {
  state?: { state?: unknown };
  available?: boolean;
}): 'an' | 'aus' | 'weg' {
  if (entity.available === false) return 'weg';
  const zustand = String(entity.state?.state ?? '').toLowerCase();
  return ['on', 'open', 'unlocked', 'playing', 'heat', 'cleaning'].includes(zustand)
    ? 'an'
    : 'aus';
}

/**
 * Welcher Punkt mit einem Tipp gemeint ist - der nächste innerhalb der
 * Toleranz, sonst keiner. Die Toleranz kommt als Bruch der Bildbreite,
 * denn auch die Punkte sind Brüche.
 */
export function getroffenerPunkt(
  punkte: GrundrissPunkt[],
  x: number,
  y: number,
  toleranz: number,
  seitenverhaeltnis = 1
): GrundrissPunkt | null {
  let bester: GrundrissPunkt | null = null;
  let bestAbstand = toleranz;
  for (const punkt of punkte) {
    // y in Bildbreiten umrechnen, sonst wäre die Trefferfläche auf
    // einem quer fotografierten Plan ein flaches Oval.
    const dx = punkt.x - x;
    const dy = (punkt.y - y) * seitenverhaeltnis;
    const abstand = Math.sqrt(dx * dx + dy * dy);
    if (abstand <= bestAbstand) {
      bester = punkt;
      bestAbstand = abstand;
    }
  }
  return bester;
}

/** Einen Punkt setzen oder versetzen - ein Gerät steht nur einmal auf
 *  dem Plan. Koordinaten werden in den Bildrand geklemmt: Ein Tipp
 *  haarscharf neben den Rand meint den Rand, nicht «weg damit». */
export function punktSetzen(
  punkte: GrundrissPunkt[],
  entityId: string,
  x: number,
  y: number
): GrundrissPunkt[] {
  const neu: GrundrissPunkt = {
    entity_id: entityId,
    x: Math.min(1, Math.max(0, Math.round(x * 10000) / 10000)),
    y: Math.min(1, Math.max(0, Math.round(y * 10000) / 10000)),
  };
  return [...punkte.filter((punkt) => punkt.entity_id !== entityId), neu];
}

export function punktEntfernen(
  punkte: GrundrissPunkt[],
  entityId: string
): GrundrissPunkt[] {
  return punkte.filter((punkt) => punkt.entity_id !== entityId);
}

/**
 * Die Geräte, die noch keinen Punkt haben - fürs Anpassen-Blatt.
 *
 * Zusammengefasste Leuchten bleiben draussen (ihr Sammellicht steht
 * stellvertretend); sortiert wird nach Raum und Name, denn so sucht
 * man: «das Licht im Flur», nicht «F wie Flurlicht».
 */
export function unplatzierte(entities: Entity[], punkte: GrundrissPunkt[]): Entity[] {
  const belegt = new Set(punkte.map((punkt) => punkt.entity_id));
  return entities
    .filter((entity) => !belegt.has(entity.id) && !entity.combined_into)
    .sort(
      (a, b) =>
        (a.room ?? '￿').localeCompare(b.room ?? '￿', 'de') ||
        a.name.localeCompare(b.name, 'de')
    );
}

/**
 * Die Punkte, die die Ansicht zeigt: nur die, deren Gerät der Hub noch
 * kennt. Ein Punkt eines ausgebauten Geräts wäre eine tote Stelle auf
 * dem Plan - beim nächsten Speichern fällt er auch auf der Platte weg.
 */
export function sichtbarePunkte(
  punkte: GrundrissPunkt[],
  entities: Entity[]
): { punkt: GrundrissPunkt; entity: Entity }[] {
  const bekannt = new Map(entities.map((entity) => [entity.id, entity]));
  return punkte.flatMap((punkt) => {
    const entity = bekannt.get(punkt.entity_id);
    return entity ? [{ punkt, entity }] : [];
  });
}
