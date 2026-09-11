import React, { useEffect, useRef } from 'react';

/** Der Klingelton im Browser - WAV kann jedes Audio-Element von selbst. */
export function Klingelprobe({ uri, takt }: { uri: string | null; takt: number }) {
  const ref = useRef<HTMLAudioElement | null>(null);

  useEffect(() => {
    const element = ref.current;
    if (!element || !uri) return;
    // Zurück an den Anfang, damit der zweite Tipp auf denselben Ton
    // wieder hörbar ist. `play()` gibt ein Versprechen zurück, das der
    // Browser ablehnt, wenn zwischendurch neu geladen wird - das ist
    // kein Fehler, den jemand sehen müsste.
    element.currentTime = 0;
    void element.play().catch(() => undefined);
  }, [uri, takt]);

  if (!uri) return null;
  return <audio ref={ref} src={uri} preload="auto" />;
}
