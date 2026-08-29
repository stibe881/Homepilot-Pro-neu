import { fehlerZeilen } from './startfehler';

describe('fehlerZeilen', () => {
  it('nimmt Meldung und die ersten Stapelzeilen eines Error', () => {
    const fehler = new Error('Cannot read property x of undefined');
    fehler.stack = 'Error: Cannot read property x of undefined\n  at eins (a.ts:1)\n  at zwei (b.ts:2)';
    const { titel, text } = fehlerZeilen(fehler);
    expect(titel).toBe('Cannot read property x of undefined');
    // Die erste Zeile ist die Meldung selbst - die steht schon im Titel.
    expect(text).toBe('at eins (a.ts:1)\nat zwei (b.ts:2)');
  });

  it('kürzt einen langen Stapel auf acht Zeilen', () => {
    const fehler = new Error('kaputt');
    fehler.stack = ['Error: kaputt', ...Array.from({ length: 20 }, (_, i) => `  at f${i} (x.ts:${i})`)].join('\n');
    expect(fehlerZeilen(fehler).text.split('\n')).toHaveLength(8);
  });

  it('kommt auch mit einem geworfenen Text zurecht', () => {
    // `throw 'text'` ist kein Error - und kam bisher als «undefined» an.
    expect(fehlerZeilen('so nicht')).toEqual({ titel: 'so nicht', text: '' });
  });

  it('macht aus einem geworfenen Objekt lesbares JSON', () => {
    const { titel, text } = fehlerZeilen({ code: 'E_NIX', detail: 'fehlt' });
    expect(titel).toBe('Unbekannter Fehler');
    expect(text).toContain('E_NIX');
  });

  it('bleibt bei einem Error ohne Meldung beim Namen', () => {
    const fehler = new Error('');
    fehler.stack = '';
    expect(fehlerZeilen(fehler).titel).toBe('Error');
  });
});
