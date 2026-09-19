/**
 * Die Kachel-Reihenfolge, die sich merkt, wann man was braucht.
 *
 * Der Fall dahinter: «Nach Tageszeit sortieren» hatte eine feste
 * Meinung – morgens erst die Storen. Wer als Erstes den Kaffee
 * anstellt, bekam sie trotzdem zuoberst.
 */
import {
  HALBWERT_MS,
  Kachelzaehler,
  gelernt,
  hinweisGelernt,
  merken,
  nachGewohnheit,
  verblasst,
} from './kachellernen';
import { ABSCHNITTE, abschnittFuer } from './tageszeit';

const MORGEN = abschnittFuer(7);
const ABEND = abschnittFuer(20);

const kachel = (id: string, kind: string) => ({ id, kind });

const oft = (
  zaehler: Kachelzaehler,
  id: string,
  mal: number,
  jetzt: number,
  abschnitt = MORGEN.key
): Kachelzaehler => {
  let ergebnis = zaehler;
  for (let i = 0; i < mal; i += 1) {
    ergebnis = merken(ergebnis, id, abschnitt, jetzt);
  }
  return ergebnis;
};

describe('merken und verblassen', () => {
  it('zählt je Gerät und Tagesabschnitt getrennt', () => {
    // Was abends zuoberst gehört, gehört morgens nicht dorthin - sonst
    // wäre es dasselbe wie «nach Nutzung».
    const jetzt = 1_000_000_000;
    let zaehler = oft({}, 'mqtt.kaffee', 4, jetzt, MORGEN.key);
    zaehler = oft(zaehler, 'mqtt.kaffee', 1, jetzt, ABEND.key);
    expect(gelernt(zaehler, MORGEN.key, jetzt)).toEqual(['mqtt.kaffee']);
    expect(gelernt(zaehler, ABEND.key, jetzt)).toEqual([]);
  });

  it('halbiert den Wert alle zwei Wochen', () => {
    // Die Heizung vom letzten Winter soll im Juli nicht mehr oben
    // stehen: Gewohnheit ist, was man zurzeit tut.
    const eintrag = { wert: 8, at: 0 };
    expect(verblasst(eintrag, HALBWERT_MS)).toBeCloseTo(4);
    expect(verblasst(eintrag, 2 * HALBWERT_MS)).toBeCloseTo(2);
  });

  it('verträgt kaputte Einträge', () => {
    expect(verblasst(undefined, 0)).toBe(0);
    expect(verblasst({ wert: NaN, at: 0 }, 0)).toBe(0);
  });
});

describe('gelernt', () => {
  it('schweigt, solange es nur einzelne Griffe sind', () => {
    const jetzt = 1_000_000_000;
    expect(gelernt(oft({}, 'hue.decke', 2, jetzt), MORGEN.key, jetzt)).toEqual([]);
  });

  it('ordnet die meistbedienten nach vorn', () => {
    const jetzt = 1_000_000_000;
    let zaehler = oft({}, 'hue.decke', 4, jetzt);
    zaehler = oft(zaehler, 'mqtt.kaffee', 9, jetzt);
    expect(gelernt(zaehler, MORGEN.key, jetzt)).toEqual(['mqtt.kaffee', 'hue.decke']);
  });
});

describe('nachGewohnheit', () => {
  const kacheln = [
    kachel('hue.decke', 'light'),
    kachel('hm.store', 'cover'),
    kachel('mqtt.kaffee', 'switch'),
  ];

  it('lässt die feste Reihenfolge stehen, solange nichts gelernt ist', () => {
    // Der Boden bleibt die Tageszeit-Sortierung: morgens erst die
    // Storen, dann die Schalter, dann das Licht.
    expect(
      nachGewohnheit(kacheln, MORGEN, {}, 0).map((eintrag) => eintrag.id)
    ).toEqual(['hm.store', 'mqtt.kaffee', 'hue.decke']);
  });

  it('zieht die gelernte Kachel nach vorn', () => {
    const jetzt = 1_000_000_000;
    const zaehler = oft({}, 'mqtt.kaffee', 5, jetzt);
    expect(
      nachGewohnheit(kacheln, MORGEN, zaehler, jetzt).map((eintrag) => eintrag.id)
    ).toEqual(['mqtt.kaffee', 'hm.store', 'hue.decke']);
  });

  it('rührt an den übrigen nichts', () => {
    // Der erste gelernte Eintrag soll genau eine Kachel verschieben und
    // nicht die ganze Seite durcheinanderbringen.
    const jetzt = 1_000_000_000;
    const zaehler = oft({}, 'hue.decke', 5, jetzt);
    expect(
      nachGewohnheit(kacheln, MORGEN, zaehler, jetzt).map((eintrag) => eintrag.id)
    ).toEqual(['hue.decke', 'hm.store', 'mqtt.kaffee']);
  });

  it('gilt nur für den Abschnitt, in dem gelernt wurde', () => {
    const jetzt = 1_000_000_000;
    const zaehler = oft({}, 'mqtt.kaffee', 5, jetzt, MORGEN.key);
    // Abends bleibt es bei der festen Liste: Licht zuerst.
    expect(
      nachGewohnheit(kacheln, ABEND, zaehler, jetzt).map((eintrag) => eintrag.id)
    ).toEqual(['hue.decke', 'hm.store', 'mqtt.kaffee']);
  });
});

describe('hinweisGelernt', () => {
  it('sagt, dass gelernt und nicht gesetzt wird', () => {
    expect(hinweisGelernt(ABSCHNITTE[2])).toBe('Abend: nach deiner Gewohnheit');
  });
});
