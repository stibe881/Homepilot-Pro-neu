/**
 * Die eigenen Abläufe, die eine Nachricht verschicken.
 *
 * Der Fall dahinter: Unter «Abläufe → Push» standen nur die eingebauten
 * Wächter-Nachrichten. Ein selbst gebauter «melde mir die zu warme
 * Gefriertruhe» fehlte dort – obwohl er genau das tut.
 */
import {
  PushAblauf,
  gehoertZuPush,
  istPushKategorie,
  pushAblaeufe,
  pushBeschreibung,
  pushSchritte,
  sendetPush,
} from './pushablaeufe';

const ablauf = (over: Partial<PushAblauf> = {}): PushAblauf => ({
  id: 'app_1',
  alias: 'Gefriertruhe',
  actions: [],
  ...over,
});

describe('sendetPush', () => {
  it('erkennt den Ablauf mit einer Nachricht', () => {
    expect(
      sendetPush(ablauf({ actions: [{ type: 'notify', title: 'Zu warm' }] }))
    ).toBe(true);
  });

  it('zählt eine Durchsage nicht als Push', () => {
    expect(
      sendetPush(ablauf({ actions: [{ type: 'broadcast', text: 'Essen ist fertig' }] }))
    ).toBe(false);
  });

  it('findet die Nachricht auch im sonst-Zweig', () => {
    expect(
      sendetPush(
        ablauf({
          actions: [{ type: 'scene', scene: 'kino' }],
          otherwise: [{ type: 'notify', title: 'Ging nicht' }],
        })
      )
    ).toBe(true);
  });

  it('bleibt bei einem Ablauf ohne Aktionen ruhig', () => {
    expect(sendetPush(ablauf({ actions: undefined }))).toBe(false);
  });
});

describe('pushAblaeufe', () => {
  it('nimmt nur die meldenden mit und behält die Reihenfolge', () => {
    const liste = [
      ablauf({ id: 'a', actions: [{ type: 'command', entity_id: 'hue.x' }] }),
      ablauf({ id: 'b', actions: [{ type: 'notify', title: 'Zwei' }] }),
      ablauf({ id: 'c', actions: [{ type: 'notify', title: 'Drei' }] }),
    ];
    expect(pushAblaeufe(liste).map((entry) => entry.id)).toEqual(['b', 'c']);
  });

  it('verträgt die noch nicht geladene Liste', () => {
    expect(pushAblaeufe(null)).toEqual([]);
  });
});

describe('pushSchritte', () => {
  it('sammelt Aktionen und sonst-Zweig zusammen', () => {
    expect(
      pushSchritte(
        ablauf({
          actions: [{ type: 'notify', title: 'Eins' }, { type: 'delay', seconds: 5 }],
          otherwise: [{ type: 'notify', title: 'Zwei' }],
        })
      )
    ).toHaveLength(2);
  });
});

describe('pushBeschreibung', () => {
  it('nennt Titel und Empfänger', () => {
    expect(
      pushBeschreibung(
        ablauf({ actions: [{ type: 'notify', title: 'Zu warm', to: 'Stefan' }] })
      )
    ).toBe('Meldet «Zu warm» an Stefan.');
  });

  it('macht aus «all» wieder «alle»', () => {
    expect(
      pushBeschreibung(ablauf({ actions: [{ type: 'notify', title: 'Zu warm', to: 'all' }] }))
    ).toBe('Meldet «Zu warm» an alle.');
  });

  it('nimmt den Text, wenn der Titel fehlt', () => {
    expect(
      pushBeschreibung(ablauf({ actions: [{ type: 'notify', body: 'Fenster offen' }] }))
    ).toBe('Meldet «Fenster offen» an alle.');
  });

  it('sagt es, wenn ein Kamerabild mitgeht', () => {
    expect(
      pushBeschreibung(
        ablauf({ actions: [{ type: 'notify', title: 'Bewegung', camera: 'ring.tuer' }] })
      )
    ).toBe('Meldet «Bewegung» an alle · mit Kamerabild.');
  });

  it('verschweigt die zweite Nachricht nicht', () => {
    expect(
      pushBeschreibung(
        ablauf({
          actions: [
            { type: 'notify', title: 'Eins' },
            { type: 'notify', title: 'Zwei' },
          ],
        })
      )
    ).toBe('Meldet «Eins» an alle. Und 1 weitere Nachricht.');
  });

  it('bleibt bei einer Nachricht ohne Text ehrlich', () => {
    expect(pushBeschreibung(ablauf({ actions: [{ type: 'notify' }] }))).toBe(
      'Meldet eine Nachricht ohne Text an alle.'
    );
  });

  it('gibt für einen Ablauf ohne Nachricht nichts zurück', () => {
    expect(pushBeschreibung(ablauf())).toBe('');
  });
});

// ── Die selbst vergebene Kategorie «Push» ────────────────────────────────
// Unter den Abläufen standen zwei gleichlautende Überschriften «PUSH»:
// einmal die Kategorie, die jemand von Hand vergeben hatte, einmal der
// eingebaute Bereich darunter. Dieselben Abläufe, zweimal.

describe('istPushKategorie', () => {
  it('erkennt die Kategorie, egal wie sie geschrieben ist', () => {
    expect(istPushKategorie('Push')).toBe(true);
    expect(istPushKategorie('push')).toBe(true);
    expect(istPushKategorie('  PUSH  ')).toBe(true);
  });

  it('lässt andere Kategorien in Ruhe', () => {
    // «Push-Kamera» ist ein eigener Topf und darf nicht verschwinden.
    expect(istPushKategorie('Push-Kamera')).toBe(false);
    expect(istPushKategorie('Wandtaster')).toBe(false);
    expect(istPushKategorie('')).toBe(false);
    expect(istPushKategorie(null)).toBe(false);
    expect(istPushKategorie(undefined)).toBe(false);
  });
});

describe('gehoertZuPush', () => {
  it('nimmt auf, was meldet', () => {
    expect(gehoertZuPush(ablauf({ actions: [{ type: 'notify', title: 'X' }] }))).toBe(true);
  });

  it('nimmt auch auf, was jemand ausdrücklich dorthin einsortiert hat', () => {
    // Sonst verschwände der Ablauf ganz: aus der Liste genommen, im
    // Bereich nicht angekommen.
    expect(gehoertZuPush(ablauf({ category: 'Push' }))).toBe(true);
  });

  it('lässt alles andere draussen', () => {
    expect(gehoertZuPush(ablauf({ category: 'Wandtaster' }))).toBe(false);
  });
});

describe('pushAblaeufe mit Kategorie', () => {
  it('sammelt beide Arten und zählt keinen doppelt', () => {
    const meldend = ablauf({ id: 'a', actions: [{ type: 'notify', title: 'X' }] });
    const einsortiert = ablauf({ id: 'b', category: 'push' });
    const beides = ablauf({
      id: 'c',
      category: 'Push',
      actions: [{ type: 'notify', title: 'Y' }],
    });
    const fremd = ablauf({ id: 'd', category: 'Wandtaster' });
    expect(pushAblaeufe([meldend, einsortiert, beides, fremd]).map((a) => a.id)).toEqual([
      'a',
      'b',
      'c',
    ]);
  });
});

describe('pushBeschreibung bei einer Kategorie ohne Nachricht', () => {
  it('sagt, dass hier nichts verschickt wird', () => {
    // Wer einen Ablauf «Push» nennt, erwartet, dass er meldet. Eine leere
    // Zeile wäre die schlechtere Auskunft.
    expect(pushBeschreibung(ablauf({ category: 'Push' }))).toBe(
      'Verschickt keine Nachricht – steht wegen der Kategorie «Push» hier.'
    );
  });

  it('bleibt bei allen anderen still', () => {
    expect(pushBeschreibung(ablauf({ category: 'Wandtaster' }))).toBe('');
  });
});
