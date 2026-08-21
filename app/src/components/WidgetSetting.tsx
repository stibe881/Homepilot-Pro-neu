import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Platform, Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from './Card';
import { Colors, type, useColors } from '../theme';

/**
 * Schalter für den Inhalt des Homescreen-Widgets.
 *
 * Ohne ihn zeigt das Widget nur die Knöpfe – mit ihm auch, ob eine Türe
 * offen steht und was als Nächstes ansteht. Der Preis steht daneben,
 * statt im Kleingedruckten: Dafür liegen Adresse und Token in der
 * geteilten App-Gruppe, also auch im Widget-Prozess.
 *
 * Auf Android und im Web gibt es kein Widget – dort erscheint die Karte
 * gar nicht, statt einen Schalter anzubieten, der nichts tut.
 */
export function WidgetSetting({
  enabled,
  onChange,
}: {
  enabled: boolean;
  onChange: (on: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  if (Platform.OS !== 'ios') return null;

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => onChange(!enabled)}
        accessibilityRole="switch"
        accessibilityState={{ checked: enabled }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      >
        <Ionicons
          name="apps-outline"
          size={22}
          color={enabled ? colors.accent : colors.inkSoft}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Widget zeigt den Hausstand</Text>
          <Text style={styles.hint}>
            {enabled
              ? 'Türstatus und nächster Termin, alle 15 Minuten aktualisiert.'
              : 'Aus: Das Widget zeigt nur die Knöpfe, ohne Zustände.'}
          </Text>
        </View>
        <Ionicons
          name={enabled ? 'toggle' : 'toggle-outline'}
          size={30}
          color={enabled ? colors.accent : colors.inkFaint}
        />
      </Pressable>
      <Text style={styles.hint}>
        Dafür liegen Hub-Adresse und Token in der App-Gruppe – das Widget
        ist ein eigener Prozess und kennt die Einstellungen sonst nicht.
        Wer das nicht will, lässt den Schalter aus; die Knöpfe funktionieren
        trotzdem.
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
  });
