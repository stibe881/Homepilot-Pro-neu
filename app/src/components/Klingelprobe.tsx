import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useEffect } from 'react';

/**
 * Spielt einen Klingelton auf dem Gerät, auf dem man gerade tippt.
 *
 * Mit expo-video statt einer Ton-Bibliothek: expo-video steckt schon in
 * der nativen Hülle (Aufnahmen, Live-Bild, Alarmbildschirm) und spielt
 * eine WAV-Datei genauso wie ein Video. Das spart ein weiteres natives
 * Modul - und damit eine Erhöhung von `runtimeVersion` samt
 * TestFlight-Build, nur um sich achtzehn Töne anzuhören (CLAUDE.md,
 * Abschnitt «Ausliefern»). `expo-audio` kam dafür nicht in Frage: Es
 * liess die App drei Tage lang schwarz starten (Punkt 223).
 *
 * Eigene Datei mit `.web`-Gegenstück wie bei `Aufnahme` - im Browser
 * genügt ein `<audio>`-Element.
 *
 * `takt` zählt die Anklicks: Wer denselben Ton zweimal antippt, will ihn
 * zweimal hören. Am Schlüssel allein liesse sich das nicht ablesen, er
 * ändert sich dabei ja nicht.
 *
 * Gemeldet als «wenn ich auf den Klingelton klicke, kommt kein Ton».
 * Drei Dinge, die hier fehlten und die zusammen erklären, warum das
 * niemand sehen konnte:
 *
 * - **Geladen und abgespielt liefen gegeneinander.** `replace()` stösst
 *   das Laden an; `play()` unmittelbar danach spielt etwas, das noch
 *   gar nicht da ist. `replaceAsync()` sagt, wann es so weit ist - und
 *   die Bibliothek rät ausdrücklich dazu.
 * - **Lautstärke und Stummschaltung standen nirgends.** Ein Abspieler,
 *   den etwas anderes stumm hinterlassen hat, bleibt stumm.
 * - **Kein Fehler kam je heraus.** Schlug das Laden fehl, sah das von
 *   aussen genauso aus wie Erfolg: still.
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
  const player = useVideoPlayer(null, (instance) => {
    // Kein Sperrbildschirm-Eintrag für einen Ton von einer Sekunde: Die
    // Karte «Läuft gerade: doorbell-sound» bliebe danach stehen.
    instance.showNowPlayingNotification = false;
    instance.audioMixingMode = 'duckOthers';
  });

  // Der Aufrufer gibt bei jedem Rendern eine neue Funktion herein - in
  // den Abhängigkeiten unten würde sie den Abspieler laufend neu
  // aufsetzen.
  const onFehlerRef = React.useRef(onFehler);
  onFehlerRef.current = onFehler;

  useEffect(() => {
    if (!uri) return undefined;
    let verworfen = false;
    const melden = (grund: unknown, satz: string) => {
      if (verworfen) return;
      console.warn(`[Klingelton] ${satz} · ${String(grund)}`);
      onFehlerRef.current?.(satz);
    };
    // Erst laden, dann spielen. Andersherum trifft `play()` auf einen
    // Abspieler, der die Datei noch gar nicht hat.
    player
      .replaceAsync(uri)
      .then(() => {
        if (verworfen) return;
        player.muted = false;
        player.volume = 1;
        player.currentTime = 0;
        player.play();
      })
      .catch((err) => melden(err, 'Der Ton liess sich nicht laden'));
    return () => {
      verworfen = true;
    };
  }, [uri, takt, player]);

  // Ein Punkt statt nichts: Ohne angehängte Ansicht hält iOS den
  // Abspieler für unbenutzt und nimmt ihm den Ton weg.
  return <VideoView player={player} style={{ width: 1, height: 1, opacity: 0 }} />;
}
