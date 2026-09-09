import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

import { radius, useColors } from '../theme';

/**
 * So lange darf ein Strom brauchen, bis er Bilder zeigt.
 *
 * Zwölf Sekunden, aus zwei Grenzen: Der Hub gibt seinem ffmpeg-Rückfall
 * fünfzehn Sekunden für die erste Wiedergabeliste (core/streams.py,
 * START_TIMEOUT), und eine Protect-Kamera braucht bis zu acht, bis sie
 * ein vollständiges Bild schickt. Wer länger als zwölf Sekunden auf eine
 * schwarze Fläche schaut, hält das Haus für kaputt - und liegt damit
 * meistens richtig.
 */
const START_FRIST_MS = 12_000;

/**
 * Live-Bild einer Kamera.
 *
 * Der Hub liefert HLS (`stream.m3u8`) – das spielen iPhone und iPad von
 * Haus aus ab. Läuft der Strom nicht an (Kamera offline, RTSP in Protect
 * nicht eingeschaltet), sagt die Komponente das und der Aufrufer kann auf
 * das Standbild zurückfallen.
 *
 * Ton ist standardmässig aus: Ein Wandpanel, das beim Antippen einer
 * Kamera lospoltert, will niemand.
 */
export function CameraLive({
  uri,
  style,
  muted = true,
  onFailed,
  onReady,
  onStalled,
  label = 'Live-Bild der Kamera',
}: {
  uri: string;
  style?: ViewStyle;
  muted?: boolean;
  onFailed?: (message: string) => void;
  /** Der Strom läuft wirklich - erst jetzt hat er ein Bild zu zeigen.
   *
   *  Dazwischen liegen Sekunden: Der Hub zapft die Kamera erst an, wenn
   *  jemand zuschaut, ffmpeg oder mediamtx müssen anlaufen, und der
   *  Player braucht sein erstes Häppchen. Wer das nicht weiss, sieht ein
   *  schwarzes Rechteck und hält die Kamera für kaputt - deshalb sagt
   *  die Komponente Bescheid, statt den Aufrufer raten zu lassen. */
  onReady?: () => void;
  /** Nach der Frist kam immer noch kein Bild - und auch kein Fehler.
   *
   *  Genau so gemeldet, mit Foto: «Live» stand da, und die Fläche blieb
   *  schwarz. Ein Strom, der gar nicht erst anläuft, meldet nämlich
   *  nichts: Der Player wartet auf Häppchen, die nie kommen, und der
   *  Aufrufer wartet auf ein Ereignis, das es nicht gibt. Diese Frist
   *  ist der Ersatz dafür.
   *
   *  Kein Abbruch: Der Strom bleibt eingehängt und darf später doch
   *  noch anlaufen - dann kommt `onReady` wie sonst auch. */
  onStalled?: () => void;
  /** Was hier zu sehen ist – für die Sprachausgabe. Ohne bleibt vom
   *  Livebild nur eine schwarze Fläche ohne Namen. */
  label?: string;
}) {
  const colors = useColors();
  const [failed, setFailed] = useState<string | null>(null);
  // Der Aufrufer gibt bei jedem Rendern eine neue Funktion herein – die darf
  // nicht in die Abhängigkeiten, sonst hängt sich der Zuhörer laufend neu an.
  const failedRef = useRef(onFailed);
  failedRef.current = onFailed;
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const stalledRef = useRef(onStalled);
  stalledRef.current = onStalled;
  // Läuft er? Nicht nur für den Aufrufer - auch die Frist unten hängt
  // daran.
  const [bereit, setBereit] = useState(false);

  const player = useVideoPlayer(uri, (instance) => {
    instance.muted = muted;
    instance.loop = false;
    instance.play();
  });

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error') {
        const message = error?.message ?? 'Der Strom liess sich nicht öffnen';
        setFailed(message);
        failedRef.current?.(message);
      } else if (status === 'readyToPlay') {
        setFailed(null);
        setBereit(true);
        readyRef.current?.();
      }
    });
    return () => subscription.remove();
  }, [player]);

  // Die Frist: Kommt in dieser Zeit kein Bild, sagt die Komponente es -
  // schweigen hiesse hier, eine schwarze Fläche stehen zu lassen.
  useEffect(() => {
    if (bereit || failed) return undefined;
    const timer = setTimeout(() => stalledRef.current?.(), START_FRIST_MS);
    return () => clearTimeout(timer);
  }, [bereit, failed, uri]);

  if (failed) {
    return (
      <View
        style={[styles.fallback, { backgroundColor: colors.surfaceSoft }, style]}
        accessibilityRole="image"
        accessibilityLabel={`${label}: ${failed}`}
      >
        <Text style={[styles.note, { color: colors.inkSoft }]}>{failed}</Text>
      </View>
    );
  }

  return (
    <VideoView
      player={player}
      accessibilityLabel={label}
      style={[styles.video, style]}
      contentFit="contain"
      nativeControls={false}
      allowsPictureInPicture={false}
    />
  );
}

const styles = StyleSheet.create({
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.control,
    backgroundColor: '#000000',
  },
  fallback: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    padding: 12,
  },
  note: { fontSize: 13, textAlign: 'center' },
});
