import React, { useEffect, useRef } from 'react';

/**
 * Der Klingelton im Browser - WAV kann jedes Audio-Element von selbst.
 *
 * Gemessen, dass es spielt: Im Browser-Prüfstand steht nach einem Tipp
 * auf «Kuckuck» ein geladenes Element mit `currentTime = 1.56` - also
 * einmal ganz durchgelaufen. Gemeldet wurde trotzdem «es kommt kein
 * Ton», und der Grund, warum das niemand nachvollziehen konnte, stand
 * in dieser Datei: Jeder Fehlschlag ging in ein `.catch(() =>
 * undefined)`. Ein abgelehntes Autoplay, ein 401, eine kaputte Adresse -
 * alles sah von aussen gleich aus, nämlich nach Stille.
 *
 * Deshalb sagt die Komponente jetzt Bescheid. `onFehler` bekommt einen
 * Satz, den die Karte anzeigen kann, und in der Konsole steht die
 * technische Ursache für den, der F12 drückt.
 */
export function Klingelprobe({
  uri,
  takt,
  onFehler,
}: {
  uri: string | null;
  takt: number;
  onFehler?: (satz: string) => void;
}) {
  const ref = useRef<HTMLAudioElement | null>(null);
  // Wie beim Live-Bild: Der Aufrufer gibt bei jedem Rendern eine neue
  // Funktion herein, und in den Abhängigkeiten löste die den Abspieler
  // laufend neu aus.
  const fehlerRef = useRef(onFehler);
  fehlerRef.current = onFehler;

  useEffect(() => {
    const element = ref.current;
    if (!element || !uri) return;
    const melden = (grund: unknown, satz: string) => {
      console.warn(`[Klingelton] ${satz} · ${String(grund)}`);
      fehlerRef.current?.(satz);
    };
    element.onerror = () =>
      melden(
        element.error?.message ?? element.error?.code ?? 'unbekannt',
        'Der Ton liess sich nicht laden'
      );
    try {
      // Zurück an den Anfang, damit der zweite Tipp auf denselben Ton
      // wieder hörbar ist.
      element.currentTime = 0;
    } catch (err) {
      // Ein frisches Element ohne geladene Daten darf das ablehnen -
      // dann spielt es ohnehin von vorn.
      console.warn(`[Klingelton] Zurückspulen abgelehnt · ${String(err)}`);
    }
    void element.play().catch((err) => {
      // Der häufigste Fall ist kein Defekt: Browser verweigern Ton, bis
      // auf der Seite einmal geklickt wurde. Nach dem Tipp auf den Chip
      // ist das erfüllt - bleibt es trotzdem stumm, gehört es gesagt.
      melden(err, 'Der Browser hat den Ton nicht abgespielt');
    });
  }, [uri, takt]);

  if (!uri) return null;
  return <audio ref={ref} src={uri} preload="auto" />;
}
