/**
 * Das Meldungsband wandert ins oberste offene Blatt (Punkt 581).
 *
 * Der Fall aus dem Haus: Es klingelt, das Klingelblatt liegt als Modal
 * über allem, der Türöffner wird abgelehnt - und die Absage stand im
 * Wurzel-View, hinter dem Modal, wo sie niemand sah. Geprüft wird
 * deshalb nicht, ob die Absage irgendwo steht, sondern *wo*: genau
 * einmal, und zwar im zuletzt geöffneten Blatt.
 */
import React from 'react';
import { Text, View } from 'react-native';
import { ReactTestRenderer, act, create } from 'react-test-renderer';

import { Blattstapel, MeldungsProvider, useBlattstapel } from '../hooks/HubContext';
import { oberstes } from '../lib/blattstapel';
import { Blatt } from './Blatt';
import { Meldungsband } from './Toast';

// Die Symbolschrift zieht das halbe Expo-Font-Paket nach; hier zählt,
// wo die Meldung steht, nicht das Warnsymbol davor.
jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

const beruehrt = jest.fn();
let stand: Blattstapel | null = null;
let baum: ReactTestRenderer | null = null;

/** Die Startseite im Kleinen: Provider, Wurzelband und bis zu zwei Blätter. */
function Probe({ blaetter }: { blaetter: number }) {
  const stapel = useBlattstapel();
  stand = stapel;
  const meldungen = {
    fehler: 'Türe verweigert',
    fehlerWeg: () => {},
    note: null,
    noteWeg: () => {},
    rueck: null,
  };
  return (
    <MeldungsProvider meldungen={meldungen} blaetter={stapel} beruehrt={beruehrt}>
      <View testID="wurzel">
        {oberstes(stapel.stapel) === null ? <Meldungsband /> : null}
      </View>
      {blaetter >= 1 ? (
        <View testID="fernbedienung">
          <Blatt>
            <Text>Fernbedienung</Text>
          </Blatt>
        </View>
      ) : null}
      {blaetter >= 2 ? (
        <View testID="klingel">
          <Blatt haeltWach>
            <Text>Klingel</Text>
          </Blatt>
        </View>
      ) : null}
    </MeldungsProvider>
  );
}

/** Ein Knoten im gezeichneten Baum, wie `toJSON()` ihn liefert. */
interface Knoten {
  props?: Record<string, unknown>;
  children?: (Knoten | string)[] | null;
}

/** Wie viele Absagen unter dem Knoten mit dieser testID stehen. */
function absagenUnter(wurzel: unknown, testID: string): number {
  const zaehle = (knoten: Knoten | string): number => {
    if (typeof knoten === 'string') return 0;
    const eigene = knoten.props?.accessibilityRole === 'alert' ? 1 : 0;
    return eigene + (knoten.children ?? []).reduce((summe, kind) => summe + zaehle(kind), 0);
  };
  const finde = (knoten: Knoten | string): Knoten | null => {
    if (typeof knoten === 'string') return null;
    if (knoten.props?.testID === testID) return knoten;
    for (const kind of knoten.children ?? []) {
      const treffer = finde(kind);
      if (treffer) return treffer;
    }
    return null;
  };
  const liste = Array.isArray(wurzel) ? (wurzel as Knoten[]) : [wurzel as Knoten];
  for (const knoten of liste) {
    const treffer = finde(knoten);
    if (treffer) return zaehle(treffer);
  }
  return 0;
}

const zeichne = (blaetter: number) => {
  act(() => {
    if (baum) baum.update(<Probe blaetter={blaetter} />);
    else baum = create(<Probe blaetter={blaetter} />);
  });
  return baum!.toJSON();
};

describe('Blatt', () => {
  beforeEach(() => {
    beruehrt.mockClear();
    stand = null;
  });
  afterEach(() => {
    // Die Einblendung stellt sich eine Uhr; ohne Abräumen liefe sie
    // nach dem Test weiter.
    act(() => baum?.unmount());
    baum = null;
  });

  it('zeigt die Absage ohne Blatt im Wurzel-View', () => {
    const json = zeichne(0);
    expect(absagenUnter(json, 'wurzel')).toBe(1);
  });

  it('zeigt sie genau einmal, im zuletzt geöffneten Blatt', () => {
    const json = zeichne(2);
    expect(absagenUnter(json, 'wurzel')).toBe(0);
    expect(absagenUnter(json, 'fernbedienung')).toBe(0);
    expect(absagenUnter(json, 'klingel')).toBe(1);
  });

  it('gibt das Band zurück, wenn das oberste Blatt zugeht', () => {
    zeichne(2);
    let json = zeichne(1);
    expect(absagenUnter(json, 'fernbedienung')).toBe(1);
    expect(absagenUnter(json, 'wurzel')).toBe(0);
    json = zeichne(0);
    expect(absagenUnter(json, 'wurzel')).toBe(1);
  });

  it('meldet Berührungen und «hält wach» an die Startseite (Punkt 582)', () => {
    zeichne(2);
    // Zwei Blätter offen, das obere hält wach.
    expect(stand?.haeltWach).toBe(true);
    const [blatt] = baum!.root.findAll(
      (knoten) => typeof knoten.props.onTouchStart === 'function'
    );
    act(() => {
      (blatt.props.onTouchStart as () => void)();
    });
    expect(beruehrt).toHaveBeenCalledTimes(1);
    // Geht die Klingel zu, hält nichts mehr wach.
    zeichne(1);
    expect(stand?.haeltWach).toBe(false);
  });
});
