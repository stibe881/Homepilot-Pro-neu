import { Scene } from '../api/types';
import { aktionenText, laeuft, tippAktion, tippLabel, unterzeile } from './szenenzeile';

const szene = (patch: Partial<Scene> = {}): Scene => ({
  id: 'kino',
  name: 'Kino',
  icon: 'film',
  entity_ids: [],
  ...patch,
});

describe('aktionenText', () => {
  it('bildet die Mehrzahl statt «Aktion(en)»', () => {
    expect(aktionenText(szene({ entity_ids: ['a', 'b', 'c'] }))).toBe('3 Aktionen');
  });

  it('sagt im Einzelfall «1 Aktion»', () => {
    expect(aktionenText(szene({ entity_ids: ['a'] }))).toBe('1 Aktion');
  });

  it('zählt die Aktionen, wo es welche gibt – nicht die Geräte', () => {
    const scene = szene({
      entity_ids: ['a'],
      actions: [
        { entity_id: 'a', command: 'turn_on' },
        { entity_id: 'a', command: 'dim' },
      ],
    });
    expect(aktionenText(scene)).toBe('2 Aktionen');
  });

  it('verträgt eine Szene ganz ohne Aktionen', () => {
    expect(aktionenText(szene())).toBe('0 Aktionen');
  });
});

describe('unterzeile', () => {
  it('nennt den Raum zuerst', () => {
    expect(unterzeile(szene({ room: 'Wohnzimmer', entity_ids: ['a', 'b'] }))).toBe(
      'Wohnzimmer · 2 Aktionen'
    );
  });

  it('lässt den Raum weg, wo keiner steht', () => {
    expect(unterzeile(szene({ entity_ids: ['a'] }))).toBe('1 Aktion');
  });

  it('behandelt einen leeren Raum wie keinen', () => {
    expect(unterzeile(szene({ room: '  ', entity_ids: ['a'] }))).toBe('1 Aktion');
  });
});

describe('tippAktion', () => {
  it('startet eine Szene, die nicht läuft', () => {
    expect(tippAktion(szene())).toBe('starten');
  });

  it('nimmt eine laufende zurück', () => {
    expect(tippAktion(szene({ active: true }))).toBe('zuruecknehmen');
  });

  it('startet auch dann, wenn die Szene keinen Zustand hält', () => {
    // «Alles aus» steht nie «an» - ein zweiter Druck soll es wieder tun,
    // nicht rückgängig machen.
    expect(tippAktion(szene({ active: true, toggles: false }))).toBe('starten');
  });
});

describe('laeuft', () => {
  it('gilt nur für Szenen, die einen Zustand halten', () => {
    expect(laeuft(szene({ active: true }))).toBe(true);
    expect(laeuft(szene({ active: true, toggles: false }))).toBe(false);
    expect(laeuft(szene())).toBe(false);
  });
});

describe('tippLabel', () => {
  it('sagt Vorlesegeräten, was passiert', () => {
    expect(tippLabel(szene())).toBe('Kino starten');
    expect(tippLabel(szene({ active: true }))).toBe('Kino zurücknehmen');
  });
});
