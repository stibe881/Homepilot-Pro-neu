import {
  ablaufAusText,
  belegLesen,
  belegSatz,
  betragAusText,
  nummerAusText,
  zahlAusBeleg,
} from './gutscheinlesen';

const MAIL = `Guten Tag Stefan Gross

vielen Dank für Ihre Bestellung bei Brack.ch.
Bestellnummer: 40012345678
Versandkosten: CHF 0.00

Ihr Geschenkgutschein über CHF 150.00
Gutscheincode: BRK7-4H2Q-99XZ
PIN: 4711
Gültig bis 31.12.2027

Freundliche Grüsse`;

describe('betragAusText', () => {
  it('nimmt den grössten Frankenbetrag, nicht die Bestellnummer', () => {
    // Die Bestellnummer ist die grösste Zahl im Beleg - aber ohne
    // Währung daneben, und genau daran unterscheidet sie sich.
    expect(betragAusText(MAIL)).toEqual({ total: 150, unit: 'chf' });
  });

  it('versteht Apostroph, Komma und nachgestelltes CHF', () => {
    expect(betragAusText("Wert: 1'250,50 CHF")).toEqual({ total: 1250.5, unit: 'chf' });
    expect(betragAusText('Betrag Fr. 20.–')).toEqual({ total: 20, unit: 'chf' });
  });

  it('liest Schweizer und deutsche Tausender', () => {
    expect(zahlAusBeleg("1'000")).toBe(1000);
    expect(zahlAusBeleg('1’250.–')).toBe(1250);
    expect(zahlAusBeleg('1\u202f250.50')).toBe(1250.5);
    expect(zahlAusBeleg('1.250,00')).toBe(1250);
    expect(zahlAusBeleg('20.50')).toBe(20.5);
    expect(betragAusText("Wert: CHF 1'000.–")).toEqual({ total: 1000, unit: 'chf' });
    expect(betragAusText('Gutscheinwert 1.250,00 CHF')).toEqual({ total: 1250, unit: 'chf' });
    expect(betragAusText('Total Fr. 2’500.00')).toEqual({ total: 2500, unit: 'chf' });
  });

  it('erkennt einen Stück-Gutschein', () => {
    expect(betragAusText('Gutschein für 5 Eintritte ins Hallenbad')).toEqual({
      total: 5,
      unit: 'stk',
    });
  });

  it('schweigt, wenn nichts dasteht', () => {
    expect(betragAusText('Vielen Dank für Ihren Einkauf.')).toBeNull();
  });
});

describe('nummerAusText', () => {
  it('trennt Nummer und PIN', () => {
    expect(nummerAusText(MAIL)).toEqual({ number: 'BRK7-4H2Q-99XZ', pin: '4711' });
  });

  it('nimmt keine Bestellnummer, die niemand als Code ankündigt', () => {
    // Ohne das Wort davor liest das Muster die Sendungsnummer, die
    // Bestellnummer und die IBAN mit - alle drei sehen gleich aus.
    expect(nummerAusText('Bestellnummer: 40012345678')).toEqual({});
  });
});

describe('ablaufAusText', () => {
  it('nimmt nur ein angekündigtes Datum', () => {
    expect(ablaufAusText(MAIL)).toBe('2027-12-31');
    // Das Kaufdatum als Ablauf zu lesen, wäre nicht bloss falsch,
    // sondern teuer.
    expect(ablaufAusText('Bestelldatum: 05.03.2026')).toBeNull();
  });

  it('versteht ausgeschriebene Monate', () => {
    expect(ablaufAusText('Gültig bis 1. April 2028')).toBe('2028-04-01');
  });

  it('nimmt ohne Tag den Monatsletzten', () => {
    // «gültig bis Dezember 2027» heisst nicht «bis zum 1. Dezember».
    expect(ablaufAusText('Einlösbar bis Dezember 2027')).toBe('2027-12-31');
    expect(ablaufAusText('Gültig bis Februar 2028')).toBe('2028-02-29');
  });
});

describe('belegLesen', () => {
  it('liest alles auf einmal', () => {
    expect(belegLesen(MAIL, ['Coop', 'Brack.ch'])).toEqual({
      total: 150,
      unit: 'chf',
      number: 'BRK7-4H2Q-99XZ',
      pin: '4711',
      expires: '2027-12-31',
      shop: 'Brack.ch',
    });
  });

  it('rät den Laden nur, wenn es ihn schon gibt', () => {
    // «noreply» als Ladennamen hat niemandem geholfen.
    expect(belegLesen(MAIL, []).shop).toBeUndefined();
  });

  it('sagt vorher, was übernommen würde', () => {
    expect(belegSatz(belegLesen(MAIL, ['Brack.ch']))).toBe(
      'Brack.ch · CHF 150.00 · Nr. BRK7-4H2Q-99XZ · PIN gefunden · gültig bis 31.12.2027'
    );
    expect(belegSatz({})).toBe('Nichts gefunden – bitte von Hand eintragen.');
  });
});
