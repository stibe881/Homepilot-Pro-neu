/** Wie sich «Wer dazugehört» ordnet. */
import { Mitglied } from './mitglieder';
import { farbIndex, gruppeVon, initialen, personenGruppen, rolleZeile } from './personenliste';

const wer = (patch: Partial<Mitglied>): Mitglied =>
  ({ name: 'X', role: 'bewohner', ...patch }) as Mitglied;

describe('gruppeVon', () => {
  it('trennt Erwachsene, Kinder, Gäste und Geräte', () => {
    expect(gruppeVon(wer({ role: 'besitzer' }))).toBe('erwachsene');
    expect(gruppeVon(wer({ role: 'kind' }))).toBe('kinder');
    expect(gruppeVon(wer({ role: 'kind', ohneZugang: true }))).toBe('kinder');
    expect(gruppeVon(wer({ role: 'gast' }))).toBe('gaeste');
  });

  it('nimmt das Wandtablet aus den Menschen heraus', () => {
    // Es trägt die Rolle «bewohner» und stand deshalb zwischen den
    // Mitbewohnerinnen - mit Punkten, offenen Aufgaben und einem Kreuz
    // zum Entfernen, als wäre es jemand.
    expect(gruppeVon(wer({ name: 'Tablet', role: 'bewohner', shared: true }))).toBe('geraete');
  });

  it('lässt einen Eintrag ohne Zugang erwachsen sein', () => {
    // «Ohne Zugang» heisst nicht «Kind»: Die Grosseltern stehen in den
    // Listen, damit man ihnen Ämtli zuteilen kann.
    expect(gruppeVon(wer({ role: 'erwachsen', ohneZugang: true }))).toBe('erwachsene');
  });
});

describe('personenGruppen', () => {
  it('ordnet in fester Reihenfolge und lässt Leeres weg', () => {
    const gruppen = personenGruppen([
      wer({ name: 'Babysitter', role: 'gast' }),
      wer({ name: 'Lina', role: 'kind', ohneZugang: true }),
      wer({ name: 'Stibe', role: 'besitzer' }),
    ]);
    // Erst der Haushalt, dann der Besuch - und «Geräte» fehlt ganz,
    // weil eine Überschrift über nichts keine Auskunft ist.
    expect(gruppen.map((g) => g.key)).toEqual(['erwachsene', 'kinder', 'gaeste']);
    expect(gruppen[0].leute.map((m) => m.name)).toEqual(['Stibe']);
  });

  it('gibt bei leerer Reihe gar keine Gruppe', () => {
    expect(personenGruppen([])).toEqual([]);
  });
});

describe('initialen', () => {
  it('nimmt bei zwei Wörtern beide Anfangsbuchstaben', () => {
    // In einem Haushalt mit Lina und Levin ist ein einzelnes «L» auf
    // zwei Bildern nebeneinander keine Unterscheidung.
    expect(initialen('Oma Meier')).toBe('OM');
    expect(initialen('Levin')).toBe('L');
    expect(initialen('  ')).toBe('?');
  });
});

describe('farbIndex', () => {
  it('hängt am Namen und nicht an der Position', () => {
    // Sonst wechselte die Farbe einer Person, sobald jemand vor ihr
    // dazukommt - und man erkennt sie am Fleck, bevor man liest.
    expect(farbIndex('Lina', 4)).toBe(farbIndex('Lina', 4));
    expect(farbIndex('', 0)).toBe(0);
    expect(farbIndex('Levin', 4)).toBeLessThan(4);
  });
});

describe('rolleZeile', () => {
  it('sagt bei jedem, was er ist', () => {
    expect(rolleZeile(wer({ shared: true }), 'Mitbewohner')).toBe('Wandgerät');
    expect(rolleZeile(wer({ role: 'kind', ohneZugang: true }), '')).toBe('Kind, ohne Zugang');
    expect(rolleZeile(wer({ role: 'erwachsen', ohneZugang: true }), '')).toBe('Ohne Zugang');
    expect(rolleZeile(wer({ role: 'besitzer' }), 'Besitzer')).toBe('Besitzer');
  });
});
