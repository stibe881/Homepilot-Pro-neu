import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet } from 'react-native';

import { CommandData, Entity } from '../api/types';
import { boxWechsel } from '../lib/boxwahl';
import {
  hatEigeneAuswahl,
  istMusikbox,
  musikboxenImRaum,
  pickPlayer,
} from '../lib/geraeteart';
import { Colors, radius, space, useColors } from '../theme';
import { MediaPanel, wechselQuelle } from './SidePanel';

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

  const players = useMemo(() => entities.filter(istMusikbox), [entities]);
  // Vorgewählt ist die Box des Raums - deswegen ist man ja hier. Hat der
  // Raum keine (mehr), fällt das Blatt auf die naheliegende des Hauses
  // zurück, statt leer dazustehen.
  const raumBox = useMemo(
    () => pickPlayer(musikboxenImRaum(entities, raum)),
    [entities, raum]
  );
  const [chosenId, setChosenId] = useState<string | null>(raumBox?.id ?? null);
  const [wunschBox, setWunschBox] = useState<string | null>(null);
  const player =
    (chosenId ? players.find((entity) => entity.id === chosenId) : undefined) ??
    raumBox ??
    pickPlayer(entities);

  const choose = (ziel: Entity) => {
    const quelle = player && hatEigeneAuswahl(player) ? player : undefined;
    const wechsel = boxWechsel(quelle ? wechselQuelle(quelle) : null, ziel);
    if (wechsel.art === 'umzug' && quelle) {
      onCommand(quelle.id, 'play_on', { device: wechsel.device, play: wechsel.play });
      setChosenId(quelle.id);
      setWunschBox(wechsel.device);
    } else {
      setChosenId(ziel.id);
    }
  };

  // Wie im SidePanel: Sobald die gewünschte Box die aktive ist, hat der
  // Wunsch seinen Dienst getan.
  useEffect(() => {
    if (wunschBox && player?.state.device === wunschBox) setWunschBox(null);
  }, [wunschBox, player?.state.device]);

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
            players={players}
            titel={raum}
            activeDevice={
              hatEigeneAuswahl(player) ? ((player.state.device as string) ?? null) : null
            }
            onSelect={choose}
            onCommand={onCommand}
            wunschBox={wunschBox}
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
