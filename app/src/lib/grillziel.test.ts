import {
  fuehlerZeile,
  fuehlerplaetze,
  grillstufen,
  zielSchritt,
  garstufen,
  grillFortschritt,
  istGrill,
  zieleVon,
} from './grillziel';

describe('garstufen', () => {
  it('nennt den Garpunkt und nicht bloss die Zahl', () => {
    // «63°» beantwortet die Frage nicht, «Schwein 63°» schon.
    expect(garstufen('°C').map((s) => s.label)).toContain('Schwein 63°');
  });

  it('gibt einem Fahrenheit-Grill die Zahlen aus seinen Rezepten', () => {
    // Nicht umgerechnet: 49 °C sind 120,2 °F, und «120,2°» stünde auf
    // keinem Knopf.
    const werte = garstufen('°F').map((s) => s.wert);
    expect(werte).toContain(145);
    expect(werte).not.toContain(63);
  });

  it('nimmt im Zweifel Celsius', () => {
    expect(garstufen(undefined).map((s) => s.wert)).toContain(63);
  });
});

describe('fuehlerZeile', () => {
  it('bleibt ohne Ziel bei der Temperatur', () => {
    // Ein «Ziel –» wäre eine Spalte, die bei jedem Fühler leer steht.
    expect(fuehlerZeile('1', 52, null, '°C')).toBe('Fühler 1: 52 °C');
  });

  it('sagt mit Ziel, wie weit es noch ist', () => {
    // Das ist beim Grillen die eigentliche Frage.
    expect(fuehlerZeile('2', 52, 63, '°C')).toBe('Fühler 2: 52 °C · noch 11 bis 63');
  });

  it('sagt es auch, wenn es so weit ist', () => {
    expect(fuehlerZeile('2', 64, 63, '°C')).toBe('Fühler 2: 64 °C · Ziel 63 erreicht');
  });
});

describe('zieleVon', () => {
  it('liest die Zeilen, die der Hub schickt', () => {
    // Zeilen und kein verschachteltes Wörterbuch: Der Datenspeicher des
    // Hubs führt Listen, und ein Wörterbuch käme dort als Liste seiner
    // Schlüssel zurück (core/grillmeldung.py).
    expect(
      zieleVon([{ entity_id: 'pitboss.grill', nummer: 1, ziel: 63 }], 'pitboss.grill')
    ).toEqual({ '1': 63 });
  });

  it('lässt Unsinn draussen, statt die Kachel umzuwerfen', () => {
    const ziele = zieleVon(
      [
        { entity_id: 'g', nummer: 1, ziel: 'warm' },
        { entity_id: 'g', nummer: 2, ziel: 63 },
      ],
      'g'
    );
    expect(ziele).toEqual({ '2': 63 });
  });

  it('verträgt einen Grill ohne Ziele', () => {
    expect(zieleVon(undefined, 'g')).toEqual({});
    expect(zieleVon([{ entity_id: 'anderer', nummer: 1, ziel: 63 }], 'g')).toEqual({});
  });
});

describe('istGrill', () => {
  it('erkennt ihn am Temperaturziel', () => {
    // Dieselbe Regel wie im Hub - «erkennbar am Temperaturziel, das
    // eine Waschmaschine nicht hat».
    expect(istGrill({ kind: 'appliance', state: { target: 110 } })).toBe(true);
  });

  it('lässt die Waschmaschine in Ruhe', () => {
    // Sie bekäme sonst eine Kachel mit Fühlern, die sie nicht hat.
    expect(istGrill({ kind: 'appliance', state: {} })).toBe(false);
    expect(istGrill({ kind: 'appliance', state: { target: null } })).toBe(false);
  });

  it('nimmt nur Haushaltgeräte', () => {
    expect(istGrill({ kind: 'sensor', state: { target: 110 } })).toBe(false);
  });
});

describe('fuehlerplaetze', () => {
  it('zeigt alle vier, auch die leeren', () => {
    // Man sieht auf einen Blick, welcher Platz noch frei ist, statt zu
    // zählen - und muss nicht rätseln, ob man den richtigen Anschluss
    // erwischt hat.
    const plaetze = fuehlerplaetze({ '2': 43 }, { '2': 63 });
    expect(plaetze.map((p) => p.nummer)).toEqual(['1', '2', '3', '4']);
    expect(plaetze[0].anzeige).toBe('- - -°');
    expect(plaetze[1].anzeige).toBe('43°');
    expect(plaetze[1].ziel).toBe(63);
    expect(plaetze[0].ziel).toBeNull();
  });
});

describe('grillFortschritt', () => {
  it('rechnet den Anteil bis zum Ziel', () => {
    expect(grillFortschritt(55, 110)).toBe(0.5);
  });

  it('bleibt zwischen null und eins', () => {
    // Ein Grill, der über sein Ziel schiesst, hat keinen Balken von 120 %.
    expect(grillFortschritt(130, 110)).toBe(1);
  });

  it('behauptet ohne Grundlage nichts', () => {
    expect(grillFortschritt(undefined, 110)).toBeNull();
    expect(grillFortschritt(55, undefined)).toBeNull();
    expect(grillFortschritt(55, 0)).toBeNull();
  });
});

describe('grillstufen und zielSchritt', () => {
  it('kennt die Rasten des Grills in beiden Einheiten', () => {
    // Punkt 565: 250 °F sind 121 °C - genau die Zahl, die am Gerät steht.
    expect(grillstufen('°C')).toContain(121);
    expect(grillstufen('°F')).toContain(250);
    expect(grillstufen(undefined)).toContain(121);
  });

  it('springt von Raste zu Raste, nicht um fünf Grad', () => {
    expect(zielSchritt(121, 1, '°C')).toBe(135);
    expect(zielSchritt(121, -1, '°C')).toBe(107);
    // Zwischen zwei Rasten (der Grill meldet einmal 110): zur nächsten.
    expect(zielSchritt(110, 1, '°C')).toBe(121);
    expect(zielSchritt(110, -1, '°C')).toBe(107);
  });

  it('bleibt an den Enden stehen', () => {
    expect(zielSchritt(260, 1, '°C')).toBe(260);
    expect(zielSchritt(82, -1, '°C')).toBe(82);
  });

  it('hat ohne Sollwert einen brauchbaren Anfang', () => {
    expect(grillstufen('°C')).toContain(zielSchritt(undefined, 1, '°C'));
  });
});
