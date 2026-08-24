/**
 * Einmal melden, wo man gerade ist.
 *
 * Der Fall dahinter: «Stefan · unterwegs · seit 1 h 19 min», während
 * Stefan zuhause war. Die Zonenüberwachung meldet nur Übertritte - wer
 * die Ortung im Wohnzimmer einschaltet, kreuzt keine Grenze.
 */
import {
  Ort,
  abstandMeter,
  drinIn,
  entfernung,
  genauGenug,
  naechsterOrt,
  meldungsText,
  ortsMeldungen,
  unsichereOrte,
} from './ortungsmeldung';

const HAUS = { lat: 47.1445, lon: 8.0675 };
const zuhause: Ort = {
  id: 'home',
  name: 'Zuhause',
  latitude: HAUS.lat,
  longitude: HAUS.lon,
  radius: 150,
};
const quartier: Ort = { ...zuhause, id: 'quartier', name: 'Quartier', radius: 3000 };

describe('abstandMeter', () => {
  it('ist am selben Punkt null', () => {
    expect(abstandMeter(HAUS.lat, HAUS.lon, HAUS.lat, HAUS.lon)).toBe(0);
  });

  it('rechnet eine Hundertstelgrad-Verschiebung in Meter um', () => {
    // 0.01° Breite sind rund 1.11 km - eine Zahl, die man nachschlagen kann.
    const meter = abstandMeter(HAUS.lat, HAUS.lon, HAUS.lat + 0.01, HAUS.lon);
    expect(meter).toBeGreaterThan(1090);
    expect(meter).toBeLessThan(1130);
  });
});

describe('drinIn', () => {
  it('erkennt das eigene Wohnzimmer', () => {
    expect(drinIn(zuhause, HAUS.lat, HAUS.lon)).toBe(true);
  });

  it('lässt einen Kilometer weiter nicht mehr gelten', () => {
    expect(drinIn(zuhause, HAUS.lat + 0.01, HAUS.lon)).toBe(false);
    // Im Quartier steht man dort aber noch.
    expect(drinIn(quartier, HAUS.lat + 0.01, HAUS.lon)).toBe(true);
  });
});

describe('genauGenug', () => {
  it('nimmt einen sauberen Fix', () => {
    expect(genauGenug([zuhause], 20)).toBe(true);
  });

  it('verwirft einen, der grösser ist als der halbe Ort', () => {
    // 400 m Streuung sagen über eine 150-m-Zone nichts. Ein falsches
    // «zuhause» schaltet die Alarmanlage unscharf.
    expect(genauGenug([zuhause], 400)).toBe(false);
  });

  it('verträgt eine fehlende Angabe', () => {
    expect(genauGenug([zuhause], null)).toBe(true);
    expect(genauGenug([], 10)).toBe(false);
  });
});

describe('ortsMeldungen', () => {
  it('meldet für jeden Ort, ob man drinsteht', () => {
    expect(ortsMeldungen([zuhause, quartier], HAUS.lat, HAUS.lon)).toEqual([
      { place: 'home', event: 'enter' },
      { place: 'quartier', event: 'enter' },
    ]);
  });

  it('meldet auch das Verlassen - sonst bleibt der alte Eintrag stehen', () => {
    expect(ortsMeldungen([zuhause, quartier], HAUS.lat + 0.1, HAUS.lon)).toEqual([
      { place: 'home', event: 'leave' },
      { place: 'quartier', event: 'leave' },
    ]);
  });
});

describe('meldungsText', () => {
  it('nennt den engsten Ort, in dem man steht', () => {
    const meldungen = ortsMeldungen([quartier, zuhause], HAUS.lat, HAUS.lon);
    expect(meldungsText([quartier, zuhause], meldungen)).toBe('Gemeldet: Zuhause.');
  });

  it('sagt es, wenn man nirgends drinsteht', () => {
    const meldungen = ortsMeldungen([zuhause], HAUS.lat + 0.1, HAUS.lon);
    expect(meldungsText([zuhause], meldungen)).toBe('Gemeldet: unterwegs.');
  });

  it('nennt die Entfernung zum nächsten Ort', () => {
    // Der stille Einrichtungsfehler: Fehlt der Standort in der
    // config.yaml, liegt der Hauskreis irgendwo - und man ist dauerhaft
    // «unterwegs», ohne dass etwas kaputt aussieht.
    const weit = { lat: HAUS.lat, lon: HAUS.lon + 0.15 };
    const meldungen = ortsMeldungen([zuhause], weit.lat, weit.lon);
    expect(meldungsText([zuhause], meldungen, weit.lat, weit.lon)).toMatch(
      /Der nächste Ort \(Zuhause\) liegt 11\.\d km entfernt\./
    );
  });
});

describe('entfernung', () => {
  it('rundet Meter auf zehn', () => {
    expect(entfernung(834)).toBe('830 m');
  });

  it('wird ab einem Kilometer zu Kilometern', () => {
    expect(entfernung(11_240)).toBe('11.2 km');
  });
});

describe('naechsterOrt', () => {
  it('nimmt den nächstgelegenen', () => {
    const weit: Ort = { ...zuhause, id: 'weit', name: 'Weit', latitude: HAUS.lat + 1 };
    expect(naechsterOrt([weit, zuhause], HAUS.lat, HAUS.lon)?.ort.id).toBe('home');
  });

  it('verträgt eine fehlende Position', () => {
    expect(naechsterOrt([zuhause], undefined, undefined)).toBeNull();
  });
});


// ── «unterwegs», während man zuhause sitzt ───────────────────────────────
//
// Der gemeldete Fall. Ein Fix, der das Haus um 180 Meter verfehlt, aber
// selbst 70 Meter Streuung hat, sagt nicht «draussen» – er sagt «weiss
// nicht». Daraus wurde ein entschiedenes `leave`, und «weg» ist keine
// harmlose Antwort: Daran hängen Alarmanlage und «alles aus».

/** Ein Punkt, der `meter` nördlich vom Haus liegt. */
const noerdlich = (meter: number) => HAUS.lat + meter / 111_320;

describe('Ein knappes «nicht drin» bei ungenauer Messung', () => {
  it('meldet kein leave, wenn die Streuung es nicht hergibt', () => {
    // 180 m vom Haus, ±70 m: Die Hausgrenze liegt innerhalb der Streuung.
    const meldungen = ortsMeldungen([zuhause], noerdlich(180), HAUS.lon, 70);
    expect(meldungen).toEqual([]);
  });

  it('meldet leave, sobald die Messung es trägt', () => {
    // 400 m entfernt, ±70 m: Das ist eindeutig draussen.
    expect(ortsMeldungen([zuhause], noerdlich(400), HAUS.lon, 70)).toEqual([
      { place: 'home', event: 'leave' },
    ]);
  });

  it('bleibt beim Ankommen beim gemessenen Punkt', () => {
    // Wer «drin» strenger fasste, käme nie zuhause an – und «drin» ist
    // die vorsichtigere Richtung, es schaltet nichts scharf.
    expect(ortsMeldungen([zuhause], noerdlich(100), HAUS.lon, 70)).toEqual([
      { place: 'home', event: 'enter' },
    ]);
  });

  it('verhält sich ohne Genauigkeitsangabe wie bisher', () => {
    expect(ortsMeldungen([zuhause], noerdlich(180), HAUS.lon)).toEqual([
      { place: 'home', event: 'leave' },
    ]);
  });

  it('nennt die unsicheren Orte beim Namen', () => {
    expect(unsichereOrte([zuhause, quartier], noerdlich(180), HAUS.lon, 70)).toEqual([
      zuhause,
    ]);
    expect(unsichereOrte([zuhause], noerdlich(180), HAUS.lon, 0)).toEqual([]);
  });

  it('sagt im Satz, dass nichts gemeldet wurde – und warum', () => {
    // Sonst drückt man den Knopf ein zweites Mal und wundert sich.
    const lat = noerdlich(180);
    const meldungen = ortsMeldungen([zuhause], lat, HAUS.lon, 70);
    const unsicher = unsichereOrte([zuhause], lat, HAUS.lon, 70);
    const satz = meldungsText([zuhause], meldungen, lat, HAUS.lon, unsicher);
    expect(satz).toContain('Zu ungenau');
    expect(satz).toContain('Zuhause');
    expect(satz).toContain('Nichts gemeldet');
  });
});
