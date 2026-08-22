/** Was ein Raum über sich sagt, und welche Kacheln zuerst kommen. */
import { Entity } from '../api/types';
import {
  raeumeSortiert,
  raumKategorien,
  raumMesswerte,
  raumSymbol,
  raumZeile,
  wichtigeZuerst,
} from './raum';

const geraet = (patch: Partial<Entity>): Entity =>
  ({
    id: Math.random().toString(36).slice(2),
    kind: 'light',
    name: 'X',
    integration: 'demo',
    state: {},
    commands: [],
    available: true,
    ...patch,
  }) as Entity;

describe('raumZeile', () => {
  it('nennt Temperatur, offenes Fenster und laufende Musik', () => {
    const zeile = raumZeile([
      geraet({
        kind: 'sensor',
        name: 'Temperatur Bad',
        state: { state: 21.53, unit: '°C', humidity: 45 },
      }),
      geraet({
        kind: 'binary_sensor',
        name: 'Fenster Bad',
        state: { state: 'on', device_class: 'contact' },
      }),
      geraet({ kind: 'media_player', name: 'Box', state: { state: 'playing' } }),
    ]);
    expect(zeile).toBe('21,5° · 45 % · Fenster Bad offen · Musik läuft');
  });

  it('schweigt in einem Raum ohne Fühler und ohne Offenes', () => {
    expect(raumZeile([geraet({ state: { state: 'off' } })])).toBe('');
  });
});

describe('wichtigeZuerst', () => {
  it('Favoriten vor Laufendem vor Bedienbarem vor Messwerten', () => {
    const liste = [
      geraet({ id: 'fuehler', kind: 'sensor', state: { state: 21 } }),
      geraet({ id: 'aus', commands: ['toggle'], state: { state: 'off' } }),
      geraet({ id: 'an', commands: ['toggle'], state: { state: 'on' } }),
      geraet({ id: 'stern', commands: ['toggle'], state: { state: 'off' } }),
    ];
    expect(wichtigeZuerst(liste, ['stern']).map((e) => e.id)).toEqual([
      'stern',
      'an',
      'aus',
      'fuehler',
    ]);
  });
});

describe('raumSymbol', () => {
  it('rät aus dem Namen', () => {
    expect(raumSymbol('Küche')).toBe('restaurant-outline');
    expect(raumSymbol('Schlafzimmer')).toBe('bed-outline');
    expect(raumSymbol('Hobbyraum')).toBe('cube-outline');
  });
});

describe('raeumeSortiert', () => {
  it('folgt der gespeicherten Reihenfolge, Unbekanntes hinten', () => {
    expect(raeumeSortiert(['Bad', 'Küche', 'Flur'], ['Flur', 'Bad'])).toEqual([
      'Flur',
      'Bad',
      'Küche',
    ]);
    expect(raeumeSortiert(['Bad', 'Küche'], undefined)).toEqual(['Bad', 'Küche']);
  });
});

describe('raumKategorien', () => {
  it('gibt jeder Geräteart ihre Überschrift statt eines Topfs «Weitere»', () => {
    const art = (entity: Entity) =>
      entity.kind === 'climate' ? 'Heizung' : entity.kind === 'lock' ? 'Schloss' : 'Licht';
    const kategorien = raumKategorien(
      [
        geraet({ id: 'l1', kind: 'light' }),
        geraet({ id: 'h1', kind: 'climate' }),
        geraet({ id: 's1', kind: 'lock' }),
        geraet({ id: 'f1', kind: 'sensor' }),
      ],
      art
    );
    expect(kategorien.map((k) => k.label)).toEqual(['Beleuchtung', 'Heizung', 'Schloss']);
    // Der Fühler steht im Raumkopf, nicht als Kachel.
    expect(kategorien.flatMap((k) => k.items.map((e) => e.id))).not.toContain('f1');
  });
});

describe('raumMesswerte', () => {
  it('sammelt die Fühler alphabetisch', () => {
    const werte = raumMesswerte([
      geraet({ kind: 'sensor', name: 'Zwei' }),
      geraet({ kind: 'sensor', name: 'Eins' }),
      geraet({ kind: 'light', name: 'Lampe' }),
    ]);
    expect(werte.map((e) => e.name)).toEqual(['Eins', 'Zwei']);
  });
});
