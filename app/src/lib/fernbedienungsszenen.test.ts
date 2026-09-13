import { Entity, Scene } from '../api/types';
import { fernbedienungsSzenen, szenenAuswahlUmschalten } from './fernbedienungsszenen';

const szene = (id: string, name: string) => ({ id, name }) as Scene;
const alle = [szene('kino', 'Kino'), szene('zocken', 'Zocken'), szene('party', 'Party')];

describe('Die Szenen unten an der Fernbedienung (Punkt 646)', () => {
  it('zeigt die getroffene Auswahl, in ihrer Reihenfolge', () => {
    const geraet = { remote_scenes: ['zocken', 'kino'] } as Entity;
    expect(fernbedienungsSzenen(geraet, alle).map((s) => s.id)).toEqual(['zocken', 'kino']);
  });

  it('klemmt auf zwei, auch wenn mehr gespeichert wären', () => {
    const geraet = { remote_scenes: ['kino', 'zocken', 'party'] } as Entity;
    expect(fernbedienungsSzenen(geraet, alle).map((s) => s.id)).toEqual(['kino', 'zocken']);
  });

  it('lässt eine gelöschte Szene einfach weg, statt auf Kino zurückzufallen', () => {
    const geraet = { remote_scenes: ['verschwunden', 'zocken'] } as Entity;
    expect(fernbedienungsSzenen(geraet, alle).map((s) => s.id)).toEqual(['zocken']);
  });

  it('fällt ohne Auswahl auf die alte Regel zurück - die Szene «Kino»', () => {
    // Kein Feld gesetzt: ein Hub, der remote_scenes noch nicht kennt,
    // oder ein Gerät, an dem niemand je etwas gewählt hat.
    expect(fernbedienungsSzenen({} as Entity, alle).map((s) => s.id)).toEqual(['kino']);
    expect(fernbedienungsSzenen(undefined, alle).map((s) => s.id)).toEqual(['kino']);
  });

  it('zeigt wirklich keine, wenn beide abgewählt sind', () => {
    // Eine leere Liste ist eine getroffene Entscheidung, kein
    // fehlendes Feld - sonst käme überraschend doch «Kino» zurück.
    const geraet = { remote_scenes: [] } as unknown as Entity;
    expect(fernbedienungsSzenen(geraet, alle)).toEqual([]);
  });
});

describe('Eine Szene an- und abwählen (Punkt 646)', () => {
  it('nimmt eine zweite dazu', () => {
    expect(szenenAuswahlUmschalten(['kino'], 'zocken')).toEqual(['kino', 'zocken']);
  });

  it('wählt eine gewählte wieder ab', () => {
    expect(szenenAuswahlUmschalten(['kino', 'zocken'], 'kino')).toEqual(['zocken']);
  });

  it('nimmt keine dritte an, bis eine abgewählt ist', () => {
    // Kein stilles Ersetzen der ältesten Wahl - das würde man erst an
    // der Fernbedienung selbst bemerken.
    expect(szenenAuswahlUmschalten(['kino', 'zocken'], 'party')).toEqual(['kino', 'zocken']);
  });
});
