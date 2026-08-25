/**
 * Wie die Startseite begrüsst.
 *
 * Herausgelöst aus DashboardScreen.tsx, weil hier eine Entscheidung
 * steckt und keine Darstellung – und weil der Bildschirm die
 * Symbolschriften von Expo mitzieht und für Jest deshalb nicht greifbar
 * ist.
 *
 * Drei Fälle, die auseinandergehalten werden wollen:
 *
 * - **Ein Telefon.** «Hallo Stefan,» – der Name des angemeldeten
 *   Menschen ist die richtige Anrede.
 * - **Ein Wandpanel.** Vor dem iPad im Flur steht mal die eine, mal der
 *   andere, mal ein Gast. «Hallo Stefan» begrüsst dort den Falschen,
 *   auch wenn Stefans Zugang darin steckt.
 * - **Ein Gemeinschaftsgerät** (`shared`): derselbe Fall, nur vom Hub
 *   her entschieden statt vom Gerät.
 *
 * In beiden letzten Fällen sticht ein selbst gesetzter Name trotzdem:
 * Wer «Küche» hinschreibt, meint es so.
 */

export function begruessung(
  settings: { name?: string; panel?: boolean },
  user: { name: string; shared?: boolean } | null
): string {
  const eigener = (settings.name ?? '').trim();
  if (eigener) return `Hallo ${eigener},`;
  // Am Panel und am Gemeinschaftsgerät steht kein einzelner Mensch –
  // der Name des Zugangs ist dort eine Aussage über das Gerät, nicht
  // über den, der davorsteht.
  if (settings.panel || user?.shared) return 'Willkommen zuhause,';
  return user?.name ? `Hallo ${user.name},` : 'Willkommen zuhause,';
}
