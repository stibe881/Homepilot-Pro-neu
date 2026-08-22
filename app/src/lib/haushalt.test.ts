/** Die Kachel-Zeile eines Haushaltgeräts – und die Falle mit der Restzeit. */
import { Entity } from '../api/types';
import { applianceLine } from './haushalt';

const geraet = (state: Record<string, unknown>): Entity =>
  ({
    id: 'vzug.wama',
    name: 'Waschmaschine',
    kind: 'appliance',
    state,
    commands: [],
    available: true,
  }) as unknown as Entity;

describe('applianceLine', () => {
  it('zeigt Programm und Restzeit, solange das Gerät läuft', () => {
    const zeile = applianceLine(geraet({ state: 'running', program: 'Eco', minutes_left: 32 }), '');
    expect(zeile.running).toBe(true);
    expect(zeile.text).toBe('Läuft · Eco · noch 32 min');
  });

  it('schweigt über eine klebengebliebene Restzeit, wenn nichts läuft', () => {
    // Der Fehler aus dem Betrieb: Der Hub merged Zustände, eine alte
    // Restzeit bleibt im Feld stehen - und die Kachel sagte tagelang
    // «Bereit · noch 1 min» an einer längst fertigen Maschine.
    const zeile = applianceLine(geraet({ state: 'idle', program: 'Eco', minutes_left: 1 }), '');
    expect(zeile.running).toBe(false);
    expect(zeile.text).toBe('Bereit');
  });

  it('nennt einen unbekannten Zustand beim Namen', () => {
    expect(applianceLine(geraet({ state: 'error' }), '').text).toBe('error');
  });

  it('ohne Gerät bleibt der Demo-Text stehen', () => {
    expect(applianceLine(undefined, 'Läuft · noch 32 min')).toEqual({
      text: 'Läuft · noch 32 min',
      running: true,
    });
    expect(applianceLine(undefined, 'Bereit').running).toBe(false);
  });
});
