import fs from 'fs';
import path from 'path';

import type { Entity, EntityState } from '../api/types';
import {
  darkColors,
  lightColors,
  mitternachtColors,
  pinkColors,
  sandColors,
} from '../theme';
import { bewegungImRaum, bewegungsSignal, istBewegungsmelder, meldetBewegung } from './bewegung';

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

  it('glaubt einer Kamera nicht, deren letzte Bewegung Stunden zurückliegt', () => {
    // Punkt 578: «Diese Bewegung war aber vor fast einer Stunde.» Ein
    // hängen gebliebenes «on» ist keine Person.
    const jetzt = Date.parse('2026-09-12T20:00:00Z');
    const alt = geraet('camera', 'Linas Zimmer', {
      detected_person: 'on',
      last_motion: '2026-09-12T19:05:00Z',
    });
    expect(meldetBewegung(alt, jetzt)).toBe(false);
    const frisch = geraet('camera', 'Linas Zimmer', {
      motion: 'on',
      last_motion: '2026-09-12T19:59:00Z',
    });
    expect(meldetBewegung(frisch, jetzt)).toBe(true);
    // Ohne Zeitangabe wie bisher - lieber ein Zeichen zu viel als eines,
    // das man nie sieht.
    expect(meldetBewegung(geraet('camera', 'Terrasse', { motion: 'on' }), jetzt)).toBe(true);
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

describe('bewegungsSignal', () => {
  // Punkt 612: «Bewegung» trug vier Farben - rot auf der Kamerawand,
  // orange auf der Kamerakachel, grün auf der Raumkachel, weiss im
  // Raumkopf. Jetzt gilt überall die Regel der Raumkachel.
  it.each([
    ['hell', lightColors],
    ['dunkel', darkColors],
    ['pink', pinkColors],
    ['mitternacht', mitternachtColors],
    ['sand', sandColors],
  ])('nimmt in der Palette %s die Farbe von «an», nie Rot', (_name, colors) => {
    const signal = bewegungsSignal(colors);
    expect(signal.farbe).toBe(colors.on);
    expect(signal.grund).toBe(colors.onSoft);
    expect(signal.farbe).not.toBe(colors.danger);
  });

  it('wird von jeder Stelle geholt, die das Männchen zeichnet', () => {
    // Ein Quellen-Test wie symbole.test.ts: Die fünfte Farbe kommt
    // nicht dadurch, dass jemand die Regel bricht, sondern dadurch,
    // dass er sie nicht kennt. Wer `walk` als Zeichen für Bewegung
    // setzt, holt Farbe und Grund aus bewegungsSignal - und schreibt
    // keinen festen Farbwert daneben.
    const quelle = path.join(__dirname, '..');
    const dateien = (ordner: string): string[] =>
      fs.readdirSync(ordner, { withFileTypes: true }).flatMap((eintrag) => {
        const voll = path.join(ordner, eintrag.name);
        if (eintrag.isDirectory()) return dateien(voll);
        return /\.tsx$/.test(eintrag.name) && !eintrag.name.includes('.test.') ? [voll] : [];
      });
    const verstoesse: string[] = [];
    for (const datei of dateien(quelle)) {
      const text = fs.readFileSync(datei, 'utf8');
      const maennchen = text.match(/<Ionicons[^>]*name="walk"[^>]*>/g) ?? [];
      if (maennchen.length === 0) continue;
      const rel = path.relative(quelle, datei);
      if (!text.includes('bewegungsSignal(')) {
        verstoesse.push(`${rel}: holt die Farbe nicht aus bewegungsSignal`);
      }
      for (const tag of maennchen) {
        if (/color=["{]'?#/.test(tag)) verstoesse.push(`${rel}: fester Farbwert am Männchen`);
      }
    }
    expect(verstoesse).toEqual([]);
  });
});
