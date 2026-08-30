import React, { useEffect, useRef, useState } from 'react';
import { AccessibilityInfo, Animated, ViewStyle } from 'react-native';

/**
 * Der Übergang beim Wechsel des Ortes.
 *
 * Der Sprung von «Räume» zu «Licht» war ein hartes Umschalten: Ein Bild
 * verschwindet, ein anderes steht da. Man sieht dabei nicht, dass man
 * gegangen ist – man findet sich plötzlich anderswo, und der Blick sucht
 * kurz, wo er gelandet ist.
 *
 * Zwei, drei Zehntel Blenden mit einem kleinen Aufwärts machen aus dem
 * Umschalten ein Gehen. Bewusst nur dort, wo man den Ort wechselt –
 * nicht bei jedem Knopf: Eine Oberfläche, in der sich ständig etwas
 * bewegt, ist unruhig, und Unruhe ist teurer als der Gewinn.
 *
 * **Es blendet, es schiebt nicht.** Ein seitliches Schieben müsste
 * wissen, ob man vor oder zurück geht; das weiss hier niemand, und ein
 * Übergang, der in die falsche Richtung läuft, ist schlimmer als keiner.
 *
 * **Wer weniger Bewegung eingestellt hat, bekommt keine.** Dieselbe
 * Regel wie beim blinkenden Punkt der Kopfzeile: Die Auskunft bleibt,
 * nur die Bewegung fällt weg.
 */

/** Wie lange der Auftritt dauert. Kurz genug, dass niemand darauf
 *  wartet - lang genug, dass man ihn als Bewegung liest. */
export const DAUER = 220;

/** Von so weit unten kommt der Inhalt herauf. Ein kleiner Weg: Es soll
 *  wie Auftauchen wirken, nicht wie Hereinfliegen. */
export const WEG = 10;

export function Auftritt({
  /** Ändert sich dieser Wert, tritt der Inhalt neu auf. */
  schluessel,
  style,
  children,
}: {
  schluessel: string;
  style?: ViewStyle | ViewStyle[];
  children: React.ReactNode;
}) {
  const fortschritt = useRef(new Animated.Value(1)).current;
  const [ruhig, setRuhig] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setRuhig)
      // Nicht abfragbar heisst: normal animieren.
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (ruhig) {
      fortschritt.setValue(1);
      return;
    }
    fortschritt.setValue(0);
    const lauf = Animated.timing(fortschritt, {
      toValue: 1,
      duration: DAUER,
      useNativeDriver: true,
    });
    lauf.start();
    // Beim schnellen Weiterklicken nicht zwei Läufe übereinander: Der
    // alte hört auf, wo er ist, und der neue fängt bei null an.
    return () => lauf.stop();
  }, [schluessel, ruhig, fortschritt]);

  return (
    <Animated.View
      style={[
        style,
        {
          opacity: fortschritt,
          transform: [
            {
              translateY: fortschritt.interpolate({
                inputRange: [0, 1],
                outputRange: [WEG, 0],
              }),
            },
          ],
        },
      ]}
    >
      {children}
    </Animated.View>
  );
}
