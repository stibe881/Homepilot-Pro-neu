/**
 * Was ein langer Druck auf eine Kachel anbietet.
 *
 * Der lange Druck zeigt den Verlauf des Geräts: wann es an- und ausging,
 * öffnete und schloss – und wer es war. Umbenennen gab es nur im
 * Anpassen-Modus – drei Schritte für eine Kleinigkeit, die man meistens
 * genau dann tun will, wenn einem der Name vor Augen steht.
 *
 * Beides auf derselben Geste heisst: eine kleine Auswahl. Aber nur, wenn
 * es wirklich etwas zu wählen gibt – bleibt nur ein Eintrag übrig,
 * passiert er sofort. Für alle, die nicht umbenennen dürfen, ändert sich
 * damit gar nichts: Der lange Druck zeigt weiter direkt den Verlauf.
 *
 * Dazu kam «Oben nicht mitzählen»: Die «3 an» in der Kopfzeile
 * beantwortet «brennt noch etwas?», und der Kühlschrank gehört nicht in
 * diese Antwort. Ausblenden hülfe nicht - dann wäre auch die Kachel weg.
 * Siehe lib/zaehlung.ts.
 *
 * Umbenennen gilt fürs ganze Haus (der Hub merkt sich den Namen) und
 * darum nur für die Besitzerin: Der Hub verlangt für die Route
 * `edit_config`, und diese Auswahl fragt dasselbe, damit niemand einen
 * Knopf sieht, der ihm gleich ein «nicht erlaubt» einträgt.
 */

export type KachelAktion =
  | 'umbenennen'
  | 'sperren'
  | 'zaehlung'
  | 'verlauf'
  | 'doppeltipp';

export interface KachelEintrag {
  id: KachelAktion;
  label: string;
  /** Ionicons-Name; die Kachel setzt ihn ein, die Liste kennt ihn nur. */
  icon: string;
}

const EINTRAEGE: Record<KachelAktion, KachelEintrag> = {
  umbenennen: { id: 'umbenennen', label: 'Umbenennen', icon: 'pencil' },
  sperren: { id: 'sperren', label: 'Sperren', icon: 'lock-closed-outline' },
  zaehlung: { id: 'zaehlung', label: 'Oben nicht mitzählen', icon: 'eye-off-outline' },
  verlauf: { id: 'verlauf', label: 'Verlauf ansehen', icon: 'time-outline' },
  // Die Beschriftung kommt von aussen (lib/doppeltipp.ts): Sie nennt
  // den Wert, der gemerkt würde - «Doppeltipp merken: 40 %».
  doppeltipp: { id: 'doppeltipp', label: 'Doppeltipp merken', icon: 'flash-outline' },
};

/** Beschriftung, die sagt, was der Griff bewirkt – nicht, was gerade gilt. */
const ENTSPERREN: KachelEintrag = {
  id: 'sperren',
  label: 'Sperre aufheben',
  icon: 'lock-open-outline',
};

const ZAEHLT_WIEDER: KachelEintrag = {
  id: 'zaehlung',
  label: 'Oben wieder mitzählen',
  icon: 'eye-outline',
};

/**
 * Die Einträge des Kachelmenüs, in der Reihenfolge, in der sie stehen
 * (rein, testbar).
 *
 * Der Verlauf steht oben. Hier stand einmal «Umbenennen» - mit der
 * Begründung, es sei der Grund, aus dem es dieses Menü gibt. Das war die
 * Sicht dessen, der das Menü gebaut hat, nicht die dessen, der es
 * benutzt: Umbenannt wird ein Gerät einmal, nachgesehen «wann ging das
 * an?» immer wieder. Und die Geste, mit der man beides erreicht, ist
 * dieselbe - also gewinnt die häufigere Frage.
 */
export function kachelAktionen(moeglich: {
  umbenennen?: boolean;
  /** Sperren: schaltet nur noch nach ausdrücklicher Rückfrage. */
  sperren?: boolean;
  /** Ist das Gerät schon gesperrt? */
  gesperrt?: boolean;
  /** Licht oder Schalter: Nur die zählt die Kopfzeile überhaupt. */
  zaehlung?: boolean;
  /** Ist das Gerät schon aus der Zählung genommen? */
  ungezaehlt?: boolean;
  verlauf?: boolean;
  /** Beschriftung für den Doppeltipp-Eintrag - fehlt sie, gibt es am
   *  Gerät nichts zu merken (ein Schalter kennt nur an und aus). */
  doppeltipp?: string | null;
}): KachelEintrag[] {
  const eintraege: KachelEintrag[] = [];
  if (moeglich.verlauf) eintraege.push(EINTRAEGE.verlauf);
  if (moeglich.umbenennen) eintraege.push(EINTRAEGE.umbenennen);
  // Die Sperre gab es nur im Anpassen-Modus. Gebraucht wird sie in dem
  // Moment, in dem man fast die Waschmaschine erwischt hätte - also
  // hier, an der Kachel.
  if (moeglich.sperren) {
    eintraege.push(moeglich.gesperrt ? ENTSPERREN : EINTRAEGE.sperren);
  }
  // «Oben nicht mitzählen» steht bei der Kachel und nicht in einer
  // Einstellungsliste: Man merkt es in dem Moment, in dem man die «3 an»
  // liest und weiss, dass eines davon der Kühlschrank ist.
  if (moeglich.zaehlung) {
    eintraege.push(moeglich.ungezaehlt ? ZAEHLT_WIEDER : EINTRAEGE.zaehlung);
  }
  // Zuletzt: Der Doppeltipp ist eine Feineinstellung, kein Handgriff,
  // den man sucht - er soll den Verlauf nicht nach unten schieben.
  if (moeglich.doppeltipp) {
    eintraege.push({ ...EINTRAEGE.doppeltipp, label: moeglich.doppeltipp });
  }
  return eintraege;
}
