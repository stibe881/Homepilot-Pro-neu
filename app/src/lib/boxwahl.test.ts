import { boxLabel, boxWechsel, zielBox } from './boxwahl';

const BOXEN = ['Büro', 'Terrasse', 'Küche'];

test('die im Panel angetippte Box gewinnt', () => {
  expect(zielBox('Küche', 'Büro', 'Terrasse', BOXEN)).toBe('Küche');
});

test('der Wunsch aus dem Wähler schlägt die aktive Box', () => {
  // Der gemeldete Fall: Büro gewählt, Terrasse noch aktiv - die Musik
  // gehört ins Büro.
  expect(zielBox(null, 'Büro', 'Terrasse', BOXEN)).toBe('Büro');
});

test('der Wunsch gilt auch für die Quelle, die man erst danach wählt', () => {
  // Der ganze gemeldete Ablauf: Oben «Büro» gewählt (Spotify zieht um),
  // dann auf «Radio» getippt. Das Radio selbst war zuletzt auf der
  // Terrasse - der Wunsch aus dem Wähler muss ihn überstimmen, sonst
  // startet der Sender auf der Terrasse.
  expect(zielBox(null, 'Büro', 'Terrasse', BOXEN)).toBe('Büro');
  // Und wenn das Radio die Box gar nicht kennt, bleibt es bei seiner.
  expect(zielBox(null, 'Büro', 'Terrasse', ['Terrasse', 'Küche'])).toBe('Terrasse');
});

test('ohne Wahl gilt die aktive Box', () => {
  expect(zielBox(null, null, 'Terrasse', BOXEN)).toBe('Terrasse');
});

test('ein Wunsch auf eine verschwundene Box verdraengt nichts', () => {
  expect(zielBox(null, 'Bad', 'Terrasse', BOXEN)).toBe('Terrasse');
});

test('aus voelliger Stille die erste sichtbare', () => {
  expect(zielBox(null, null, null, BOXEN)).toBe('Büro');
  expect(zielBox(null, null, null, [])).toBeNull();
});

describe('boxWechsel', () => {
  const quelle = { id: 'spotify', kannUmziehen: true, devices: ['Büro', 'Terrasse'], spielt: true };

  it('zieht die Musik um, wenn die Quelle die Box kennt', () => {
    expect(boxWechsel(quelle, { id: 'box.buero', name: 'Büro' })).toEqual({
      art: 'umzug',
      device: 'Büro',
      play: true,
    });
  });

  it('wechselt nur die Ansicht, wenn die Quelle die Box nicht kennt', () => {
    expect(boxWechsel(quelle, { id: 'box.bad', name: 'Bad' })).toEqual({ art: 'ansicht' });
  });

  it('wechselt nur die Ansicht ohne Quelle oder auf die Quelle selbst', () => {
    expect(boxWechsel(null, { id: 'box.buero', name: 'Büro' })).toEqual({ art: 'ansicht' });
    expect(boxWechsel(quelle, { id: 'spotify', name: 'Spotify' })).toEqual({ art: 'ansicht' });
  });
});



describe('boxLabel', () => {
  it('schreibt die gewünschte Box an, solange nichts läuft', () => {
    // Der gemeldete Fall, zweite Runde: «Oben Büro gewählt, dann einen
    // Radiosender abgespielt - der Lautsprecher wechselt auf Terrasse.»
    // Läuft nichts, ist der Wunsch die Antwort auf die einzige offene
    // Frage: wo der nächste Griff spielen wird.
    expect(boxLabel(false, 'Terrasse', 'Büro')).toBe('Büro');
  });

  it('schreibt die aktive Box an, sobald etwas läuft', () => {
    // Dann ist sie die Wahrheit über das Jetzt - auch wenn jemand die
    // Musik anderswo hingezogen hat.
    expect(boxLabel(true, 'Küche', 'Büro')).toBe('Küche');
  });

  it('kommt auch mit nur einer der beiden Angaben aus', () => {
    expect(boxLabel(false, 'Terrasse', null)).toBe('Terrasse');
    expect(boxLabel(true, null, 'Büro')).toBe('Büro');
    expect(boxLabel(false, null, undefined)).toBeNull();
  });
});
