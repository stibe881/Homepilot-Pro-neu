import { fusszeile } from './fernbedienungsstand';

describe('fusszeile', () => {
  it('nennt Stand, Herkunft und dass noch nichts berührt wurde', () => {
    expect(fusszeile('1.3.6', true, 0)).toBe(
      'App 1.3.6 · nachgeladen · noch keine Berührung'
    );
  });

  it('unterscheidet mitgeliefert von nachgeladen', () => {
    expect(fusszeile('1.3.6', false, 0)).toBe(
      'App 1.3.6 · mitgeliefert · noch keine Berührung'
    );
  });

  it('laesst die Herkunft im Browser weg, statt zu raten', () => {
    expect(fusszeile('1.3.6', null, 2)).toBe('App 1.3.6 · 2 Berührungen');
  });

  it('zaehlt die Einzahl richtig', () => {
    expect(fusszeile('1.3.6', true, 1)).toBe('App 1.3.6 · nachgeladen · 1 Berührung');
  });

  it('sagt lieber Fragezeichen als gar nichts, wenn die Version fehlt', () => {
    expect(fusszeile(null, true, 3)).toBe('App ? · nachgeladen · 3 Berührungen');
  });
});
