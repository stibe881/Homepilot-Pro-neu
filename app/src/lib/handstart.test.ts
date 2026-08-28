import { brauchtRueckfrage, handstartSatz } from './handstart';

describe('brauchtRueckfrage', () => {
  it('fragt vor dem Türschloss', () => {
    expect(brauchtRueckfrage([{ command: 'turn_off' }, { command: 'lock' }])).toBe(true);
  });

  it('fragt vor der Alarmanlage', () => {
    expect(brauchtRueckfrage([{ command: 'arm_away' }])).toBe(true);
  });

  it('lässt Licht und Sauger sofort laufen', () => {
    // Wer beim Einrichten fünfmal drückt, will nicht fünfmal bestätigen.
    expect(
      brauchtRueckfrage([{ command: 'turn_on' }, { command: 'clean_rooms' }]),
    ).toBe(false);
  });

  it('sieht auch in den sonst-Zweig', () => {
    // Beim Handstart weiss man vorher nicht, welcher Zweig dran ist.
    expect(brauchtRueckfrage([{ command: 'turn_on' }], [{ command: 'unlock' }])).toBe(
      true,
    );
  });

  it('kommt ohne Aktionen zurecht', () => {
    expect(brauchtRueckfrage(undefined)).toBe(false);
    expect(brauchtRueckfrage([])).toBe(false);
  });
});

describe('handstartSatz', () => {
  it('zählt die Schritte und warnt vor den Bedingungen', () => {
    const satz = handstartSatz(62);
    expect(satz).toContain('62 Schritte');
    expect(satz).toContain('Bedingungen werden dabei übergangen');
  });

  it('beugt den einen Schritt richtig', () => {
    expect(handstartSatz(1)).toContain('1 Schritt.');
  });
});
