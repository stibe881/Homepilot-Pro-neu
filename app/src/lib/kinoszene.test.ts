import { Scene } from '../api/types';
import { kinoSzene } from './kinoszene';

const szene = (id: string, name: string) => ({ id, name }) as Scene;

describe('Die Kino-Szene auf der Fernbedienung', () => {
  it('findet sie über den Namen, Schreibweise egal', () => {
    expect(kinoSzene([szene('s1', 'Abend'), szene('s2', ' KINO ')])?.id).toBe('s2');
  });

  it('lieber kein Knopf als der falsche', () => {
    // Heisst keine Szene so, gibt es keinen Knopf - und heissen zwei
    // so, auch nicht. Dieselbe Regel wie auf der Live-Karte des
    // Fernsehers (hub kino_knopf), damit die beiden nie verschieden
    // entscheiden.
    expect(kinoSzene([])).toBeNull();
    expect(kinoSzene([szene('s1', 'Kino'), szene('s2', 'kino')])).toBeNull();
  });
});
