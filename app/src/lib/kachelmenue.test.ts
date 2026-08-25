/**
 * Was langes Drücken anbietet.
 *
 * Der Fall: «Die Kacheln auf der Startseite bei Favoriten lassen sich mit
 * einem langen Drücken nicht umbenennen.»
 */
import { kachelAktionen } from './kachelmenue';

const schluessel = (opts: Parameters<typeof kachelAktionen>[0]) =>
  kachelAktionen(opts).map((eintrag) => eintrag.key);

const standard = {
  favorit: false,
  versteckt: false,
  mitVerlauf: true,
  darfBearbeiten: true,
};

describe('kachelAktionen', () => {
  it('stellt das Umbenennen nach vorn', () => {
    // Danach greift die Hand, wenn sie eine Kachel lange hält.
    expect(schluessel(standard)[0]).toBe('rename');
  });

  it('behält den Verlauf, nur eine Zeile tiefer', () => {
    // Vorher zeigte langes Drücken ihn sofort. Ihn ganz zu streichen wäre
    // ein Verlust für einen Gewinn woanders.
    expect(schluessel(standard)).toContain('history');
    expect(schluessel({ ...standard, mitVerlauf: false })).not.toContain('history');
  });

  it('lässt Umbenennen und Raum weg, wo es niemand darf', () => {
    // Der Hub verlangt für beides eine Berechtigung. Ein Eintrag, der mit
    // «keine Berechtigung» antwortet, wäre ein Knopf, der nichts tut.
    const ohne = schluessel({ ...standard, darfBearbeiten: false });
    expect(ohne).not.toContain('rename');
    expect(ohne).not.toContain('room');
    // Favorit und Ausblenden gehören dem Benutzer selbst – die bleiben.
    expect(ohne).toEqual(['favorite', 'hide', 'history']);
  });

  it('sagt, was der Griff bewirkt – nicht, was gerade gilt', () => {
    // «Favorit» auf einer Kachel, die schon einer ist, wäre eine Aussage
    // über den Zustand und keine über den Knopf.
    const [favorit] = kachelAktionen({ ...standard, favorit: true }).filter(
      (eintrag) => eintrag.key === 'favorite'
    );
    expect(favorit.label).toBe('Kein Favorit');
    const [zeigen] = kachelAktionen({ ...standard, versteckt: true }).filter(
      (eintrag) => eintrag.key === 'hide'
    );
    expect(zeigen.label).toBe('Wieder zeigen');
  });
});
