import { dauerName, gaesteansicht, gezeigterGutschein } from './gaestewlan';

test('ohne WLAN und ohne UniFi bleibt nur der Einrichtungshinweis', () => {
  expect(gaesteansicht(false, null)).toBe('einrichten');
});

test('ein hinterlegtes Gaeste-WLAN genuegt fuer die Karte', () => {
  expect(gaesteansicht(true, null)).toBe('karte');
});

test('die UniFi-Anbindung zeigt den Spender auch mit leerem Vorrat', () => {
  // Der Fall des Hauses: kein guest_wifi, kein Passwort, nur das Portal.
  // Hier muss der erste Gutschein angelegt werden koennen.
  expect(gaesteansicht(false, [])).toBe('karte');
});

test('vorhandene Gutscheine zeigen die Karte ohnehin', () => {
  expect(gaesteansicht(false, [{ id: 'a' }])).toBe('karte');
});

describe('dauerName', () => {
  test('nennt die Woche beim Namen', () => {
    // Auf dem Knopf steht «1 Woche» - darunter soll dasselbe stehen,
    // nicht «7 Tage».
    expect(dauerName(10080)).toBe('1 Woche');
  });

  test('Tage und Stunden', () => {
    expect(dauerName(480)).toBe('8 Std.');
    expect(dauerName(1440)).toBe('1 Tag');
    expect(dauerName(4320)).toBe('3 Tage');
  });

  test('krumme Dauern bleiben Stunden', () => {
    expect(dauerName(90)).toBe('2 Std.');
  });
});

describe('gezeigterGutschein', () => {
  const vorrat = [
    { id: 'alt', used: false, created: 100 },
    { id: 'neu', used: false, created: 300 },
    { id: 'weg', used: true, created: 50 },
  ];

  test('ohne frischen Gutschein steht der aelteste offene da', () => {
    expect(gezeigterGutschein(vorrat, null)?.id).toBe('alt');
  });

  test('eingeloeste zaehlen nicht mit', () => {
    // 'weg' ist der älteste, aber schon benutzt.
    expect(gezeigterGutschein(vorrat, null)?.id).not.toBe('weg');
  });

  test('der eben angelegte draengt sich vor', () => {
    // Wer «+ 1 Woche» drückt, will genau diesen Code vorlesen - nicht
    // den älteren aus dem Vorrat.
    expect(gezeigterGutschein(vorrat, 'neu')?.id).toBe('neu');
  });

  test('ist der eben angelegte weg, rueckt der Vorrat nach', () => {
    expect(gezeigterGutschein(vorrat, 'weg')?.id).toBe('alt');
    expect(gezeigterGutschein(vorrat, 'gibtsnicht')?.id).toBe('alt');
  });

  test('leerer Vorrat ergibt nichts', () => {
    expect(gezeigterGutschein([], 'neu')).toBeNull();
    expect(gezeigterGutschein([{ id: 'a', used: true }], null)).toBeNull();
  });
});
