/**
 * Die Modi der Alarmanlage - eingebaute und eigene (Punkt 426).
 *
 * «Nacht», «Ausser Haus», «Urlaub» kennt der Hub fest; dazu kommen die
 * eigenen aus den Einstellungen («Nur Erdgeschoss», «Gäste da»). Der
 * Bildschirm zeichnet seine Knöpfe aus dieser einen Liste, statt drei
 * feste zu kennen - und die kommt vom Hub, weil nur er weiss, welche
 * Modi es gerade gibt.
 */
import type { Ionicons } from '@expo/vector-icons';

export type Symbol = React.ComponentProps<typeof Ionicons>['name'];

export interface Modus {
  key: string;
  label: string;
  icon: Symbol;
  /** Eingebaut: lässt sich nicht löschen und heisst überall gleich. */
  builtin: boolean;
}

/** Was der Hub zu einem Modus schickt - das Symbol nur als Text. */
export interface ModusVomHub {
  key: string;
  label: string;
  icon?: string;
  builtin?: boolean;
}

/** Die eingebauten - auch die Vorgabe, wenn ein älterer Hub keine Liste schickt. */
export const EINGEBAUTE_MODI: Modus[] = [
  { key: 'nacht', label: 'Nacht', icon: 'moon-outline', builtin: true },
  { key: 'ausser_haus', label: 'Ausser Haus', icon: 'exit-outline', builtin: true },
  { key: 'urlaub', label: 'Urlaub', icon: 'airplane-outline', builtin: true },
];

/** Symbole, die ein eigener Modus tragen darf - eine kleine Auswahl,
 *  damit die Knöpfe nebeneinander zusammenpassen. */
export const MODUS_SYMBOLE: Symbol[] = [
  'shield-outline',
  'home-outline',
  'people-outline',
  'construct-outline',
  'bed-outline',
  'car-outline',
  'leaf-outline',
  'paw-outline',
];

const EINGEBAUTE_SYMBOLE: Record<string, Symbol> = Object.fromEntries(
  EINGEBAUTE_MODI.map((modus) => [modus.key, modus.icon])
);

/** Die Liste des Hubs in Knöpfe verwandeln (rein, testbar).
 *
 *  Ein unbekanntes Symbol wird zum Schild: Lieber ein neutrales Zeichen
 *  als ein Knopf ohne. Ohne Liste (älterer Hub) die drei eingebauten. */
export function modiAus(vomHub: ModusVomHub[] | undefined | null): Modus[] {
  if (!vomHub || vomHub.length === 0) return EINGEBAUTE_MODI;
  return vomHub
    .filter((eintrag) => eintrag && typeof eintrag.key === 'string' && eintrag.key)
    .map((eintrag) => {
      const builtin = eintrag.builtin ?? eintrag.key in EINGEBAUTE_SYMBOLE;
      const gewuenscht = eintrag.icon as Symbol | undefined;
      const icon =
        EINGEBAUTE_SYMBOLE[eintrag.key] ??
        (gewuenscht && MODUS_SYMBOLE.includes(gewuenscht) ? gewuenscht : 'shield-outline');
      return { key: eintrag.key, label: eintrag.label || eintrag.key, icon, builtin };
    });
}

/** Aus «Nur Erdgeschoss» wird «nur_erdgeschoss» - dieselbe Regel wie im
 *  Hub (alarm_rules.modus_schluessel), damit die App Doppelte erkennt,
 *  bevor der Hub sie still verwirft (rein, testbar). */
export function modusSchluessel(label: string): string {
  let text = label.trim().toLowerCase();
  for (const [von, nach] of [
    ['ä', 'ae'],
    ['ö', 'oe'],
    ['ü', 'ue'],
    ['ß', 'ss'],
  ] as const) {
    text = text.split(von).join(nach);
  }
  return text
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '')
    .slice(0, 24)
    .replace(/_+$/g, '');
}

/** Warum sich dieser Name nicht anlegen lässt - oder null (rein, testbar). */
export function modusFehler(label: string, bestehende: Modus[]): string | null {
  const key = modusSchluessel(label);
  if (!key) return 'Ein Name braucht mindestens einen Buchstaben.';
  if (bestehende.some((modus) => modus.key === key)) return 'Diesen Modus gibt es schon.';
  if (bestehende.filter((modus) => !modus.builtin).length >= 5) {
    return 'Mehr als fünf eigene Modi passen auf keinen Bildschirm - Zonen helfen weiter.';
  }
  return null;
}
