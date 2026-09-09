import { WidgetButton } from './widgetButtons';

/**
 * Die Knöpfe im Auto - CarPlay und Android Auto.
 *
 * Es sind dieselben, die im Sperrbildschirm-Widget stehen: Wer sie dort
 * zusammengestellt hat, hat damit schon gesagt, was ihm die drei
 * wichtigsten Handgriffe sind. Eine zweite Liste zu pflegen wäre eine
 * zweite Liste zum Vergessen.
 *
 * **Was im Auto anders ist als überall sonst**, und deshalb hier steht:
 *
 * Ein Knopf muss *selbst schalten* können. Auf dem Telefon darf einer
 * die App an der richtigen Stelle öffnen - im Auto gibt es nichts zu
 * öffnen: Die Oberfläche des Telefons bleibt während der Fahrt dunkel,
 * und der Bildschirm im Auto kann nur, was seine Vorlagen können. Ein
 * Knopf ohne eigene Wirkung wäre dort eine Kachel, die beim Antippen
 * nichts tut - schlimmer als eine Kachel, die fehlt.
 *
 * Und die Symbole sind andere. Das Widget nennt SF-Symbole, die es nur
 * auf Apple-Geräten gibt; das Auto braucht einen Namen, den beide
 * Seiten kennen. Deshalb die Übersetzung hier - einmal, statt zweimal
 * nativ.
 */

/** Die Symbole, die beide Auto-Seiten zeichnen können. Bewusst wenige:
 *  Jedes muss als Vektor für Android *und* als SF-Symbol für CarPlay
 *  vorliegen, und ein Symbol, das eine Seite nicht kennt, ist eine
 *  leere Kachel. */
export type Autosymbol =
  | 'tuer'
  | 'aus'
  | 'alarm'
  | 'licht'
  | 'szene'
  | 'store'
  | 'musik'
  | 'punkt';

/** Ein Knopf, wie ihn die native Auto-Seite bekommt. */
export interface Autoknopf {
  key: string;
  /** Kurz: Auf dem Autobildschirm bricht nichts um, es wird
   *  abgeschnitten. */
  title: string;
  symbol: Autosymbol;
  /** Pfad am Hub - im Auto wird immer selbst geschaltet. */
  path: string;
  /** Der Rumpf dazu, als JSON-Text (meist «{}»). */
  body: string;
}

/**
 * Höchstens so viele Knöpfe gehen ins Auto.
 *
 * Dieselben acht wie im Widget - mehr gibt die Liste gar nicht her.
 * Wie viele davon wirklich auf den Bildschirm passen, entscheidet aber
 * das Auto und nicht wir: Android fragt man zur Laufzeit
 * (`ConstraintManager`), und ein VW-Bildschirm zeigt andere Zahlen als
 * ein Tesla. Die native Seite schneidet deshalb noch einmal zu - hier
 * steht nur die Obergrenze, über die hinaus es sich nicht lohnt.
 */
export const AUTO_HOECHSTENS = 8;

/** SF-Symbol → Auto-Symbol (rein, testbar). */
export function autoSymbol(sf: string): Autosymbol {
  const name = String(sf || '');
  if (name.startsWith('key')) return 'tuer';
  if (name.startsWith('power')) return 'aus';
  if (name.startsWith('shield') || name.startsWith('lock.shield')) return 'alarm';
  if (name.startsWith('lightbulb')) return 'licht';
  if (name.startsWith('sparkles') || name.startsWith('theatermasks')) return 'szene';
  if (name.startsWith('arrow.up.arrow.down') || name.startsWith('blinds')) return 'store';
  if (
    name.startsWith('music') ||
    name.startsWith('speaker') ||
    name.startsWith('hifispeaker')
  ) {
    return 'musik';
  }
  // Lieber ein Punkt als nichts: Eine Kachel ohne Bild zeichnet Android
  // gar nicht erst.
  return 'punkt';
}

/**
 * Aus den Widget-Knöpfen die Auto-Knöpfe (rein, testbar).
 *
 * Es bleiben nur die, die selbst schalten. Wer im Widget einen Knopf
 * hat, der bloss die App öffnet, sieht ihn im Auto nicht - und das ist
 * die richtige Auskunft: Dort gäbe es nichts zu öffnen.
 */
export function autoKnoepfe(buttons: WidgetButton[]): Autoknopf[] {
  return buttons
    .filter((knopf) => !!knopf.direct && !!knopf.actionPath)
    .slice(0, AUTO_HOECHSTENS)
    .map((knopf) => ({
      key: knopf.key,
      title: knopf.title,
      symbol: autoSymbol(knopf.symbol),
      path: knopf.actionPath as string,
      body: knopf.actionBody ?? '{}',
    }));
}

/**
 * Was in der App unter «Auto» steht (rein, testbar).
 *
 * Die Zeile beantwortet die Frage, die man sich sonst erst im Auto
 * stellt - wo man sie nicht mehr beantworten kann: Warum ist die
 * Kachelwand leer, obwohl im Widget fünf Knöpfe stehen?
 */
export function autoSatz(buttons: WidgetButton[]): string {
  const knoepfe = autoKnoepfe(buttons);
  if (knoepfe.length > 0) {
    const zahl =
      knoepfe.length === 1 ? '1 Knopf' : `${knoepfe.length} Knöpfe`;
    return `${zahl} im Auto: ${knoepfe.map((knopf) => knopf.title).join(', ')}`;
  }
  if (buttons.length > 0) {
    return (
      'Keiner deiner Widget-Knöpfe schaltet selbst - im Auto gibt es aber ' +
      'nichts zu öffnen. Unter «Widget» je Knopf «direkt schalten» ' +
      'einschalten, dann erscheinen sie auch dort.'
    );
  }
  return 'Noch keine Knöpfe eingestellt - dieselben wie im Widget.';
}
