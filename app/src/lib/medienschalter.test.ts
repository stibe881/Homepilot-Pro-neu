import { medienSchalter } from './medienschalter';

const CAST = ['play', 'pause', 'toggle', 'turn_off', 'set_volume'];

describe('medienSchalter', () => {
  it('schaltet eine spielende Box aus', () => {
    expect(medienSchalter('playing', CAST)).toEqual({
      an: true,
      command: 'turn_off',
      label: 'Ausschalten',
    });
  });

  it('behandelt Puffern wie Spielen', () => {
    expect(medienSchalter('buffering', CAST)?.an).toBe(true);
  });

  it('nimmt Pause, wo die Integration kein echtes Aus kennt', () => {
    // Eine halbe Antwort, aber die richtige Richtung.
    expect(medienSchalter('playing', ['play', 'pause'])?.command).toBe('pause');
  });

  it('spielt aus der Pause heraus weiter', () => {
    expect(medienSchalter('paused', CAST)).toEqual({
      an: false,
      command: 'play',
      label: 'Weiterspielen',
    });
  });

  it('zeigt auf einer leeren Box keinen Knopf', () => {
    // Dort gibt es nichts zu starten - ein Knopf, der auf eine
    // Fehlermeldung führt, ist schlimmer als keiner.
    expect(medienSchalter('idle', CAST)).toBeNull();
    expect(medienSchalter(undefined, CAST)).toBeNull();
  });

  it('zeigt keinen Knopf, wenn die Box gar nichts davon kann', () => {
    expect(medienSchalter('playing', ['set_volume'])).toBeNull();
  });
});
