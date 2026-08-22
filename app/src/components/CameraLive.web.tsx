import Hls from 'hls.js';
import React, { useEffect, useRef, useState } from 'react';
import { ViewStyle } from 'react-native';

/**
 * Live-Bild im Browser.
 *
 * Safari spielt HLS von Haus aus, Chrome und Firefox nicht – dort übernimmt
 * hls.js und füttert das Video-Element selbst. Deshalb gibt es diese Datei
 * neben CameraLive.tsx: Der Bündler nimmt auf dem Web die `.web`-Fassung,
 * auf iPhone und iPad die native mit expo-video – hls.js landet also gar
 * nicht erst im App-Bündel.
 */
export function CameraLive({
  uri,
  muted = true,
  onFailed,
  label = 'Live-Bild der Kamera',
}: {
  uri: string;
  style?: ViewStyle;
  muted?: boolean;
  onFailed?: (message: string) => void;
  /** Was hier zu sehen ist – für die Sprachausgabe. */
  label?: string;
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
      failedRef.current?.(message);
    };

    // Safari und die Browser auf iOS können HLS direkt.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = uri;
      // Autoplay darf der Browser verweigern - dann startet der erste Tipp.
      video.play().catch(() => {});
      return () => {
        video.removeAttribute('src');
        video.load();
      };
    }

    if (!Hls.isSupported()) {
      fail('Dieser Browser kann kein Live-Bild anzeigen');
      return;
    }

    // Wenig Vorlauf: lieber nah am Geschehen als flüssig gepuffert – bei
    // einer Türklingel zählen Sekunden.
    const hls = new Hls({ lowLatencyMode: true, liveSyncDurationCount: 2 });
    // Ein abgerissenes Häppchen im WLAN ist normal und kein Grund, gleich
    // aufs Standbild zurückzufallen – erst nach einem Rettungsversuch.
    let recovered = false;
    hls.on(Hls.Events.ERROR, (_event, data) => {
      if (!data.fatal) return;
      if (!recovered && data.type === Hls.ErrorTypes.NETWORK_ERROR) {
        recovered = true;
        hls.startLoad();
        return;
      }
      if (!recovered && data.type === Hls.ErrorTypes.MEDIA_ERROR) {
        recovered = true;
        hls.recoverMediaError();
        return;
      }
      fail('Der Strom brach ab');
    });
    hls.loadSource(uri);
    hls.attachMedia(video);
    // Wie oben: verweigertes Autoplay heisst nur «erst antippen».
    video.play().catch(() => {});

    return () => hls.destroy();
  }, [uri]);

  if (failed) {
    return (
      <div
        role="img"
        aria-label={`${label}: ${failed}`}
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
      aria-label={label}
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
