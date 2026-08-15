import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, useColors } from '../theme';

interface Props {
  visible: boolean;
  name: string;
  onClose: () => void;
  onCommand: (command: string) => void;
}

/** Vollwertige Fernbedienung für Android-TV-Kacheln: Steuerkreuz,
 *  Lautstärke, Medientasten. Öffnet sich als Modal über dem Dashboard. */
export function TvRemote({ visible, name, onClose, onCommand }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  const Key = ({
    icon,
    command,
    label,
    big,
  }: {
    icon: keyof typeof Ionicons.glyphMap;
    command: string;
    label: string;
    big?: boolean;
  }) => (
    <Pressable
      accessibilityLabel={label}
      onPress={() => onCommand(command)}
      style={({ pressed }) => [styles.key, big && styles.keyBig, pressed && styles.keyPressed]}>
      <Ionicons name={icon} size={big ? 26 : 20} color={colors.ink} />
    </Pressable>
  );

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose}>
        {/* Ein Tipp in die Fernbedienung selbst darf sie nicht schliessen. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {name}
            </Text>
            <Pressable accessibilityLabel="Schliessen" onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={20} color={colors.inkSoft} />
            </Pressable>
          </View>

          {/* Steuerkreuz */}
          <View style={styles.dpad}>
            <View style={styles.dpadRow}>
              <Key icon="chevron-up" command="dpad_up" label="Hoch" />
            </View>
            <View style={styles.dpadRow}>
              <Key icon="chevron-back" command="dpad_left" label="Links" />
              <Key icon="ellipse-outline" command="ok" label="OK" big />
              <Key icon="chevron-forward" command="dpad_right" label="Rechts" />
            </View>
            <View style={styles.dpadRow}>
              <Key icon="chevron-down" command="dpad_down" label="Runter" />
            </View>
          </View>

          <View style={styles.row}>
            <Key icon="arrow-undo" command="back" label="Zurück" />
            <Key icon="home-outline" command="home" label="Home" />
            <Key icon="power" command="toggle" label="An/Aus" />
          </View>

          <View style={styles.row}>
            <Key icon="volume-low" command="volume_down" label="Leiser" />
            <Key icon="volume-mute" command="mute" label="Stumm" />
            <Key icon="volume-high" command="volume_up" label="Lauter" />
          </View>

          <View style={styles.row}>
            <Key icon="play-skip-back" command="previous" label="Zurück" />
            <Key icon="play" command="play" label="Play/Pause" />
            <Key icon="play-skip-forward" command="next" label="Weiter" />
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    sheet: {
      width: 300,
      maxWidth: '100%',
      borderRadius: 24,
      padding: 20,
      gap: 14,
      // Opaker Grund: das Modal schwebt frei, Glas-Transparenz hätte hier
      // nichts, wodurch sie durchscheinen könnte.
      backgroundColor: colors.gradient[1],
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontSize: 17, fontWeight: '600', color: colors.ink },
    close: { padding: 4 },
    dpad: { alignItems: 'center', gap: 8 },
    dpadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    row: { flexDirection: 'row', justifyContent: 'space-evenly' },
    key: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    keyBig: { width: 68, height: 68, borderRadius: 34 },
    keyPressed: { backgroundColor: colors.surfaceStrong },
  });
