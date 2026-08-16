import React, { useEffect, useRef, useState } from 'react';
import { ViewStyle } from 'react-native';

/**
 * Live-Bild im Browser.
 *
 * Safari spielt HLS von Haus aus, Chrome und Firefox nicht – dort übernimmt
 * hls.js und füttert das Video-Element selbst. Deshalb gibt es diese Datei
 * neben CameraLive.tsx: Der Bündler nimmt auf dem Web die `.web`-Fassung,
 * auf iPhone und iPad die native mit expo-video, und hls.js landet gar
 * nicht erst im App-Bündel.
 */
export function CameraLive({
  uri,
  muted = true,
  onFailed,
}: {
  uri: string;
  style?: ViewStyle;
  muted?: boolean;
  onFailed?: () => void;
}) {
  const ref = useRef<HTMLVideoElement | null>(null);
  const [failed, setFailed] = useState<string | null>(null);
  // Der Aufrufer gibt bei jedem Rendern eine neue Funktion herein. Käme die
  // in die Abhängigkeiten, würde der Player laufend neu aufgebaut – das
  // Bild ruckelte im Sekundentakt.
  const failedRef = useRef(onFailed);
  failedRef.current = onFailed;

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    setFailed(null);

    const fail = (message: string) => {
      setFailed(message);
      failedRef.current?.();
    };

    // Safari (und iOS-Browser) können HLS direkt.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = uri;
      video.play().catch(() => {});
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    let player: { destroy: () => void } | null = null;
    let cancelled = false;
    import('hls.js')
      .then(({ default: Hls }) => {
        if (cancelled) return;
        if (!Hls.isSupported()) {
          fail('Dieser Browser kann kein Live-Bild anzeigen');
          return;
        }
        // Wenig Vorlauf: lieber nah am Geschehen als flüssig gepuffert –
        // bei einer Türklingel zählen Sekunden.
        const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2 });
        player = hls;
        hls.on(Hls.Events.ERROR, (_event, data) => {
          if (data.fatal) fail('Der Strom brach ab');
        });
        hls.loadSource(uri);
        hls.attachMedia(video);
        video.play().catch(() => {});
      })
      .catch(() => fail('Videoplayer liess sich nicht laden'));

    return () => {
      cancelled = true;
      player?.destroy();
    };
  }, [uri]);

  if (failed) {
    return (
      <div
        style={{
          flex: 1,
          width: '100%',
          minHeight: 0,
          borderRadius: 18,
          background: '#1C2430',
          color: 'rgba(255,255,255,0.7)',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          fontSize: 13,
        }}
      >
        {failed}
      </div>
    );
  }

  return (
    <video
      ref={ref}
      muted={muted}
      autoPlay
      playsInline
      style={{
        flex: 1,
        width: '100%',
        minHeight: 0,
        objectFit: 'contain',
        borderRadius: 18,
        background: '#000000',
      }}
    />
  );
}
