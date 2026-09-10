import type { Entity, EntityState } from '../api/types';
import { bewegungImRaum, istBewegungsmelder, meldetBewegung } from './bewegung';

function geraet(
  kind: string,
  name: string,
  state: EntityState,
  extra: Partial<Entity> = {}
): Entity {
  return {
    id: `${kind}.${name}`,
    kind,
    name,
    integration: 'demo',
    state,
    commands: [],
    available: true,
    ...extra,
  };
}

const melder = (state: EntityState) =>
  geraet('binary_sensor', 'Präsenzmelder Terrasse', {
    device_class: 'motion',
    ...state,
  });

describe('istBewegungsmelder', () => {
  it('erkennt ihn an der Geräteklasse', () => {
    for (const klasse of ['motion', 'occupancy', 'presence']) {
      expect(istBewegungsmelder(melder({ device_class: klasse }))).toBe(true);
    }
  });

  it('hält den Fensterkontakt heraus', () => {
    expect(istBewegungsmelder(melder({ device_class: 'window' }))).toBe(false);
  });

  it('nimmt ohne Geräteklasse den Namen', () => {
    // Nicht jede Integration schickt eine - und ein Melder ohne Klasse
    // stünde sonst wieder als Kachel im Zimmer.
    expect(
      istBewegungsmelder(geraet('binary_sensor', 'Bewegung Flur', { state: 'off' }))
    ).toBe(true);
    expect(
      istBewegungsmelder(geraet('binary_sensor', 'Waschküche', { state: 'off' }))
    ).toBe(false);
  });
});

describe('meldetBewegung', () => {
  it('meldet den Melder, solange er «on» sagt', () => {
    expect(meldetBewegung(melder({ state: 'on' }))).toBe(true);
    expect(meldetBewegung(melder({ state: 'off' }))).toBe(false);
  });

  it('nimmt eine Kamera mit Bewegung genauso', () => {
    // Sie sieht dieselbe Person wie ein Melder, nur hat sie niemand
    // aufgehängt.
    expect(meldetBewegung(geraet('camera', 'Terrasse', { motion: 'on' }))).toBe(true);
    expect(
      meldetBewegung(geraet('camera', 'Terrasse', { detected_person: 'on' }))
    ).toBe(true);
    expect(meldetBewegung(geraet('camera', 'Terrasse', { motion: 'off' }))).toBe(false);
  });

  it('lässt das Klingeln aussen vor', () => {
    // Es ist keine Bewegung, sondern ein Ereignis mit eigenem Vollbild.
    expect(meldetBewegung(geraet('camera', 'Haustüre', { ring: 'on' }))).toBe(false);
  });

  it('glaubt einem Gerät nicht, das gar nicht antwortet', () => {
    expect(
      meldetBewegung(
        geraet('binary_sensor', 'Melder', { device_class: 'motion', state: 'on' }, {
          available: false,
        })
      )
    ).toBe(false);
  });
});

describe('bewegungImRaum', () => {
  it('reicht ein einziges Gerät, das etwas sieht', () => {
    const raum = [
      geraet('light', 'Licht', { state: 'off' }),
      melder({ state: 'off' }),
      geraet('camera', 'Terrasse', { motion: 'on' }),
    ];
    expect(bewegungImRaum(raum)).toBe(true);
  });

  it('zählt ausgeblendete Geräte nicht mit', () => {
    // Wer einen Melder ausblendet, will von ihm nichts mehr hören -
    // auch nicht als Zeichen im Raumkopf.
    const melder = geraet('binary_sensor', 'Melder', {
      device_class: 'motion',
      state: 'on',
    });
    expect(bewegungImRaum([melder])).toBe(true);
    expect(bewegungImRaum([melder], [melder.id])).toBe(false);
  });

  it('bleibt still, wo nichts los ist', () => {
    expect(bewegungImRaum([geraet('light', 'Licht', { state: 'on' }), melder({ state: 'off' })])).toBe(
      false
    );
  });
});
