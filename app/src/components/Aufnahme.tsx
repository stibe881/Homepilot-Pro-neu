import { VideoView, useVideoPlayer } from 'expo-video';
import React from 'react';
import { ViewStyle } from 'react-native';

/**
 * Die Aufnahme zu einem Zeitleisten-Ereignis (MP4 vom Hub).
 *
 * Eigene Datei mit `.web`-Gegenstück wie bei CameraLive: Der Bündler
 * nimmt im Browser die Fassung mit dem `<video>`-Element, auf iPhone
 * und iPad diese mit expo-video - so hängt der Web-Bau nicht an der
 * Web-Tauglichkeit von expo-video.
 */
export function Aufnahme({ uri, style }: { uri: string; style?: ViewStyle }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.play();
  });
  return <VideoView player={player} style={style} nativeControls contentFit="contain" />;
}
