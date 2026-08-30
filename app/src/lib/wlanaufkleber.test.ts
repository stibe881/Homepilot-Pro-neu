/**
 * Der Aufkleber, mit dem sich Besuch selbst einen WLAN-Code holt.
 *
 * Der Anlass: Bisher konnte einen Gutschein nur ziehen, wer ein Konto
 * hat – der Gast wartete, bis ihm jemand einen Code vorlas.
 */
import { Aufkleberstand, aufkleberSatz, huerde, offenSatz } from './wlanaufkleber';

const STAND: Aufkleberstand = {
  url: 'https://haus.example.ch/gast/wlan/abc',
  public: true,
  unifi: true,
  hours: 12,
  open: [],
};

describe('huerde', () => {
  it('schweigt, wenn alles steht', () => {
    expect(huerde(STAND)).toBeNull();
  });

  it('nennt den fehlenden Controller zuerst', () => {
    // Ohne ihn gibt es gar keine Gutscheine - das wiegt schwerer als
    // eine fehlende Adresse.
    expect(huerde({ ...STAND, unifi: false, public: false })).toContain('UniFi');
  });

  it('erklärt, warum der Aufkleber unterwegs nicht wirkt', () => {
    const satz = huerde({ ...STAND, public: false });
    expect(satz).toContain('public_url');
    expect(satz).toContain('Wandpanel');
  });

  it('behauptet ohne Stand gar nichts', () => {
    expect(huerde(null)).toBeNull();
  });
});

describe('aufkleberSatz', () => {
  it('sagt, was der Code tut und wie lange er gilt', () => {
    expect(aufkleberSatz(STAND)).toContain('12 Stunden');
    expect(aufkleberSatz(STAND)).toContain('einmal einlösbar');
  });
});

describe('offenSatz', () => {
  it('schweigt, solange keiner offen ist', () => {
    expect(offenSatz(STAND)).toBeNull();
  });

  it('zählt und beugt richtig', () => {
    const eins = { ...STAND, open: [{ code: 'a', left: 'Noch 3 Std.' }] };
    expect(offenSatz(eins)).toBe('1 Code offen');
    expect(offenSatz({ ...eins, open: [...eins.open, { code: 'b', left: 'x' }] })).toBe(
      '2 Codes offen'
    );
  });
});
