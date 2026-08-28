import { DURCHBRUCH, durchbruchAn, durchbruchUmschalten } from './saugerdurchbruch';

describe('durchbruchAn', () => {
  it('erkennt eine gewählte Art', () => {
    expect(durchbruchAn(['person', 'animal'], 'person')).toBe(true);
    expect(durchbruchAn(['animal'], 'person')).toBe(false);
  });

  it('sagt bei fehlender Liste nichts Falsches', () => {
    expect(durchbruchAn(undefined, 'person')).toBe(false);
  });
});

describe('durchbruchUmschalten', () => {
  it('nimmt eine Art heraus', () => {
    expect(durchbruchUmschalten(['person', 'animal'], 'animal')).toEqual(['person']);
  });

  it('nimmt eine Art dazu', () => {
    expect(durchbruchUmschalten(['person'], 'animal')).toEqual(['person', 'animal']);
  });

  it('geht von der Hub-Vorgabe aus, wenn noch nichts gespeichert ist', () => {
    // Ein fehlendes Feld heisst «noch nie angefasst», nicht «nichts
    // ausgewählt» - sonst schaltete der erste Tipp alles ein statt eines
    // aus.
    expect(durchbruchUmschalten(undefined, 'animal')).toEqual(['person']);
  });

  it('lässt sich vollständig leeren', () => {
    expect(durchbruchUmschalten(['person'], 'person')).toEqual([]);
  });
});

describe('DURCHBRUCH', () => {
  it('bietet nur an, was in eine Wohnung gehört', () => {
    // Fahrzeuge und Pakete sind Dinge vor der Haustür.
    expect(DURCHBRUCH.map((e) => e.key)).toEqual(['person', 'animal']);
  });
});
