/** Ein neues Gerät anlernen - aus der App (Punkt 632). */
import {
  anlernSatz,
  gefundenZeile,
  gekoppeltSatz,
  matterCodeGueltig,
  restText,
} from './anlernen';

describe('restText', () => {
  it('zeigt die Restzeit als Uhr', () => {
    expect(restText(187)).toBe('noch 3:07');
    expect(restText(60)).toBe('noch 1:00');
    expect(restText(0)).toBe('noch 0:00');
    expect(restText(-5)).toBe('noch 0:00');
  });
});

describe('gefundenZeile', () => {
  it('nennt das Modell, sonst den Namen, und sagt, woran es hängt', () => {
    expect(gefundenZeile({ name: '0x00158d', model: 'Aqara Türkontakt', status: 'successful' })).toBe(
      'Aqara Türkontakt gefunden'
    );
    expect(gefundenZeile({ name: '0x00158d', model: '', status: 'joined' })).toBe(
      '0x00158d klopft an …'
    );
    // Ein Modell, das Zigbee2MQTT nicht kennt, bekommt keine Kachel -
    // das soll dastehen, statt dass man auf sie wartet.
    expect(gefundenZeile({ name: 'x', model: 'Fremd', status: 'unsupported' })).toMatch(
      /kennt dieses Modell nicht/
    );
    expect(gefundenZeile({ name: 'x', model: '', status: 'failed' })).toMatch(/gescheitert/);
  });
});

describe('anlernSatz', () => {
  it('sagt, ob das Netz offen ist und was zu tun ist', () => {
    expect(anlernSatz(null)).toMatch(/sagt gerade nichts/);
    expect(anlernSatz({ offen: false, rest: 0, gefunden: [], verbunden: false })).toMatch(
      /Kein Broker/
    );
    expect(anlernSatz({ offen: true, rest: 90, gefunden: [] })).toBe(
      'Das Netz ist offen (noch 1:30). Jetzt die Anlerntaste am Gerät drücken.'
    );
    expect(anlernSatz({ offen: false, rest: 0, gefunden: [] })).toMatch(/^Das Netz ist zu/);
  });
});

describe('matterCodeGueltig', () => {
  it('nimmt den QR-Inhalt und den Zahlencode, sonst nichts', () => {
    expect(matterCodeGueltig('MT:Y.K90-Q000KA0648G00')).toBe(true);
    expect(matterCodeGueltig('mt:x')).toBe(true);
    expect(matterCodeGueltig('3497-011-2332')).toBe(true);
    expect(matterCodeGueltig('34970112332')).toBe(true);
    expect(matterCodeGueltig('3497011233')).toBe(false);
    expect(matterCodeGueltig('MT:')).toBe(false);
    expect(matterCodeGueltig('Stehlampe')).toBe(false);
    expect(matterCodeGueltig('')).toBe(false);
  });
});

describe('gekoppeltSatz', () => {
  it('nennt die Geräte, sonst den Knoten', () => {
    expect(gekoppeltSatz(['Stehlampe', 'Kontakt'], 7)).toBe('Aufgenommen: Stehlampe, Kontakt.');
    expect(gekoppeltSatz([], 7)).toMatch(/Knoten 7/);
    expect(gekoppeltSatz([], null)).toBe('Aufgenommen.');
  });
});
