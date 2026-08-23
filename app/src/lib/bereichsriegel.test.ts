/**
 * Der Riegel vor den persönlichen Bereichen.
 *
 * Der Fall dahinter: das Wandtablet im Flur. Licht und Storen bedient
 * jeder, der vorbeigeht – die Einkaufsliste und der Kalender der Familie
 * sollen nicht offen im Flur stehen.
 */
import {
  OFFEN_MS,
  istGesperrt,
  istPersoenlich,
  offenBis,
} from './bereichsriegel';

const JETZT = 1_700_000_000_000;

describe('istPersoenlich', () => {
  it('nennt Familie und Konto persönlich', () => {
    expect(istPersoenlich('family')).toBe(true);
    expect(istPersoenlich('account')).toBe(true);
  });

  it('lässt das Haus selbst frei', () => {
    // Sonst stünde jemand im Dunkeln vor einem Passwortfeld.
    expect(istPersoenlich('start')).toBe(false);
    expect(istPersoenlich('light')).toBe(false);
    expect(istPersoenlich('alarm')).toBe(false);
  });
});

describe('istGesperrt', () => {
  it('fragt ohne gesetztes Passwort nie', () => {
    expect(istGesperrt('family', false, 0, JETZT)).toBe(false);
    expect(istGesperrt('family', undefined, 0, JETZT)).toBe(false);
  });

  it('fragt beim ersten Öffnen', () => {
    expect(istGesperrt('family', true, 0, JETZT)).toBe(true);
  });

  it('fragt nicht noch einmal, solange es offen ist', () => {
    expect(istGesperrt('family', true, JETZT + 1000, JETZT)).toBe(false);
  });

  it('fragt wieder, sobald die Zeit um ist', () => {
    expect(istGesperrt('family', true, JETZT, JETZT)).toBe(true);
  });

  it('lässt das Licht auch mit Riegel in Ruhe', () => {
    expect(istGesperrt('light', true, 0, JETZT)).toBe(false);
  });
});

describe('offenBis', () => {
  it('nimmt die Dauer vom Hub', () => {
    expect(offenBis(JETZT, 120)).toBe(JETZT + 120_000);
  });

  it('hat eine eigene, wenn der Hub keine nennt', () => {
    expect(offenBis(JETZT)).toBe(JETZT + OFFEN_MS);
    expect(offenBis(JETZT, 0)).toBe(JETZT + OFFEN_MS);
  });
});
