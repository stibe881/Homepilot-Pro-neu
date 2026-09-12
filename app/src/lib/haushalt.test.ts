/** Die Kachel-Zeile eines Haushaltgeräts – und die Falle mit der Restzeit. */
import { Entity } from '../api/types';
import {
  applianceLine,
  steckdosengeraet,
  uebernahmeZeile,
  workingAppliances,
} from './haushalt';

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

describe('uebernahmeZeile', () => {
  it('nennt den Namen, wenn jemand übernommen hat', () => {
    // Die Frage im Kopf ist «muss ich?», und darauf antwortet nur ein Name.
    expect(uebernahmeZeile(geraet({ state: 'idle', claimed_by: 'Bine' }))).toBe(
      'Bine räumt aus'
    );
  });

  it('schweigt, solange niemand übernommen hat', () => {
    expect(uebernahmeZeile(geraet({ state: 'idle' }))).toBeNull();
    expect(uebernahmeZeile(undefined)).toBeNull();
  });

  it('steht nicht über einem laufenden Programm', () => {
    // Läuft die Maschine wieder, ist die Übernahme von vorhin erledigt -
    // der Hub räumt sie in der nächsten Runde weg.
    expect(
      uebernahmeZeile(geraet({ state: 'running', claimed_by: 'Bine' }))
    ).toBeNull();
  });
});

describe('steckdosengeraet', () => {
  const steckdose = (state: Record<string, unknown>): Entity =>
    ({
      id: 'homematic.tumbler',
      name: 'Tumbler',
      kind: 'switch',
      state,
      commands: ['turn_on', 'turn_off'],
      available: true,
    }) as unknown as Entity;

  it('nennt den fertigen Tumbler fertig, obwohl er noch 9 W zieht', () => {
    // Der gemeldete Fall: «Am Trocknen · 9 W» an einer längst trockenen
    // Wäsche. Das wache Display der Maschine reicht über die alte
    // Schwelle von 5 W - Arbeit heisst bei einem Tumbler hunderte Watt.
    const zeile = steckdosengeraet(steckdose({ state: 'on', power: 9 }), 'Am Trocknen');
    expect(zeile.text).toBe('Fertig');
    expect(zeile.running).toBe(false);
    expect(zeile.watts).toBe(9);
  });

  it('zeigt den laufenden Tumbler mit seinem eigenen Wort', () => {
    const zeile = steckdosengeraet(steckdose({ state: 'on', power: 1142 }), 'Am Trocknen');
    expect(zeile.text).toBe('Am Trocknen');
    expect(zeile.running).toBe(true);
  });

  it('unterscheidet die ausgeschaltete Steckdose vom fertigen Gerät', () => {
    // «Fertig» an einer toten Steckdose wäre eine Behauptung über die
    // Wäsche, die niemand geprüft hat.
    const zeile = steckdosengeraet(steckdose({ state: 'off', power: 0 }), 'Am Trocknen');
    expect(zeile.text).toBe('Steckdose aus');
    expect(zeile.aus).toBe(true);
    expect(zeile.running).toBe(false);
  });

  it('hält dieselbe Schwelle wie die Begrüssungszeile', () => {
    // Zwei Regeln für dieselbe Frage waren der Fehler; ein Gerät, das
    // hier läuft, muss auch dort laufen.
    const laeuft = steckdose({ state: 'on', power: 1142 });
    const fertig = steckdose({ state: 'on', power: 9 });
    expect(workingAppliances([laeuft]).length).toBe(1);
    expect(workingAppliances([fertig]).length).toBe(0);
    expect(steckdosengeraet(laeuft).running).toBe(true);
    expect(steckdosengeraet(fertig).running).toBe(false);
  });

  it('zeigt ohne Gerät die Demo-Maschine bei der Arbeit', () => {
    expect(steckdosengeraet(undefined, 'Am Trocknen').running).toBe(true);
  });
});
