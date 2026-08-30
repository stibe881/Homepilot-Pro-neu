import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { CommandData } from '../api/types';
import { tapped } from '../lib/haptics';
import { Colors, radius, useColors } from '../theme';
import { useKachelDruck } from './entity/kacheldruck';

/**
 * Das Steuerkreuz auf der Fernseh-Kachel.
 *
 * Auf der Kachel standen drei Transportknöpfe (zurück, Wiedergabe,
 * weiter) - und die sind für einen Fernseher das Falsche: Ein Android TV
 * meldet nie, ob gerade etwas läuft, «weiter» springt je nach App
 * irgendwohin, und was man tatsächlich tun will, ist navigieren. Genau
 * dafür gibt es das Kreuz.
 *
 * Die vollständige Fernbedienung (Zifferntasten, Apps, Zurück-Verlauf)
 * bleibt als Blatt darüber - hier stehen die fünf Tasten, die man im
 * Vorbeigehen braucht, ohne dass sich etwas öffnen muss.
 *
 * Die Tasten stehen auf Modulebene, und das ist keine Stilfrage: Eine
 * Komponente, die im Rumpf definiert wird, ist für React bei jedem
 * Rendern ein neuer Typ - und weil der Hub über den WebSocket laufend
 * Zustände schickt, bricht das eine Berührung mitten in der Geste ab.
 * Derselbe Fall steht ausführlich in TvRemote.tsx.
 */
function Taste({
  icon,
  label,
  onDruck,
  stil,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  onDruck: () => void;
  stil?: object;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const langerDruck = useKachelDruck();
  return (
    <Pressable
      onPress={() => {
        tapped();
        onDruck();
      }}
      onLongPress={langerDruck}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.taste, stil, pressed && { opacity: 0.55 }]}
    >
      <Ionicons name={icon} size={18} color={colors.ink} />
    </Pressable>
  );
}

export function TvSteuerkreuz({
  onCommand,
  onMehr,
  lautstaerke,
}: {
  onCommand: (command: string, data?: CommandData) => void;
  /** Die vollständige Fernbedienung aufmachen. */
  onMehr?: () => void;
  /** Die beiden Lautstärketasten daneben. Wo die Kachel schon einen
   *  Schieber hat (TvVolume), wären sie ein zweiter Weg zum selben Ziel. */
  lautstaerke?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const langerDruck = useKachelDruck();
  return (
    <View style={styles.reihe}>
      {lautstaerke ? (
        <View style={styles.tonSpalte}>
          <Taste icon="add" label="Lauter" onDruck={() => onCommand('volume_up')} />
          <Text style={styles.tonWort}>Ton</Text>
          <Taste icon="remove" label="Leiser" onDruck={() => onCommand('volume_down')} />
        </View>
      ) : null}
      <View style={styles.kreuz}>
        <Pressable
          onPress={() => {
            tapped();
            onCommand('dpad_up');
          }}
          onLongPress={langerDruck}
          accessibilityRole="button"
          accessibilityLabel="Hoch"
          style={({ pressed }) => [styles.pfeil, styles.oben, pressed && { opacity: 0.5 }]}
        >
          <Ionicons name="chevron-up" size={20} color={colors.ink} />
        </Pressable>
        <Pressable
          onPress={() => {
            tapped();
            onCommand('dpad_down');
          }}
          onLongPress={langerDruck}
          accessibilityRole="button"
          accessibilityLabel="Runter"
          style={({ pressed }) => [styles.pfeil, styles.unten, pressed && { opacity: 0.5 }]}
        >
          <Ionicons name="chevron-down" size={20} color={colors.ink} />
        </Pressable>
        <Pressable
          onPress={() => {
            tapped();
            onCommand('dpad_left');
          }}
          onLongPress={langerDruck}
          accessibilityRole="button"
          accessibilityLabel="Links"
          style={({ pressed }) => [styles.pfeil, styles.links, pressed && { opacity: 0.5 }]}
        >
          <Ionicons name="chevron-back" size={20} color={colors.ink} />
        </Pressable>
        <Pressable
          onPress={() => {
            tapped();
            onCommand('dpad_right');
          }}
          onLongPress={langerDruck}
          accessibilityRole="button"
          accessibilityLabel="Rechts"
          style={({ pressed }) => [styles.pfeil, styles.rechts, pressed && { opacity: 0.5 }]}
        >
          <Ionicons name="chevron-forward" size={20} color={colors.ink} />
        </Pressable>
        <Pressable
          onPress={() => {
            tapped();
            onCommand('ok');
          }}
          onLongPress={langerDruck}
          accessibilityRole="button"
          accessibilityLabel="OK"
          style={({ pressed }) => [styles.ok, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.okWort}>OK</Text>
        </Pressable>
      </View>
      <View style={styles.tonSpalte}>
        <Taste icon="arrow-undo-outline" label="Zurück" onDruck={() => onCommand('back')} />
        <Taste icon="home-outline" label="Startseite" onDruck={() => onCommand('home')} />
        {onMehr ? (
          <Taste
            icon="ellipsis-horizontal"
            label="Ganze Fernbedienung"
            onDruck={onMehr}
          />
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    reihe: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
    },
    tonSpalte: { alignItems: 'center', gap: 6 },
    tonWort: { color: colors.inkFaint, fontSize: 10, fontWeight: '700' },
    taste: {
      width: 34,
      height: 34,
      borderRadius: 17,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    /** Das Kreuz: eine runde Fläche, in der die vier Pfeile aussen und
     *  OK in der Mitte sitzen - wie auf jeder Fernbedienung, damit der
     *  Daumen sie ohne Hinsehen findet. */
    kreuz: {
      // Fest quadratisch und in der Mitte: Mit `flex: 1` nahm das Kreuz
      // die ganze Restbreite und wurde zur Ellipse - eine Fernbedienung
      // erkennt der Daumen aber an ihrer runden Form.
      width: 132,
      height: 132,
      alignSelf: 'center',
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    pfeil: {
      position: 'absolute',
      width: 40,
      height: 34,
      alignItems: 'center',
      justifyContent: 'center',
    },
    oben: { top: 2 },
    unten: { bottom: 2 },
    links: { left: 2, width: 34, height: 40 },
    rechts: { right: 2, width: 34, height: 40 },
    ok: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    okWort: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  });
