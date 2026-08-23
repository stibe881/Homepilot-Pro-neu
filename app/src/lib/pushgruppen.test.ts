/**
 * Die Unterkategorien der Push-Nachrichten.
 *
 * Der Fall dahinter: Im Profil standen zwanzig gleich aussehende
 * Schalter, die Hälfte davon unter «Weiteres» – obwohl der Hub für jede
 * Kategorie längst eine Gruppe kennt. Dieselbe Einteilung braucht die
 * Liste unter «Abläufe → Push».
 */
import { OHNE_GRUPPE, nachGruppen } from './pushgruppen';

const eintrag = (key: string, group?: string) => ({ key, group });

describe('nachGruppen', () => {
  it('sortiert in der Reihenfolge, die der Hub vorgibt', () => {
    // «Sicherheit» oben, «Betrieb» unten – nicht alphabetisch.
    const gruppen = nachGruppen(
      [eintrag('disk', 'Betrieb'), eintrag('leak', 'Sicherheit')],
      ['Sicherheit', 'Haus', 'Betrieb']
    );
    expect(gruppen.map((g) => g.title)).toEqual(['Sicherheit', 'Betrieb']);
    expect(gruppen[0].items.map((i) => i.key)).toEqual(['leak']);
  });

  it('lässt leere Gruppen weg', () => {
    const gruppen = nachGruppen([eintrag('leak', 'Sicherheit')], [
      'Sicherheit',
      'Haus',
    ]);
    expect(gruppen.map((g) => g.title)).toEqual(['Sicherheit']);
  });

  it('hängt Unbekanntes hinten an, statt es verschwinden zu lassen', () => {
    // Eine neue Kategorie soll höchstens unsortiert sein, nie unsichtbar.
    const gruppen = nachGruppen(
      [eintrag('neu', 'Ganz Neues'), eintrag('leak', 'Sicherheit')],
      ['Sicherheit']
    );
    expect(gruppen.map((g) => g.title)).toEqual(['Sicherheit', 'Ganz Neues']);
  });

  it('nimmt auch auf, was gar keine Gruppe hat', () => {
    const gruppen = nachGruppen([eintrag('namenlos')], ['Sicherheit']);
    expect(gruppen).toEqual([
      { title: OHNE_GRUPPE, items: [{ key: 'namenlos', group: undefined }] },
    ]);
  });

  it('kommt ohne Reihenfolge zurecht', () => {
    // Ein älterer Hub schickt sie nicht mit - dann eben nach Vorkommen.
    const gruppen = nachGruppen([eintrag('a', 'Zweite'), eintrag('b', 'Erste')]);
    expect(gruppen.map((g) => g.title)).toEqual(['Zweite', 'Erste']);
  });

  it('bleibt bei leerer Liste leer', () => {
    expect(nachGruppen([], ['Sicherheit'])).toEqual([]);
  });
});
