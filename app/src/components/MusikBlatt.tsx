import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { CommandData, Entity } from '../api/types';
import { useMusikwahl } from '../hooks/useMusikwahl';
import { musikboxenImRaum, pickPlayer } from '../lib/geraeteart';
import { Colors, radius, space, useColors } from '../theme';
import { MediaPanel } from './SidePanel';

/**
 * Der Player der Startseite als Blatt über der Raumkachel.
 *
 * Der Musik-Knopf auf der Raumkachel schaltete bisher nur Play/Pause
 * auf der Raumbox - wer eine Playlist wollte, musste auf die Startseite
 * zurück und dort erst die richtige Box wählen. Jetzt öffnet der Knopf
 * denselben Player wie dort, nur mit der Box des Raums schon gewählt:
 * Der Weg «Zimmer antippen, Musik, Playlist» kommt ohne Umweg aus.
 *
 * Es ist bewusst *derselbe* Player (MediaPanel aus SidePanel.tsx), kein
 * zweiter: Auch die Boxwahl-Regeln reisen mit (lib/boxwahl.ts) - die
 * Kette, die schon einmal Musik auf der Terrasse statt im Büro hat
 * spielen lassen, soll genau einmal existieren.
 */
export function MusikBlatt({
  raum,
  entities,
  onCommand,
  onSchliessen,
}: {
  raum: string;
  entities: Entity[];
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
  onSchliessen: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Vorgewählt ist die Box des Raums - deswegen ist man ja hier. Hat der
  // Raum keine (mehr), fällt das Blatt auf die naheliegende des Hauses
  // zurück, statt leer dazustehen (hooks/useMusikwahl.ts).
  const raumBox = useMemo(
    () => pickPlayer(musikboxenImRaum(entities, raum)),
    [entities, raum]
  );
  const musik = useMusikwahl(entities, onCommand, raumBox, raum);
  const player = musik.player;

  if (!player) return null;
  return (
    <Modal visible animationType="fade" transparent onRequestClose={onSchliessen}>
      <Pressable
        style={styles.grund}
        onPress={onSchliessen}
        accessibilityLabel="Musik schliessen"
      >
        <Pressable style={styles.blatt} onPress={() => {}}>
          <MediaPanel
            entity={player}
            players={musik.players}
            titel={raum}
            activeDevice={musik.activeDevice}
            onSelect={musik.waehlen}
            onCommand={onCommand}
            wunschBox={musik.wunschBox}
          />
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    grund: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      justifyContent: 'center',
      padding: space.gap,
    },
    // Das Blatt selbst bleibt schmal: MediaPanel ist für die Spaltenbreite
    // der Startseite gebaut, nicht für ein volles iPad quer.
    blatt: {
      alignSelf: 'center',
      width: '100%',
      maxWidth: 420,
      backgroundColor: colors.panel,
      borderRadius: radius.card,
      padding: 10,
    },
  });
