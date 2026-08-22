/**
 * Wo ein Rezeptschritt vorgelesen wird.
 *
 * Bisher ging jedes «Vorlesen» als Durchsage an die Cast-Boxen – und ohne
 * gewählte Box an *alle*. Wer in der Küche auf den Knopf tippte, hörte
 * seinen Schritt also im Wohnzimmer. Das ist die Ausnahme, nicht der
 * Regelfall: Man liest dort mit, wo man steht.
 *
 * Deshalb ist «dieses Gerät» die Vorgabe, und die Boxen bleiben als
 * bewusste Wahl – für den Fall, dass das Telefon am Ladekabel im Flur
 * hängt.
 */

/** Das Gerät in der Hand. Kein Lautsprecher-Kennzeichen, deshalb ein
 *  eigener Wert, der mit keiner Entitäts-ID kollidieren kann. */
export const ZIEL_HIER = 'hier';

/** Alle Boxen zugleich – die frühere (und falsche) Vorgabe. */
export const ZIEL_ALLE = 'alle';

export interface Box {
  id: string;
  name: string;
}

/** Wird hier vorgelesen oder anderswo? (rein, testbar) */
export function istHier(ziel: string): boolean {
  return ziel === ZIEL_HIER;
}

/**
 * Was auf dem Knopf steht (rein, testbar).
 *
 * Der Knopf sagt, wohin es geht – sonst tippt man ihn im Zweifel nicht,
 * weil das Kind schläft.
 */
export function zielName(ziel: string, boxen: Box[]): string {
  if (istHier(ziel)) return 'Vorlesen';
  if (ziel === ZIEL_ALLE || !ziel) return 'Auf allen Boxen';
  const box = boxen.find((eintrag) => eintrag.id === ziel);
  return box ? `Auf ${box.name}` : 'Auf der Box';
}

/**
 * Die Auswahlliste (rein, testbar).
 *
 * «Dieses Gerät» steht zuoberst, weil es die Vorgabe ist und weil man in
 * einer Liste von zwölf Boxen sonst danach sucht.
 */
export function zielListe(boxen: Box[]): Box[] {
  return [
    { id: ZIEL_HIER, name: 'Dieses Gerät' },
    { id: ZIEL_ALLE, name: 'Alle Boxen' },
    ...boxen,
  ];
}

/**
 * Welche Lautsprecher der Hub ansagen soll (rein, testbar).
 *
 * Leer heisst für die Durchsage «alle» – deshalb darf hier nie ein
 * leeres Feld herauskommen, wenn eine Box gemeint war.
 */
export function sprecherFuer(ziel: string): string[] {
  if (istHier(ziel) || ziel === ZIEL_ALLE || !ziel) return [];
  return [ziel];
}
