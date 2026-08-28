/**
 * Die Saugerkarte: Wer wird getroffen, wenn man auf den Gang tippt?
 *
 * Der Fall stammt aus Zell: Die Wohnung ist diagonal geschnitten, und
 * die achsenparallelen Hüllen der Zimmer überlappen sich so stark, dass
 * ein Punkt in vier davon liegt.
 */
import {
  Box,
  VacuumRoom,
  contentBox,
  inShape,
  roomAt,
  robotRoom,
  shapeInCrop,
  saugerFaehrt,
  vacuumText,
  zustandLesbar,
  zustandWort,
} from './saugerkarte';

// Gang: ein diagonaler Streifen von links oben nach rechts unten. Seine
// Hülle deckt die ganze linke Hälfte ab – auch das Bad.
const GANG: VacuumRoom = {
  id: 1,
  name: 'Gang',
  box: [0, 0, 0.5, 0.5],
  shape: [
    [0, 0, 0.2, 0.2],
    [0.2, 0.2, 0.2, 0.2],
  ],
};
const BAD: VacuumRoom = {
  id: 2,
  name: 'Bad',
  box: [0.05, 0.25, 0.18, 0.45],
  shape: [[0.05, 0.25, 0.13, 0.2]],
};

describe('roomAt mit echten Formen', () => {
  test('trifft das Zimmer, auf das man gezeigt hat', () => {
    // Der Punkt liegt in beiden Hüllen, aber nur in Bads Form.
    expect(roomAt([GANG, BAD], 0.1, 0.3)?.name).toBe('Bad');
    expect(roomAt([GANG, BAD], 0.1, 0.1)?.name).toBe('Gang');
  });

  test('daneben ist daneben – auch innerhalb der Hülle', () => {
    // In Gangs Hülle, aber in keiner Form: die Lücke der Diagonale.
    expect(roomAt([GANG, BAD], 0.45, 0.05)).toBeNull();
  });

  test('ohne Form gewinnt weiterhin die kleinste Hülle', () => {
    const gross: VacuumRoom = { id: 3, name: 'Gross', box: [0, 0, 1, 1] };
    const klein: VacuumRoom = { id: 4, name: 'Klein', box: [0.4, 0.4, 0.6, 0.6] };
    expect(roomAt([gross, klein], 0.5, 0.5)?.name).toBe('Klein');
  });

  test('eine Hülle überstimmt keine Form', () => {
    // «Gross» hat keine Form und würde sonst den Punkt beanspruchen,
    // der eindeutig in Bads Form liegt.
    const gross: VacuumRoom = { id: 3, name: 'Gross', box: [0, 0, 0.3, 0.6] };
    expect(roomAt([gross, BAD], 0.1, 0.3)?.name).toBe('Bad');
  });

  test('der Sauger steht in dem Zimmer, in dem er steht', () => {
    expect(robotRoom([GANG, BAD], [0.3, 0.3])?.name).toBe('Gang');
    expect(robotRoom([GANG, BAD], undefined)).toBeNull();
  });
});

describe('inShape', () => {
  test('kennt drinnen und draussen', () => {
    expect(inShape([[0.1, 0.1, 0.2, 0.2]], 0.2, 0.2)).toBe(true);
    expect(inShape([[0.1, 0.1, 0.2, 0.2]], 0.05, 0.2)).toBe(false);
    expect(inShape(undefined, 0.2, 0.2)).toBe(false);
  });
});

describe('shapeInCrop', () => {
  const crop: Box = [0.2, 0.2, 0.6, 0.6];

  test('rechnet auf den Ausschnitt um', () => {
    // Ein Rechteck, das die rechte untere Ecke des Ausschnitts füllt.
    const [teil] = shapeInCrop([[0.4, 0.4, 0.2, 0.2]], crop);
    expect(teil[0]).toBeCloseTo(0.5);
    expect(teil[1]).toBeCloseTo(0.5);
    expect(teil[2]).toBeCloseTo(0.5);
    expect(teil[3]).toBeCloseTo(0.5);
  });

  test('lässt weg, was ausserhalb liegt', () => {
    expect(shapeInCrop([[0.7, 0.7, 0.1, 0.1]], crop)).toEqual([]);
  });

  test('ohne Form nichts zu zeichnen', () => {
    expect(shapeInCrop(undefined, crop)).toEqual([]);
  });
});

test('contentBox umschliesst alle Zimmer mit Rand', () => {
  const box = contentBox([GANG, BAD], 0.05);
  expect(box).toEqual([0, 0, 0.55, 0.55]);
});

test('vacuumText sagt Zustand und Akku', () => {
  const sauger = { state: { state: 'cleaning', battery: 82 } } as never;
  expect(vacuumText(sauger)).toBe('Reinigt · 82 %');
});

test('vacuumText schreibt nie einen Bezeichner auf die Kachel', () => {
  // Der Fall aus dem Haus: «segment_cleaning · 87 %» stand da.
  const sauger = { state: { state: 'segment_cleaning', battery: 87 } } as never;
  expect(vacuumText(sauger)).toBe('Reinigt · 87 %');
});

test('vacuumText kennt die Arbeit an der Station', () => {
  const sauger = { state: { state: 'washing_the_mop', battery: 100 } } as never;
  expect(vacuumText(sauger)).toBe('Wäscht den Mopp · 100 %');
});

test('ein unbekannter Zustand wird wenigstens zu Wörtern', () => {
  // Lieber ein englisches Wort mit grossem Anfangsbuchstaben als ein
  // Unterstrich in der Wohnung.
  expect(zustandLesbar('egg_attack')).toBe('Egg attack');
  expect(zustandLesbar('')).toBe('–');
});

test('zustandWort gibt den Zustand ohne Akku', () => {
  expect(zustandWort('returning_home')).toBe('Fährt zur Station');
  expect(zustandWort('idle')).toBe('Bereit');
});

test('saugerFaehrt erkennt jede Art von Reinigen', () => {
  // Sonst bot der Knopf «Reinigen» an, während sie reinigte.
  expect(saugerFaehrt('cleaning')).toBe(true);
  expect(saugerFaehrt('segment_cleaning')).toBe(true);
  expect(saugerFaehrt('returning')).toBe(true);
  expect(saugerFaehrt('charging')).toBe(false);
  expect(saugerFaehrt('idle')).toBe(false);
  expect(saugerFaehrt(undefined)).toBe(false);
});
