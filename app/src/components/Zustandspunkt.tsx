/**
 * Der Punkt an einer Kachel, der an und aus geht - mit Übergang.
 *
 * Punkt 292/443 der Werkbank: Eine Kachel sprang von aus auf an. Der
 * Sprung ist der Grund, warum man zweimal tippt - man hat nicht
 * gesehen, dass beim ersten Mal schon etwas geschah.
 *
 * Bewusst als eigene Komponente und nicht als Stil in der Kachel: Der
 * Übergang gehört an jede Stelle, an der ein Zustand umspringt, und
 * eine Animation, die an drei Orten je einmal nachgebaut wird, läuft an
 * drei Orten verschieden.
 *
 * Die Zahlen stehen in lib/uebergang.ts - dort lassen sie sich prüfen,
 * ohne einen Bildschirm zu bauen.
 */
import React, { useEffect, useRef } from 'react';
import { Animated, Easing, StyleProp, ViewStyle } from 'react-native';

import { bewegtSich, dauerMs } from '../lib/uebergang';

export function Zustandspunkt({
  an,
  anFarbe,
  ausFarbe,
  /** Wann zuletzt auf dieses Gerät getippt wurde - für die Frage, ob
   *  der Wechsel von mir kam oder von selbst (lib/uebergang.ts). */
  getipptAt,
  style,
}: {
  an: boolean;
  anFarbe: string;
  ausFarbe: string;
  getipptAt?: number | null;
  style?: StyleProp<ViewStyle>;
}) {
  // 0 = aus, 1 = an. Der Anfangswert ist der *jetzige* Zustand: Beim
  // ersten Aufbau soll nichts laufen, sonst wären beim Öffnen der App
  // dreissig Kacheln gleichzeitig in Bewegung.
  const wert = useRef(new Animated.Value(an ? 1 : 0)).current;
  const vorher = useRef<boolean | undefined>(undefined);

  useEffect(() => {
    const wechsel = bewegtSich(vorher.current, an);
    vorher.current = an;
    if (!wechsel) {
      wert.setValue(an ? 1 : 0);
      return;
    }
    Animated.timing(wert, {
      toValue: an ? 1 : 0,
      duration: dauerMs(getipptAt, Date.now()),
      // Sanft heraus, nicht linear: Ein Licht geht auch nicht mit
      // gleichbleibender Geschwindigkeit an.
      easing: Easing.out(Easing.quad),
      // Farben kann der native Treiber nicht - das ist der Preis, und
      // bei einem Punkt von zehn Punkten Grösse merkt man ihn nicht.
      useNativeDriver: false,
    }).start();
  }, [an, getipptAt, wert]);

  return (
    <Animated.View
      style={[
        style,
        {
          backgroundColor: wert.interpolate({
            inputRange: [0, 1],
            outputRange: [ausFarbe, anFarbe],
          }),
        },
      ]}
    />
  );
}
