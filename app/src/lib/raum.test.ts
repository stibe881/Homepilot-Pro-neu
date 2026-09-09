/** Was ein Raum über sich sagt, und welche Kacheln zuerst kommen. */
import { Entity } from '../api/types';
import {
  alphabetisch,
  inBeschattung,
  raeumeSortiert,
  raumKategorien,
  raumFakten,
  raumKlima,
  raumDunkel,
  raumLeuchtet,
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

  it('meldet Beschattung - unten, aber mit offenen Lamellen', () => {
    const store = geraet({
      kind: 'cover',
      name: 'Store Essbereich',
      state: { state: 'closed', position: 0, tilt: 50 },
      commands: ['open', 'close', 'set_position', 'set_tilt'],
    });
    expect(raumZeile([store])).toBe('Beschattung');
    expect(inBeschattung(store)).toBe(true);
  });

  it('schweigt bei ganz geschlossenen Lamellen - das ist «zu», nicht Beschattung', () => {
    const store = geraet({
      kind: 'cover',
      name: 'Store Essbereich',
      state: { state: 'closed', position: 0, tilt: 0 },
      commands: ['open', 'close', 'set_position', 'set_tilt'],
    });
    expect(raumZeile([store])).toBe('');
    expect(inBeschattung(store)).toBe(false);
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
    // «Waschküche» enthält «küche» - und trug darum ein Besteck im
    // Raumkopf. Dieselbe Falle wie beim Küchentimer (istKueche).
    expect(raumSymbol('Waschküche')).toBe('shirt-outline');
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

  it('gibt den Lichtszenen der Bridge keine eigene Kategorie mehr', () => {
    // Sie stand ganz unten, hinter Beleuchtung, Store und Medien - und
    // damit weit weg von den Szenen des Hubs, die dasselbe tun. Beide
    // stehen jetzt oben im Raumkopf (lib/szenen.ts, raumSzenen).
    const kategorien = raumKategorien(
      [geraet({ id: 'l1', kind: 'light' }), geraet({ id: 'sz1', kind: 'scene' })],
      () => 'Lichtszene'
    );
    expect(kategorien.map((k) => k.label)).toEqual(['Beleuchtung']);
    expect(kategorien.flatMap((k) => k.items.map((e) => e.id))).not.toContain('sz1');
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

describe('alphabetisch', () => {
  it('sortiert schweizerdeutsch – Umlaute stehen beim Grundbuchstaben', () => {
    // Ohne Locale stünde «Gäste Bad» hinter «Küche», weil Ä und Ü nach Z
    // einsortiert würden.
    expect(alphabetisch(['Küche', 'Wohnzimmer', 'Gäste Bad', 'Bad'])).toEqual([
      'Bad',
      'Gäste Bad',
      'Küche',
      'Wohnzimmer',
    ]);
  });

  it('lässt die übergebene Liste in Ruhe', () => {
    const liste = ['B', 'A'];
    alphabetisch(liste);
    expect(liste).toEqual(['B', 'A']);
  });

  it('verträgt die leere Liste', () => {
    expect(alphabetisch([])).toEqual([]);
  });
});

describe('raumKlima', () => {
  it('liefert Temperatur und Feuchte fuer den grossen Wert im Kopf', () => {
    const klima = raumKlima([
      geraet({
        kind: 'sensor',
        name: 'Temperatur',
        state: { state: 21.53, unit: '°C', humidity: 44.6 },
      }),
    ]);
    expect(klima?.temp).toBe('21,5°');
    expect(klima?.feuchte).toBe('45 % Feuchte');
  });

  it('ohne Fuehler kein Wert - statt eines Strichs', () => {
    expect(raumKlima([geraet({ kind: 'light' })])).toBeNull();
  });
});

describe('raumFakten', () => {
  it('zaehlt Bedienbares, beruhigt beim Fenster und nennt Musik', () => {
    const zeile = raumFakten([
      geraet({ kind: 'light', state: { state: 'on' }, commands: ['toggle'] }),
      geraet({ kind: 'switch', state: { state: 'off' }, commands: ['toggle'] }),
      geraet({
        kind: 'binary_sensor',
        name: 'Fenster',
        state: { state: 'off', device_class: 'contact' },
      }),
      geraet({ kind: 'media_player', state: { state: 'playing' }, commands: ['play'] }),
    ]);
    expect(zeile).toBe('2 von 3 an · Fenster zu · Musik läuft');
  });

  it('ohne Kontakt keine Beruhigung - sie waere eine Behauptung', () => {
    const zeile = raumFakten([
      geraet({ kind: 'light', state: { state: 'off' }, commands: ['toggle'] }),
    ]);
    expect(zeile).toBe('Alles aus');
  });

  it('offene Fenster schlagen die Beruhigung', () => {
    const zeile = raumFakten([
      geraet({
        kind: 'binary_sensor',
        name: 'Fenster Sued',
        state: { state: 'on', device_class: 'window' },
      }),
    ]);
    expect(zeile).toBe('Fenster Sued offen');
  });
});

describe('raumLeuchtet', () => {
  it('nur brennendes Licht macht den Schein an', () => {
    expect(raumLeuchtet([geraet({ kind: 'light', state: { state: 'on' } })])).toBe(true);
    expect(raumLeuchtet([geraet({ kind: 'light', state: { state: 'off' } })])).toBe(false);
    expect(raumLeuchtet([geraet({ kind: 'switch', state: { state: 'on' } })])).toBe(false);
  });
});

describe('raumDunkel', () => {
  it('ein Raum mit gelöschtem Licht liegt im Dunkeln', () => {
    expect(raumDunkel([geraet({ kind: 'light', state: { state: 'off' } })])).toBe(true);
    expect(raumDunkel([geraet({ kind: 'light', state: { state: 'on' } })])).toBe(false);
  });

  it('eine brennende Lampe genügt, um den Raum zu erhellen', () => {
    expect(
      raumDunkel([
        geraet({ kind: 'light', state: { state: 'off' } }),
        geraet({ kind: 'light', state: { state: 'on' } }),
      ])
    ).toBe(false);
  });

  it('ein Raum ohne Lampen steht nie im Dunkeln', () => {
    // Ein Eingang mit bloss einer Kamera kann nie leuchten - für immer
    // abgedunkelt sähe er aus wie ein Fehler, nicht wie eine Auskunft.
    expect(raumDunkel([geraet({ kind: 'camera', state: { state: 'on' } })])).toBe(false);
    expect(raumDunkel([])).toBe(false);
  });
});

describe('raumKlima mit eigenem Feuchtefühler', () => {
  it('nimmt den zweiten Fühler, wenn der erste keine Feuchte meldet', () => {
    // In der Waschküche sind Temperatur und Feuchte zwei Geräte. Die
    // Feuchte lag darum als Chip unter dem Kopf statt daneben.
    const klima = raumKlima([
      geraet({ kind: 'sensor', name: 'Temperatur', state: { state: 30, unit: '°C' } }),
      geraet({
        kind: 'sensor',
        name: 'Luftfeuchtigkeit Rack',
        state: { state: 37.4, unit: '%', device_class: 'humidity' },
      }),
    ]);
    expect(klima?.temp).toBe('30,0°');
    expect(klima?.feuchte).toBe('37 % Feuchte');
    expect(klima?.feuchteFuehler?.name).toBe('Luftfeuchtigkeit Rack');
  });

  it('lässt den Akkustand nicht als Luftfeuchtigkeit durchgehen', () => {
    // Prozent misst auch der Akku - und der Sendespeicher des
    // Funkmoduls (lib/klimachip.ts).
    const klima = raumKlima([
      geraet({ kind: 'sensor', name: 'Temperatur', state: { state: 21, unit: '°C' } }),
      geraet({ kind: 'sensor', name: 'Batterie', state: { state: 100, unit: '%' } }),
    ]);
    expect(klima?.feuchte).toBeNull();
  });

  it('zeigt die Feuchte auch ohne Temperaturfühler', () => {
    const klima = raumKlima([
      geraet({
        kind: 'sensor',
        name: 'Feuchte',
        state: { state: 55, unit: '%', device_class: 'humidity' },
      }),
    ]);
    expect(klima?.temp).toBeNull();
    expect(klima?.feuchte).toBe('55 % Feuchte');
  });
});
