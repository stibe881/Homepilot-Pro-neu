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
/** Wie lange ein Strom brauchen darf, bis er Bilder zeigt - dieselbe
 *  Frist wie nativ, samt Begründung in CameraLive.tsx. */
const START_FRIST_MS = 12_000;

export function CameraLive({
  uri,
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
  /** Der Strom läuft wirklich - siehe CameraLive.tsx. */
  onReady?: () => void;
  /** Nach der Frist kam kein Bild und auch kein Fehler - siehe
   *  CameraLive.tsx. Kein Abbruch: Er darf später doch noch anlaufen. */
  onStalled?: () => void;
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
  const readyRef = useRef(onReady);
  readyRef.current = onReady;
  const stalledRef = useRef(onStalled);
  stalledRef.current = onStalled;
  const [bereit, setBereit] = useState(false);

  useEffect(() => {
    const video = ref.current;
    if (!video) return;
    setFailed(null);

    const fail = (message: string) => {
      setFailed(message);
      failedRef.current?.(message);
    };

    // «playing» und nicht «canplay»: Gemeint ist der Moment, in dem
    // wirklich Bilder kommen - bis dahin zeigt der Aufrufer das
    // Standbild weiter.
    const laeuft = () => {
      setBereit(true);
      readyRef.current?.();
    };
    video.addEventListener('playing', laeuft);

    // Safari und die Browser auf iOS können HLS direkt.
    if (video.canPlayType('application/vnd.apple.mpegurl')) {
      video.src = uri;
      // Autoplay darf der Browser verweigern - dann startet der erste Tipp.
      video.play().catch(() => {});
      return () => {
        video.removeEventListener('playing', laeuft);
        video.removeAttribute('src');
        video.load();
      };
    }

    if (!Hls.isSupported()) {
      video.removeEventListener('playing', laeuft);
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
      // Jede Klage in die Konsole, auch die nicht tödliche. Der Grund
      // steht in einem Bildschirmfoto einer schwarzen Fläche: hls.js
      // hört bei einem stehenden Puffer («bufferStalledError») nicht auf
      // und meldet auch nichts nach aussen - es kommt einfach kein Bild.
      // Wer dann F12 drückt, soll den Grund lesen können, statt raten zu
      // müssen. Eine Zeile je Klage; sie kosten nichts, solange alles
      // läuft, denn dann kommt keine.
      console.warn(
        `[Live-Bild] ${data.type} · ${data.details}` +
          `${data.fatal ? ' · endgültig' : ''}` +
          `${data.response?.code ? ` · HTTP ${data.response.code}` : ''}`
      );
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

    return () => {
      video.removeEventListener('playing', laeuft);
      hls.destroy();
    };
  }, [uri]);

  // Die Frist: Kommt in dieser Zeit kein Bild, sagt die Komponente es -
  // schweigen hiesse hier, eine schwarze Fläche stehen zu lassen. Der
  // Strom bleibt dabei eingehängt und darf später doch noch anlaufen.
  useEffect(() => {
    if (bereit || failed) return undefined;
    const timer = setTimeout(() => stalledRef.current?.(), START_FRIST_MS);
    return () => clearTimeout(timer);
  }, [bereit, failed, uri]);

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
