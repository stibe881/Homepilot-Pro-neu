import { nochNichtZu, riegelText, unverschlossenAus } from './alarmriegel';

const haustuer = { entity_id: 'nuki.haustuer', label: 'Haustüre' };

describe('unverschlossenAus', () => {
  it('liest die Türen aus der dritten Antwort des Hubs', () => {
    expect(unverschlossenAus({ ok: false, reason: 'unverschlossen', unlocked: [haustuer] })).toEqual([
      haustuer,
    ]);
  });

  it('kommt mit einem älteren Hub und mit Unsinn zurecht', () => {
    // Ein Hub vor Punkt 614 schickt das Feld nicht.
    expect(unverschlossenAus({ ok: false, reason: 'offen', open: ['Fenster'] })).toEqual([]);
    expect(unverschlossenAus(null)).toEqual([]);
    expect(unverschlossenAus({ unlocked: ['Haustüre', { entity_id: 'x' }, { label: '' }] })).toEqual(
      []
    );
  });
});

describe('riegelText', () => {
  it('ist nachts ein Hinweis und sonst eine Absage', () => {
    expect(riegelText([haustuer], true)).toBe('Scharf – aber nicht abgeschlossen: Haustüre');
    expect(riegelText([haustuer], false)).toBe('Nicht abgeschlossen: Haustüre');
    expect(riegelText([], false)).toBeNull();
  });
});

describe('nochNichtZu', () => {
  it('wartet, bis jede Türe wirklich «locked» sagt', () => {
    const keller = { entity_id: 'nuki.keller', label: 'Kellertüre' };
    // Mitten in der Umdrehung sagt das Nuki «locking» - das zählt noch nicht.
    const stand: Record<string, string> = { 'nuki.haustuer': 'locked', 'nuki.keller': 'locking' };
    expect(nochNichtZu([haustuer, keller], (id) => stand[id])).toEqual([keller]);
    stand['nuki.keller'] = 'locked';
    expect(nochNichtZu([haustuer, keller], (id) => stand[id])).toEqual([]);
    // Unbekannt heisst nicht zu.
    expect(nochNichtZu([haustuer], () => undefined)).toEqual([haustuer]);
  });
});
