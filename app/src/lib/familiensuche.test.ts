/**
 * Die Suche über alle Listen und die «was ist neu»-Punkte.
 *
 * Der Fall: «Wo stand nochmal die Nummer vom Kaminfeger?» – die Antwort
 * darf nicht davon abhängen, in welchem Modul man zuerst nachsieht.
 */
import { herkunftText, neuSeit, suche, trefferName } from './familiensuche';

const DATEN = {
  contacts: [
    { id: 'c1', text: 'Kaminfeger Meier', phone: '041 921 00 00', created: '2026-08-20T10:00:00' },
    { id: 'c2', text: 'Kinderärztin', phone: '041 921 11 11' },
  ],
  recipes: [{ id: 'r1', text: 'Lasagne', category: 'Znacht' }],
  documents: [{ id: 'd1', text: 'Versicherung', note: 'Police 123, Kaminfeger-Kontrolle jährlich' }],
  tasks: [{ id: 't1', text: 'Grüngut', author: 'Sandra', created: '2026-08-21T08:00:00' }],
};

describe('suche', () => {
  test('findet quer durch die Module und gruppiert nach Modul', () => {
    const gruppen = suche(DATEN, 'kaminfeger');
    expect(gruppen.map((g) => g.collection)).toEqual(['contacts', 'documents']);
    expect(gruppen[0].treffer[0].item.id).toBe('c1');
  });

  test('nennt die Fundstelle, wenn sie nicht der Name ist', () => {
    const gruppen = suche(DATEN, 'police');
    expect(gruppen[0].treffer[0].fundstelle).toContain('Police 123');
  });

  test('der Name selbst ist keine Fundstelle', () => {
    const gruppen = suche(DATEN, 'lasagne');
    expect(gruppen[0].treffer[0].fundstelle).toBe('');
  });

  test('ein Buchstabe sucht nicht – der trifft alles', () => {
    expect(suche(DATEN, 'a')).toEqual([]);
  });

  test('findet auch über die Nummer', () => {
    expect(suche(DATEN, '921 11')[0].collection).toBe('contacts');
  });
});

test('trefferName fällt auf etwas Lesbares zurück', () => {
  expect(trefferName({ name: 'Ohne text' })).toBe('Ohne text');
  expect(trefferName({})).toBe('Ohne Namen');
});

describe('neuSeit', () => {
  test('zählt, was seit dem letzten Besuch dazukam', () => {
    const zahlen = neuSeit(DATEN, { contacts: '2026-08-19T00:00:00' }, 'Stefan');
    expect(zahlen.contacts).toBe(1);
  });

  test('was ich selbst geschrieben habe, zählt nicht', () => {
    const zahlen = neuSeit(DATEN, {}, 'Sandra');
    expect(zahlen.tasks).toBeUndefined();
  });
});

describe('herkunftText', () => {
  const jetzt = new Date('2026-08-22T12:00:00');

  test('nennt Person und Zeit', () => {
    expect(herkunftText({ author: 'Sandra', created: '2026-08-22T11:40:00' }, jetzt)).toBe(
      'von Sandra, vorhin'
    );
  });

  test('gestern heisst gestern', () => {
    expect(herkunftText({ author: 'Livia', created: '2026-08-21T11:00:00' }, jetzt)).toBe(
      'von Livia, gestern'
    );
  });

  test('ohne Angaben bleibt die Zeile leer', () => {
    expect(herkunftText({}, jetzt)).toBe('');
  });
});
