/** Die Kopplung des Fernsehers – die Rechnerei dazu. */
import { Entity } from '../api/types';
import { brauchtKopplung, codeSauber, codeVollstaendig } from './fernsehkopplung';

const geraet = (state: Record<string, unknown>): Entity =>
  ({
    id: 'androidtv.10_0_0_5',
    kind: 'media_player',
    name: 'Fernseher Wohnzimmer',
    integration: 'androidtv',
    state,
    commands: ['sleep_timer'],
    available: true,
  }) as Entity;

describe('brauchtKopplung', () => {
  it('fragt nur, wenn der Hub die Kopplung ausdrücklich vermisst', () => {
    expect(brauchtKopplung(geraet({ paired: false }))).toBe(true);
    expect(brauchtKopplung(geraet({ paired: true }))).toBe(false);
  });

  it('behauptet nichts, wo der Hub nichts sagt', () => {
    // Ältere Hub-Fassung oder ein ganz anderes Gerät: Eine
    // Aufforderung zum Koppeln auf einer Hue-Lampe wäre schlimmer als
    // gar keine.
    expect(brauchtKopplung(geraet({}))).toBe(false);
  });
});

describe('codeSauber', () => {
  it('nimmt Leerzeichen und Kleinbuchstaben, wie sie kommen', () => {
    // Der Fernseher zeigt «A1B2C3», getippt wird auf einem Telefon.
    expect(codeSauber(' a1b 2c3 ')).toBe('A1B2C3');
    expect(codeSauber('123456789')).toBe('123456');
    expect(codeSauber('')).toBe('');
  });
});

describe('codeVollstaendig', () => {
  it('lässt erst bei sechs Zeichen bestätigen', () => {
    expect(codeVollstaendig('12345')).toBe(false);
    expect(codeVollstaendig('1 2 3 4 5 6')).toBe(true);
  });
});
