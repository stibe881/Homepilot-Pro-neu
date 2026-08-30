import React from 'react';
import { ViewStyle } from 'react-native';

/** Die Aufnahme im Browser - MP4 kann jedes Video-Element von selbst. */
export function Aufnahme({ uri, style }: { uri: string; style?: ViewStyle }) {
  return (
    <video
      src={uri}
      controls
      autoPlay
      playsInline
      style={{ ...(style as React.CSSProperties), objectFit: 'contain' }}
    />
  );
}
