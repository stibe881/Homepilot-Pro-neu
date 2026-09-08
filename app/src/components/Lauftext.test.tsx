/**
 * Eine Zeile, die durchwandert, wenn sie nicht ganz hineinpasst.
 *
 * Geprüft wird die Entscheidung, nicht die Bewegung: dass gewandert
 * wird, wenn der Text zu lang ist, und dass alles stehen bleibt, wenn
 * er passt. Die Zeiten dazu stehen in lib/lauftext.test.ts; ob es hübsch
 * aussieht, sagt der Augenschein im Browser.
 */
import React from 'react';
import { Text } from 'react-native';
import { ReactTestRenderer, act, create } from 'react-test-renderer';

import { Lauftext } from './Lauftext';

jest.mock('@expo/vector-icons', () => ({ Ionicons: () => null }));

/** Beide Ausfertigungen: erst der Platzhalter, dann die wandernde. */
const texte = (baum: ReactTestRenderer) =>
  baum.root.findAllByType(Text).map((k) => k.props);

/** Der Kasten meldet seine Breite, der Text seine eigene. */
const messen = async (baum: ReactTestRenderer, kasten: number, inhalt: number) => {
  const kaesten = baum.root.findAll((k) => typeof k.props.onLayout === 'function');
  await act(async () => {
    (kaesten[0].props.onLayout as (e: unknown) => void)({
      nativeEvent: { layout: { width: kasten } },
    });
  });
  await act(async () => {
    const inneres = baum.root.findAll(
      (k) => typeof k.props.onLayout === 'function' && typeof k.props.numberOfLines === 'number'
    );
    (inneres[inneres.length - 1].props.onLayout as (e: unknown) => void)({
      nativeEvent: { layout: { width: inhalt } },
    });
  });
};

/** Was man sieht: opacity 0 heisst weg. */
const sichtbar = (props: Record<string, unknown>) =>
  JSON.stringify(props.style ?? null).includes('"opacity":0') === false;

// Die Bewegung läuft in Schleife weiter, auch wenn die Prüfung längst
// durch ist - ein Animated.loop, den niemand abräumt, hält den ganzen
// Prüflauf am Leben und stürzt danach ab.
let offen: ReactTestRenderer | null = null;

afterEach(() => {
  act(() => {
    offen?.unmount();
  });
  offen = null;
});

describe('Lauftext', () => {
  it('lässt stehen, was passt', async () => {
    let baum!: ReactTestRenderer;
    await act(async () => {
      offen = baum = create(<Lauftext>08:50 Chrabbelzwergli</Lauftext>);
    });
    await messen(baum, 300, 180);
    const [platzhalter, wandernd] = texte(baum);
    // Der Platzhalter ist die gewöhnliche Zeile - sie bleibt.
    expect(sichtbar(platzhalter)).toBe(true);
    expect(platzhalter.numberOfLines).toBe(1);
    // Und die zweite Ausfertigung wird nicht gezeigt; sie bleibt nur
    // gezeichnet, weil sich sonst niemand mehr messen könnte.
    expect(wandernd).toBeTruthy();
  });

  it('wandert, wenn der Text nicht hineinpasst', async () => {
    let baum!: ReactTestRenderer;
    await act(async () => {
      offen = baum = create(
        <Lauftext>08:50 Chrabbelzwergli Bine + Aline / finja hüten 9.15, Sinja</Lauftext>
      );
    });
    await messen(baum, 300, 520);
    const [platzhalter] = texte(baum);
    // Jetzt tritt der Platzhalter zurück: Zwei sichtbare Ausfertigungen
    // übereinander wären ein Doppelbild.
    expect(sichtbar(platzhalter)).toBe(false);
  });

  it('steht still, solange nichts gemessen ist', async () => {
    // Beim ersten Zeichnen ist beides 0 - da wird nichts behauptet.
    let baum!: ReactTestRenderer;
    await act(async () => {
      offen = baum = create(<Lauftext>Irgendwas</Lauftext>);
    });
    expect(sichtbar(texte(baum)[0])).toBe(true);
  });

  it('sagt denselben Satz nur einmal an', async () => {
    // Die zweite Ausfertigung ist für die Vorlesefunktion nicht da -
    // sonst hörte man jeden Termin zweimal.
    let baum!: ReactTestRenderer;
    await act(async () => {
      offen = baum = create(<Lauftext>Pia morgen</Lauftext>);
    });
    const versteckt = baum.root.findAll(
      (k) => k.props.importantForAccessibility === 'no-hide-descendants'
    );
    expect(versteckt.length).toBeGreaterThan(0);
    // Der Platzhalter dagegen bleibt lesbar - er ist der mit dem
    // ganzen Satz, auch wo die Pünktchen stehen.
    const [platzhalter] = texte(baum);
    expect(platzhalter.importantForAccessibility).toBeUndefined();
  });
});
