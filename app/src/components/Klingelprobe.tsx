import { VideoView, useVideoPlayer } from 'expo-video';
import React, { useEffect } from 'react';

/**
 * Spielt einen Klingelton auf dem Gerät, auf dem man gerade tippt.
 *
 * Mit expo-video statt einer Ton-Bibliothek: expo-video steckt schon in
 * der nativen Hülle (Aufnahmen, Live-Bild, Alarmbildschirm) und spielt
 * eine WAV-Datei genauso wie ein Video. Das spart ein weiteres natives
 * Modul - und damit eine Erhöhung von `runtimeVersion` samt
 * TestFlight-Build, nur um sich sechzehn Töne anzuhören (CLAUDE.md,
 * Abschnitt «Ausliefern»). `expo-audio` kam dafür nicht in Frage: Es
 * liess die App drei Tage lang schwarz starten (Punkt 223).
 *
 * Eigene Datei mit `.web`-Gegenstück wie bei `Aufnahme` - im Browser
 * genügt ein `<audio>`-Element.
 *
 * `takt` zählt die Anklicks: Wer denselben Ton zweimal antippt, will ihn
 * zweimal hören. Am Schlüssel allein liesse sich das nicht ablesen, er
 * ändert sich dabei ja nicht.
 */
export function Klingelprobe({ uri, takt }: { uri: string | null; takt: number }) {
  const player = useVideoPlayer(null, (instance) => {
    // Kein Sperrbildschirm-Eintrag für einen Ton von einer Sekunde: Die
    // Karte «Läuft gerade: doorbell-sound» bliebe danach stehen.
    instance.showNowPlayingNotification = false;
    instance.audioMixingMode = 'duckOthers';
  });

  useEffect(() => {
    if (!uri) return;
    // `replace` auch beim selben Schlüssel: Es setzt die Wiedergabe an
    // den Anfang zurück, sonst bliebe der zweite Tipp stumm, weil der
    // Ton schon am Ende steht.
    player.replace(uri);
    player.play();
  }, [uri, takt, player]);

  // Ein Punkt statt nichts: Ohne angehängte Ansicht hält iOS den
  // Abspieler für unbenutzt und nimmt ihm den Ton weg.
  return <VideoView player={player} style={{ width: 1, height: 1, opacity: 0 }} />;
}
