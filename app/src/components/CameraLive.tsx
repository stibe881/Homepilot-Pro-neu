import React, { useEffect, useState } from 'react';
import { StyleSheet, Text, View, ViewStyle } from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';

import { Colors, radius, useColors } from '../theme';

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
}: {
  uri: string;
  style?: ViewStyle;
  muted?: boolean;
  onFailed?: () => void;
}) {
  const colors = useColors();
  const [failed, setFailed] = useState<string | null>(null);

  const player = useVideoPlayer(uri, (instance) => {
    instance.muted = muted;
    instance.loop = false;
    instance.play();
  });

  useEffect(() => {
    const subscription = player.addListener('statusChange', ({ status, error }) => {
      if (status === 'error') {
        setFailed(error?.message ?? 'Der Strom liess sich nicht öffnen');
        onFailed?.();
      } else if (status === 'readyToPlay') {
        setFailed(null);
      }
    });
    return () => subscription.remove();
  }, [player, onFailed]);

  if (failed) {
    return (
      <View style={[styles.fallback, { backgroundColor: colors.surfaceSoft }, style]}>
        <Text style={[styles.note, { color: colors.inkSoft }]}>{failed}</Text>
      </View>
    );
  }

  return (
    <VideoView
      player={player}
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
