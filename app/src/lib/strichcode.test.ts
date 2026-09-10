import { code128Bits, eanPruefziffer, istEan, strichbild } from './strichcode';

describe('EAN-13', () => {
  it('rechnet die Prüfziffer wie die Kasse', () => {
    // Nachgerechnet an bekannten Nummern - eine falsche Prüfziffer
    // fällt erst an der Kasse auf, und dort steht die Schlange.
    expect(eanPruefziffer('400638133393')).toBe(1);
    expect(eanPruefziffer('978020137962')).toBe(4);
  });

  it('nimmt zwölf Ziffern und prüft dreizehn', () => {
    expect(istEan('400638133393')).toBe(true);
    expect(istEan('4006381333931')).toBe(true);
    expect(istEan('4006381333932')).toBe(false);
    expect(istEan('BRK7-4H2Q')).toBe(false);
  });

  it('baut ein Bild mit Rand-, Mitten- und Endzeichen', () => {
    const bild = strichbild('4006381333931');
    expect(bild?.schrift).toBe('ean13');
    // 3 + 6*7 + 5 + 6*7 + 3 = 95 Module, so steht es in der Norm.
    expect(bild?.module).toBe(95);
    expect(bild?.text).toBe('4006381333931');
  });

  it('hängt die Prüfziffer an, wenn sie fehlt', () => {
    expect(strichbild('400638133393')?.text).toBe('4006381333931');
  });
});

describe('Code 128', () => {
  it('nimmt, was EAN nicht kann', () => {
    const bild = strichbild('BRK7-4H2Q-99XZ');
    expect(bild?.schrift).toBe('code128');
    expect(bild?.text).toBe('BRK7-4H2Q-99XZ');
  });

  it('fängt mit dem Startzeichen an und hört mit dem Stoppzeichen auf', () => {
    const bits = code128Bits('A');
    // Startzeichen B: 11010010000, Stoppzeichen: 1100011101011
    expect(bits.startsWith('11010010000')).toBe(true);
    expect(bits.endsWith('1100011101011')).toBe(true);
  });

  it('rechnet die Prüfsumme mit der Stelle gewichtet', () => {
    // «A» ist Wert 33: (104 + 33*1) % 103 = 34. Zeichen 34 ist 111323.
    const bits = code128Bits('A');
    const pruef = [...'111323']
      .map((breite, index) => (index % 2 === 0 ? '1' : '0').repeat(Number(breite)))
      .join('');
    expect(bits).toContain(pruef);
  });
});

describe('strichbild', () => {
  it('schweigt lieber, als einen leeren Code zu zeigen', () => {
    // Ein leerer Code ist schlimmer als keiner - man geht damit an die
    // Kasse.
    expect(strichbild('')).toBeNull();
    expect(strichbild(null)).toBeNull();
    expect(strichbild('   ')).toBeNull();
  });

  it('fasst gleiche Bits zu einem Balken zusammen', () => {
    const bild = strichbild('4006381333931');
    expect(bild?.balken.every((balken) => balken.breit > 0)).toBe(true);
    // Abwechselnd schwarz und weiss, sonst wären es zwei Balken zu viel.
    const wechsel = bild!.balken.every(
      (balken, index) => index === 0 || balken.an !== bild!.balken[index - 1].an
    );
    expect(wechsel).toBe(true);
  });
});
