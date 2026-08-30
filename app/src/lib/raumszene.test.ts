/**
 * «So wie jetzt» aus einem Zimmer heraus.
 *
 * Geprüft wird hier vor allem das, was der Schnappschuss NICHT
 * einsammeln darf: Die Szene «Abend», die still «unscharf» mitnimmt,
 * entschärft abends die Alarmanlage.
 */
import { Entity } from '../api/types';
import {
  aufnahmeAktionen,
  aufnahmeSatz,
  aufnehmbar,
  namensvorschlag,
} from './raumszene';

const geraet = (teile: Partial<Entity> & { id: string }): Entity =>
  ({
    kind: 'light',
    name: teile.id,
    integration: 'demo',
    state: { state: 'off' },
    commands: ['turn_on', 'turn_off'],
    available: true,
    ...teile,
  }) as Entity;

const LAMPE = geraet({
  id: 'hue.stehlampe',
  name: 'Stehlampe',
  state: { state: 'on', brightness: 30, color: '#FF8800' },
  commands: ['turn_on', 'turn_off', 'set_brightness', 'set_color'],
});

const STORE = geraet({
  id: 'hm.store',
  name: 'Store',
  kind: 'cover',
  state: { state: 'open', position: 40 },
  commands: ['open', 'close', 'stop'],
});

describe('aufnehmbar', () => {
  it('lässt Alarmanlage, Kamera und Lichtszene weg', () => {
    const liste = aufnehmbar([
      LAMPE,
      geraet({ id: 'alarm.haus', kind: 'alarm', commands: ['disarm'] }),
      geraet({ id: 'ring.tuere', kind: 'camera', commands: ['set_privacy'] }),
      geraet({ id: 'hue.szene', kind: 'scene', commands: ['activate'] }),
    ]);
    expect(liste.map((entity) => entity.id)).toEqual(['hue.stehlampe']);
  });

  it('lässt Fühler weg, die man gar nicht stellen kann', () => {
    // Ein Temperaturfühler hat einen Zustand, aber keinen, den man
    // herstellen kann - die Zeile täte beim Auslösen nichts.
    const liste = aufnehmbar([
      LAMPE,
      geraet({ id: 'hm.temperatur', kind: 'sensor', commands: [] }),
    ]);
    expect(liste.map((entity) => entity.id)).toEqual(['hue.stehlampe']);
  });
});

describe('aufnahmeAktionen', () => {
  it('hält die Helligkeit fest, nicht bloss «an»', () => {
    // Der Fehler, den es hier schon einmal gab: Der Schnappschuss
    // sammelte turn_on ein, und die gedimmte Stimmung wurde beim
    // Auslösen zur vollen Deckenbeleuchtung.
    expect(aufnahmeAktionen([LAMPE])).toEqual([
      {
        entity_id: 'hue.stehlampe',
        command: 'set_brightness',
        data: { brightness: 30 },
      },
      {
        entity_id: 'hue.stehlampe',
        command: 'set_color',
        data: { color: '#FF8800' },
      },
    ]);
  });

  it('macht aus einer offenen Store ein «hoch»', () => {
    expect(aufnahmeAktionen([STORE])).toEqual([
      { entity_id: 'hm.store', command: 'open' },
    ]);
  });

  it('nimmt ausgeschaltete Geräte als «aus» mit', () => {
    // Sonst wäre eine Szene «Abend» eine, die das Deckenlicht anlässt,
    // wenn es beim Aufnehmen zufällig aus war.
    expect(aufnahmeAktionen([geraet({ id: 'mqtt.decke' })])).toEqual([
      { entity_id: 'mqtt.decke', command: 'turn_off' },
    ]);
  });
});

describe('aufnahmeSatz', () => {
  it('nennt bis zu drei Geräte beim Namen', () => {
    expect(aufnahmeSatz([LAMPE, STORE])).toBe('Stehlampe, Store');
  });

  it('zählt ab dem vierten', () => {
    const viele = ['a', 'b', 'c', 'd', 'e'].map((id) => geraet({ id, name: id }));
    expect(aufnahmeSatz(viele)).toBe('a, b, c und 2 weitere');
  });

  it('sagt es, wenn es nichts aufzunehmen gibt', () => {
    expect(aufnahmeSatz([])).toBe('Hier gibt es nichts aufzunehmen.');
  });
});

describe('namensvorschlag', () => {
  it('nimmt Raum und Tageszeit', () => {
    expect(namensvorschlag('Wohnzimmer', new Date(2026, 7, 30, 20, 15))).toBe(
      'Wohnzimmer abends'
    );
    expect(namensvorschlag('Küche', new Date(2026, 7, 30, 7, 0))).toBe(
      'Küche morgens'
    );
  });
});
