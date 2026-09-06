import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Colors, radius, type, useColors } from '../theme';

/**
 * Das Hilfeblatt: die häufigsten Fragen, dauerhaft erreichbar.
 *
 * Die 28 Doku-Seiten unter docs/ liegen im Repository und sind von der
 * App aus unerreichbar - wer vor einem Gerät steht, das nicht reagiert,
 * hat kein Repository zur Hand. Hier stehen darum die drei Fragen, mit
 * denen im Haus wirklich angerufen wird, und je Antwort der Ort in der
 * App, an dem es weitergeht. Keine Links nach draussen: Eine Hilfe, die
 * auf eine Webseite verweist, hilft genau dann nicht, wenn das Netz das
 * Problem ist.
 *
 * Von hier aus lässt sich auch die Einführung erneut zeigen - für die
 * Person selbst oder um sie jemandem über die Schulter zu erklären.
 */

const FRAGEN: { icon: keyof typeof Ionicons.glyphMap; frage: string; antwort: string }[] = [
  {
    icon: 'bulb-outline',
    frage: 'Ein Gerät reagiert nicht?',
    antwort:
      'Unter Einstellungen → «Nicht in Ordnung» steht, wer nicht ' +
      'antwortet oder verstummt ist - die häufigste Ursache ist eine ' +
      'leere Batterie. Fehlt das Gerät dort, sagt System je Integration, ' +
      'ob sie überhaupt läuft.',
  },
  {
    icon: 'cloud-offline-outline',
    frage: 'Hub nicht erreichbar?',
    antwort:
      'Der Hub wohnt im Heimnetz - im selben WLAN geht es meist nach ' +
      'einer Minute von selbst weiter. Adresse und Token dieses Geräts ' +
      'stehen unter Einstellungen → Verbindungen; von unterwegs braucht ' +
      'es den eingerichteten Fernzugriff.',
  },
  {
    icon: 'people-outline',
    frage: 'Wer sieht was?',
    antwort:
      'Besitzer richten ein, Bewohner bedienen das ganze Haus und sehen ' +
      'die Gerätelisten, Gäste und Babysitter nur die Bereiche, die für ' +
      'sie freigegeben sind. Verteilt wird das in der Benutzerverwaltung ' +
      '- die sieht nur, wer Besitzer ist.',
  },
];

export function Hilfeblatt({
  offen,
  onZu,
  onEinfuehrung,
}: {
  offen: boolean;
  onZu: () => void;
  /** «Einführung erneut zeigen» - das Blatt schliesst sich dabei. */
  onEinfuehrung: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible={offen} transparent animationType="fade" onRequestClose={onZu}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.heading}>Hilfe</Text>
          <ScrollView style={{ maxHeight: 440 }} contentContainerStyle={{ gap: 14 }}>
            {FRAGEN.map((eintrag) => (
              <View key={eintrag.frage} style={styles.row}>
                <Ionicons name={eintrag.icon} size={20} color={colors.accent} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.frage}>{eintrag.frage}</Text>
                  <Text style={styles.antwort}>{eintrag.antwort}</Text>
                </View>
              </View>
            ))}
          </ScrollView>

          <Pressable
            onPress={onEinfuehrung}
            accessibilityRole="button"
            style={({ pressed }) => [styles.einfuehrung, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="school-outline" size={17} color={colors.ink} />
            <Text style={styles.einfuehrungText}>Einführung erneut zeigen</Text>
          </Pressable>

          <Pressable onPress={onZu} accessibilityRole="button" style={styles.confirm}>
            <Text style={styles.confirmText}>Schliessen</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    sheet: {
      width: '100%',
      maxWidth: 520,
      gap: 12,
      padding: 18,
      borderRadius: radius.card,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    row: { flexDirection: 'row', alignItems: 'flex-start', gap: 12 },
    frage: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    antwort: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 2 },
    einfuehrung: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 11,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    einfuehrungText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    confirm: {
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    confirmText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  });
