import { Entity } from '../api/types';
import {
  feldLabel,
  istRauchmelder,
  meldetRauch,
  rauchmelderListe,
  rauchmelderVerstecken,
  wertText,
} from './rauchmelder';

function melder(
  id: string,
  state: Record<string, unknown>,
  extra: Record<string, unknown> = {}
): Entity {
  return {
    id,
    name: id,
    kind: 'binary_sensor',
    integration: 'zigbee2mqtt',
    state,
    commands: [],
    available: true,
    ...extra,
  } as unknown as Entity;
}

describe('istRauchmelder', () => {
  it('erkennt ihn an der Geräteklasse', () => {
    expect(istRauchmelder(melder('a', { state: 'off', device_class: 'smoke' }))).toBe(true);
    expect(istRauchmelder(melder('b', { state: 'off', device_class: 'gas' }))).toBe(true);
  });

  it('nimmt den Namen, wo keine Klasse kommt', () => {
    // Nicht jede Integration schickt eine - ohne diesen Zweig stünde der
    // Melder wieder als Kachel im Zimmer.
    expect(istRauchmelder(melder('Rauchmelder Flur', { state: 'off' }))).toBe(true);
  });

  it('lässt den Fensterkontakt in Ruhe', () => {
    expect(istRauchmelder(melder('c', { state: 'on', device_class: 'contact' }))).toBe(false);
    expect(istRauchmelder(melder('d', { state: 'on', device_class: 'motion' }))).toBe(false);
  });

  it('ist kein Messwert', () => {
    const sensor = { ...melder('e', { state: 21, unit: '°C' }), kind: 'sensor' } as Entity;
    expect(istRauchmelder(sensor)).toBe(false);
  });
});

describe('rauchmelderVerstecken', () => {
  it('nimmt dem ruhigen Melder die Kachel', () => {
    expect(rauchmelderVerstecken(melder('a', { state: 'off', device_class: 'smoke' }))).toBe(true);
  });

  it('lässt den meldenden Melder im Zimmer stehen', () => {
    // Eine ausgeblendete Brandmeldung wäre kein aufgeräumter
    // Bildschirm, sondern ein Fehler.
    const brennt = melder('a', { state: 'on', device_class: 'smoke' });
    expect(meldetRauch(brennt)).toBe(true);
    expect(rauchmelderVerstecken(brennt)).toBe(false);
  });

  it('versteckt einen Melder, der gar nicht antwortet', () => {
    // «on» von einem Gerät, das der Hub seit Tagen nicht erreicht, ist
    // keine Meldung - es ist der letzte bekannte Wert. Er steht in der
    // Liste unter System als «nicht erreichbar».
    const stumm = melder('a', { state: 'on', device_class: 'smoke' }, { available: false });
    expect(meldetRauch(stumm)).toBe(false);
    expect(rauchmelderVerstecken(stumm)).toBe(true);
  });
});

describe('wertText', () => {
  it('macht aus ja/nein-Feldern Worte', () => {
    expect(wertText('tamper', 'on')).toBe('ja');
    expect(wertText('tamper', false)).toBe('nein');
  });

  it('hängt die Einheit an, wo eine gehört', () => {
    expect(wertText('battery', 87)).toBe('87 %');
    expect(wertText('smoke_density_dbm', 0.12)).toBe('0.1');
  });

  it('rundet die Fliesskommazahl weg', () => {
    // «23.400000000000002» ist kein Messwert, sondern eine Zahl beim
    // Ausatmen.
    expect(wertText('smoke_density', 23.400000000000002)).toBe('23.4');
  });
});

describe('feldLabel', () => {
  it('beschriftet, was es kennt', () => {
    expect(feldLabel('smoke_density_dbm')).toBe('Rauchdichte (dB/m)');
    expect(feldLabel('battery')).toBe('Batterie');
  });

  it('zeigt auch das Unbekannte, statt es wegzulassen', () => {
    // Das «usw.» aus der Bitte: Welche Werte ein Melder führt, hängt am
    // Modell. Eine Liste, die nur Aufgezähltes zeigt, lässt genau das
    // weg, wonach man sucht.
    expect(feldLabel('battery_defect')).toBe('Battery defect');
  });
});

describe('rauchmelderListe', () => {
  it('führt Status, Batterie und die Rauchdichten', () => {
    const [zeile] = rauchmelderListe([
      melder('Rauchmelder Flur', {
        state: 'off',
        device_class: 'smoke',
        battery: 87,
        smoke_density: 0,
        smoke_density_dbm: 0.05,
      }),
    ]);
    expect(zeile.status).toBe('Ruhig');
    expect(zeile.werte.map((w) => `${w.label}: ${w.wert}`)).toEqual([
      'Batterie: 87 %',
      'Rauchdichte: 0',
      'Rauchdichte (dB/m): 0.1',
    ]);
  });

  it('gibt den beiden Rauchdichten verschiedene Beschriftungen', () => {
    // Bei Zigbee2MQTT heissen beide «smoke density». Nebeneinander
    // standen so zwei Spalten mit gleichem Namen und verschiedener
    // Zahl - im Browser gesehen, nicht gelesen.
    const [zeile] = rauchmelderListe([
      melder('Flur', {
        state: 'off',
        device_class: 'smoke',
        smoke_density: 0,
        smoke_density_dbm: 0.05,
      }),
    ]);
    const labels = zeile.werte.map((w) => w.label);
    expect(new Set(labels).size).toBe(labels.length);
  });

  it('stellt das Dringende nach oben', () => {
    // Alphabetisch stünde der meldende Melder unter «W» ganz unten.
    const liste = rauchmelderListe([
      melder('Wohnzimmer', { state: 'on', device_class: 'smoke' }),
      melder('Bad', { state: 'off', device_class: 'smoke' }),
      melder('Estrich', { state: 'off', device_class: 'smoke' }, { available: false }),
    ]);
    expect(liste.map((z) => `${z.name}/${z.status}`)).toEqual([
      'Wohnzimmer/RAUCH',
      'Estrich/nicht erreichbar',
      'Bad/Ruhig',
    ]);
  });

  it('markiert Sabotage und leere Batterie', () => {
    const [zeile] = rauchmelderListe([
      melder('Flur', { state: 'off', device_class: 'smoke', tamper: 'on', low_battery: true }),
    ]);
    expect(zeile.werte.filter((w) => w.warnt).map((w) => w.label)).toEqual([
      'Batterie schwach',
      'Sabotage',
    ]);
  });

  it('lässt Zustand und Geräteklasse aus den Werten heraus', () => {
    // Beides steht schon in der Zeile darüber - zweimal dasselbe liest
    // sich wie zwei Auskünfte.
    const [zeile] = rauchmelderListe([
      melder('Flur', { state: 'off', device_class: 'smoke', battery: 50 }),
    ]);
    expect(zeile.werte.map((w) => w.feld)).toEqual(['battery']);
  });

  it('merkt sich, ob der Melder von aussen lärmen kann', () => {
    // Punkt 544. Hängt am Modell: Die meisten Rauchmelder haben zwar
    // eine Sirene, aber nur ihre eigene. Ohne dieses Feld bliebe die
    // Frage offen, warum der Melder im Ablauf-Editor fehlt.
    const [laut] = rauchmelderListe([
      { ...melder('Flur', { state: 'off', device_class: 'smoke' }),
        commands: ['sound_alarm', 'silence_alarm'] } as unknown as Entity,
    ]);
    expect(laut.kannSignal).toBe(true);
    const [stumm] = rauchmelderListe([melder('Bad', { state: 'off', device_class: 'smoke' })]);
    expect(stumm.kannSignal).toBe(false);
  });

  it('nimmt nur Melder auf', () => {
    expect(rauchmelderListe([melder('Fenster', { state: 'on', device_class: 'contact' })])).toEqual(
      []
    );
  });
});
