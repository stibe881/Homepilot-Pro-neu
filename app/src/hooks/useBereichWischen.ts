/**
 * Wischen zwischen den Bereichen (Punkt 522) - das Anmelden der Geste.
 *
 * Beansprucht wird sie erst *während* der Bewegung und nicht in der
 * Capture-Fassung, damit die Kinder Vorrang haben: Der Wischdimmer
 * einer Lampe, die Kachel am Finger, die Storen-Leiste - sie alle
 * nehmen sich waagrechte Bewegungen zuerst. Was übrig bleibt, ist ein
 * Wischen über Karten und Zwischenräume, und das meint den Nachbarn.
 */
import { useMemo, useRef } from 'react';
import { PanResponder } from 'react-native';

import { bereichsRichtung, zimmerRichtung } from '../lib/bereichwischen';

/**
 * `ohneKante` (Punkt 583): Im Zimmer gehört die linke Kante der
 * Zurück-Geste (hooks/useZurueckWischen.ts). Eine Bewegung, die dort
 * begonnen hat, lässt dieser Responder liegen - der äussere nimmt sie
 * dann als «zurück». Die Kinder (Wischdimmer, Storen-Leiste, Kachel am
 * Finger) behalten ihren Vorrang wie beim Bereichswischen: Sie werden
 * zuerst gefragt.
 */
export function useBereichWischen(
  aktiv: boolean,
  wechseln: (richtung: 1 | -1) => void,
  ohneKante = false
) {
  const stand = useRef({ aktiv, wechseln, ohneKante });
  stand.current = { aktiv, wechseln, ohneKante };
  // Wo der Finger aufgesetzt hat - `pageX` ist die Stelle auf dem
  // Bildschirm, und nur die sagt, ob es die Kante war.
  const startX = useRef(Number.NaN);

  const responder = useMemo(() => {
    const richtung = (dx: number, dy: number): 1 | -1 | null =>
      stand.current.ohneKante
        ? zimmerRichtung(startX.current, dx, dy)
        : bereichsRichtung(dx, dy);
    return PanResponder.create({
      onStartShouldSetPanResponderCapture: (event) => {
        // Nichts beanspruchen, nur merken, wo der Finger aufgesetzt hat.
        // In der Capture-Fassung, weil die Bubble-Fassung beim ersten
        // Kind endet, das den Start für sich will - eine Kachel etwa -
        // und dann stünde hier noch der Ort der vorigen Berührung.
        startX.current = event.nativeEvent.pageX;
        return false;
      },
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, geste) =>
        stand.current.aktiv && richtung(geste.dx, geste.dy) !== null,
      onPanResponderRelease: (_event, geste) => {
        const ziel = richtung(geste.dx, geste.dy);
        if (ziel !== null) stand.current.wechseln(ziel);
      },
    });
  }, []);

  return aktiv ? responder.panHandlers : {};
}
