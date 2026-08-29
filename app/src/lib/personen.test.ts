import {
  Person,
  anzahlAn,
  herkunft,
  nebenZeile,
  ortZeile,
  sortiert,
} from './personen';

const JETZT = new Date(2026, 7, 25, 14, 30);
const vorMinuten = (n: number) => (JETZT.getTime() - n * 60_000) / 1000;

const person = (over: Partial<Person>): Person => ({
  name: 'Stefan',
  zone: 'stefan',
  household: true,
  where: 'zuhause',
  source: 'geofence',
  meldungen: { battery: true, silence: true, arrive: false, leave: false },
  ...over,
});

describe('Familie und Freunde', () => {
  it('sagt, wo jemand ist – und seit wann', () => {
    // Ohne die Dauer beantwortet «unterwegs» die halbe Frage: Seit zehn
    // Minuten unterwegs ist etwas anderes als seit vorgestern.
    expect(ortZeile(person({ since: vorMinuten(12) }), JETZT)).toBe(
      'Zuhause · seit 12 min'
    );
    expect(
      ortZeile(person({ where: 'bei Tanners Home', since: vorMinuten(90) }), JETZT)
    ).toBe('Bei Tanners Home · seit 1 h 30 min');
    // Ohne Zeitpunkt bleibt der Ort allein stehen, statt dass da «· »
    // baumelt.
    expect(ortZeile(person({ where: 'unterwegs', since: null }), JETZT)).toBe(
      'Unterwegs'
    );
  });

  it('nennt ein Nichtwissen beim Namen', () => {
    // «Unbekannt» allein sähe aus wie ein Ortsname.
    expect(ortZeile(person({ where: 'unbekannt' }), JETZT)).toBe(
      'Aufenthalt unbekannt'
    );
  });

  it('sagt darunter, wie verlässlich das ist', () => {
    expect(nebenZeile(person({ source: 'life360', battery: 62 }))).toBe(
      'über Life360 · Telefon 62 %'
    );
    expect(nebenZeile(person({ source: 'none' }))).toBe('Hat sich noch nie gemeldet');
    // Ein Wandtablet ist ein Benutzer und geht nirgendwohin.
    expect(nebenZeile(person({ zone: null, source: null }))).toBe(
      'Keine Ortung eingerichtet'
    );
    // Kein Akkustand: dann steht dort nichts, statt «Telefon NaN %».
    expect(nebenZeile(person({ source: 'geofence', battery: null }))).toBe(
      'über das Telefon'
    );
  });

  it('unterscheidet Haushalt von bloss geortet', () => {
    expect(herkunft(person({}))).toBe('Haushalt');
    expect(herkunft(person({ household: false }))).toBe('Geortet');
  });

  it('stellt den Haushalt nach vorn, behält aber die Reihenfolge des Hubs', () => {
    // Alphabetisch zu sortieren würde die Wahl aus der config.yaml
    // überschreiben.
    const leute = [
      person({ name: 'Maja', household: false }),
      person({ name: 'Stefan' }),
      person({ name: 'Livia' }),
    ];
    expect(sortiert(leute).map((p) => p.name)).toEqual(['Stefan', 'Livia', 'Maja']);
  });

  it('zählt, was bei einer Person ansteht', () => {
    // Zugeklappt neben dem Namen: Sonst müsste man jede Person
    // aufklappen, um zu sehen, ob überhaupt etwas eingestellt ist.
    expect(anzahlAn(person({}))).toBe(2);
    expect(anzahlAn(person({ meldungen: {} }))).toBe(0);
    expect(anzahlAn(person({ meldungen: undefined }))).toBe(0);
  });
});
