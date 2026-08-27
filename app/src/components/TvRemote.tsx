import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, useColors } from '../theme';

interface Props {
  visible: boolean;
  name: string;
  onClose: () => void;
  onCommand: (command: string) => void;
  /** Was der Hub zur letzten Taste sagte – oder ``null``.
   *
   *  Muss hier hinein und nicht ins Band unten am Bildschirm: Die
   *  Fernbedienung ist ein Modal und liegt darüber. Die Absage stand
   *  also da, verdeckt von genau der Fläche, auf der man gerade tippt –
   *  gemessen mit `elementFromPoint`, nicht geraten. Wer drückte, sah
   *  nichts passieren und erfuhr auch nicht, warum. */
  fehler?: string | null;
  onFehlerWeg?: () => void;
}

/** Vollwertige Fernbedienung für Android-TV-Kacheln: Steuerkreuz,
 *  Lautstärke, Medientasten. Öffnet sich als Modal über dem Dashboard. */
export function TvRemote({
  visible,
  name,
  onClose,
  onCommand,
  fehler,
  onFehlerWeg,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Welche Taste zuletzt rausging.
  //
  // Ohne das heisst «nichts passiert» dreierlei, und alle drei sehen
  // gleich aus: Der Tipp kam gar nicht an, der Hub hat ihn angenommen
  // und der Fernseher ignoriert ihn, oder der Hub hat abgelehnt. Genau
  // daran liess sich der Fehler im Haus nicht einkreisen. Jetzt sagt die
  // Zeile unten, was die App getan hat – und die Absage darüber, was der
  // Hub davon hielt.
  const [letzte, setLetzte] = useState<string | null>(null);
  useEffect(() => {
    // Beim Öffnen mit leerer Zeile beginnen: Was beim letzten Mal
    // gedrückt wurde, sagt über dieses Mal nichts.
    if (visible) setLetzte(null);
  }, [visible]);

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
      onPress={() => {
        // Die alte Absage gehört zur alten Taste. Bliebe sie stehen,
        // liesse sich nicht mehr erkennen, ob die neue ankam.
        if (fehler) onFehlerWeg?.();
        setLetzte(label);
        onCommand(command);
      }}
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

          {fehler ? (
            <View style={styles.absage}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.absageText}>{fehler}</Text>
            </View>
          ) : letzte ? (
            <View style={styles.absage}>
              <Ionicons name="checkmark-circle" size={16} color={colors.inkFaint} />
              <Text style={styles.gesendetText}>
                «{letzte}» ging an den Hub. Tut der Fernseher nichts, liegt es an ihm.
              </Text>
            </View>
          ) : null}
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
      backgroundColor: colors.panel,
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
    absage: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingTop: 4,
    },
    absageText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.inkSoft },
    gesendetText: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.inkFaint },
    keyPressed: { backgroundColor: colors.surfaceStrong },
  });
