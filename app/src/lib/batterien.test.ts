/**
 * Die Batterienliste und ihr «bis morgen».
 *
 * Der Fall dahinter: «Die Meldung ‹Batterie schwach› kommt immer und
 * immer wieder.» Der Hub meldet jetzt einmal je Gerät und lässt sich
 * quittieren – die App muss dafür wissen, was quittiert ist und bis wann.
 */
import type { Entity } from '../api/types';
import { batteryRows, stummBis } from './batterien';

const geraet = (teile: Partial<Entity>): Entity =>
  ({
    id: 'hm.melder',
    kind: 'binary_sensor',
    name: 'Melder',
    integration: 'hm',
    state: {},
    commands: [],
    available: true,
    ...teile,
  }) as Entity;

describe('batteryRows', () => {
  it('nimmt nur Geräte mit Batterie und stellt die dringendsten nach vorn', () => {
    // «Schwach» ohne Prozentwert steht ganz oben: Das Gerät sagt nur
    // noch «bald leer», danach ist es still.
    const rows = batteryRows([
      geraet({ id: 'a', name: 'Voll', state: { battery: 90 } }),
      geraet({ id: 'b', name: 'Ohne Batterie', state: {} }),
      geraet({ id: 'c', name: 'Knapp', state: { battery: 12 } }),
      geraet({ id: 'd', name: 'Schwach', state: { low_battery: true } }),
    ]);
    expect(rows.map((row) => row.entity.id)).toEqual(['d', 'c', 'a']);
    expect(rows[0].percent).toBeNull();
    expect(rows[0].low).toBe(true);
  });

  it('lässt unsinnige Prozentwerte weg statt sie anzuzeigen', () => {
    expect(batteryRows([geraet({ state: { battery: 240 } })])).toEqual([]);
    // Ein Gerät, das Text statt einer Zahl meldet, gibt es – und eine
    // Zeile «voll %» wäre schlimmer als keine Zeile.
    expect(
      batteryRows([geraet({ state: { battery: 'voll' as unknown as number } })])
    ).toEqual([]);
  });
});

describe('stummBis', () => {
  const jetzt = 1_700_000_000_000; // Millisekunden, wie Date.now()

  it('meldet ein laufendes «bis morgen»', () => {
    const bis = jetzt / 1000 + 3600;
    expect(stummBis([{ entity_id: 'hm.melder', muted_until: bis }], 'hm.melder', jetzt)).toBe(
      bis
    );
  });

  it('lässt ein abgelaufenes «bis morgen» fallen', () => {
    // Morgen früh ist die Warnung wieder scharf – der Knopf soll dann
    // nicht weiter «still» behaupten.
    const bis = jetzt / 1000 - 60;
    expect(
      stummBis([{ entity_id: 'hm.melder', muted_until: bis }], 'hm.melder', jetzt)
    ).toBeNull();
  });

  it('kommt ohne Vermerk zurecht', () => {
    expect(stummBis([], 'hm.melder', jetzt)).toBeNull();
    expect(
      stummBis([{ entity_id: 'anderes', muted_until: jetzt / 1000 + 60 }], 'hm.melder', jetzt)
    ).toBeNull();
    expect(
      stummBis([{ entity_id: 'hm.melder', muted_until: null }], 'hm.melder', jetzt)
    ).toBeNull();
  });
});


// ── Telefone gehören nicht in die Batterieliste ──────────────────────────
//
// Die Anwesenheits-Entitäten führen den Akkustand des Telefons mit - über
// die App selbst oder über Life360. Nützlich ist er dort, wo er hingehört:
// Ein leeres Telefon meldet keinen Standort mehr, und davor warnt der Hub.
// In dieser Liste steht er nur im Weg.

describe('Telefone in der Batterieliste', () => {
  it('lässt Personen weg, egal woher ihr Standort kommt', () => {
    const zeilen = batteryRows([
      geraet({
        id: 'geofence.stefan',
        name: 'Stefan',
        integration: 'geofence',
        state: { state: 'home', place: 'home', battery: 14, device_class: 'presence' },
      }),
      geraet({
        id: 'geofence.oma',
        name: 'Oma',
        integration: 'geofence',
        // Über Life360 gemeldet - dieselbe Türe, dieselbe Entität.
        state: { state: 'away', place: null, source: 'life360', battery: 9 },
      }),
      geraet({ id: 'hm.tuerkontakt', name: 'Haustüre', state: { battery: 38 } }),
    ]);
    expect(zeilen.map((zeile) => zeile.entity.id)).toEqual(['hm.tuerkontakt']);
  });

  it('verdeckt kein echtes Gerät mehr', () => {
    // Der Grund für die ganze Übung: Ein Telefon mit 14 Prozent stand
    // zuoberst und schob den Türkontakt nach unten, der wirklich dran
    // gewesen wäre.
    const zeilen = batteryRows([
      geraet({
        id: 'geofence.stefan',
        name: 'Stefan',
        state: { place: 'home', battery: 14 },
      }),
      geraet({ id: 'hm.rauchmelder', name: 'Rauchmelder', state: { low_battery: true } }),
    ]);
    expect(zeilen).toHaveLength(1);
    expect(zeilen[0].entity.id).toBe('hm.rauchmelder');
  });

  it('behält Geräte, die bloss zufällig einen Ort im Zustand hätten', () => {
    // Kein Ort, keine Anwesenheitsklasse: ganz normales Batteriegerät.
    const zeilen = batteryRows([
      geraet({ id: 'matter.schloss', name: 'Wohnungstüre', state: { battery: 77 } }),
    ]);
    expect(zeilen.map((zeile) => zeile.entity.id)).toEqual(['matter.schloss']);
  });
});
