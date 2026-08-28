import { SHOP_CATEGORIES, Shop } from './einkauf';
import {
  LOG_MAX,
  LernEintrag,
  SITZUNGS_LUECKE,
  gelernteReihenfolge,
  istGelernt,
  merken,
  mitLernen,
  sitzungen,
  vergessen,
} from './ladenlernen';

const MIN = 60 * 1000;

/** Einen Einkauf ins Protokoll schreiben: eine Kategorie pro Minute. */
function einkauf(
  log: LernEintrag[],
  shop: string,
  kategorien: string[],
  start: number
): LernEintrag[] {
  let ergebnis = log;
  kategorien.forEach((kategorie, index) => {
    ergebnis = merken(ergebnis, shop, kategorie, start + index * MIN);
  });
  return ergebnis;
}

describe('merken', () => {
  test('ohne Laden oder unter «Allgemein» wird nichts gelernt', () => {
    expect(merken([], null, 'Getränke', 1000)).toEqual([]);
    expect(merken([], '', 'Getränke', 1000)).toEqual([]);
    expect(merken([], 'allgemein', 'Getränke', 1000)).toEqual([]);
  });

  test('unbekannte Kategorien landen unter Sonstiges', () => {
    const log = merken([], 'migros', 'Werkzeugwand', 1000);
    expect(log[0].kategorie).toBe('Sonstiges');
  });

  test('das Protokoll bleibt gedeckelt und behaelt die juengsten Eintraege', () => {
    let log: LernEintrag[] = [];
    for (let i = 0; i < LOG_MAX + 50; i += 1) {
      log = merken(log, 'migros', 'Vorrat', i * MIN);
    }
    expect(log).toHaveLength(LOG_MAX);
    expect(log[0].at).toBe(50 * MIN);
  });

  test('verspaetete Eintraege werden nach Zeit einsortiert', () => {
    let log = merken([], 'migros', 'Getränke', 5 * MIN);
    log = merken(log, 'migros', 'Vorrat', 2 * MIN);
    expect(log.map((eintrag) => eintrag.kategorie)).toEqual(['Vorrat', 'Getränke']);
  });
});

describe('vergessen', () => {
  test('ein frischer Fehlgriff verschwindet wieder aus dem Protokoll', () => {
    let log = merken([], 'migros', 'Getränke', 1000);
    log = merken(log, 'migros', 'Vorrat', 2000);
    const bereinigt = vergessen(log, 'migros', 'Vorrat', 30_000);
    expect(bereinigt.map((eintrag) => eintrag.kategorie)).toEqual(['Getränke']);
  });

  test('ein altes Abhaken bleibt stehen - das war kein Fehlgriff', () => {
    const log = merken([], 'migros', 'Getränke', 1000);
    expect(vergessen(log, 'migros', 'Getränke', 1000 + 10 * MIN)).toEqual(log);
  });
});

describe('sitzungen', () => {
  test('eine lange Pause beginnt einen neuen Einkauf', () => {
    let log = einkauf([], 'migros', ['Getränke', 'Vorrat', 'Tiefkühl'], 0);
    log = einkauf(log, 'migros', ['Vorrat'], 3 * MIN + SITZUNGS_LUECKE + MIN);
    const ergebnis = sitzungen(log, 'migros');
    expect(ergebnis).toHaveLength(2);
    expect(ergebnis[0]).toHaveLength(3);
    expect(ergebnis[1]).toHaveLength(1);
  });

  test('fremde Laeden zaehlen nicht mit', () => {
    const log = einkauf([], 'baumarkt', ['Haushalt', 'Vorrat', 'Sonstiges'], 0);
    expect(sitzungen(log, 'migros')).toEqual([]);
  });
});

describe('gelernteReihenfolge', () => {
  test('zwei gleiche Einkaeufe ergeben deren Reihenfolge', () => {
    let log = einkauf([], 'migros', ['Getränke', 'Tiefkühl', 'Früchte & Gemüse'], 0);
    log = einkauf(
      log,
      'migros',
      ['Getränke', 'Tiefkühl', 'Früchte & Gemüse'],
      24 * 60 * MIN
    );
    expect(gelernteReihenfolge(log, 'migros')).toEqual([
      'Getränke',
      'Tiefkühl',
      'Früchte & Gemüse',
    ]);
  });

  test('ein einzelner Einkauf lernt noch nichts', () => {
    const log = einkauf([], 'migros', ['Getränke', 'Tiefkühl', 'Vorrat'], 0);
    expect(gelernteReihenfolge(log, 'migros')).toEqual([]);
  });

  test('Kleinsteinkaeufe unter drei Abhaken zaehlen nicht', () => {
    let log = einkauf([], 'migros', ['Getränke', 'Vorrat'], 0);
    log = einkauf(log, 'migros', ['Getränke', 'Vorrat'], 24 * 60 * MIN);
    log = einkauf(log, 'migros', ['Getränke', 'Vorrat'], 48 * 60 * MIN);
    expect(gelernteReihenfolge(log, 'migros')).toEqual([]);
  });

  test('ein Gang aus nur einem Einkauf bekommt keine gelernte Position', () => {
    let log = einkauf([], 'migros', ['Getränke', 'Tiefkühl', 'Vorrat'], 0);
    log = einkauf(
      log,
      'migros',
      ['Getränke', 'Tiefkühl', 'Haushalt', 'Vorrat'],
      24 * 60 * MIN
    );
    const gelernt = gelernteReihenfolge(log, 'migros');
    expect(gelernt).toEqual(['Getränke', 'Tiefkühl', 'Vorrat']);
    expect(gelernt).not.toContain('Haushalt');
  });

  test('ein einzelner Umweg kippt die Mehrheit nicht', () => {
    // Dreimal Getränke zuerst, einmal andersherum - die Regel bleibt.
    let log = einkauf([], 'migros', ['Getränke', 'Vorrat', 'Tiefkühl'], 0);
    log = einkauf(log, 'migros', ['Getränke', 'Vorrat', 'Tiefkühl'], 24 * 60 * MIN);
    log = einkauf(log, 'migros', ['Getränke', 'Vorrat', 'Tiefkühl'], 48 * 60 * MIN);
    log = einkauf(log, 'migros', ['Vorrat', 'Getränke', 'Tiefkühl'], 72 * 60 * MIN);
    expect(gelernteReihenfolge(log, 'migros')).toEqual([
      'Getränke',
      'Vorrat',
      'Tiefkühl',
    ]);
  });

  test('bei Gleichstand entscheidet die Standardreihenfolge', () => {
    // Zwei Einkaeufe, die sich genau widersprechen: Mittelwert je 0.5.
    let log = einkauf([], 'migros', ['Vorrat', 'Getränke', 'Tiefkühl'], 0);
    log = einkauf(log, 'migros', ['Tiefkühl', 'Getränke', 'Vorrat'], 24 * 60 * MIN);
    const gelernt = gelernteReihenfolge(log, 'migros');
    const erwartet = ['Getränke', 'Tiefkühl', 'Vorrat'].sort(
      (a, b) => SHOP_CATEGORIES.indexOf(a) - SHOP_CATEGORIES.indexOf(b)
    );
    expect([...gelernt].sort()).toEqual([...erwartet].sort());
    // Alle drei stehen auf 0.5 - also exakt Standardreihenfolge.
    expect(gelernt).toEqual(
      SHOP_CATEGORIES.filter((name) => gelernt.includes(name))
    );
  });
});

describe('mitLernen', () => {
  const zweiEinkaeufe = () => {
    const log = einkauf([], 'migros', ['Getränke', 'Tiefkühl', 'Früchte & Gemüse'], 0);
    return einkauf(
      log,
      'migros',
      ['Getränke', 'Tiefkühl', 'Früchte & Gemüse'],
      24 * 60 * MIN
    );
  };

  test('ohne Handarbeit greift das Gelernte', () => {
    const shop: Shop = { id: 'migros', name: 'Migros' };
    const ergebnis = mitLernen(shop, zweiEinkaeufe());
    expect(ergebnis.categories).toEqual([
      'Getränke',
      'Tiefkühl',
      'Früchte & Gemüse',
    ]);
    expect(istGelernt(shop, zweiEinkaeufe())).toBe(true);
  });

  test('die Handarbeit gewinnt gegen das Gelernte', () => {
    const shop = {
      id: 'migros',
      name: 'Migros',
      categories: ['Früchte & Gemüse', 'Getränke'],
    };
    expect(mitLernen(shop, zweiEinkaeufe())).toBe(shop);
    expect(istGelernt(shop, zweiEinkaeufe())).toBe(false);
  });

  test('ohne genug Einkaeufe bleibt der Laden unveraendert', () => {
    const shop = { id: 'migros', name: 'Migros' };
    expect(mitLernen(shop, [])).toBe(shop);
    expect(istGelernt(shop, [])).toBe(false);
  });

  test('Allgemein und fehlender Laden bleiben unangetastet', () => {
    expect(mitLernen(null, zweiEinkaeufe())).toBeNull();
    const allgemein = { id: 'allgemein', name: 'Allgemein' };
    expect(mitLernen(allgemein, zweiEinkaeufe())).toBe(allgemein);
  });
});
