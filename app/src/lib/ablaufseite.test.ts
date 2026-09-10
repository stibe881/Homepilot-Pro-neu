/**
 * Ein Ablauf auf Papier (Punkt 367) - Wenn/Nur wenn/Dann/Sonst als Liste.
 */
import { Entity, Scene } from '../api/types';
import { ablaufAlsSeite } from './ablaufseite';

const entities = [
  { id: 'hm.bewegung', name: 'Bewegung Flur' },
  { id: 'hue.flur', name: 'Licht Flur' },
  { id: 'hm.fenster', name: 'Fenster Küche' },
] as Entity[];
const scenes = [{ id: 'kino', name: 'Kino' }] as Scene[];

const NACH_HAUSE = {
  alias: 'Nach Hause',
  triggers: [{ type: 'state', entity_id: 'hm.bewegung', to: 'on' }],
  conditions: [{ type: 'sun', state: 'down' }],
  actions: [
    { type: 'command', entity_id: 'hue.flur', command: 'turn_on' },
    { type: 'delay', seconds: 240 },
    { type: 'command', entity_id: 'hue.flur', command: 'turn_off' },
  ],
  otherwise: [{ type: 'scene', scene: 'kino' }],
  match: 'all',
};

describe('ablaufAlsSeite', () => {
  it('bringt Titel, Auslöser, Bedingung, Aktionen und den Sonst-Zweig aufs Blatt', () => {
    const seite = ablaufAlsSeite(NACH_HAUSE, entities, scenes);
    expect(seite).toContain('<h1>Nach Hause</h1>');
    expect(seite).toContain('<h2>Wenn</h2>');
    expect(seite).toContain('Bewegung Flur → on');
    expect(seite).toContain('<h2>Nur wenn</h2>');
    expect(seite).toContain('dunkel');
    expect(seite).toContain('<h2>Dann</h2>');
    expect(seite).toContain('Licht Flur ein');
    expect(seite).toContain('4 Min warten');
    expect(seite).toContain('<h2>Sonst</h2>');
    expect(seite).toContain('Kino');
  });

  it('lässt leere Abschnitte weg, statt eine leere Überschrift zu zeigen', () => {
    const seite = ablaufAlsSeite(
      { alias: 'Nur Zeit', triggers: [{ type: 'time', at: '07:00' }], actions: [], conditions: [] },
      entities,
      scenes
    );
    expect(seite).not.toContain('<h2>Nur wenn</h2>');
    expect(seite).not.toContain('<h2>Sonst</h2>');
  });

  it('sagt, wenn der Ablauf ausgeschaltet ist', () => {
    const seite = ablaufAlsSeite({ ...NACH_HAUSE, enabled: false }, entities, scenes);
    expect(seite).toContain('ausgeschaltet');
  });

  it('sagt, wenn noch etwas fehlt, statt eine leere Seite zu zeigen', () => {
    const seite = ablaufAlsSeite({ alias: 'Entwurf', triggers: [], actions: [] }, entities, scenes);
    expect(seite).toContain('unvollständig');
  });

  it('was jemand getippt hat, bleibt Text und wird kein Markup', () => {
    const seite = ablaufAlsSeite(
      { alias: '<script>x</script>', triggers: [], actions: [] },
      entities,
      scenes
    );
    expect(seite).not.toContain('<script>x');
  });
});
