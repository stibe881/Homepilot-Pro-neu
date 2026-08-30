import {
  ZUHAUSE,
  anwesenheitSatz,
  anwesenheitsPersonen,
  ausTrigger,
  istOrtsmelder,
  ortsSatz,
  ortsWort,
  ortsauswahl,
  zuTrigger,
} from './ortsausloeser';

test('zuhause ankommen bleibt to:home', () => {
  expect(zuTrigger({ ort: ZUHAUSE, richtung: 'an' })).toEqual({ to: 'home' });
});

test('zuhause weggehen bleibt to:away', () => {
  // Nur mit Zielzustand kann der Hub ein «bleibt 10 Min. so» nachpruefen.
  expect(zuTrigger({ ort: ZUHAUSE, richtung: 'weg' })).toEqual({ to: 'away' });
});

test('an einem benannten Ort ankommen ist der Ort als Zielzustand', () => {
  expect(zuTrigger({ ort: 'schule', richtung: 'an' })).toEqual({ to: 'schule' });
});

test('einen benannten Ort verlassen geht ueber from', () => {
  // Was danach kommt, weiss man vorher nicht: unterwegs, oder schon der
  // naechste Ort.
  expect(zuTrigger({ ort: 'schule', richtung: 'weg' })).toEqual({ from: 'schule' });
});

test('ohne Ort gilt das Zuhause', () => {
  expect(zuTrigger({ ort: '', richtung: 'an' })).toEqual({ to: 'home' });
});

test('alte Ablaeufe lesen sich unveraendert', () => {
  // Ein Ablauf, der vor den Orten entstanden ist, muss im Editor
  // weiterhin als «Zuhause» dastehen.
  expect(ausTrigger({ to: 'home' })).toEqual({ ort: ZUHAUSE, richtung: 'an' });
  expect(ausTrigger({ to: 'away' })).toEqual({ ort: ZUHAUSE, richtung: 'weg' });
});

test('ein Ortsausloeser liest sich wieder als derselbe Ort', () => {
  for (const wahl of [
    { ort: ZUHAUSE, richtung: 'an' as const },
    { ort: ZUHAUSE, richtung: 'weg' as const },
    { ort: 'schule', richtung: 'an' as const },
    { ort: 'schule', richtung: 'weg' as const },
  ]) {
    expect(ausTrigger(zuTrigger(wahl))).toEqual(wahl);
  }
});

test('ein leerer Ausloeser faellt auf zuhause zurueck', () => {
  expect(ausTrigger({})).toEqual({ ort: ZUHAUSE, richtung: 'an' });
});

test('die Auswahl fuehrt zuhause zuoberst und den Rest alphabetisch', () => {
  const auswahl = ortsauswahl([
    { id: 'quartier', name: 'Quartier' },
    { id: 'schule', name: 'Schule' },
    { id: 'home', name: 'Zuhause' },
    { id: 'arbeit', name: 'Arbeit' },
  ]);
  expect(auswahl.map((e) => e.key)).toEqual(['home', 'arbeit', 'quartier', 'schule']);
});

test('ein Ort ohne Namen zeigt seine Kennung', () => {
  expect(ortsauswahl([{ id: 'tanners_home' }])[1]).toEqual({
    key: 'tanners_home',
    label: 'tanners_home',
  });
});

test('der Ablauf-Satz nennt Person und Ort', () => {
  expect(ortsSatz('Stefan', { to: 'home' })).toBe('Stefan kommt heim');
  expect(ortsSatz('Stefan', { to: 'away' })).toBe('Stefan geht weg');
  expect(ortsSatz('Livia', { to: 'schule_zell' })).toBe('Livia kommt bei Schule Zell an');
  expect(ortsSatz('Livia', { from: 'schule_zell' })).toBe('Livia verlässt Schule Zell');
});

test('aus einer Kennung wird wieder ein Wort', () => {
  expect(ortsWort('tanners_home')).toBe('Tanners Home');
  expect(ortsWort('')).toBe('');
});

test('die Sammelanwesenheit ist keine Person an einem Ort', () => {
  // Der gemeldete Fall: Sie stand in der Auswahl unter «Ort», und der
  // Satz las sich «Wenn Jemand zuhause kommt bei Off an seit 10 Min».
  // Gespeichert war der Ablauf richtig - nur Auswahl und Satz
  // behaupteten etwas anderes.
  expect(istOrtsmelder('geofence.stefan')).toBe(true);
  expect(istOrtsmelder('geofence.anyone_home')).toBe(false);
  expect(istOrtsmelder('light.kueche')).toBe(false);
  expect(istOrtsmelder(undefined)).toBe(false);
});

test('die Sammelanwesenheit sagt, was sie meint', () => {
  // «Jemand zuhause → off» stimmt zwar, beantwortet aber nicht die
  // Frage, die man beim Lesen stellt.
  expect(anwesenheitSatz('off')).toBe('niemand mehr zuhause ist');
  expect(anwesenheitSatz('on')).toBe('jemand zuhause ist');
});

describe('anwesenheitsPersonen', () => {
  const zone = (id: string, name: string) => ({ id, name });

  it('macht aus der Entität die Kennung, die der Hub kennt', () => {
    expect(
      anwesenheitsPersonen([zone('geofence.levin', 'Levin')])
    ).toEqual([{ zone: 'levin', name: 'Levin' }]);
  });

  it('lässt die Sammelfrage weg', () => {
    // «Jemand zuhause» ist keine Person und lässt sich nicht melden.
    expect(
      anwesenheitsPersonen([
        zone('geofence.anyone_home', 'Jemand zuhause'),
        zone('geofence.lina', 'Lina'),
      ]).map((eintrag) => eintrag.zone)
    ).toEqual(['lina']);
  });

  it('lässt alles ausserhalb des Geofence weg', () => {
    expect(anwesenheitsPersonen([zone('hue.decke', 'Decke')])).toEqual([]);
  });
});
