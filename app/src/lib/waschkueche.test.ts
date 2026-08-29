/**
 * Die Türe, an der «ausgeräumt» abgelesen wird.
 *
 * Der Anlass: Die Erinnerung an die volle Waschmaschine kam genau
 * einmal, und die Wäsche lag über Nacht in der Trommel.
 */
import {
  Tuerstand,
  gemessenAn,
  geordnet,
  kontaktName,
  naechsteWahl,
  tuerSatz,
} from './waschkueche';

const STAND: Tuerstand = {
  door: null,
  using: 'z.wk',
  guess: 'z.wk',
  candidates: [
    { id: 'z.kueche', name: 'Fenster Küche', room: 'Küche' },
    { id: 'z.wk', name: 'Türe Waschküche', room: 'Waschküche' },
    { id: 'z.bad', name: 'Fenster', room: 'Bad' },
  ],
};

describe('kontaktName', () => {
  it('nennt den Raum dazu', () => {
    expect(kontaktName({ id: 'x', name: 'Fenster', room: 'Bad' })).toBe('Fenster · Bad');
  });

  it('wiederholt den Raum nicht, wenn er schon im Namen steht', () => {
    // «Türe Waschküche · Waschküche» liest sich wie ein Fehler.
    expect(kontaktName({ id: 'x', name: 'Türe Waschküche', room: 'Waschküche' })).toBe(
      'Türe Waschküche'
    );
  });

  it('kommt ohne Raum aus', () => {
    expect(kontaktName({ id: 'x', name: 'Kontakt 3' })).toBe('Kontakt 3');
  });
});

describe('geordnet', () => {
  it('stellt die geratene Türe nach oben', () => {
    expect(geordnet(STAND).map((k) => k.id)).toEqual(['z.wk', 'z.bad', 'z.kueche']);
  });

  it('verträgt eine leere Auswahl', () => {
    expect(geordnet(null)).toEqual([]);
  });
});

describe('tuerSatz', () => {
  it('sagt, an welcher Türe gemessen wird', () => {
    expect(tuerSatz(STAND)).toContain('Türe Waschküche');
    expect(tuerSatz(STAND)).toContain('selbst gefunden');
  });

  it('lässt den Zusatz weg, wo jemand selbst gewählt hat', () => {
    const eigen = { ...STAND, door: 'z.bad', using: 'z.bad' };
    expect(tuerSatz(eigen)).toContain('Fenster · Bad');
    expect(tuerSatz(eigen)).not.toContain('selbst gefunden');
  });

  it('sagt ohne Türe, was dann nicht passiert', () => {
    // Sonst sucht man die versprochene Wiederholung und hält ihr
    // Ausbleiben für einen Fehler.
    const ohne = { ...STAND, using: null, guess: null };
    expect(tuerSatz(ohne)).toContain('einer Nachricht je Programm');
  });
});

describe('gemessenAn', () => {
  it('findet die Türe zur Id', () => {
    expect(gemessenAn(STAND)?.name).toBe('Türe Waschküche');
  });

  it('liefert nichts, wo nichts gilt', () => {
    expect(gemessenAn({ ...STAND, using: null })).toBeNull();
  });
});

describe('naechsteWahl', () => {
  it('wählt eine Türe', () => {
    expect(naechsteWahl(STAND, 'z.bad')).toBe('z.bad');
  });

  it('gibt die eigene Wahl beim zweiten Antippen wieder auf', () => {
    // Ohne diesen Weg zurück käme man aus einer Wahl nicht mehr heraus.
    expect(naechsteWahl({ ...STAND, door: 'z.bad' }, 'z.bad')).toBeNull();
  });
});
