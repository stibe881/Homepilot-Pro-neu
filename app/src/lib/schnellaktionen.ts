/**
 * Die Kurzbefehle am App-Symbol.
 *
 * Langer Druck auf das Symbol auf dem Homescreen, und darunter stehen
 * die drei, vier Handgriffe, für die man sonst die App öffnet, wartet,
 * zur richtigen Stelle tippt. Zwei Handgriffe weniger als über das
 * Widget - und im Gegensatz zu ihm ist das Symbol immer da, auch auf der
 * zweiten Seite und in der App-Mediathek.
 *
 * Was darauf steht, wird **nicht** ein zweites Mal eingestellt: Es sind
 * dieselben Knöpfe wie im Widget (Einstellungen → Widgets). Wer sie dort
 * ordnet, ordnet sie hier mit. Eine zweite Liste für dieselbe Frage wäre
 * eine zweite Stelle, an der man sucht - und eine, die mit der ersten
 * auseinanderläuft.
 *
 * Gedrückt wird nichts blind: Der Kurzbefehl trägt dieselbe
 * `homepilot://`-Adresse wie der Widget-Knopf, und die App behandelt sie
 * mit derselben Hürde - Schlösser bekommen ihre Rückfrage, alles andere
 * geht durch die gewohnte Prüfung.
 */
import { kann } from './plattform';

import { WidgetButton } from './widgetButtons';

/** Ein Kurzbefehl, wie ihn das Betriebssystem versteht. */
export interface Schnellaktion {
  id: string;
  title: string;
  /** Ein eingebautes Apple-Symbol – bewusst nur die sicheren Namen. */
  icon?: string;
  params: { url: string };
}

/**
 * iOS zeigt höchstens vier. Mehr einzutragen ist nicht falsch, aber die
 * hinteren sieht niemand - und das Höchstmass der Widget-Knöpfe ist
 * ohnehin dasselbe.
 */
export const HOECHSTENS = 4;

/**
 * Das Symbol zum Knopf (rein, testbar).
 *
 * Nur eingebaute Namen: Ein Symbol, das die iOS-Fassung nicht kennt,
 * zeichnet gar nichts - und ein Kurzbefehl ohne Bild sieht aus wie ein
 * Fehler. Dieselbe Vorsicht wie beim Widget.
 */
export function symbolFuer(key: string): string {
  if (key === 'door') return 'home';
  if (key === 'alloff') return 'prohibit';
  if (key === 'alarm') return 'love';
  if (key.startsWith('scene:')) return 'favorite';
  return 'task';
}

/**
 * Aus den Widget-Knöpfen Kurzbefehle machen (rein, testbar).
 *
 * Die Reihenfolge bleibt: Wer den Türknopf nach oben gezogen hat, meint
 * ihn auch hier zuerst.
 */
export function schnellaktionen(buttons: WidgetButton[]): Schnellaktion[] {
  return buttons.slice(0, HOECHSTENS).map((knopf) => ({
    id: knopf.key,
    title: knopf.title,
    icon: symbolFuer(knopf.key),
    params: { url: knopf.url },
  }));
}

/**
 * Die Kurzbefehle beim Betriebssystem hinterlegen.
 *
 * Erst zur Laufzeit geladen: Im Browser gibt es das Modul nicht, und ein
 * Import oben würde die Seite zerlegen - dieselbe Vorsicht wie bei der
 * Widget-Ablage (lib/widget.ts).
 *
 * Fehler bleiben still: Ein Kurzbefehl, der nicht angelegt werden kann,
 * ist eine Bequemlichkeit weniger - kein Grund, die App zu stören.
 */
export function setzeSchnellaktionen(buttons: WidgetButton[]): void {
  if (!kann.schnellaktionen) return;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const QuickActions = require('expo-quick-actions');
    QuickActions.setItems(schnellaktionen(buttons));
  } catch {
    // Siehe oben.
  }
}

/**
 * Auf einen gedrückten Kurzbefehl hören - und den, der die App gestartet
 * hat, sofort nachreichen.
 *
 * Gibt eine Funktion zum Abmelden zurück, oder nichts.
 */
export function hoereAufSchnellaktionen(
  aufAdresse: (url: string) => void
): (() => void) | undefined {
  if (!kann.schnellaktionen) return undefined;
  try {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const QuickActions = require('expo-quick-actions');
    // Der Kurzbefehl, mit dem die App gestartet wurde: Er liegt schon
    // bereit und käme über das Ereignis unten nie an - derselbe Fall wie
    // bei den Mitteilungen.
    const start = QuickActions.initial;
    if (start?.params?.url) aufAdresse(String(start.params.url));
    const listener = QuickActions.addListener(
      (aktion: { params?: { url?: unknown } }) => {
        if (aktion?.params?.url) aufAdresse(String(aktion.params.url));
      }
    );
    return () => listener.remove();
  } catch {
    return undefined;
  }
}
