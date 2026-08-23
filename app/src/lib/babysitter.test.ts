import { LEERER_BABYSITTER, istFreigegeben, modusSatz, ruht, seitText } from './babysitter';

describe('Babysitter-Modus', () => {
  it('hält zurück, was nicht freigegeben ist', () => {
    const stand = { active: true, allow: ['licht_flur'] };
    expect(ruht(stand, 'alles_aus')).toBe(true);
    expect(ruht(stand, 'licht_flur')).toBe(false);
  });

  it('hält ausserhalb des Modus nichts zurück – behält die Haken aber', () => {
    // Wer ihn am nächsten Abend wieder einschaltet, soll nicht neu
    // anhaken müssen.
    const stand = { active: false, allow: ['licht_flur'] };
    expect(ruht(stand, 'alles_aus')).toBe(false);
    expect(istFreigegeben(stand, 'licht_flur')).toBe(true);
  });

  it('sagt vor dem Einschalten, was dann ruht', () => {
    // Danach ist die Auskunft wertlos - dann sind die Storen schon unten.
    expect(modusSatz({ active: false, allow: ['a', 'b'] }, 20)).toBe(
      'Beim Einschalten laufen 2 von 20 Abläufen weiter, 18 ruhen.'
    );
    expect(modusSatz(LEERER_BABYSITTER, 20)).toContain('würden alle 20 Abläufe ruhen');
  });

  it('sagt im Betrieb, seit wann', () => {
    const um = new Date(2026, 7, 23, 19, 40).getTime() / 1000;
    const satz = modusSatz({ active: true, allow: ['a'], since: um }, 20);
    expect(satz).toContain('seit 19:40');
    expect(satz).toContain('1 von 20');
  });

  it('kommt ohne Zeitstempel aus', () => {
    expect(seitText(undefined)).toBe('');
    expect(seitText(null)).toBe('');
    expect(modusSatz({ active: true, allow: [] }, 5)).toContain('Läuft –');
  });
});
