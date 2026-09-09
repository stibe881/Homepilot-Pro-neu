import {
  Box,
  boxName,
  boxSchluessel,
  boxStand,
  boxZeile,
  boxenSortiert,
  uebersichtSatz,
} from './lautsprecher';

const box = (patch: Partial<Box>): Box => ({
  name: 'Küche',
  host: '10.0.0.5',
  group: false,
  ...patch,
});

describe('boxName', () => {
  it('nimmt den Namen aus der App, wenn es einen gibt', () => {
    expect(boxName({ name: 'Nest Mini', app_name: 'Küche' })).toBe('Küche');
    expect(boxName({ name: 'Nest Mini', app_name: null })).toBe('Nest Mini');
    expect(boxName({ name: 'Nest Mini', app_name: '' })).toBe('Nest Mini');
  });
});

describe('boxSchluessel', () => {
  it('nimmt die uuid, sonst Adresse und Port', () => {
    // Adresse allein reicht nicht: Eine Gruppe läuft auf der IP eines
    // ihrer Mitglieder, nur mit eigenem Port.
    expect(boxSchluessel(box({ uuid: 'abc' }))).toBe('abc');
    expect(boxSchluessel(box({ host: '10.0.0.5' }))).toBe('10.0.0.5:8009');
    expect(boxSchluessel(box({ host: '10.0.0.5', port: 32100 }))).toBe('10.0.0.5:32100');
  });
});

describe('boxStand', () => {
  it('eine Entität schlägt alles andere', () => {
    const drin = box({ entity_id: 'cast.kueche', name: 'Küche' });
    expect(boxStand(drin, ['Küche'])).toBe('eingebunden');
  });

  it('eingetragen, aber noch ohne Neustart', () => {
    expect(boxStand(box({ name: 'Küche' }), ['Küche'])).toBe('wartet');
  });

  it('sonst ist sie neu', () => {
    expect(boxStand(box({ name: 'Küche' }))).toBe('neu');
  });
});

describe('uebersichtSatz', () => {
  it('sagt in einem Satz, was die Seite gefunden hat', () => {
    // Die Frage, mit der man herkommt: Kennt der Hub meine Boxen schon?
    // Vorher musste man zwei Listen durchgehen und je Zeile das kleine
    // Wort rechts lesen.
    const satz = uebersichtSatz([
      box({ name: 'Küche', entity_id: 'cast.kueche' }),
      box({ name: 'Bad' }),
      box({ name: 'Alle', group: true, entity_id: 'cast.alle' }),
    ]);
    expect(satz).toBe('3 Boxen gefunden · 2 eingebunden');
  });

  it('nennt Vermisstes nur, wenn es welches gibt', () => {
    expect(uebersichtSatz([box({ name: 'Küche' })], ['Estrich'])).toBe(
      '1 Box gefunden · 0 eingebunden · 1 vermisst'
    );
    expect(uebersichtSatz([box({ name: 'Küche' })])).not.toContain('vermisst');
  });

  it('unterscheidet «sucht noch» von «nichts gefunden»', () => {
    // Beides sah vorher gleich aus - eine leere Liste. Wer während der
    // Suche hinsah, hielt das Netz für stumm.
    expect(uebersichtSatz(null)).toBe('Sucht Boxen im Netz …');
    expect(uebersichtSatz([])).toBe('Keine Box im Netz gefunden.');
  });
});

describe('boxZeile', () => {
  it('nennt den Netz-Namen nur bei umbenannten Boxen', () => {
    expect(boxZeile(box({ name: 'Nest Mini', app_name: 'Küche' }))).toBe(
      'im Netz «Nest Mini» · 10.0.0.5'
    );
    expect(boxZeile(box({ name: 'Küche', app_name: 'Küche' }))).toBe('10.0.0.5');
  });

  it('zeigt Mitglieder, sobald sie geladen sind', () => {
    const gruppe = box({ name: 'Alle', group: true });
    expect(boxZeile(gruppe, ['Küche', 'Bad'])).toBe('Küche, Bad · 10.0.0.5');
    expect(boxZeile(gruppe, [])).toBe('Mitglieder nicht lesbar · 10.0.0.5');
    expect(boxZeile(gruppe)).toBe('10.0.0.5');
  });

  it('hängt das Modell hinten an', () => {
    expect(boxZeile(box({ model: 'Nest Audio' }))).toBe('10.0.0.5 · Nest Audio');
  });
});

describe('boxenSortiert', () => {
  it('Gruppen zuerst, beide Hälften alphabetisch', () => {
    // Vorher kamen sie in der Reihenfolge, in der das Netz geantwortet
    // hat - bei jeder Suche eine andere.
    const liste = boxenSortiert([
      box({ name: 'Küche' }),
      box({ name: 'Überall', group: true }),
      box({ name: 'Bad' }),
      box({ name: 'Erdgeschoss', group: true }),
    ]);
    expect(liste.map((b) => b.name)).toEqual(['Erdgeschoss', 'Überall', 'Bad', 'Küche']);
  });

  it('sortiert nach dem Namen, den die App zeigt', () => {
    const liste = boxenSortiert([
      box({ name: 'Zimmer 1', app_name: 'Anna' }),
      box({ name: 'Aaa-Box', app_name: 'Zoe' }),
    ]);
    expect(liste.map(boxName)).toEqual(['Anna', 'Zoe']);
  });
});
