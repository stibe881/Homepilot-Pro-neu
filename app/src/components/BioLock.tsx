import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from './Card';
import { entsperrName } from '../lib/plattform';
import { available, HEIKEL } from '../lib/biometrie';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Schalter für die Face-ID-Sperre – in den Profileinstellungen.
 *
 * Bewusst je Person und nicht je Gerät: Wer sie einschaltet, meint sie
 * überall. Die Einstellung liegt deshalb in den Hub-Prefs, nicht im
 * Gerätespeicher.
 *
 * Kann das Gerät keine Biometrie – der Browser etwa, oder ein Tablet
 * ohne eingerichteten Fingerabdruck –, steht das dabei, statt dass der
 * Schalter still wirkungslos bleibt.
 */
export function BioLock({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [möglich, setMöglich] = useState<boolean | null>(null);

  useEffect(() => {
    let abgebrochen = false;
    available().then((wert) => {
      if (!abgebrochen) setMöglich(wert);
    });
    return () => {
      abgebrochen = true;
    };
  }, []);

  const name = entsperrName();

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => onChange(!enabled)}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      >
        <Ionicons
          name={enabled ? 'lock-closed' : 'lock-open-outline'}
          size={22}
          color={enabled ? colors.accent : colors.inkSoft}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>{name} vor heiklen Aktionen</Text>
          <Text style={styles.hint}>
            {enabled
              ? `${Object.values(HEIKEL).join(', ')} – erst nach Bestätigung.`
              : 'Aus: Türe und Alarmanlage lassen sich mit einem Tipp bedienen.'}
          </Text>
        </View>
        <Ionicons
          name={enabled ? 'toggle' : 'toggle-outline'}
          size={30}
          color={enabled ? colors.accent : colors.inkFaint}
        />
      </Pressable>
      {möglich === false ? (
        <Text style={styles.warn}>
          Dieses Gerät kennt keine Biometrie oder es ist keine eingerichtet –
          hier bleibt die Sperre wirkungslos. Auf deinen anderen Geräten gilt
          sie trotzdem.
        </Text>
      ) : null}
      <Text style={styles.hint}>
        Die Sperre gilt für dich auf allen deinen Geräten. Sie ist eine
        Hürde vor dem Absenden – die Rechte und die Alarm-PIN prüft der Hub
        weiterhin selbst.
      </Text>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10, minHeight: 0 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    warn: {
      color: colors.warn,
      fontSize: 12,
      lineHeight: 18,
      borderRadius: radius.control,
    },
  });
