import { artName, hausAbschnitte, quelleName, vorhandeneArten } from './hausrueckblick';

const HEUTE = new Date('2026-08-27T14:00:00').getTime();
const sek = (ms: number) => ms / 1000;

const geraete = {
  'hue.kueche': { name: 'Licht Küche', kind: 'light', room: 'Küche' },
  'matter.tuere': { name: 'Haustüre', kind: 'binary_sensor', room: null },
};

describe('quelleName', () => {
  it('nennt Mensch, Ablauf und Szene beim Namen', () => {
    expect(quelleName({ kind: 'user', label: 'Stefan' })).toBe('Stefan');
    expect(quelleName({ kind: 'automation', label: 'Guten Morgen' })).toBe(
      'Ablauf «Guten Morgen»',
    );
    expect(quelleName({ kind: 'scene', label: 'Kino' })).toBe('Szene «Kino»');
  });

  it('sagt bei fehlender Quelle, dass es nicht über den Hub kam', () => {
    expect(quelleName(undefined)).toBe('am Gerät');
    expect(quelleName({})).toBe('am Gerät');
  });
});

describe('hausAbschnitte', () => {
  it('teilt nach Tagen und nennt Gerät und Raum', () => {
    const abschnitte = hausAbschnitte(
      [
        { entity_id: 'hue.kueche', state: 'on', at: sek(HEUTE - 1000) },
        { entity_id: 'matter.tuere', state: 'on', at: sek(HEUTE - 86400000) },
      ],
      geraete,
      HEUTE,
    );
    expect(abschnitte.map((a) => a.titel)).toEqual(['Heute', 'Gestern']);
    expect(abschnitte[0].zeilen[0].wer).toBe('Licht Küche · Küche');
    expect(abschnitte[0].zeilen[0].was).toBe('Eingeschaltet');
    // Ohne Raum steht nur der Name da, kein leeres Trennzeichen.
    expect(abschnitte[1].zeilen[0].wer).toBe('Haustüre');
  });

  it('behält ein Gerät, das es nicht mehr gibt', () => {
    // Was passiert ist, ist passiert - auch wenn die Kachel weg ist.
    const abschnitte = hausAbschnitte(
      [{ entity_id: 'weg.geraet', state: 'off', at: sek(HEUTE) }],
      geraete,
      HEUTE,
    );
    expect(abschnitte[0].zeilen[0].wer).toBe('weg.geraet');
  });

  it('macht aus nichts keine leeren Abschnitte', () => {
    expect(hausAbschnitte([], geraete, HEUTE)).toEqual([]);
  });
});

describe('vorhandeneArten', () => {
  it('bietet nur an, was auch dasteht', () => {
    // Ein Filter für etwas, das nicht vorkommt, ist ein Knopf, der
    // nichts tut.
    const abschnitte = hausAbschnitte(
      [
        { entity_id: 'hue.kueche', state: 'on', at: sek(HEUTE) },
        { entity_id: 'matter.tuere', state: 'on', at: sek(HEUTE) },
      ],
      geraete,
      HEUTE,
    );
    expect(vorhandeneArten(abschnitte[0].zeilen)).toEqual(['binary_sensor', 'light']);
  });
});

describe('artName', () => {
  it('übersetzt, was es kennt, und zeigt sonst den Rohwert', () => {
    expect(artName('cover')).toBe('Storen');
    expect(artName('etwas_neues')).toBe('etwas_neues');
  });
});
