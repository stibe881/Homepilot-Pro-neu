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

  it('rechnet lange Restzeiten in Stunden um', () => {
    // «noch 233 min» rechnet sonst jeder selbst nach – meistens falsch.
    const zeile = applianceLine(geraet({ state: 'running', minutes_left: 233 }), '');
    expect(zeile.text).toBe('Läuft · noch 3 h 53 min');
  });

  it('schweigt über eine klebengebliebene Restzeit, wenn nichts läuft', () => {
    // Der Fehler aus dem Betrieb: Der Hub merged Zustände, eine alte
    // Restzeit bleibt im Feld stehen - und die Kachel sagte tagelang
    // «Bereit · noch 1 min» an einer längst fertigen Maschine.
    const zeile = applianceLine(geraet({ state: 'idle', program: 'Eco', minutes_left: 1 }), '');
    expect(zeile.running).toBe(false);
    expect(zeile.text).toBe('Bereit');
  });

  it('sagt auch im Standby «Bereit»', () => {
    // So gewünscht aus der Waschküche: «Standby» ist ein Wort aus dem
    // Datenblatt an einer Stelle, an der man wissen will, ob man Wäsche
    // hineintun kann. Ob die Maschine noch voll ist, sagt ohnehin kein
    // Zustandswert - dafür meldet der Hub das Programmende.
    const zeile = applianceLine(geraet({ state: 'standby' }), '');
    expect(zeile.running).toBe(false);
    expect(zeile.text).toBe('Bereit');
  });

  it('schreibt kein englisches «unknown» auf die Kachel', () => {
    // Der Fall aus der Küche: Nach jedem Hub-Neustart schliefen die
    // Maschinen, der Hub hatte noch keine Messung - und unter
    // «Waschmaschine» stand roh der Platzhalter aus dem Setup.
    expect(applianceLine(geraet({ state: 'unknown' }), '').text).toBe('Unbekannt');
    expect(applianceLine(geraet({}), '').text).toBe('Unbekannt');
  });

  it('nennt einen unerwarteten Zustand beim Namen', () => {
    // Hässlich, aber wahr - und man kann danach suchen.
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

describe('Stillstehende Maschinen heissen «Bereit»', () => {
  const geraet2 = (state: string): Entity =>
    ({
      id: 'vzug.waschmaschine',
      name: 'Waschmaschine',
      kind: 'appliance',
      integration: 'vzug',
      available: true,
      commands: [],
      state: { state },
    }) as unknown as Entity;

  it('übersetzt, was der Hersteller sagt', () => {
    // «Standby» stand so an Waschmaschine, Geschirrspüler und Tumbler -
    // ein Wort aus dem Datenblatt an einer Stelle, an der man wissen
    // will, ob man Wäsche hineintun kann.
    for (const wert of ['idle', 'off', 'standby', 'ready']) {
      expect(applianceLine(geraet2(wert), '').text).toBe('Bereit');
      expect(applianceLine(geraet2(wert), '').running).toBe(false);
    }
    // «unknown» ist etwas anderes: Da hat der Hub noch nichts gehört.
    expect(applianceLine(geraet2('unknown'), '').text).toBe('Unbekannt');
  });

  it('verschweigt eine Störung nicht', () => {
    // Was nicht «wartet» heisst, bleibt stehen - «Bereit» über einem
    // Fehler wäre die schlechtere Auskunft.
    expect(applianceLine(geraet2('error'), '').text).toBe('error');
  });
});
