import { Entity } from '../api/types';
import {
  AUTO_SCHLIESSEN_SEKUNDEN,
  HOECHSTENS_AKTIONEN,
  befehlLabel,
  haustuerZeile,
  klingelAktionen,
  klingelBild,
  klingeltGerade,
  neueFrist,
  oeffnungsBefehl,
  restSekunden,
  vollbildZeigen,
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
    const wege = klingelAktionen(
      [
        geraet({
          id: 'nuki.wohnung',
          name: 'Wohnungstüre',
          integration: 'nuki',
          commands: ['unlatch', 'unlock', 'lock'],
        }),
        geraet({
          id: 'ring.haustuere',
          name: 'Haustüre',
          integration: 'ring',
          commands: ['open_door'],
        }),
        geraet({ id: 'x.schrank', name: 'Schrank', commands: ['lock'] }),
        kamera,
      ],
      kamera
    );
    // Genau die drei Handgriffe, um die es beim Klingeln geht - und die
    // Türe der Klingel selbst zuerst.
    expect(wege.map((w) => w.label)).toEqual([
      'Haustüre öffnen',
      'Wohnungstüre aufschliessen',
      'Wohnungstüre öffnen',
    ]);
    expect(wege.map((w) => w.befehl)).toEqual(['open_door', 'unlock', 'unlatch']);
    // Aufschliessen ist nicht öffnen - der Knopf muss das auseinanderhalten.
    expect(wege.map((w) => w.oeffnet)).toEqual([true, false, true]);
  });

  it('zeigt höchstens vier – ein Vollbild ist keine Suchaufgabe', () => {
    const viele = ['a', 'b', 'c', 'd'].map((id) =>
      geraet({ id, commands: ['unlatch', 'unlock'] })
    );
    expect(klingelAktionen(viele).length).toBe(HOECHSTENS_AKTIONEN);
  });

  it('kommt ohne Türen aus', () => {
    expect(klingelAktionen([])).toEqual([]);
  });
});

describe('Wer klingelt', () => {
  it('findet auch die Gegensprechanlage, nicht nur eine Kamera', () => {
    // Der Fehler, wegen dem das Vollbild nie kam: Die Haustüre ist eine
    // Ring-Gegensprechanlage. Der Hub legt sie als Türe an - sie hat
    // einen Türöffner, aber kein Bild. Gesucht wurde eine Kamera.
    const anlage = geraet({
      id: 'ring.haustuere',
      name: 'Haustüre',
      integration: 'ring',
      commands: ['open_door'],
      state: { ring: 'on' },
    });
    expect(klingeltGerade([geraet({ id: 'nuki.wohnung' }), anlage])?.id).toBe(
      'ring.haustuere'
    );
  });

  it('nimmt die Kamera, wenn beides klingelt', () => {
    const anlage = geraet({ id: 'ring.haustuere', state: { ring: 'on' } });
    const kamera = geraet({
      id: 'ring.klingel',
      kind: 'camera',
      state: { ring: 'on' },
    });
    expect(klingeltGerade([anlage, kamera])?.id).toBe('ring.klingel');
  });

  it('schweigt, wenn niemand klingelt', () => {
    expect(klingeltGerade([geraet({ id: 'a', state: { ring: 'off' } })])).toBeUndefined();
    expect(klingeltGerade([])).toBeUndefined();
  });

  it('zeigt das Bild der Kamera an derselben Türe', () => {
    const anlage = geraet({
      id: 'ring.haustuere',
      room: 'Eingang',
      integration: 'ring',
      state: { ring: 'on' },
    });
    const kamera = geraet({ id: 'x.eingang', kind: 'camera', room: 'Eingang' });
    expect(klingelBild([anlage, kamera], anlage)?.id).toBe('x.eingang');
    // Eine Anlage ohne Kamera bleibt ohne Bild - besser kein Bild als ein
    // Abruf, der ins Leere geht.
    expect(klingelBild([anlage], anlage)).toBeUndefined();
    expect(klingelBild([], undefined)).toBeUndefined();
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

describe('Wer das Klingel-Vollbild sieht', () => {
  it('zeigt es am Wandpanel', () => {
    expect(
      vollbildZeigen({ panel: true, ringKey: 'tuer:1', weggewischt: null })
    ).toBe(true);
  });

  it('zeigt es nicht auf dem Telefon', () => {
    // Dort reisst dasselbe Vollbild einem die App unter der Hand weg –
    // auch dann, wenn man gar nicht zuhause ist.
    expect(
      vollbildZeigen({ panel: false, ringKey: 'tuer:1', weggewischt: null })
    ).toBe(false);
    expect(vollbildZeigen({ ringKey: 'tuer:1', weggewischt: null })).toBe(false);
  });

  it('zeigt nichts, solange es nicht klingelt', () => {
    expect(vollbildZeigen({ panel: true, ringKey: null, weggewischt: null })).toBe(
      false
    );
  });

  it('kommt nach dem Wegwischen nicht wieder', () => {
    expect(
      vollbildZeigen({ panel: true, ringKey: 'tuer:1', weggewischt: 'tuer:1' })
    ).toBe(false);
  });

  it('kommt beim nächsten Klingeln wieder', () => {
    // Ein neues Läuten ist ein neuer Anlass, auch wenn das letzte
    // weggewischt wurde.
    expect(
      vollbildZeigen({ panel: true, ringKey: 'tuer:2', weggewischt: 'tuer:1' })
    ).toBe(true);
  });
});
