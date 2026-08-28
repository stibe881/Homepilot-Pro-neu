import { trockenSatz } from './giessen';

describe('trockenSatz', () => {
  it('nennt die Zahl der trockenen Tage', () => {
    expect(trockenSatz(5, 0)).toBe('Seit 5 Tagen kein Regen');
  });

  it('schweigt nach zwei trockenen Tagen', () => {
    // Zwei Tage sind Sommer, keine Nachricht.
    expect(trockenSatz(2, 0)).toBeNull();
  });

  it('schweigt, wenn Regen kommt', () => {
    expect(trockenSatz(6, 8)).toBeNull();
  });

  it('spricht bei ein paar Tropfen trotzdem', () => {
    expect(trockenSatz(6, 0.4)).toBe('Seit 6 Tagen kein Regen');
  });

  it('kommt mit fehlenden Werten zurecht', () => {
    expect(trockenSatz(undefined, undefined)).toBeNull();
    expect(trockenSatz(4, undefined)).toBe('Seit 4 Tagen kein Regen');
  });
});
