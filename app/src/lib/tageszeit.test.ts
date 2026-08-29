import {
  ABSCHNITTE,
  abschnittFuer,
  hinweis,
  jetzigerAbschnitt,
  lohntSich,
  nachTageszeit,
} from './tageszeit';

describe('abschnittFuer', () => {
  it('trifft die vier Abschnitte', () => {
    expect(abschnittFuer(7).key).toBe('morgen');
    expect(abschnittFuer(12).key).toBe('tag');
    expect(abschnittFuer(19).key).toBe('abend');
    expect(abschnittFuer(23).key).toBe('nacht');
  });

  it('rechnet die frühen Stunden zur Nacht davor', () => {
    // Um zwei Uhr ist nicht Morgen.
    expect(abschnittFuer(2).key).toBe('nacht');
    expect(abschnittFuer(0).key).toBe('nacht');
  });

  it('verträgt Unsinn, statt undefined zurückzugeben', () => {
    expect(abschnittFuer(-5).key).toBe('nacht');
    expect(abschnittFuer(99).key).toBe('nacht');
  });
});

describe('jetzigerAbschnitt', () => {
  it('nimmt die Stunde der Ortszeit', () => {
    const abends = new Date('2026-08-27T19:30:00').getTime();
    expect(jetzigerAbschnitt(abends).key).toBe('abend');
  });
});

describe('nachTageszeit', () => {
  const geraete = [
    { id: 'a', kind: 'light' },
    { id: 'b', kind: 'cover' },
    { id: 'c', kind: 'media_player' },
    { id: 'd', kind: 'camera' },
    { id: 'e', kind: 'light' },
  ];

  it('holt morgens die Storen nach vorne', () => {
    const sortiert = nachTageszeit(geraete, ABSCHNITTE[0]);
    expect(sortiert[0].id).toBe('b');
  });

  it('holt abends das Licht nach vorne', () => {
    const sortiert = nachTageszeit(geraete, ABSCHNITTE[2]);
    expect(sortiert[0].id).toBe('a');
  });

  it('behält innerhalb einer Art die gezogene Reihenfolge', () => {
    // Wer seine Kacheln gezogen hat, findet sie in derselben Abfolge
    // wieder - nur die Blöcke stehen anders.
    const sortiert = nachTageszeit(geraete, ABSCHNITTE[2]);
    const lichter = sortiert.filter((g) => g.kind === 'light').map((g) => g.id);
    expect(lichter).toEqual(['a', 'e']);
  });

  it('lässt nichts verschwinden', () => {
    const sortiert = nachTageszeit(geraete, ABSCHNITTE[0]);
    expect(sortiert).toHaveLength(geraete.length);
    // Was der Abschnitt nicht nennt, hängt hinten an.
    expect(sortiert[sortiert.length - 1].id).toBe('d');
  });
});

describe('lohntSich', () => {
  it('sortiert nur, wo es etwas zu sortieren gibt', () => {
    // Eine Seite mit lauter Lampen sieht danach genauso aus.
    expect(lohntSich([{ kind: 'light' }, { kind: 'light' }])).toBe(false);
    expect(lohntSich([{ kind: 'light' }, { kind: 'cover' }])).toBe(false);
    expect(
      lohntSich([
        { kind: 'light' },
        { kind: 'cover' },
        { kind: 'switch' },
        { kind: 'lock' },
      ]),
    ).toBe(true);
  });
});

describe('hinweis', () => {
  it('sagt in einem Satz, was gerade vorne steht', () => {
    expect(hinweis(ABSCHNITTE[0])).toContain('Morgen');
    expect(hinweis(ABSCHNITTE[0])).toContain('Storen');
  });
});
