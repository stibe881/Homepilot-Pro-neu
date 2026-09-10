import { STICHWORTE, seitenSuchen } from './seitensuche';
import { SECTION_LABEL, type Section } from './bereiche';

describe('seitenSuchen', () => {
  it('findet die Nachtruhe unter «Konto»', () => {
    // Der Fall, wegen dem es die Datei gibt: Niemand tippt «Konto»,
    // wenn er die Ruhezeit sucht.
    const treffer = seitenSuchen('nachtruhe');
    expect(treffer[0].section).toBe('account');
  });

  it('findet das Update unter «System»', () => {
    expect(seitenSuchen('update')[0].section).toBe('system');
  });

  it('sagt, weswegen getroffen wurde', () => {
    // «Geräte · Batterie» sagt einem, dass man richtig ist; «Geräte»
    // allein nicht.
    expect(seitenSuchen('batterie')[0].wegen).toBe('batterie');
  });

  it('lässt den Namen vor dem Stichwort gewinnen', () => {
    // Wer «Alarm» tippt, meint die Alarmseite - nicht die Geräteliste,
    // in der «Alarm» bloss ein Stichwort wäre.
    expect(seitenSuchen('alarm')[0].section).toBe('alarm');
  });

  it('schweigt bei einem einzelnen Buchstaben', () => {
    // Sonst stünde bei jedem Tippen die halbe App in der Liste.
    expect(seitenSuchen('a')).toEqual([]);
  });

  it('zeigt nur, was diese Person überhaupt sehen darf', () => {
    // Ein Suchtreffer auf eine Seite, die der Hub dann abweist, ist
    // schlimmer als kein Treffer.
    const ohneAdmin = seitenSuchen('benutzer', (section) => section !== 'users');
    expect(ohneAdmin.every((zeile) => zeile.section !== 'users')).toBe(true);
  });
});

describe('STICHWORTE', () => {
  it('kennt nur Seiten, die es gibt', () => {
    // Ein Tippfehler im Schlüssel wäre eine Seite, die nie gefunden
    // wird - und niemand merkt es.
    for (const key of Object.keys(STICHWORTE)) {
      expect(SECTION_LABEL[key as Section]).toBeDefined();
    }
  });

  it('führt jedes Stichwort klein und ohne Rand', () => {
    // Verglichen wird kleingeschrieben; ein «Batterie» mit grossem B
    // fände sich nie.
    for (const worte of Object.values(STICHWORTE)) {
      for (const wort of worte ?? []) {
        expect(wort).toBe(wort.toLowerCase().trim());
      }
    }
  });
});
