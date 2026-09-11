import {
  ThemeMode,
  darkColors,
  lightColors,
  mitternachtColors,
  pinkColors,
  sandColors,
} from '../theme';

/**
 * Zwei Farben, die zeigen, wie ein Erscheinungsbild aussieht.
 *
 * Die Wahl stand als sieben gleich aussehende Wortpillen da:
 * «Neonpink», «Mitternacht», «Sand». Was davon dunkel ist und was
 * hell, erfuhr man nur durchs Ausprobieren - und wer eines antippte,
 * musste sich durch die anderen tippen, um zurückzufinden. Ein
 * Farbfleck neben dem Wort beantwortet das vorher.
 *
 * Zwei Farben und nicht eine: Jedes Erscheinungsbild ist ein Verlauf,
 * und gerade der Unterschied zwischen oben und unten macht «Sand» aus.
 *
 * «System» und «Nach Sonnenstand» haben keine eigene Palette - sie
 * sind hell *und* dunkel. Ihr Fleck zeigt darum beides nebeneinander,
 * und genau das ist die Aussage.
 */
export function themenprobe(mode: ThemeMode): [string, string] {
  switch (mode) {
    case 'light':
      return [lightColors.gradient[0], lightColors.gradient[2]];
    case 'dark':
      return [darkColors.gradient[0], darkColors.gradient[2]];
    case 'pink':
      return [pinkColors.gradient[0], pinkColors.gradient[2]];
    case 'mitternacht':
      return [mitternachtColors.gradient[0], mitternachtColors.gradient[2]];
    case 'sand':
      return [sandColors.gradient[0], sandColors.gradient[2]];
    default:
      // System und Sonnenstand: hell über dunkel.
      return [lightColors.gradient[0], darkColors.gradient[2]];
  }
}
