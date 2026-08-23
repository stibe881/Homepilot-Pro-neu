/** Wo kommt ein Gerät überall vor – Abläufe und Szenen. */
import { Scene } from '../api/types';
import { verweisText, verweiseAuf } from './verweise';

const automations = [
  {
    id: 'a1',
    alias: 'Flurlicht',
    triggers: [{ type: 'state', entity_id: 'hm.bewegung', to: 'on' }],
    actions: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_on' }],
  },
  {
    id: 'a2',
    alias: 'Sonst-Zweig',
    triggers: [{ type: 'time', at: '18:00' }],
    otherwise: [{ type: 'command', entity_id: 'hue.flur', command: 'turn_off' }],
  },
];
const scenes = [{ id: 's1', name: 'Kino', entity_ids: ['hue.flur'] }] as Scene[];

const taster = [
  {
    id: 'a3',
    alias: 'Wandtaster Eingang',
    triggers: [{ type: 'state', entity_id: 'hm.taster', to: 'short' }],
    actions: [{ type: 'toggle_all', entity_ids: ['hue.eingang', 'hue.gang'] }],
  },
];

describe('verweiseAuf', () => {
  it('findet das Gerät in Auslösern, Aktionen und dem Sonst-Zweig', () => {
    const { ablaeufe, szenen } = verweiseAuf('hue.flur', automations, scenes);
    expect(ablaeufe.map((a) => a.id)).toEqual(['a1', 'a2']);
    expect(szenen.map((s) => s.id)).toEqual(['s1']);
  });

  it('verwechselt Auslöser nicht mit Aktionen', () => {
    const { ablaeufe, szenen } = verweiseAuf('hm.bewegung', automations, scenes);
    expect(ablaeufe.map((a) => a.id)).toEqual(['a1']);
    expect(szenen).toEqual([]);
  });
});

describe('verweisText', () => {
  it('beugt richtig', () => {
    expect(verweisText(1, 0)).toBe('in 1 Ablauf');
    expect(verweisText(2, 1)).toBe('in 2 Abläufen und 1 Szene');
    expect(verweisText(0, 2)).toBe('in 2 Szenen');
    expect(verweisText(0, 0)).toBe('');
  });
});

describe('Geräte in einer Liste', () => {
  it('findet die Lampe auch in «gemeinsam umschalten»', () => {
    // Sonst fehlte sie in «in 2 Abläufen», und man sucht den Urheber
    // wieder von Hand.
    const { ablaeufe } = verweiseAuf('hue.gang', taster, []);
    expect(ablaeufe.map((a) => a.id)).toEqual(['a3']);
  });

  it('nimmt keine fremde Lampe mit', () => {
    expect(verweiseAuf('hue.kueche', taster, []).ablaeufe).toEqual([]);
  });
});
