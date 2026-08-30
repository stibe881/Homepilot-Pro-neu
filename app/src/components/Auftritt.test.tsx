/**
 * Der Übergang beim Ortswechsel.
 *
 * Geprüft wird das, was man an einem Bild nicht sieht: dass der Inhalt
 * überhaupt dasteht und dass ein neuer Schlüssel ihn nicht wegwirft.
 * Ob es hübsch aussieht, sagt der Augenschein im Browser.
 */
import React from 'react';
import { Text } from 'react-native';
import { ReactTestRenderer, act, create } from 'react-test-renderer';

import { Auftritt, DAUER, WEG } from './Auftritt';

const texte = (baum: ReactTestRenderer): string[] =>
  baum.root.findAllByType(Text).map((knoten) => String(knoten.props.children));

describe('Auftritt', () => {
  it('zeigt seinen Inhalt', () => {
    let baum!: ReactTestRenderer;
    act(() => {
      baum = create(
        <Auftritt schluessel="home:alle">
          <Text>Wohnzimmer</Text>
        </Auftritt>
      );
    });
    expect(texte(baum)).toEqual(['Wohnzimmer']);
  });

  it('behält den Inhalt beim Ortswechsel', () => {
    // Der Übergang blendet - er wirft nichts weg. Ein Auftritt, der die
    // Seite kurz leert, wäre ein Flackern und kein Gehen.
    let baum!: ReactTestRenderer;
    act(() => {
      baum = create(
        <Auftritt schluessel="home:alle">
          <Text>Wohnzimmer</Text>
        </Auftritt>
      );
    });
    act(() => {
      baum.update(
        <Auftritt schluessel="home:Büro">
          <Text>Büro</Text>
        </Auftritt>
      );
    });
    expect(texte(baum)).toEqual(['Büro']);
  });

  it('bleibt kurz und klein', () => {
    // Lang genug, dass man ihn als Bewegung liest, kurz genug, dass
    // niemand darauf wartet - und ein kleiner Weg, damit es wie
    // Auftauchen wirkt und nicht wie Hereinfliegen.
    expect(DAUER).toBeLessThanOrEqual(300);
    expect(WEG).toBeLessThanOrEqual(16);
  });
});
