/**
 * Wie eine Rolle im Haus auf Deutsch heisst.
 *
 * Stand in screens/UsersScreen.tsx, wurde aber längst von mehreren
 * Bildschirmen gebraucht - die Systemseite holte es sich schon von dort,
 * und das Profil hätte als Nächstes nachgezogen. Ein Bildschirm, aus dem
 * andere Bildschirme Wörter importieren, ist der falsche Ort dafür.
 *
 * «besitzer» steht so in der Hub-Konfiguration; hingeschrieben wird es
 * gross und ausgeschrieben - «bewohner» ist im Haus ein «Mitbewohner».
 */
export const ROLE_LABELS: Record<string, string> = {
  besitzer: 'Besitzer',
  bewohner: 'Mitbewohner',
  // Punkt 245 der Werkbank: zwischen Mitbewohner und Gast - ein Kind
  // war vorher ein Bewohner mit fünf verstreuten Einschränkungsfeldern,
  // und wer eines vergass, hatte ein Kind mit Systemsicht.
  kind: 'Kind',
  gast: 'Gast',
};
