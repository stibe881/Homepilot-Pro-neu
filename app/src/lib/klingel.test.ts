import { Entity } from '../api/types';
import {
  AUTO_SCHLIESSEN_SEKUNDEN,
  befehlLabel,
  haustuerZeile,
  neueFrist,
  oeffnungsBefehl,
  restSekunden,
  tuerenFuerKlingel,
} from './klingel';

const geraet = (over: Partial<Entity> & { id: string }): Entity =>
  ({
    kind: 'lock',
    name: over.id,
    integration: 'x',
    state: {},
    commands: [],
    ...over,
  }) as Entity;

describe('Türen beim Klingeln', () => {
  it('zieht die Falle, statt bloss zu entriegeln', () => {
    // Ein Nuki, das nur «unlock» bekommt, macht den Riegel auf und die
    // Türe bleibt zu - der Besuch steht weiter im Treppenhaus.
    expect(oeffnungsBefehl(geraet({ id: 'a', commands: ['lock', 'unlock', 'unlatch'] }))).toBe(
      'unlatch'
    );
    expect(oeffnungsBefehl(geraet({ id: 'b', commands: ['open_door'] }))).toBe('open_door');
    expect(oeffnungsBefehl(geraet({ id: 'c', commands: ['lock', 'unlock'] }))).toBe('unlock');
    expect(oeffnungsBefehl(geraet({ id: 'd', commands: ['lock'] }))).toBeNull();
  });

  it('nennt beim Namen, was der Knopf tut', () => {
    expect(befehlLabel(geraet({ id: 'x', name: 'Wohnungstüre', commands: ['unlatch'] }))).toBe(
      'Wohnungstüre öffnen'
    );
    // Nur entriegeln ist etwas anderes als öffnen - und das gehört auf
    // den Knopf, sonst wartet man vergeblich auf das Summen.
    expect(befehlLabel(geraet({ id: 'y', name: 'Garage', commands: ['unlock'] }))).toBe(
      'Garage entriegeln'
    );
  });

  it('bietet Haustüre und Wohnungstüre an, die der Klingel zuerst', () => {
    const kamera = geraet({ id: 'ring.klingel', kind: 'camera', integration: 'ring' });
    const tueren = tuerenFuerKlingel(
      [
        geraet({ id: 'nuki.wohnung', name: 'Wohnungstüre', commands: ['unlatch', 'lock'] }),
        geraet({ id: 'ring.haustuere', name: 'Haustüre', integration: 'ring', commands: ['open_door'] }),
        geraet({ id: 'x.schrank', name: 'Schrank', commands: ['lock'] }),
        kamera,
      ],
      kamera
    );
    expect(tueren.map((t) => t.id)).toEqual(['ring.haustuere', 'nuki.wohnung']);
  });

  it('zeigt höchstens drei – ein Vollbild ist keine Suchaufgabe', () => {
    const viele = ['a', 'b', 'c', 'd'].map((id) =>
      geraet({ id, commands: ['unlatch'] })
    );
    expect(tuerenFuerKlingel(viele).length).toBe(3);
  });

  it('kommt ohne Türen aus', () => {
    expect(tuerenFuerKlingel([])).toEqual([]);
  });
});

describe('Rücklauf des Vollbilds', () => {
  it('rechnet aus der Uhr, nicht aus gezählten Takten', () => {
    // Der Takt der App hält im Hintergrund an. Wer eine halbe Stunde
    // später zurückkommt, hätte sonst noch 59 Sekunden vor sich.
    const frist = neueFrist(1_000_000);
    expect(restSekunden(frist, 1_000_000)).toBe(AUTO_SCHLIESSEN_SEKUNDEN);
    expect(restSekunden(frist, 1_000_000 + 30_000)).toBe(30);
    expect(restSekunden(frist, 1_000_000 + 1_800_000)).toBe(0);
  });

  it('wird nie negativ', () => {
    expect(restSekunden(0, 999_999)).toBe(0);
  });
});

describe('Zustandszeile der Haustüren-Kachel', () => {
  const heute = new Date(2026, 7, 23, 20, 0);

  it('schweigt, wenn es nichts zu sagen gibt', () => {
    // Vorher stand dort fest «Gegensprechanlage» - ein Wort, das die
    // Überschrift «Haustüre» schon sagt.
    expect(haustuerZeile({ state: 'online' }, heute)).toBeNull();
    expect(haustuerZeile(undefined, heute)).toBeNull();
  });

  it('meldet, wenn die Anlage weg ist', () => {
    expect(haustuerZeile({ state: 'offline' }, heute)).toBe('Nicht erreichbar');
  });

  it('sagt, wann es zuletzt geklingelt hat', () => {
    const um = new Date(2026, 7, 23, 18, 42).toISOString();
    expect(haustuerZeile({ state: 'online', last_ring: um }, heute)).toBe(
      'Zuletzt geklingelt 18:42'
    );
  });

  it('lässt ein Klingeln von gestern weg', () => {
    // Es beantwortet keine Frage, die sich jemand auf der Startseite stellt.
    const gestern = new Date(2026, 7, 22, 18, 42).toISOString();
    expect(haustuerZeile({ state: 'online', last_ring: gestern }, heute)).toBeNull();
    expect(haustuerZeile({ state: 'online', last_ring: 'kaputt' }, heute)).toBeNull();
  });
});
