/**
 * Welches Bild an der Kasse erscheint (Punkt 420 der Werkbank).
 *
 * Die Entscheidung selbst ist in `lib/strichcode.ts` geprüft. Hier geht
 * es um das, was daraus wird: dass ein QR-Gutschein wirklich einen
 * QR-Code zeigt und keinen Strichcode. Genau dieser Schritt fehlte -
 * gerechnet war es vorher schon, gezeichnet immer dasselbe.
 */
import React from 'react';
import { ReactTestRenderer, act, create } from 'react-test-renderer';

import { Kassencode } from './Kassencode';

jest.mock('react-native-qrcode-svg', () => {
  const { Text } = jest.requireActual('react-native');
  const React2 = jest.requireActual('react');
  return {
    __esModule: true,
    default: ({ value }: { value: string }) => React2.createElement(Text, null, `QR:${value}`),
  };
});

/** Alle Texte im gezeichneten Baum, hintereinander. */
function zeichne(element: React.ReactElement): ReactTestRenderer {
  let baum!: ReactTestRenderer;
  act(() => {
    baum = create(element);
  });
  return baum;
}

function texte(element: React.ReactElement): string {
  const baum = zeichne(element).toJSON();
  const sammeln = (knoten: unknown): string => {
    if (typeof knoten === 'string') return knoten;
    if (Array.isArray(knoten)) return knoten.map(sammeln).join(' ');
    if (knoten && typeof knoten === 'object' && 'children' in knoten) {
      return sammeln((knoten as { children: unknown }).children);
    }
    return '';
  };
  return sammeln(baum);
}

describe('Kassencode', () => {
  it('zeichnet einen QR-Code, wenn am Gutschein einer steht', () => {
    expect(texte(<Kassencode nummer="ABCD-1234" art="qr" />)).toContain('QR:ABCD-1234');
  });

  it('zeichnet den Strichcode, solange keiner etwas anderes sagt', () => {
    const gezeigt = texte(<Kassencode nummer="7612345678900" art="strich" />);
    expect(gezeigt).not.toContain('QR:');
    // Die Ziffern unter dem Strichcode - das Zeichen dafür, dass er da ist.
    expect(gezeigt).toContain('7612345678900');
  });

  it('eine Adresse wird auch ohne Angabe zum QR-Code', () => {
    // Als Code 128 wäre sie so breit, dass keine Kasse sie liest.
    expect(texte(<Kassencode nummer="https://brack.ch/gc/AB12" />)).toContain('QR:https://');
  });

  it('ohne Nummer bleibt die Seite leer, statt ein leeres Feld zu zeigen', () => {
    expect(zeichne(<Kassencode nummer="" />).toJSON()).toBeNull();
  });
});
