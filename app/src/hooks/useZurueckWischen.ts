/**
 * Die Zurück-Geste von der linken Kante.
 *
 * Warum an der Kante und nicht überall, steht in lib/zurueckwischen.ts.
 * Hier nur das Anmelden der Geste – und die eine Feinheit, die sie
 * verträglich macht: Beansprucht wird sie erst *während* der Bewegung
 * (`onMoveShouldSetPanResponder`, nicht die Capture-Fassung). Damit
 * haben die Kinder Vorrang: Wer eine Kachel zieht oder über eine Lampe
 * streicht, verliert sie nicht an die Kante.
 */
import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

import { anDerKante, istZurueck } from '../lib/zurueckwischen';

export function useZurueckWischen(aktiv: boolean, zurueck: () => void) {
  // Refs, weil der Responder einmal gebaut wird und sonst für immer die
  // Werte vom ersten Rendern sähe.
  const stand = useRef({ aktiv, zurueck });
  stand.current = { aktiv, zurueck };
  const gestartetAnDerKante = useRef(false);

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: (event) => {
          // Nichts beanspruchen, nur merken, wo der Finger aufgesetzt
          // hat: `pageX` ist die Stelle auf dem Bildschirm, und genau
          // die entscheidet.
          gestartetAnDerKante.current = anDerKante(event.nativeEvent.pageX);
          return false;
        },
        onMoveShouldSetPanResponder: (_event, geste) =>
          stand.current.aktiv &&
          gestartetAnDerKante.current &&
          istZurueck(geste.dx, geste.dy),
        onPanResponderRelease: () => {
          gestartetAnDerKante.current = false;
          stand.current.zurueck();
        },
        onPanResponderTerminate: () => {
          gestartetAnDerKante.current = false;
        },
      }),
    []
  );

  return aktiv ? responder.panHandlers : {};
}
