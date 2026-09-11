/**
 * Wischen zwischen den Bereichen (Punkt 433) - das Anmelden der Geste.
 *
 * Beansprucht wird sie erst *während* der Bewegung und nicht in der
 * Capture-Fassung, damit die Kinder Vorrang haben: Der Wischdimmer
 * einer Lampe, die Kachel am Finger, die Storen-Leiste - sie alle
 * nehmen sich waagrechte Bewegungen zuerst. Was übrig bleibt, ist ein
 * Wischen über Karten und Zwischenräume, und das meint den Nachbarn.
 */
import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

import { bereichsRichtung } from '../lib/bereichwischen';

export function useBereichWischen(aktiv: boolean, wechseln: (richtung: 1 | -1) => void) {
  const stand = useRef({ aktiv, wechseln });
  stand.current = { aktiv, wechseln };

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (_event, geste) =>
          stand.current.aktiv && bereichsRichtung(geste.dx, geste.dy) !== null,
        onPanResponderRelease: (_event, geste) => {
          const richtung = bereichsRichtung(geste.dx, geste.dy);
          if (richtung !== null) stand.current.wechseln(richtung);
        },
      }),
    []
  );

  return aktiv ? responder.panHandlers : {};
}
