import { Entity } from '../api/types';
import {
  WEISSKNOEPFE,
  aktiverWeisston,
  kannFarbe,
  kannWeiss,
  zeigtFarbe,
} from './lichtwahl';

function lampe(commands: string[], state: Record<string, unknown> = {}): Entity {
  return {
    id: 'hue.buero',
    kind: 'light',
    name: 'Büro',
    integration: 'hue',
    state: { state: 'on', ...state },
    commands,
    available: true,
  } as unknown as Entity;
}

describe('was die Lampe kann', () => {
  it('bietet nur an, was das Gerät auch kann', () => {
    // Der gemeldete Satz: «Es soll aber auch nur da gehen, wo die Lampen
    // dies unterstützen.»
    const einfach = lampe(['turn_on', 'turn_off']);
    expect(kannFarbe(einfach)).toBe(false);
    expect(kannWeiss(einfach)).toBe(false);

    const hue = lampe(['turn_on', 'set_brightness', 'set_color_temp']);
    expect(kannWeiss(hue)).toBe(true);
    expect(kannFarbe(hue)).toBe(false);

    const bunt = lampe(['turn_on', 'set_color', 'set_color_temp']);
    expect(kannFarbe(bunt)).toBe(true);
    expect(kannWeiss(bunt)).toBe(true);
  });
});

describe('aktiverWeisston', () => {
  const kann = ['set_color_temp'];

  it('nimmt den nächstgelegenen der drei', () => {
    // Eine Lampe meldet 366 zurück, wo 370 geschickt wurde. Ohne
    // Nachsicht wäre nie ein Punkt markiert.
    expect(aktiverWeisston(lampe(kann, { color_temp: 366 }))).toBe(370);
    expect(aktiverWeisston(lampe(kann, { color_temp: 290 }))).toBe(286);
    expect(aktiverWeisston(lampe(kann, { color_temp: 205 }))).toBe(200);
  });

  it('markiert nichts, was zu weit von jeder Stufe weg ist', () => {
    // Eine Szene aus der Bridge bringt Werte mit, die auf keiner
    // unserer Stufen liegen - dann lieber kein Punkt als ein falscher.
    expect(aktiverWeisston(lampe(kann, { color_temp: 500 }))).toBeNull();
  });

  it('schweigt, solange die Lampe bunt leuchtet', () => {
    // Der zuletzt gesetzte Weisston bleibt im Zustand stehen, auch
    // während die Lampe rot leuchtet - nur die Bridge weiss, welcher
    // der beiden Werte gerade gilt.
    expect(
      aktiverWeisston(lampe(kann, { color_temp: 370, color_mode: 'farbe' }))
    ).toBeNull();
  });

  it('schweigt ohne gemeldeten Weisston und ohne Können', () => {
    expect(aktiverWeisston(lampe(kann))).toBeNull();
    expect(aktiverWeisston(lampe(kann, { color_temp: 0 }))).toBeNull();
    expect(aktiverWeisston(lampe(['turn_on'], { color_temp: 370 }))).toBeNull();
  });
});

describe('zeigtFarbe', () => {
  it('markiert die Farbe nur, wenn die Lampe bunt leuchtet', () => {
    const bunt = ['set_color', 'set_color_temp'];
    expect(zeigtFarbe(lampe(bunt, { color: '#ff0000' }))).toBe(true);
    expect(zeigtFarbe(lampe(bunt, { color: '#ff0000', color_mode: 'weiss' }))).toBe(
      false
    );
  });

  it('kommt ohne Modus aus', () => {
    // Nicht jede Anbindung meldet ihn - was eine Farbe im Zustand hat,
    // zeigt sie dann auch.
    expect(zeigtFarbe(lampe(['set_color'], { color: '#2e7cff' }))).toBe(true);
    expect(zeigtFarbe(lampe(['set_color'], {}))).toBe(false);
  });
});

describe('WEISSKNOEPFE', () => {
  it('trägt zu jedem Ton eine Farbe zum Zeichnen', () => {
    expect(WEISSKNOEPFE).toHaveLength(3);
    for (const ton of WEISSKNOEPFE) {
      expect(ton.hex).toMatch(/^#[0-9A-F]{6}$/i);
      expect(ton.label).toBeTruthy();
    }
    // Warm zuerst: Es ist die häufigste Antwort.
    expect(WEISSKNOEPFE[0].label).toBe('warmweiss');
  });
});
