/** Die Wetterwarnung in der Kopfzeile - und nur dort. */
import { Entity } from '../api/types';
import { warnText, warnZahl, warnZahlSatz, warnungSchonOben } from './warnzeile';

const geraet = (patch: Partial<Entity>): Entity =>
  ({
    id: 'meteoalarm.switzerland',
    kind: 'alert',
    name: 'Wetterlage',
    integration: 'meteoalarm',
    state: {},
    commands: [],
    available: true,
    ...patch,
  }) as Entity;

describe('warnungSchonOben', () => {
  it('lässt die Kachel weg, solange eine Warnung läuft', () => {
    // Sie stand zweimal auf derselben Seite: oben in der
    // Begrüssungskarte und noch einmal als Kachel «Wetterlage».
    expect(warnungSchonOben(geraet({ state: { state: 'alert', count: 1 } }))).toBe(true);
  });

  it('lässt sie stehen, wenn nichts läuft', () => {
    // «Keine Warnungen» ist eine Auskunft, die man gerade vor einem
    // Gewitterabend sucht - und sie steht sonst nirgends.
    expect(warnungSchonOben(geraet({ state: { state: 'ok', count: 0 } }))).toBe(false);
  });

  it('fasst nichts an, was kein Warngerät ist', () => {
    expect(warnungSchonOben(geraet({ kind: 'light', state: { count: 3 } }))).toBe(false);
  });
});

describe('warnZahl', () => {
  it('nimmt nur echte Zahlen über null', () => {
    expect(warnZahl({ count: 2 })).toBe(2);
    expect(warnZahl({ count: 0 })).toBe(0);
    expect(warnZahl({ count: 'kaputt' })).toBe(0);
    expect(warnZahl(undefined)).toBe(0);
  });
});

describe('warnZahlSatz', () => {
  it('schreibt die Eins ohne s', () => {
    // Auf der Kachel stand «1 Warnungen».
    expect(warnZahlSatz(1)).toBe('1 Warnung');
    expect(warnZahlSatz(3)).toBe('3 Warnungen');
  });
});

describe('warnText', () => {
  it('nimmt die Schlagzeile des Hubs', () => {
    expect(
      warnText({ headline: 'Verbreitet heftige Gewitter möglich, schwer, bis 22:00' })
    ).toBe('Verbreitet heftige Gewitter möglich, schwer, bis 22:00');
  });

  it('fällt auf das Ereignis und zuletzt auf die Zahl zurück', () => {
    expect(warnText({ event: 'Sturmwind' })).toBe('Sturmwind');
    // Ganz ohne Text: Dass etwas los ist, gehört trotzdem gesagt.
    expect(warnText({ count: 2 })).toBe('2 Warnungen');
    expect(warnText({})).toBe('1 Warnung');
  });
});
