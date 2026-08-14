/**
 * Gestaltung: helle Glaskacheln auf einem kühlen Farbverlauf.
 *
 * Die Kacheln sind durchscheinendes Weiss, damit der Verlauf durchschimmert –
 * daher sind Flächen als rgba definiert und nicht als Volltonfarben.
 */

export const colors = {
  // Hintergrundverlauf von oben links nach unten rechts.
  // Tupel-Typ, weil LinearGradient mindestens zwei Farben verlangt.
  gradient: ['#8B9AB0', '#6C7C94', '#556579'] as [string, string, ...string[]],

  // Kräftig genug, dass die Kacheln klar vor dem Verlauf stehen.
  surface: 'rgba(255, 255, 255, 0.78)',
  surfaceStrong: 'rgba(255, 255, 255, 0.94)',
  surfaceSoft: 'rgba(255, 255, 255, 0.26)',
  surfaceBorder: 'rgba(255, 255, 255, 0.6)',

  // Text auf Kacheln
  ink: '#232833',
  inkSoft: '#69727F',
  inkFaint: '#98A0AC',

  // Text auf dem Verlauf
  onGradient: '#FFFFFF',
  onGradientSoft: 'rgba(255, 255, 255, 0.78)',

  on: '#34C759',
  onSoft: 'rgba(52, 199, 89, 0.16)',
  off: 'rgba(35, 40, 51, 0.14)',
  accent: '#2F6BF6',
  warn: '#F5A524',
  danger: '#E5484D',

  track: 'rgba(35, 40, 51, 0.10)',
  // Farbtemperatur-Regler: warm nach kalt, wie an einer echten Lampe
  warmCool: ['#F5A524', '#FFFFFF', '#8CC5FF'] as [string, string, ...string[]],
};

export const radius = {
  card: 26,
  control: 18,
  pill: 999,
};

export const space = {
  gap: 14,
  page: 22,
};

export const type = {
  greeting: 34,
  greetingSmall: 25,
  cardTitle: 16,
  cardSub: 13,
  value: 26,
  label: 14,
};

/** Ab dieser Breite ist Platz für Seitenleiste und rechte Spalte. */
export const breakpoints = {
  rail: 760,
  sidePanel: 1100,
};
