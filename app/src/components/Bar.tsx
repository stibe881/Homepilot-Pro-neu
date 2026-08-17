import { LinearGradient } from 'expo-linear-gradient';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { Colors, radius, useColors } from '../theme';

interface Props {
  value: number; // 0…100
  onChange: (value: number) => void;
  gradient?: [string, string, ...string[]];
  height?: number;
  disabled?: boolean;
}

const clamp = (value: number) => Math.max(0, Math.min(100, Math.round(value)));

/**
 * Zieh- und antippbarer Balken.
 *
 * Die Position wird beim Aufsetzen aus locationX genommen und danach über
 * die Verschiebung (dx) fortgeschrieben – dx ist auf allen Plattformen
 * verlässlich, während locationX während der Bewegung je nach Ziel-Element
 * springen kann.
 */
export function Bar({ value, onChange, gradient, height = 46, disabled }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [width, setWidth] = useState(0);
  const widthRef = useRef(0);
  const startRef = useRef(0);
  const changeRef = useRef(onChange);
  changeRef.current = onChange;
  // Der Wert, den der Finger gerade setzt. Solange er steht, zeigt der
  // Balken ihn und nicht den Wert vom Gerät – sonst zappelt er zwischen
  // Fingerposition und der Antwort, die Sekunden später eintrifft.
  const [local, setLocal] = useState<number | null>(null);

  const at = (x: number): number | null =>
    widthRef.current > 0 ? clamp((x / widthRef.current) * 100) : null;

  const pan = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => !disabled,
        onMoveShouldSetPanResponder: () => !disabled,
        onPanResponderGrant: (event) => {
          startRef.current = event.nativeEvent.locationX;
          const next = at(startRef.current);
          if (next != null) setLocal(next);
        },
        onPanResponderMove: (_event, gesture) => {
          const next = at(startRef.current + gesture.dx);
          if (next != null) setLocal(next);
        },
        // Erst beim Loslassen senden. Vorher war es ein Befehl je Pixel –
        // beim Lautstärkeregler also Dutzende Aufrufe an Spotify, die sich
        // gegenseitig überholten und den Regler zäh wirken liessen.
        onPanResponderRelease: (_event, gesture) => {
          const next = at(startRef.current + gesture.dx);
          if (next != null) {
            setLocal(next);
            changeRef.current(next);
          }
        },
        onPanResponderTerminate: () => setLocal(null),
      }),
    [disabled]
  );

  // Meldet das Gerät den gesetzten Wert zurück, wieder ihm folgen. Der
  // Zeitgeber ist die Rückfallebene: Rundet das Gerät anders, klebte der
  // Balken sonst für immer am selbstgesetzten Wert.
  useEffect(() => {
    if (local == null) return;
    if (Math.abs(clamp(value) - local) <= 2) {
      setLocal(null);
      return;
    }
    const timer = setTimeout(() => setLocal(null), 4000);
    return () => clearTimeout(timer);
  }, [value, local]);

  // Bei 0 gar nichts füllen – ein Reststummel sähe aus wie ein Fehler.
  const ratio = clamp(local ?? value) / 100;
  const filled = ratio === 0 ? 0 : Math.max(14, ratio * width);

  return (
    <View
      {...pan.panHandlers}
      onLayout={(event) => {
        widthRef.current = event.nativeEvent.layout.width;
        setWidth(event.nativeEvent.layout.width);
      }}
      style={[styles.track, { height, opacity: disabled ? 0.5 : 1 }]}
    >
      <View style={[styles.fillClip, { width: filled, height }]}>
        <LinearGradient
          colors={gradient ?? colors.warmCool}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 0 }}
          // Der Verlauf bezieht sich auf den ganzen Balken, nicht auf den
          // gefüllten Teil – sonst wanderten die Farben beim Regeln mit.
          style={{ width: Math.max(width, 1), height }}
        />
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  track: {
    backgroundColor: colors.track,
    borderRadius: radius.control,
    overflow: 'hidden',
    width: '100%',
  },
  fillClip: {
    borderRadius: radius.control,
    overflow: 'hidden',
  },
});
