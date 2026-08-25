/**
 * Was ein langer Druck auf eine Kachel anbietet.
 *
 * Der lange Druck zeigte bisher den Verlauf des Geräts. Umbenennen gab es
 * nur im Anpassen-Modus – drei Schritte für eine Kleinigkeit, die man
 * meistens genau dann tun will, wenn einem der Name vor Augen steht.
 *
 * Beides auf derselben Geste heisst: eine kleine Auswahl. Aber nur, wenn
 * es wirklich etwas zu wählen gibt – bleibt nur ein Eintrag übrig,
 * passiert er sofort. Für alle, die nicht umbenennen dürfen, ändert sich
 * damit gar nichts: Der lange Druck zeigt weiter direkt den Verlauf.
 *
 * Umbenennen gilt fürs ganze Haus (der Hub merkt sich den Namen) und
 * darum nur für die Besitzerin: Der Hub verlangt für die Route
 * `edit_config`, und diese Auswahl fragt dasselbe, damit niemand einen
 * Knopf sieht, der ihm gleich ein «nicht erlaubt» einträgt.
 */

export type KachelAktion = 'umbenennen' | 'verlauf';

export interface KachelEintrag {
  id: KachelAktion;
  label: string;
  /** Ionicons-Name; die Kachel setzt ihn ein, die Liste kennt ihn nur. */
  icon: string;
}

const EINTRAEGE: Record<KachelAktion, KachelEintrag> = {
  umbenennen: { id: 'umbenennen', label: 'Umbenennen', icon: 'pencil' },
  verlauf: { id: 'verlauf', label: 'Verlauf ansehen', icon: 'time-outline' },
};

/**
 * Die Einträge des Kachelmenüs, in der Reihenfolge, in der sie stehen
 * (rein, testbar).
 *
 * «Umbenennen» steht oben: Es ist der Grund, aus dem es dieses Menü
 * überhaupt gibt. Der Verlauf hat unter «Geräte» ohnehin seinen eigenen
 * Weg über einen einfachen Tipp.
 */
export function kachelAktionen(moeglich: {
  umbenennen?: boolean;
  verlauf?: boolean;
}): KachelEintrag[] {
  const gewaehlt: KachelAktion[] = [];
  if (moeglich.umbenennen) gewaehlt.push('umbenennen');
  if (moeglich.verlauf) gewaehlt.push('verlauf');
  return gewaehlt.map((id) => EINTRAEGE[id]);
}
