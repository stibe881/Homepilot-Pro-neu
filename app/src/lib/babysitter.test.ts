import {
  LEERER_BABYSITTER,
  istFreigegeben,
  lichterUmschalten,
  modusSatz,
  modusZeile,
  restText,
  ruht,
  seitText,
} from './babysitter';

describe('Babysitter-Modus', () => {
  it('hält zurück, was nicht freigegeben ist', () => {
    const stand = { active: true, allow: ['licht_flur'] };
    expect(ruht(stand, 'alles_aus')).toBe(true);
    expect(ruht(stand, 'licht_flur')).toBe(false);
  });

  it('hält ausserhalb des Modus nichts zurück – behält die Haken aber', () => {
    // Wer ihn am nächsten Abend wieder einschaltet, soll nicht neu
    // anhaken müssen.
    const stand = { active: false, allow: ['licht_flur'] };
    expect(ruht(stand, 'alles_aus')).toBe(false);
    expect(istFreigegeben(stand, 'licht_flur')).toBe(true);
  });

  it('sagt vor dem Einschalten, was dann ruht – und wovon es handelt', () => {
    // Danach ist die Auskunft wertlos - dann sind die Storen schon unten.
    // Der Vorspann muss mit: Der Satz steht unter den Pausier-Knöpfen
    // und läse sich sonst wie eine Auskunft übers Pausieren.
    expect(modusSatz({ active: false, allow: ['a', 'b'] }, 20)).toBe(
      'Babysitter-Modus: beim Einschalten laufen 2 von 20 Abläufen weiter, 18 ruhen.'
    );
    expect(modusSatz(LEERER_BABYSITTER, 20)).toContain('würden alle 20 Abläufe ruhen');
  });

  it('sagt im Betrieb, seit wann', () => {
    const um = new Date(2026, 7, 23, 19, 40).getTime() / 1000;
    const satz = modusSatz({ active: true, allow: ['a'], since: um }, 20);
    expect(satz).toContain('seit 19:40');
    expect(satz).toContain('1 von 20');
  });

  it('kommt ohne Zeitstempel aus', () => {
    expect(seitText(undefined)).toBe('');
    expect(seitText(null)).toBe('');
    expect(modusSatz({ active: true, allow: [] }, 5)).toContain('Läuft –');
  });
});

describe('Die Wahl der Empfangslichter', () => {
  it('ein zweiter Tipp nimmt die Lampe wieder heraus', () => {
    expect(lichterUmschalten([], 'hue.flur')).toEqual(['hue.flur']);
    expect(lichterUmschalten(['hue.flur'], 'hue.flur')).toEqual([]);
  });

  it('lässt die übrige Auswahl in Ruhe', () => {
    expect(lichterUmschalten(['a', 'b'], 'c')).toEqual(['a', 'b', 'c']);
    expect(lichterUmschalten(['a', 'b', 'c'], 'b')).toEqual(['a', 'c']);
  });
});

// ── Frist und Menüzeile (früher der Gästemodus) ───────────────────────

describe('Wie lange noch', () => {
  const jetzt = 1_700_000_000_000;

  /**
   * Aus der Frist gerechnet und nicht aus `minutes_left`: Die Zahl aus
   * dem Hub ist von dem Augenblick, in dem sie geholt wurde. Ein Blatt,
   * das eine Viertelstunde offen liegt, zeigte sonst eine Restzeit, die
   * es nicht mehr gibt.
   */
  it('rechnet aus der Frist, nicht aus der mitgeschickten Zahl', () => {
    const stand = {
      active: true,
      allow: [],
      until: jetzt / 1000 + 90 * 60,
      minutes_left: 240,
    };
    expect(restText(stand, jetzt)).toBe('1 Std 30 Min');
  });

  it('unter einer Stunde nur Minuten', () => {
    expect(restText({ active: true, allow: [], until: jetzt / 1000 + 40 * 60 }, jetzt)).toBe(
      '40 Min'
    );
  });

  it('volle Stunden ohne Minutenrest', () => {
    expect(restText({ active: true, allow: [], until: jetzt / 1000 + 7200 }, jetzt)).toBe(
      '2 Std'
    );
  });

  it('abgelaufen heisst «gleich zu Ende», nicht eine negative Zahl', () => {
    expect(restText({ active: true, allow: [], until: jetzt / 1000 - 60 }, jetzt)).toBe(
      'gleich zu Ende'
    );
  });

  it('ohne Frist gibt es keine Restzeit', () => {
    expect(restText({ active: true, allow: [], until: null }, jetzt)).toBe('');
    expect(restText({ active: false, allow: [] }, jetzt)).toBe('');
    expect(restText(null, jetzt)).toBe('');
  });
});

describe('Die Zeile im Menü', () => {
  const jetzt = 1_700_000_000_000;

  it('lädt ein, solange der Modus aus ist', () => {
    expect(modusZeile(null, jetzt)).toMatch(/Frist/);
    expect(modusZeile({ active: false, allow: [] }, jetzt)).toMatch(/Abläufe/);
  });

  it('zeigt die Restzeit, wenn eine Frist läuft', () => {
    expect(
      modusZeile({ active: true, allow: [], until: jetzt / 1000 + 3600 }, jetzt)
    ).toBe('Läuft noch 1 Std');
  });

  /**
   * Der Babysitter-Abend hat keine Frist. Dort eine Restzeit zu zeigen,
   * die es nicht gibt, wäre schlimmer als gar keine Angabe.
   */
  it('sagt es, wenn er ohne Frist läuft', () => {
    const zeile = modusZeile(
      { active: true, allow: [], until: null, since: 1_700_000_000 },
      jetzt
    );
    expect(zeile).toMatch(/ohne Frist/);
    expect(zeile).not.toMatch(/noch/);
  });
});
