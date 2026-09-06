/**
 * Das Blatt «Hätte gefeuert»: aus dem Bericht des Hubs die Zeilen.
 *
 * Geprüft wird vor allem die Ehrlichkeit: Tage ohne Lauf bleiben
 * sichtbar, die obere Schranke steht dabei, und lange Tage werden
 * gezählt statt aufgezählt.
 */
import {
  SimulationsBericht,
  ZEITEN_KURZ,
  nichtSimulierbarZeile,
  obergrenzeSatz,
  summenSatz,
  tagLabel,
  tagZeile,
  ungeprueftZeile,
} from './ablaufsimulation';

const leer: SimulationsBericht = {
  from: '2026-08-31',
  to: '2026-09-06',
  days: [],
  total: 0,
  not_simulatable: [],
  unchecked_conditions: [],
};

describe('tagLabel', () => {
  it('zerlegt das ISO-Datum von Hand, nicht über UTC', () => {
    // Der 1. September 2026 ist ein Dienstag – in jeder Zeitzone.
    expect(tagLabel('2026-09-01')).toBe('Di 01.09.');
    expect(tagLabel('2026-12-24')).toBe('Do 24.12.');
  });

  it('lässt Unlesbares wörtlich stehen', () => {
    expect(tagLabel('kaputt')).toBe('kaputt');
  });
});

describe('tagZeile', () => {
  it('zeigt einen Tag ohne Lauf als Strich, nicht als Lücke', () => {
    expect(tagZeile({ date: '2026-09-01', times: [], count: 0 })).toBe(
      'Di 01.09. · –'
    );
  });

  it('zählt statt aufzuzählen, wenn ein Melder den Tag füllt', () => {
    const times = Array.from({ length: 40 }, (_unused, i) =>
      `${String(Math.floor(i / 4) + 6).padStart(2, '0')}:0${i % 4}`
    );
    const zeile = tagZeile({ date: '2026-09-01', times, count: 40 });
    expect(zeile).toContain('(40×)');
    expect(zeile.split(',').length).toBe(ZEITEN_KURZ);
  });

  it('schreibt wenige Zeitpunkte aus', () => {
    expect(
      tagZeile({ date: '2026-09-01', times: ['06:30', '18:12'], count: 2 })
    ).toBe('Di 01.09. · 06:30, 18:12');
  });
});

describe('summenSatz', () => {
  it('beugt richtig – null, eins, viele', () => {
    expect(
      summenSatz({ ...leer, days: [{ date: '2026-09-01', times: [], count: 0 }] })
    ).toBe('Der Ablauf hätte heute kein einziges Mal gefeuert.');
    expect(
      summenSatz({
        ...leer,
        total: 1,
        days: Array.from({ length: 7 }, (_unused, i) => ({
          date: `2026-09-0${i + 1}`,
          times: [],
          count: 0,
        })),
      })
    ).toBe('Der Ablauf hätte in den letzten 7 Tagen einmal gefeuert.');
    expect(
      summenSatz({
        ...leer,
        total: 12,
        days: Array.from({ length: 7 }, (_unused, i) => ({
          date: `2026-09-0${i + 1}`,
          times: [],
          count: 0,
        })),
      })
    ).toBe('Der Ablauf hätte in den letzten 7 Tagen 12-mal gefeuert.');
  });
});

describe('nichtSimulierbarZeile', () => {
  it('nennt Art, Gerätenamen und den Grund des Hubs', () => {
    expect(
      nichtSimulierbarZeile(
        {
          type: 'presence',
          entity_id: 'geofence.livia',
          reason: 'Anwesenheitswechsel stehen nicht im Ereignisprotokoll',
        },
        (id) => (id === 'geofence.livia' ? 'Livia' : id)
      )
    ).toBe(
      'Person kommt/geht «Livia»: Anwesenheitswechsel stehen nicht im Ereignisprotokoll'
    );
  });

  it('lässt ohne Namensliste die Kennung stehen', () => {
    expect(
      nichtSimulierbarZeile({ type: 'interval', reason: 'läuft im Takt' })
    ).toBe('Regelmässig: läuft im Takt');
  });
});

describe('obergrenzeSatz', () => {
  it('schweigt, wenn alles prüfbar war', () => {
    expect(obergrenzeSatz(leer)).toBeNull();
  });

  it('sagt zur Zahl dazu, dass sie eine Obergrenze ist', () => {
    expect(
      obergrenzeSatz({
        ...leer,
        unchecked_conditions: [{ type: 'state', entity_id: 'hm.sensor' }],
      })
    ).toBe(
      'Eine Bedingung liess sich für die Vergangenheit nicht nachprüfen – die Zahl ist eine Obergrenze.'
    );
    expect(
      obergrenzeSatz({
        ...leer,
        unchecked_conditions: [{ type: 'state' }, { type: 'group' }],
      })
    ).toContain('2 Bedingungen liessen sich');
  });
});

describe('ungeprueftZeile', () => {
  it('benennt Gerät und Gruppe verschieden', () => {
    expect(
      ungeprueftZeile({ type: 'state', entity_id: 'hm.lux' }, () => 'Helligkeit Flur')
    ).toBe('Gerätebedingung «Helligkeit Flur»');
    expect(ungeprueftZeile({ type: 'group' })).toBe('eine Bedingungsgruppe');
  });
});
