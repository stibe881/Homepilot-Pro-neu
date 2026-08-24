/**
 * Die Kennung, unter der eine Person ihren Standort meldet.
 *
 * Der Hub rechnet dieselbe Kennung aus seiner Benutzerliste aus (siehe
 * `zonenkennung` in hub/homepilot/integrations/geofence.py). Beide Seiten
 * müssen zeichenweise dasselbe ergeben - weicht eine ab, meldet das
 * Telefon an eine Zone, die es nicht gibt, und der Hub weist es ab.
 * Deshalb steht die Regel hier an einer Stelle und nicht mitten in einem
 * Bildschirm.
 */

/** Umlaute und Zubehör - eine Zonenkennung soll durch eine URL passen. */
const UMSCHRIFT: Record<string, string> = {
  ä: 'ae', ö: 'oe', ü: 'ue', ß: 'ss',
  à: 'a', á: 'a', â: 'a', ã: 'a', å: 'a',
  è: 'e', é: 'e', ê: 'e', ë: 'e',
  ì: 'i', í: 'i', î: 'i', ï: 'i',
  ò: 'o', ó: 'o', ô: 'o', õ: 'o', ø: 'o',
  ù: 'u', ú: 'u', û: 'u',
  ç: 'c', ñ: 'n',
};

export function zonenkennung(name: string | null | undefined): string {
  const erstes = String(name ?? '').trim().split(' ')[0].toLowerCase();
  return [...erstes]
    .map((zeichen) => UMSCHRIFT[zeichen] ?? zeichen)
    .join('')
    .replace(/[^a-z0-9_]/g, '');
}
