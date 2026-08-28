import { aufnahmeFehler, bestesFormat, dauerText } from './sprachnotiz';

describe('bestesFormat', () => {
  it('nimmt Opus, wenn der Browser es kann', () => {
    expect(bestesFormat((typ) => typ === 'audio/webm;codecs=opus')).toBe(
      'audio/webm;codecs=opus'
    );
  });

  it('weicht auf mp4 aus, wenn es kein WebM gibt', () => {
    // Safari nimmt mp4 auf, nicht WebM.
    expect(bestesFormat((typ) => typ === 'audio/mp4')).toBe('audio/mp4');
  });

  it('liefert nichts, wenn der Browser keines kennt', () => {
    expect(bestesFormat(() => false)).toBeUndefined();
  });

  it('lässt sich von einer werfenden Prüfung nicht aufhalten', () => {
    expect(
      bestesFormat((typ) => {
        if (typ.includes('webm')) throw new Error('kaputt');
        return typ === 'audio/mp4';
      })
    ).toBe('audio/mp4');
  });
});

describe('dauerText', () => {
  it('zählt Sekunden', () => {
    expect(dauerText(7400)).toBe('0:07');
  });

  it('füllt die Sekunden auf zwei Stellen', () => {
    expect(dauerText(65_000)).toBe('1:05');
  });

  it('zeigt bei negativen Werten null', () => {
    expect(dauerText(-500)).toBe('0:00');
  });
});

describe('aufnahmeFehler', () => {
  it('nennt die fehlende Freigabe beim Namen', () => {
    expect(aufnahmeFehler({ name: 'NotAllowedError' })).toContain('nicht freigegeben');
  });

  it('unterscheidet ein fehlendes von einem belegten Mikrofon', () => {
    expect(aufnahmeFehler({ name: 'NotFoundError' })).toBe('Kein Mikrofon gefunden.');
    expect(aufnahmeFehler({ name: 'NotReadableError' })).toContain('belegt');
  });

  it('hat auch für Unbekanntes einen Satz', () => {
    expect(aufnahmeFehler(new Error('was auch immer'))).toBe('Die Aufnahme ging nicht los.');
  });
});
