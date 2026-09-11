/** Woher eine Lampe im Ablauf ihre Helligkeit nimmt. */
import { Entity } from '../api/types';
import {
  NACH_RAUM,
  NACH_TAGESZEIT,
  UNVERAENDERT,
  chipWahl,
  chipWert,
  helligkeitsOptionen,
  helligkeitsQuellen,
  helligkeitsStufen,
  misstLux,
  quelleVon,
  raumHatLux,
} from './helligkeitsvorgabe';

const geraet = (patch: Partial<Entity>): Entity =>
  ({
    id: 'x',
    kind: 'sensor',
    name: 'X',
    integration: 'demo',
    state: {},
    commands: [],
    available: true,
    ...patch,
  }) as Entity;

describe('misstLux', () => {
  it('nimmt nur echte Messwerte', () => {
    expect(misstLux(geraet({ state: { illumination: 12 } }))).toBe(true);
    expect(misstLux(geraet({ state: { illumination: 0 } }))).toBe(true);
    expect(misstLux(geraet({ state: {} }))).toBe(false);
    expect(misstLux(geraet({ state: { illumination: 'hell' } }))).toBe(false);
  });
});

describe('raumHatLux', () => {
  const lampe = geraet({ id: 'hue.stube', kind: 'light', room: 'Stube' });

  it('fragt den Raum der Lampe', () => {
    const alle = [lampe, geraet({ id: 'm1', room: 'Stube', state: { illumination: 5 } })];
    expect(raumHatLux(alle, lampe)).toBe(true);
  });

  it('lässt einen Fühler zwei Zimmer weiter nicht gelten', () => {
    const alle = [lampe, geraet({ id: 'm1', room: 'Bad', state: { illumination: 5 } })];
    expect(raumHatLux(alle, lampe)).toBe(false);
  });

  it('sagt nein, wenn die Lampe gar keinen Raum hat', () => {
    expect(raumHatLux([], geraet({ id: 'hue.x', kind: 'light' }))).toBe(false);
  });
});

describe('quelleVon und chipWert', () => {
  it('erkennt alle drei Fälle', () => {
    expect(quelleVon({ adaptive: true })).toBe('raum');
    expect(quelleVon({ nachTageszeit: true })).toBe('tageszeit');
    expect(quelleVon({})).toBe('zahl');
    expect(chipWert({ adaptive: true })).toBe(NACH_RAUM);
    expect(chipWert({ nachTageszeit: true })).toBe(NACH_TAGESZEIT);
    expect(chipWert({ brightness: 25 })).toBe('25');
    expect(chipWert({})).toBe('50');
  });
});

describe('chipWahl', () => {
  it('lässt immer nur eine Quelle stehen', () => {
    // Sonst gewänne beim Speichern die alte Wahl gegen die neue Zahl.
    expect(chipWahl(NACH_RAUM)).toEqual({ adaptive: true, nachTageszeit: undefined });
    expect(chipWahl(NACH_TAGESZEIT)).toEqual({
      adaptive: undefined,
      nachTageszeit: true,
    });
    expect(chipWahl('75')).toEqual({
      adaptive: undefined,
      nachTageszeit: undefined,
      brightness: 75,
    });
  });
});

describe('helligkeitsOptionen', () => {
  it('bietet die Uhr immer an, den Raum nur mit Fühler', () => {
    const ohne = helligkeitsOptionen(false).map((o) => o.key);
    expect(ohne).not.toContain(NACH_RAUM);
    expect(ohne).toContain(NACH_TAGESZEIT);
    expect(helligkeitsOptionen(true).map((o) => o.key)).toContain(NACH_RAUM);
  });
});

describe('Helligkeit beim Umschalten', () => {
  it('lässt sie weg, wenn niemand eine gewählt hat', () => {
    // Ein Taster, der die Lampe jedes Mal auf 50 % zwingt, nimmt einem
    // das Dimmen von Hand wieder weg. Unter «ein, gedimmt» bleibt es
    // dagegen bei einer Zahl - dort muss die Lampe eine bekommen.
    expect(chipWert({}, UNVERAENDERT)).toBe(UNVERAENDERT);
    expect(chipWert({ brightness: 20 }, UNVERAENDERT)).toBe('20');
    expect(chipWert({})).toBe('50');
  });

  it('macht aus «lassen» keine null Prozent', () => {
    // `Number('')` wäre 0 - eine Lampe, die auf null Prozent «angeht».
    expect(chipWahl(UNVERAENDERT)).toEqual({
      adaptive: undefined,
      nachTageszeit: undefined,
      brightness: undefined,
    });
  });

  it('stellt «Helligkeit lassen» nur beim Umschalten voran', () => {
    expect(helligkeitsOptionen(false, true)[0].key).toBe(UNVERAENDERT);
    expect(helligkeitsOptionen(false).map((o) => o.key)).not.toContain(UNVERAENDERT);
  });
});

// ── Zwei Fragen statt einer Reihe (Punkt 534 der Werkbank) ────────────
//
// «10 % · 25 % · 50 % · 75 % · 100 % · nach Raumhelligkeit · nach
// Tageszeit» stand als eine Reihe da. Sieben Chips passen auf kein
// Telefon in eine Zeile, und so stand «nach Tageszeit» allein in der
// zweiten - wie ein sechster Prozentwert, nur mit Worten statt Zahlen.

describe('helligkeitsStufen', () => {
  it('führt nur Zahlen, keine Quellen', () => {
    const keys = helligkeitsStufen().map((o) => o.key);
    expect(keys).toEqual(['10', '25', '50', '75', '100']);
    expect(keys).not.toContain(NACH_RAUM);
    expect(keys).not.toContain(NACH_TAGESZEIT);
  });

  it('stellt «Helligkeit lassen» voran, wo es das gibt', () => {
    expect(helligkeitsStufen(true)[0].key).toBe(UNVERAENDERT);
    expect(helligkeitsStufen().map((o) => o.key)).not.toContain(UNVERAENDERT);
  });
});

describe('helligkeitsQuellen', () => {
  it('bietet die Uhr immer an, den Raum nur mit Fühler', () => {
    // Ohne Messwert wäre «nach Raumhelligkeit» eine Attrappe; die Uhr
    // braucht kein Gerät.
    expect(helligkeitsQuellen(false).map((o) => o.key)).toEqual([NACH_TAGESZEIT]);
    expect(helligkeitsQuellen(true).map((o) => o.key)).toEqual([
      NACH_RAUM,
      NACH_TAGESZEIT,
    ]);
  });

  it('ergibt zusammen mit den Stufen wieder die alte Reihe', () => {
    // Damit die Teilung nichts verliert: Was vorher in einer Reihe
    // stand, steht jetzt in zweien - aber vollständig.
    const geteilt = [
      ...helligkeitsStufen(true).map((o) => o.key),
      ...helligkeitsQuellen(true).map((o) => o.key),
    ];
    expect(geteilt).toEqual(helligkeitsOptionen(true, true).map((o) => o.key));
  });
});
