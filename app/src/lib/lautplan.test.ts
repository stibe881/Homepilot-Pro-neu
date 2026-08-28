import {
  boxAn,
  boxenSatz,
  boxenUmschalten,
  freieBoxen,
  geordnet,
  minuten,
  neueStufe,
  planBoxen,
  stufeJetzt,
  stufenSatz,
  uhrzeit,
  vorauswahl,
} from './lautplan';

const STUFEN = [
  { at: '07:00', volume: 20 },
  { at: '10:00', volume: 70 },
  { at: '20:00', volume: 20 },
  { at: '23:45', volume: 10 },
];

const um = (hhmm: string) => minuten(hhmm) as number;

describe('minuten / uhrzeit', () => {
  it('rechnet hin und zurück', () => {
    expect(minuten('07:00')).toBe(420);
    expect(uhrzeit(420)).toBe('07:00');
  });

  it('weist Unsinn ab', () => {
    expect(minuten('25:00')).toBeNull();
    expect(minuten('7')).toBeNull();
    expect(minuten('07:70')).toBeNull();
  });

  it('füllt einstellige Stunden auf', () => {
    expect(uhrzeit(65)).toBe('01:05');
  });
});

describe('stufeJetzt', () => {
  it('hält die Morgenstufe bis zur Tagstufe', () => {
    expect(stufeJetzt(STUFEN, um('08:30'))?.volume).toBe(20);
  });

  it('schaltet auf die Minute genau', () => {
    expect(stufeJetzt(STUFEN, um('10:00'))?.volume).toBe(70);
  });

  it('trägt die letzte Stufe über Mitternacht', () => {
    // Sonst wäre die Nacht ein Loch im Plan - und genau dort liegt sie.
    expect(stufeJetzt(STUFEN, um('02:00'))?.volume).toBe(10);
  });

  it('liest auch einen unsortierten Plan richtig', () => {
    expect(stufeJetzt([...STUFEN].reverse(), um('12:00'))?.volume).toBe(70);
  });

  it('sagt nichts ohne Stufen', () => {
    expect(stufeJetzt([], um('12:00'))).toBeNull();
  });
});

describe('geordnet', () => {
  it('sortiert und wirft Vertipper zusammen', () => {
    const liste = geordnet([
      { at: '10:00', volume: 70 },
      { at: '7:00', volume: 20 },
      { at: '07:00', volume: 25 },
    ]);
    expect(liste).toEqual([
      { at: '07:00', volume: 25 },
      { at: '10:00', volume: 70 },
    ]);
  });
});

describe('stufenSatz', () => {
  it('nennt das Bis', () => {
    expect(stufenSatz(STUFEN, 1)).toBe('70 % – bis 20:00');
  });

  it('schliesst über Mitternacht zur ersten Stufe', () => {
    expect(stufenSatz(STUFEN, 3)).toBe('10 % – bis 07:00');
  });

  it('sagt bei einer einzigen Stufe, dass sie durchgilt', () => {
    expect(stufenSatz([{ at: '07:00', volume: 20 }], 0)).toBe('20 % – den ganzen Tag');
  });
});

describe('neueStufe', () => {
  it('legt sich in die grösste Lücke', () => {
    // 10:00 bis 20:00 sind zehn Stunden - die Mitte ist 15:00.
    expect(neueStufe(STUFEN).at).toBe('15:00');
  });

  it('rechnet die Lücke über Mitternacht mit', () => {
    const zwei = [
      { at: '08:00', volume: 20 },
      { at: '09:00', volume: 70 },
    ];
    // Von 09:00 bis 08:00 sind 23 Stunden; die Mitte liegt um 20:30.
    expect(neueStufe(zwei).at).toBe('20:30');
  });

  it('schlägt bei leerem Plan etwas Brauchbares vor', () => {
    expect(neueStufe([])).toEqual({ at: '07:00', volume: 30 });
  });
});

describe('boxenUmschalten', () => {
  const ALLE = ['cast.bad', 'cast.buero'];

  it('schreibt «alle» erst aus und nimmt dann heraus', () => {
    // Hier stand einmal «der erste Tipp heisst: nur diese» - eine
    // Abkürzung, die man nicht sieht.
    expect(boxenUmschalten([], 'cast.bad', ALLE)).toEqual(['cast.buero']);
    expect(boxenUmschalten(undefined, 'cast.bad', ALLE)).toEqual(['cast.buero']);
  });

  it('nimmt den Fernseher zusätzlich dazu', () => {
    // Wer ihn dazunimmt, meint ihn zusätzlich - nicht statt aller anderen.
    expect(boxenUmschalten([], 'cast.tv', ALLE)).toEqual([
      'cast.bad',
      'cast.buero',
      'cast.tv',
    ]);
  });

  it('nimmt eine weitere dazu', () => {
    expect(boxenUmschalten(['cast.bad'], 'cast.buero', ALLE)).toEqual([
      'cast.bad',
      'cast.buero',
    ]);
  });

  it('nimmt eine wieder heraus', () => {
    expect(boxenUmschalten(['cast.bad', 'cast.buero'], 'cast.bad', ALLE)).toEqual([
      'cast.buero',
    ]);
  });

  it('lässt sich nicht leeren', () => {
    // Ein Plan ohne Box hat keinen Adressaten; wer ihn nicht mehr will,
    // löscht ihn.
    expect(boxenUmschalten(['cast.bad'], 'cast.bad', ALLE)).toEqual(['cast.bad']);
  });
});

describe('boxAn', () => {
  it('bei leerer Liste ist jede Box dabei', () => {
    expect(boxAn([], 'cast.bad')).toBe(true);
    expect(boxAn(undefined, 'cast.bad')).toBe(true);
  });

  it('ein Fernseher aber nicht', () => {
    // Sonst zeigte sich sein Chip als ausgewählt, während der Hub ihn
    // gar nicht anfasst.
    expect(boxAn([], 'cast.tv', true)).toBe(false);
  });

  it('sonst zählt nur die Liste', () => {
    expect(boxAn(['cast.tv'], 'cast.tv', true)).toBe(true);
    expect(boxAn(['cast.bad'], 'cast.buero')).toBe(false);
  });
});

describe('boxenSatz', () => {
  const NAMEN = {
    'cast.bad': 'Nest Badezimmer',
    'cast.buero': 'Büro',
    'cast.gang': 'Nest Gang',
  };

  it('nennt die leere Auswahl beim Namen', () => {
    expect(boxenSatz([], NAMEN)).toBe('Alle Boxen');
  });

  it('nennt eine und zwei aus', () => {
    expect(boxenSatz(['cast.bad'], NAMEN)).toBe('Nest Badezimmer');
    expect(boxenSatz(['cast.bad', 'cast.buero'], NAMEN)).toBe(
      'Nest Badezimmer und Büro',
    );
  });

  it('zählt ab drei', () => {
    // Elf Boxennamen in einer Überschrift liest niemand.
    expect(boxenSatz(['cast.bad', 'cast.buero', 'cast.gang'], NAMEN)).toBe(
      'Nest Badezimmer und 2 weitere',
    );
  });

  it('nimmt die Kennung, wenn der Name fehlt', () => {
    expect(boxenSatz(['cast.weg'], NAMEN)).toBe('cast.weg');
  });
});

describe('freieBoxen', () => {
  const ALLE = ['cast.bad', 'cast.buero', 'cast.gang'];

  it('lässt übrig, was noch kein Plan hat', () => {
    const plaene = [{ entities: ['cast.bad'], steps: [] }];
    expect(freieBoxen(plaene, ALLE)).toEqual(['cast.buero', 'cast.gang']);
  });

  it('gibt nichts frei, wenn ein Plan schon alle abdeckt', () => {
    // Zwei Pläne für dieselbe Box wären ein Widerspruch.
    expect(freieBoxen([{ entities: [], steps: [] }], ALLE)).toEqual([]);
  });

  it('ohne Pläne ist alles frei', () => {
    expect(freieBoxen([], ALLE)).toEqual(ALLE);
  });
});

describe('planBoxen', () => {
  const geraet = (
    id: string,
    name: string,
    state: Record<string, unknown> = {},
    commands = ['set_volume'],
  ) => ({ id, name, kind: 'media_player', available: true, commands, state });

  it('nimmt alles auf, was eine Lautstärke annimmt', () => {
    // Genau das lag auseinander: Der Hub stellte Gruppen mit, die App
    // bot sie nicht zur Wahl an.
    const liste = planBoxen([
      geraet('cast.bad', 'Nest Badezimmer'),
      geraet('cast.haus', 'Haus', { is_group: true }),
      geraet('cast.tv', 'Fernseher', { has_screen: true }),
    ]);
    expect(liste.map((b) => b.id)).toEqual(['cast.bad', 'cast.haus', 'cast.tv']);
  });

  it('markiert Gruppen und Fernseher', () => {
    const liste = planBoxen([
      geraet('cast.haus', 'Haus', { is_group: true }),
      geraet('cast.tv', 'Fernseher', { has_screen: true }),
    ]);
    expect(liste.find((b) => b.id === 'cast.haus')?.gruppe).toBe(true);
    expect(liste.find((b) => b.id === 'cast.tv')?.bildschirm).toBe(true);
  });

  it('sortiert Boxen vor Gruppen vor Fernsehern', () => {
    // Je seltener gemeint, desto weiter hinten.
    const liste = planBoxen([
      geraet('cast.tv', 'Aaa Fernseher', { has_screen: true }),
      geraet('cast.haus', 'Bbb Haus', { is_group: true }),
      geraet('cast.zzz', 'Zzz Box'),
    ]);
    expect(liste.map((b) => b.id)).toEqual(['cast.zzz', 'cast.haus', 'cast.tv']);
  });

  it('lässt weg, was keine Lautstärke kann oder nicht da ist', () => {
    const liste = planBoxen([
      geraet('demo.klingel', 'Klingel', {}, ['play']),
      { ...geraet('cast.weg', 'Weg'), available: false },
      { ...geraet('licht.kueche', 'Licht'), kind: 'light' },
    ]);
    expect(liste).toEqual([]);
  });
});

describe('vorauswahl', () => {
  it('nimmt Boxen und Gruppen, aber keine Fernseher', () => {
    // Das ist genau das, was der Plan bisher ohnehin gestellt hat.
    const boxen = planBoxen([
      { id: 'cast.bad', name: 'Bad', kind: 'media_player', available: true, commands: ['set_volume'], state: {} },
      { id: 'cast.haus', name: 'Haus', kind: 'media_player', available: true, commands: ['set_volume'], state: { is_group: true } },
      { id: 'cast.tv', name: 'TV', kind: 'media_player', available: true, commands: ['set_volume'], state: { has_screen: true } },
    ]);
    expect(vorauswahl(boxen)).toEqual(['cast.bad', 'cast.haus']);
  });
});
