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
  offeneModule,
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

/** Der Abend, für den es den Riegel gibt: Panel im Flur, Babysitter da. */
const BABYSITTERABEND = {
  areaLocked: true,
  panel: true,
  babysitter: true,
  offenBis: 0,
  jetzt: JETZT,
};

describe('istGesperrt', () => {
  it('fragt ohne gesetztes Passwort nie', () => {
    expect(istGesperrt('family', { ...BABYSITTERABEND, areaLocked: false })).toBe(false);
    expect(istGesperrt('family', { ...BABYSITTERABEND, areaLocked: undefined })).toBe(
      false
    );
  });

  it('fragt beim ersten Öffnen', () => {
    expect(istGesperrt('family', BABYSITTERABEND)).toBe(true);
  });

  it('fragt nicht noch einmal, solange es offen ist', () => {
    expect(istGesperrt('family', { ...BABYSITTERABEND, offenBis: JETZT + 1000 })).toBe(
      false
    );
  });

  it('fragt wieder, sobald die Zeit um ist', () => {
    expect(istGesperrt('family', { ...BABYSITTERABEND, offenBis: JETZT })).toBe(true);
  });

  it('lässt das Licht auch mit Riegel in Ruhe', () => {
    expect(istGesperrt('light', BABYSITTERABEND)).toBe(false);
  });

  it('fragt am Telefon nie', () => {
    // Es steckt in einer Tasche, nicht im Flur - was darauf steht, sieht
    // ohnehin nur der, dem es gehört.
    expect(istGesperrt('family', { ...BABYSITTERABEND, panel: false })).toBe(false);
    expect(istGesperrt('family', { ...BABYSITTERABEND, panel: undefined })).toBe(false);
  });

  it('fragt ohne Babysitter-Modus nicht', () => {
    // Mittags ist die Familie unter sich. Zwanzig Ziffern am Tag für
    // einen Fall, den es an den meisten Tagen gar nicht gibt.
    expect(istGesperrt('family', { ...BABYSITTERABEND, babysitter: false })).toBe(false);
    expect(istGesperrt('family', { ...BABYSITTERABEND, babysitter: undefined })).toBe(
      false
    );
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

describe('Was am Wandpanel ohne Code offensteht', () => {
  it('sind Kontakte, Notfallblatt und Babysitter', () => {
    // Der Babysitter braucht das Notfallblatt, und im Notfall braucht es
    // jeder, der gerade im Flur steht. Ein Code davor ist kein
    // Sichtschutz, sondern eine verschlossene Tür vor dem Feuerlöscher.
    expect(offeneModule('family', true, true)).toEqual([
      'contacts',
      'emergency',
      'babysitter',
    ]);
  });

  it('gilt nur am Panel', () => {
    // Auf einem Telefon hat der Riegel diesen Zweck nicht - das Gerät
    // steckt in einer Tasche und nicht im Flur.
    expect(offeneModule('family', false, true)).toEqual([]);
    expect(offeneModule('family', undefined, true)).toEqual([]);
  });

  it('gilt nur, wo der Riegel wirklich steht', () => {
    // Sonst stünde dieselbe Kachel zweimal da: einmal als Abkürzung und
    // einmal auf der Seite dahinter.
    expect(offeneModule('family', true, false)).toEqual([]);
    // Und im Konto gibt es nichts, was der Besuch im Flur brauchte.
    expect(offeneModule('account', true, true)).toEqual([]);
  });
});
