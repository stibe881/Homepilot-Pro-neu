import { Entity } from '../api/types';
import { FAVORITEN, OHNE_RAUM, raumGruppen } from './raumgruppen';

function lampe(id: string, name: string, room?: string): Entity {
  return {
    id,
    name,
    kind: 'light',
    integration: 'demo',
    room,
    commands: [],
    state: {},
  } as unknown as Entity;
}

const RAEUME = ['Wohnzimmer', 'Küche', 'Bad'];

it('sorts the lamps into their rooms, in the order of the configuration', () => {
  const gruppen = raumGruppen(
    [lampe('a', 'Stehlampe', 'Küche'), lampe('b', 'Decke', 'Wohnzimmer')],
    RAEUME
  );
  expect(gruppen.map((g) => g.label)).toEqual(['Wohnzimmer', 'Küche']);
  expect(gruppen[0].items.map((e) => e.id)).toEqual(['b']);
});

it('leaves out rooms without a single device', () => {
  const gruppen = raumGruppen([lampe('a', 'Decke', 'Bad')], RAEUME);
  expect(gruppen.map((g) => g.label)).toEqual(['Bad']);
});

it('collects what has no room under «Weitere», at the end', () => {
  const gruppen = raumGruppen([lampe('a', 'Girlande'), lampe('b', 'Decke', 'Bad')], RAEUME);
  expect(gruppen.map((g) => g.key)).toEqual(['Bad', OHNE_RAUM]);
});

it('keeps a room that only the device knows about', () => {
  // Ein Gerät kann einem Raum zugeordnet sein, den die config.yaml nicht
  // listet – per API gesetzt. Ohne diesen Fall verschwände es lautlos.
  const gruppen = raumGruppen([lampe('a', 'Decke', 'Estrich')], RAEUME);
  expect(gruppen.map((g) => g.label)).toEqual(['Estrich']);
  expect(gruppen[0].items).toHaveLength(1);
});

it('names such a room only once, even with several devices in it', () => {
  const gruppen = raumGruppen(
    [lampe('a', 'Decke', 'Estrich'), lampe('b', 'Spot', 'Estrich')],
    RAEUME
  );
  expect(gruppen.map((g) => g.label)).toEqual(['Estrich']);
  expect(gruppen[0].items.map((e) => e.id)).toEqual(['a', 'b']);
});

it('puts favourites in front – but only when asked for them', () => {
  const geraete = [lampe('a', 'Decke', 'Bad'), lampe('b', 'Stehlampe', 'Küche')];
  const mit = raumGruppen(geraete, RAEUME, ['b']);
  expect(mit.map((g) => g.key)).toEqual([FAVORITEN, 'Bad']);
  // Ohne Favoritenliste steht jede Lampe in ihrem Zimmer – genau das
  // will die Licht-Seite.
  const ohne = raumGruppen(geraete, RAEUME);
  expect(ohne.map((g) => g.label)).toEqual(['Küche', 'Bad']);
});

it('answers an empty list with no groups at all', () => {
  expect(raumGruppen([], RAEUME)).toEqual([]);
});
