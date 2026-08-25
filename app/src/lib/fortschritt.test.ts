import { darfSpringen, fortschritt, mmss, sprungziel } from './fortschritt';

describe('mmss', () => {
  it('schreibt Minuten und Sekunden', () => {
    expect(mmss(0)).toBe('0:00');
    expect(mmss(83)).toBe('1:23');
    expect(mmss(3723)).toBe('1:02:03');
  });

  it('macht aus Unsinn keine negative Zeit', () => {
    expect(mmss(-5)).toBe('0:00');
  });
});

describe('fortschritt', () => {
  it('rechnet Anteil und Restzeit', () => {
    const f = fortschritt({ state: 'paused', position: 60, duration: 240 });
    expect(f).not.toBeNull();
    expect(f!.anteil).toBe(25);
    expect(f!.gelaufen).toBe('1:00');
    expect(f!.rest).toBe('-3:00');
  });

  it('läuft weiter, während gespielt wird', () => {
    // Der Hub meldet sich nur bei Änderungen - ohne Hochrechnen stünde
    // der Balken zwischen zwei Meldungen still.
    const f = fortschritt(
      { state: 'playing', position: 60, duration: 240, position_at: 1000 },
      1010,
    );
    expect(f!.position).toBe(70);
  });

  it('rechnet bei Pause nicht hoch', () => {
    const f = fortschritt(
      { state: 'paused', position: 60, duration: 240, position_at: 1000 },
      1010,
    );
    expect(f!.position).toBe(60);
  });

  it('läuft nicht über das Ende hinaus', () => {
    const f = fortschritt(
      { state: 'playing', position: 230, duration: 240, position_at: 1000 },
      1100,
    );
    expect(f!.position).toBe(240);
    expect(f!.rest).toBe('-0:00');
  });

  it('zeigt keinen Balken, wo es kein Ende gibt', () => {
    // Radio hat keine Länge - ein Balken ohne Länge zeigt nichts an.
    expect(fortschritt({ state: 'playing', position: 12 })).toBeNull();
    expect(fortschritt({ state: 'playing', duration: 0, position: 0 })).toBeNull();
    expect(fortschritt(undefined)).toBeNull();
  });
});

describe('sprungziel', () => {
  it('rechnet den Anteil in Sekunden', () => {
    expect(sprungziel(50, 240)).toBe(120);
    expect(sprungziel(0, 240)).toBe(0);
  });

  it('springt nicht genau ans Ende', () => {
    // Genau ans Ende heisst beim Empfänger «Titel vorbei».
    expect(sprungziel(100, 240)).toBe(239);
  });
});

describe('darfSpringen', () => {
  const laeuft = { state: 'playing', position: 10, duration: 100 };

  it('braucht den Befehl und eine Länge', () => {
    expect(darfSpringen(laeuft, ['seek'])).toBe(true);
    expect(darfSpringen(laeuft, ['play'])).toBe(false);
    expect(darfSpringen({ state: 'playing' }, ['seek'])).toBe(false);
  });

  it('glaubt dem Gerät, wenn es Nein sagt', () => {
    expect(darfSpringen({ ...laeuft, can_seek: false }, ['seek'])).toBe(false);
  });
});
