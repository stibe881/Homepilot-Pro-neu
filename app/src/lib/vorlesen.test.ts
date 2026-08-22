/**
 * Wo ein Rezeptschritt vorgelesen wird.
 *
 * Der Auslöser: Wer in der Küche auf «Vorlesen» tippte, hörte seinen
 * Schritt im Wohnzimmer – die Durchsage ging ohne gewählte Box an alle
 * Cast-Lautsprecher. Man liest aber dort mit, wo man steht.
 */
import {
  ZIEL_ALLE,
  ZIEL_HIER,
  istHier,
  sprecherFuer,
  zielListe,
  zielName,
} from './vorlesen';

const boxen = [
  { id: 'google_cast.kueche', name: 'Küche' },
  { id: 'google_cast.wohnzimmer', name: 'Wohnzimmer' },
];

describe('Vorlese-Ziel', () => {
  it('erkennt das Gerät in der Hand', () => {
    expect(istHier(ZIEL_HIER)).toBe(true);
    expect(istHier(ZIEL_ALLE)).toBe(false);
    expect(istHier('google_cast.kueche')).toBe(false);
  });

  it('sagt auf dem Knopf, wohin es geht', () => {
    // Sonst tippt man ihn im Zweifel nicht, weil das Kind schläft.
    expect(zielName(ZIEL_HIER, boxen)).toBe('Vorlesen');
    expect(zielName(ZIEL_ALLE, boxen)).toBe('Auf allen Boxen');
    expect(zielName('google_cast.kueche', boxen)).toBe('Auf Küche');
    // Eine Box, die es nicht mehr gibt, ergibt keinen leeren Knopf.
    expect(zielName('google_cast.weg', boxen)).toBe('Auf der Box');
    // Der alte gespeicherte Wert '' hiess «alle».
    expect(zielName('', boxen)).toBe('Auf allen Boxen');
  });

  it('stellt das eigene Gerät zuoberst', () => {
    // In einer Liste von zwölf Boxen sucht man die Vorgabe sonst.
    const liste = zielListe(boxen);
    expect(liste[0]).toEqual({ id: ZIEL_HIER, name: 'Dieses Gerät' });
    expect(liste[1].id).toBe(ZIEL_ALLE);
    expect(liste).toHaveLength(4);
  });

  it('schickt nie ein leeres Ziel, wenn eine Box gemeint war', () => {
    // Leer heisst für die Durchsage «alle» – genau der Fehler von vorher.
    expect(sprecherFuer('google_cast.kueche')).toEqual(['google_cast.kueche']);
    expect(sprecherFuer(ZIEL_ALLE)).toEqual([]);
    expect(sprecherFuer(ZIEL_HIER)).toEqual([]);
  });
});
