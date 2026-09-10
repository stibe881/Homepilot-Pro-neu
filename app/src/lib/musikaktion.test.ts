import { musikSatz } from './ablaufsatz';
import {
  EMPTY_STEP,
  actionsToSteps,
  musikSchrittZuAktion,
} from '../screens/automations/entwurf';
import type { Entity } from '../api/types';

const boxen = [
  { id: 'cast.kueche', name: 'Küche' } as Entity,
];

describe('musikSchrittZuAktion', () => {
  it('braucht für «Überall Pause» nichts weiter', () => {
    expect(musikSchrittZuAktion({ ...EMPTY_STEP, musikTat: 'pause_all' })).toEqual([
      { type: 'music', do: 'pause_all' },
    ]);
  });

  it('schickt bei der Nachtruhe mit, ob ein oder aus', () => {
    expect(
      musikSchrittZuAktion({ ...EMPTY_STEP, musikTat: 'night', musikAn: false }),
    ).toEqual([{ type: 'music', do: 'night', on: false }]);
  });

  it('ergibt ohne Favorit gar keine Aktion', () => {
    // Ein halber Schritt, der beim Ablaufen stillschweigend nichts tut,
    // wäre schlimmer als einer, der im Editor unfertig aussieht.
    expect(musikSchrittZuAktion({ ...EMPTY_STEP, musikTat: 'favorite' })).toEqual([]);
    expect(
      musikSchrittZuAktion({ ...EMPTY_STEP, musikTat: 'favorite', musikFavorit: 'SRF 3' }),
    ).toEqual([{ type: 'music', do: 'favorite', favorite: 'SRF 3' }]);
  });

  it('ergibt ohne Box weder Schlummer noch Einblenden', () => {
    expect(musikSchrittZuAktion({ ...EMPTY_STEP, musikTat: 'sleep' })).toEqual([]);
    expect(musikSchrittZuAktion({ ...EMPTY_STEP, musikTat: 'fade' })).toEqual([]);
  });

  it('«Musik folgt» braucht Quelle und Ziel (Punkt 419)', () => {
    expect(musikSchrittZuAktion({ ...EMPTY_STEP, musikTat: 'follow' })).toEqual([]);
    expect(
      musikSchrittZuAktion({
        ...EMPTY_STEP,
        musikTat: 'follow',
        musikEntityId: 'cast.kueche',
      }),
    ).toEqual([]);
    expect(
      musikSchrittZuAktion({
        ...EMPTY_STEP,
        musikTat: 'follow',
        musikEntityId: 'cast.kueche',
        musikZiel: 'cast.bad',
      }),
    ).toEqual([{ type: 'music', do: 'follow', entity_id: 'cast.kueche', target: 'cast.bad' }]);
  });

  it('nimmt Minuten und Lautstärke als Zahl mit', () => {
    expect(
      musikSchrittZuAktion({
        ...EMPTY_STEP,
        musikTat: 'sleep',
        musikEntityId: 'cast.kueche',
        musikMinuten: '45',
      }),
    ).toEqual([{ type: 'music', do: 'sleep', entity_id: 'cast.kueche', minutes: 45 }]);
    expect(
      musikSchrittZuAktion({
        ...EMPTY_STEP,
        musikTat: 'fade',
        musikEntityId: 'cast.kueche',
        musikLautstaerke: '45',
      }),
    ).toEqual([{ type: 'music', do: 'fade', entity_id: 'cast.kueche', volume: 45 }]);
  });

  it('fällt bei leerer Zahl auf die Vorgabe zurück', () => {
    // Ein leeres Feld darf nicht «nach 0 Minuten» heissen.
    expect(
      musikSchrittZuAktion({
        ...EMPTY_STEP,
        musikTat: 'sleep',
        musikEntityId: 'cast.kueche',
        musikMinuten: '',
      })[0].minutes,
    ).toBe(30);
  });
});

describe('musikSatz', () => {
  it('sagt in der Liste, was der Schritt tut', () => {
    expect(musikSatz({ do: 'pause_all' }, boxen)).toBe('überall Pause');
    expect(musikSatz({ do: 'night', on: false }, boxen)).toBe('Nachtruhe aus');
    expect(musikSatz({ do: 'favorite', favorite: 'SRF 3' }, boxen)).toBe('Favorit «SRF 3»');
    expect(musikSatz({ do: 'sleep', entity_id: 'cast.kueche', minutes: 45 }, boxen)).toBe(
      'Küche nach 45 Min aus',
    );
    expect(musikSatz({ do: 'fade', entity_id: 'cast.kueche' }, boxen)).toBe(
      'Küche leise starten',
    );
    expect(
      musikSatz({ do: 'follow', entity_id: 'cast.kueche', target: 'cast.bad' }, boxen),
    ).toBe('Musik von Küche nach cast.bad mitnehmen');
  });
});

describe('«Musik folgt» beim erneuten Öffnen (Punkt 419)', () => {
  it('liest Quelle und Ziel aus der gespeicherten Aktion zurück', () => {
    const schritte = actionsToSteps([
      { type: 'music', do: 'follow', entity_id: 'cast.kueche', target: 'cast.bad' },
    ]);
    expect(schritte).toHaveLength(1);
    expect(schritte[0].kind).toBe('music');
    expect(schritte[0].musikTat).toBe('follow');
    expect(schritte[0].musikEntityId).toBe('cast.kueche');
    expect(schritte[0].musikZiel).toBe('cast.bad');
  });
});
