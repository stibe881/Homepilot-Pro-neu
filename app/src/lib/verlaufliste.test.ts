import {
  dauerText,
  tagTitel,
  verlaufAbschnitte,
  zeilenText,
  zustandName,
} from './verlaufliste';

const HEUTE = new Date('2026-08-27T14:00:00').getTime();

describe('zustandName', () => {
  it('kennt die Zustände, die im Haus vorkommen', () => {
    expect(zustandName('on')).toBe('Eingeschaltet');
    expect(zustandName('closed')).toBe('Geschlossen');
    expect(zustandName('unlatched')).toBe('Aufgezogen');
    expect(zustandName('cleaning')).toBe('Saugt');
    expect(zustandName('triggered')).toBe('Ausgelöst');
  });

  it('zeigt Unbekanntes im Klartext statt es zu verschlucken', () => {
    // Ein Zustand, den die App nicht kennt, ist immer noch eine Auskunft.
    expect(zustandName('quatsch')).toBe('quatsch');
    expect(zustandName(null)).toBe('–');
  });
});

describe('dauerText', () => {
  it('wählt die Einheit, in der man denkt', () => {
    expect(dauerText(40)).toBe('40 Sek.');
    expect(dauerText(720)).toBe('12 Min.');
    expect(dauerText(3600)).toBe('1 Std.');
    expect(dauerText(12000)).toBe('3 Std. 20 Min.');
    expect(dauerText(90000)).toBe('1 T. 1 Std.');
  });

  it('sagt nichts, wo es nichts zu sagen gibt', () => {
    // Der jüngste Eintrag dauert noch an - eine Zahl dafür wäre eine
    // Behauptung über die Zukunft.
    expect(dauerText(null)).toBe('');
    expect(dauerText(-5)).toBe('');
  });
});

describe('tagTitel', () => {
  it('nennt heute und gestern beim Namen', () => {
    expect(tagTitel(HEUTE / 1000, HEUTE)).toBe('Heute');
    expect(tagTitel((HEUTE - 86400000) / 1000, HEUTE)).toBe('Gestern');
  });

  it('nennt ältere Tage mit Datum', () => {
    const titel = tagTitel((HEUTE - 3 * 86400000) / 1000, HEUTE);
    expect(titel).not.toBe('Heute');
    expect(titel).not.toBe('Gestern');
    expect(titel.length).toBeGreaterThan(0);
  });
});

describe('verlaufAbschnitte', () => {
  const sek = (ms: number) => ms / 1000;

  it('teilt nach Tagen und rechnet die Dauer', () => {
    const abschnitte = verlaufAbschnitte(
      [
        { state: 'off', at: sek(HEUTE - 1000) },
        { state: 'on', at: sek(HEUTE - 3601000) },
        { state: 'off', at: sek(HEUTE - 86400000) },
      ],
      HEUTE,
    );
    expect(abschnitte.map((a) => a.titel)).toEqual(['Heute', 'Gestern']);
    // «an» hielt eine Stunde, bis es ausging.
    expect(abschnitte[0].zeilen[1].dauer).toBe(3600);
    // Der jüngste dauert noch an.
    expect(abschnitte[0].zeilen[0].dauer).toBeNull();
  });

  it('macht aus nichts keine leeren Abschnitte', () => {
    expect(verlaufAbschnitte([], HEUTE)).toEqual([]);
  });

  it('verträgt Zeitstempel, die nicht der Reihe nach kommen', () => {
    // Zwei Ereignisse in derselben Sekunde ergeben keine negative Dauer.
    const abschnitte = verlaufAbschnitte(
      [
        { state: 'on', at: sek(HEUTE) },
        { state: 'off', at: sek(HEUTE + 5000) },
      ],
      HEUTE,
    );
    expect(abschnitte[0].zeilen[1].dauer).toBe(0);
  });
});

describe('zeilenText', () => {
  it('setzt Detail, Dauer und Quelle in eine Zeile', () => {
    expect(
      zeilenText({ state: 'open', at: 0, dauer: 3600, detail: 'auf 40 %' }, 'Stefan'),
    ).toBe('auf 40 % · 1 Std. lang · Stefan');
  });

  it('lässt weg, was fehlt', () => {
    expect(zeilenText({ state: 'on', at: 0, dauer: null }, 'am Gerät / von aussen')).toBe(
      'am Gerät / von aussen',
    );
  });
});
