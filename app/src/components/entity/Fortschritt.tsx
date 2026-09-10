/**
 * Wie weit ist der Titel – und der Griff zum Spulen.
 *
 * Die Kachel wusste bisher, dass etwas läuft; wie weit und wie lang
 * stand nirgends. «Wie lange geht der Podcast noch?» war damit nicht zu
 * beantworten, und zurückspulen ging gar nicht.
 *
 * Der Balken läuft in der App weiter, denn der Hub meldet sich nur bei
 * Änderungen (siehe lib/fortschritt.ts). Getickt wird nur, solange etwas
 * spielt – ein Timer, der auf einer pausierten Kachel weiterläuft,
 * kostet Strom für eine Zahl, die sich nicht ändert.
 */
import React, { useMemo, useState } from 'react';
import { Text, View } from 'react-native';

import { CommandData, Entity } from '../../api/types';
import { useTakt } from '../../hooks/useTakt';
import { darfSpringen, fortschritt, sprungziel } from '../../lib/fortschritt';
import { useColors } from '../../theme';
import { Bar } from '../Bar';

import { makeStyles } from './stil';

export function Fortschritt({
  entity,
  onCommand,
}: {
  entity: Entity;
  onCommand: (command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const spielt = String(entity.state.state) === 'playing';
  // Der Takt: einmal pro Sekunde, aber nur beim Spielen. Punkt 345: über
  // den gemeinsamen Takt statt einem eigenen setInterval.
  const [, tick] = useState(0);
  useTakt(() => tick((wert) => wert + 1), spielt ? 1000 : null);

  const stand = fortschritt(entity.state);
  if (!stand) return null;
  const springen = darfSpringen(entity.state, entity.commands);

  return (
    <View style={styles.fortschrittBox}>
      <Bar
        height={springen ? 18 : 6}
        value={stand.anteil}
        disabled={!springen}
        onChange={(anteil) =>
          onCommand('seek', { position: sprungziel(anteil, stand.duration) })
        }
      />
      <View style={styles.fortschrittZeile}>
        <Text style={styles.fortschrittZeit}>{stand.gelaufen}</Text>
        <Text style={styles.fortschrittZeit}>{stand.rest}</Text>
      </View>
    </View>
  );
}
