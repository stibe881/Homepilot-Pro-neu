/**
 * Aus einem Ladennamen wird eine Ortskennung.
 *
 * Der Hub rechnet dieselbe Kennung aus (`ort_kennung` in
 * hub/homepilot/core/presence.py). Beide Seiten müssen zeichenweise
 * dasselbe ergeben: Die App hängt den Laden nach dem Anlegen sofort an
 * die Kennung, die der Hub gerade vergeben hat - weicht sie ab, zeigt
 * der Laden ins Leere und die Erinnerung kommt nie.
 */

const UMSCHRIFT: Record<string, string> = { ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss' };

export function ortKennung(name: string | null | undefined): string {
  const text = [...String(name ?? '').trim().toLowerCase()]
    .map((zeichen) => UMSCHRIFT[zeichen] ?? zeichen)
    .join('');
  return text
    .replace(/[^a-z0-9]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '');
}
