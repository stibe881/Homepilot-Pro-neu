/**
 * «Mami anrufen» in der Kinder-Ansicht (Punkt 261 der Werkbank).
 *
 * Der Babysitter hat den grossen Anruf-Knopf (Punkt 183) - das Kind vor
 * dem Wandpanel hatte nichts. Hier steht rein und testbar, welche
 * Knöpfe es gibt und wie sie heissen; die Nummern kommen aus derselben
 * Quelle wie beim Babysitter: die Kontakte der Familienlisten mit der
 * Rolle «Notfall». Eine zweite Liste zu pflegen hiesse, dass eine der
 * beiden veraltet - und zwar die, auf die es ankommt.
 */
import { Platform } from 'react-native';

import { Eintrag, nummernVon, rollenVon, waehlbar } from './familie';

/**
 * Ob dieses Gerät einen tel:-Link wählen kann.
 *
 * Im Browser (Web-Fassung, Wandpanel im Browser) öffnet tel: nichts -
 * dort zeigt die Ansicht die Nummer gross an, statt einen toten Knopf
 * hinzustellen. Gehört der Art nach zu lib/plattform.ts (kann.*);
 * solange nur der Elternruf danach fragt, wohnt die Antwort bei ihm.
 */
export const kannAnrufen = Platform.OS !== 'web';

/** Ein Anruf-Knopf: wer, wie beschriftet, welche Nummer. */
export interface RufKnopf {
  /** Der Name der Person - für die Anzeige ohne Telefonie. */
  name: string;
  /** «Mami anrufen» - fürs Vorlesen und auf dem Knopf. */
  label: string;
  /** Die Nummer, wie sie eingetragen ist («079 123 45 67»). */
  nummer: string;
  /** Die wählbare Form für den tel:-Link. */
  tel: string;
}

/** Womit ein Knopf ohne Kontaktnamen beschriftet wird. Erst ab dem
 *  dritten Elternteil gibt es keinen Ersatznamen mehr - den Fall gibt
 *  es nicht, und «Zuhause» wäre eine Nummer ohne Gesicht. */
const ERSATZNAMEN = ['Mami', 'Papi'];

/**
 * Die Anruf-Knöpfe für die Kinder-Ansicht (rein, testbar).
 *
 * Genommen werden die Notfallkontakte mit einer Nummer, höchstens zwei
 * - dieselbe Auswahl wie auf der Babysitter-Seite. Trägt ein Kontakt
 * einen Namen, steht der auf dem Knopf («Mama anrufen» statt hart
 * «Mami»); ohne Namen springen «Mami» und «Papi» ein. Keine Kontakte,
 * keine Knöpfe: Ein Knopf, der nichts wählt, ist für ein Kind
 * schlimmer als keiner.
 */
export function rufKnoepfe(
  contacts: Eintrag[] | null | undefined,
  hoechstens = 2
): RufKnopf[] {
  const knoepfe: RufKnopf[] = [];
  for (const kontakt of contacts ?? []) {
    if (!rollenVon(kontakt).includes('notfall')) continue;
    const nummer = nummernVon(kontakt)[0]?.nummer;
    if (!nummer) continue;
    const name =
      String(kontakt?.text ?? '').trim() || ERSATZNAMEN[knoepfe.length] || '';
    if (!name) continue;
    knoepfe.push({ name, label: `${name} anrufen`, nummer, tel: waehlbar(nummer) });
    if (knoepfe.length >= hoechstens) break;
  }
  return knoepfe;
}
