import { griffSatz, rueckangebot } from './rueckgriff';

const einkauf = { name: 'Milch' };
const griff = { count: 12 };
const befehl = { name: 'Stehlampe', label: 'ausgeschaltet' };

test('ein fehlgeschlagener Befehl hat nichts hinterlassen, was man zurücknimmt', () => {
  expect(rueckangebot({ fehler: true, einkauf, griff, befehl })).toEqual({
    quelle: null,
    what: null,
  });
});

test('das Abhaken im Laden geht vor – dort tippt man daneben', () => {
  const angebot = rueckangebot({ fehler: false, einkauf, griff, befehl });
  expect(angebot.quelle).toBe('einkauf');
  expect(angebot.what).toEqual({ name: 'Milch', label: 'abgehakt' });
});

test('der grosse Griff geht der einzelnen Schaltung vor', () => {
  const angebot = rueckangebot({ fehler: false, einkauf: null, griff, befehl });
  expect(angebot.quelle).toBe('griff');
  expect(angebot.what).toEqual({ name: '12 Geräte', label: 'ausgeschaltet' });
});

test('ohne Griff bleibt die letzte Schaltung', () => {
  expect(rueckangebot({ fehler: false, einkauf: null, griff: null, befehl })).toEqual({
    quelle: 'befehl',
    what: befehl,
  });
});

test('ohne alles gibt es nichts anzubieten', () => {
  expect(
    rueckangebot({ fehler: false, einkauf: null, griff: null, befehl: null })
  ).toEqual({ quelle: null, what: null });
});

test('ein einzelnes Gerät wird nicht in der Mehrzahl gemeldet', () => {
  expect(griffSatz(1).name).toBe('1 Gerät');
});
