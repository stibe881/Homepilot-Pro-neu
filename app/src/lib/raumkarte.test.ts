import { Entity } from '../api/types';
import {
  geraetAktion,
  gewaehlteAktionen,
  kachelKnoepfe,
  raumFarben,
  raumSchleier,
  raumTon,
  raumStand,
  raumaktionen,
  waehlbareGeraete,
} from './raumkarte';

function geraet(
  id: string,
  kind: string,
  state: Record<string, unknown>,
  commands: string[]
): Entity {
  return {
    id,
    name: id,
    kind,
    integration: 'demo',
    state,
    commands,
    available: true,
  } as unknown as Entity;
}

const lampe = (id: string, an: boolean) =>
  geraet(id, 'light', { state: an ? 'on' : 'off' }, ['toggle', 'turn_on', 'turn_off']);
const store = (id: string, position: number) =>
  geraet(id, 'cover', { state: position > 0 ? 'open' : 'closed', position }, [
    'open',
    'close',
  ]);
const box = (id: string, spielt: boolean) =>
  geraet(id, 'media_player', { state: spielt ? 'playing' : 'paused' }, ['play', 'pause']);

describe('raumaktionen', () => {
  it('bietet nur an, was das Zimmer hat', () => {
    // Ein Storen-Knopf im Bad ohne Storen wäre ein Knopf, der nichts tut.
    expect(raumaktionen([lampe('a', false)]).map((k) => k.art)).toEqual(['licht']);
    expect(raumaktionen([]).length).toBe(0);
    expect(
      raumaktionen([lampe('a', false), store('s', 0), box('m', false)]).map((k) => k.art)
    ).toEqual(['licht', 'storen', 'musik']);
  });

  it('macht alles aus, sobald irgendetwas brennt', () => {
    // «toggle» je Lampe wäre falsch: Bei zwei von drei machte der eine
    // Tipp zwei aus und die dritte an.
    const aktion = raumaktionen([lampe('a', true), lampe('b', false), lampe('c', true)])[0];
    expect(aktion.an).toBe(true);
    expect(aktion.befehle).toEqual([
      { entityId: 'a', command: 'turn_off' },
      { entityId: 'c', command: 'turn_off' },
    ]);
  });

  it('macht alles an, wenn nichts brennt', () => {
    const aktion = raumaktionen([lampe('a', false), lampe('b', false)])[0];
    expect(aktion.an).toBe(false);
    expect(aktion.befehle.map((b) => b.command)).toEqual(['turn_on', 'turn_on']);
  });

  it('fährt die Storen dorthin, wo sie noch nicht sind', () => {
    const offen = raumaktionen([store('s1', 100), store('s2', 0)])[1 - 1];
    expect(offen.icon).toBe('arrow-down');
    // Nur die offene fährt – die geschlossene hat nichts mehr zu tun.
    expect(offen.befehle).toEqual([{ entityId: 's1', command: 'close' }]);

    const zu = raumaktionen([store('s1', 0), store('s2', 0)])[0];
    expect(zu.icon).toBe('arrow-up');
    expect(zu.befehle.map((b) => b.command)).toEqual(['open', 'open']);
  });

  it('nimmt bei zwei Boxen die spielende', () => {
    // Zwei gleichzeitig zu starten erwartet niemand von einem Knopf.
    const aktion = raumaktionen([box('still', false), box('laeuft', true)])[0];
    expect(aktion.an).toBe(true);
    expect(aktion.befehle).toEqual([{ entityId: 'laeuft', command: 'pause' }]);
  });

  it('nimmt «toggle», wo es das gibt', () => {
    const spotify = geraet('sp', 'media_player', { state: 'paused' }, [
      'toggle',
      'play',
      'pause',
    ]);
    expect(raumaktionen([spotify])[0].befehle).toEqual([
      { entityId: 'sp', command: 'toggle' },
    ]);
  });

  it('lässt Geräte weg, die sich gar nicht schalten lassen', () => {
    const fuehler = geraet('t', 'sensor', { state: 21.3 }, []);
    const kamera = geraet('k', 'camera', { state: 'idle' }, ['snapshot']);
    expect(raumaktionen([fuehler, kamera])).toEqual([]);
  });
});

describe('raumFarben', () => {
  it('gibt demselben Zimmer immer dieselbe Farbe', () => {
    expect(raumFarben('Küche')).toEqual(raumFarben('Küche'));
    expect(raumFarben('Küche')).toEqual(raumFarben(' küche '));
  });

  it('bleibt im gedeckten Bereich, damit weisser Text darauf hält', () => {
    for (const name of ['Küche', 'Bad', 'Wohnzimmer', 'Estrich', '🛋️']) {
      const [oben, unten] = raumFarben(name);
      expect(oben).toMatch(/^hsl\(\d+, 38%, 44%\)$/);
      expect(unten).toMatch(/^hsl\(\d+, 42%, 25%\)$/);
    }
  });

  it('meidet das Blau des Hintergrunds', () => {
    // Der Verlauf der App ist ein blaues Grau; ein blaugrauer Kopf
    // darauf las sich nicht als Fläche, sondern als Loch.
    for (const name of ['Küche', 'Bad', 'Wohnzimmer', 'Flur', 'Estrich', 'Büro']) {
      const ton = Number(raumFarben(name)[0].match(/^hsl\((\d+)/)![1]);
      expect(ton >= 250 || ton <= 30).toBe(true);
    }
  });

  it('trennt benachbarte Zimmer', () => {
    expect(raumFarben('Küche')[0]).not.toEqual(raumFarben('Bad')[0]);
  });
});

describe('raumStand', () => {
  it('stellt den Zustand des Raums voran', () => {
    expect(raumStand([lampe('a', true)], '21,3° · 47 %')).toBe('21,3° · 47 % · 1 an');
  });

  it('sagt «alles ruhig» statt «0 an»', () => {
    // «0 an» ist keine Auskunft.
    expect(raumStand([lampe('a', false)], '19,1°')).toBe('19,1° · alles ruhig');
    expect(raumStand([], '')).toBe('alles ruhig');
  });

  it('zählt laufende Musik mit', () => {
    expect(raumStand([lampe('a', true), box('m', true)], '')).toBe('2 an');
  });
});

describe('gewaehlteAktionen', () => {
  const alle = raumaktionen([lampe('a', false), box('b', false)]);

  it('zeigt ohne Wahl alles, was der Raum hergibt', () => {
    expect(gewaehlteAktionen(alle, undefined).map((a) => a.art)).toEqual([
      'licht',
      'musik',
    ]);
  });

  it('zeigt mit Wahl genau die gewählten', () => {
    expect(gewaehlteAktionen(alle, ['musik']).map((a) => a.art)).toEqual(['musik']);
  });

  it('nimmt auch die leere Wahl ernst - keine Knöpfe ist eine Antwort', () => {
    expect(gewaehlteAktionen(alle, [])).toEqual([]);
  });
});


// ── Geräteknöpfe ─────────────────────────────────────────────────────────
// Der Fall: In Levins Zimmer stand nur «Licht» zur Wahl - ein einzelnes
// Gerät («Sternenhimmel») liess sich nicht auf die Kachel legen.

describe('geraetAktion und kachelKnoepfe', () => {
  const szene = geraet('hue.sternenhimmel', 'scene', { state: 'off' }, ['activate']);

  it('macht aus einer Hue-Lichtszene einen Knopf', () => {
    const knopf = geraetAktion(szene);
    expect(knopf?.art).toBe('geraet');
    expect(knopf?.id).toBe('hue.sternenhimmel');
    expect(knopf?.befehle).toEqual([
      { entityId: 'hue.sternenhimmel', command: 'activate' },
    ]);
  });

  it('schaltet den Fernseher ein und aus, die Box auf Play und Pause', () => {
    const tv = geraet('cast.tv', 'media_player', { state: 'off', has_screen: true }, [
      'turn_on',
      'turn_off',
      'play',
      'pause',
    ]);
    expect(geraetAktion(tv)?.befehle[0].command).toBe('turn_on');
    expect(geraetAktion(box('b', true))?.befehle[0].command).toBe('pause');
  });

  it('macht aus einem Fühler keinen Knopf', () => {
    expect(geraetAktion(geraet('t', 'sensor', { state: '21' }, []))).toBeNull();
    expect(waehlbareGeraete([szene, geraet('t', 'sensor', {}, [])]).length).toBe(1);
  });

  it('zeigt gewählte Geräte neben den Sammelknöpfen', () => {
    const items = [lampe('a', false), szene];
    expect(kachelKnoepfe(items, undefined).map((k) => k.art)).toEqual(['licht']);
    expect(
      kachelKnoepfe(items, ['licht', 'hue.sternenhimmel']).map((k) => k.id ?? k.art)
    ).toEqual(['licht', 'hue.sternenhimmel']);
  });

  it('trägt nie mehr als drei Knöpfe - vier passen nicht nebeneinander', () => {
    const items = [lampe('a', true), store('s', 50), box('m', false), szene];
    const wahl = ['licht', 'storen', 'musik', 'hue.sternenhimmel'];
    expect(kachelKnoepfe(items, wahl).length).toBe(3);
  });
});

describe('raumTon und raumSchleier', () => {
  it('gibt demselben Zimmer immer denselben Ton', () => {
    // Aus dem Namen gerechnet, nicht gespeichert: auf jedem Gerät gleich,
    // ohne dass jemand etwas einstellen muss.
    expect(raumTon('Wohnzimmer')).toBe(raumTon('wohnzimmer '));
  });

  it('bleibt im blau-bis-orangen Bereich', () => {
    // Grün und Gelb fehlen mit Absicht - auf dem blaugrauen Verlauf
    // kippen sie ins Schmutzige.
    for (const raum of ['Bad', 'Küche', 'Büro', 'Eingang', 'Levins Zimmer']) {
      const ton = raumTon(raum);
      expect(ton >= 250 || ton <= 30).toBe(true);
    }
  });

  it('baut aus dem Ton einen Schleier, der nach unten ausgeht', () => {
    const [oben, unten] = raumSchleier('Wohnzimmer');
    expect(oben).toContain(`hsla(${raumTon('Wohnzimmer')}`);
    expect(unten).toMatch(/, 0\)$/);
  });

  it('nimmt denselben Ton wie das Kopfbild der Kachel', () => {
    expect(raumFarben('Büro')[0]).toContain(`hsl(${raumTon('Büro')},`);
  });
});
