import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, radius, type, useColors } from '../theme';

/**
 * Offenlegung vor der Standort-Erlaubnis (Google Play: „Prominent
 * Disclosure and Consent Requirement", Punkt 744 der Werkbank).
 *
 * Der Schalter unter Einstellungen → Ortung fragte bisher direkt das
 * Betriebssystem - ein eigener Hinweis stand nur daneben, nicht davor.
 * Für den Zugriff im Hintergrund verlangt Google einen eigenen,
 * unübersehbaren Schritt *vor* der Systemabfrage, mit ausdrücklicher
 * Zustimmung statt eines blossen Textes nebenan.
 */
export function StandortOffenlegung({
  visible,
  onCancel,
  onConfirm,
}: {
  visible: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.backdrop}>
        <View style={styles.sheet}>
          <Text style={styles.title}>Standort im Hintergrund</Text>
          <Text style={styles.text}>
            HomePilot fragt deinen Standort auch dann ab, wenn die App
            geschlossen ist oder du sie nicht benutzt. Damit erkennt euer
            Hub, wann du das Haus verlässt oder heimkommst, und kann
            Heizung, Licht und Alarmanlage entsprechend automatisch
            schalten.
          </Text>
          <Text style={styles.text}>
            Der Standort geht ausschliesslich an euren eigenen Hub - nie an
            einen Server Dritter.
          </Text>
          <View style={styles.actions}>
            <Pressable onPress={onCancel} style={styles.cancel}>
              <Text style={styles.cancelText}>Abbrechen</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={styles.confirm}>
              <Text style={styles.confirmText}>Verstanden, weiter</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

function makeStyles(colors: Colors) {
  return StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    sheet: {
      width: '100%',
      maxWidth: 420,
      backgroundColor: colors.panel,
      borderRadius: radius.card,
      padding: 20,
      gap: 12,
    },
    title: { fontSize: type.cardTitle, fontWeight: '700', color: colors.ink },
    text: { fontSize: type.cardSub, lineHeight: 19, color: colors.inkSoft },
    actions: { flexDirection: 'row', gap: 12, marginTop: 8 },
    cancel: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
    },
    cancelText: { fontSize: type.label, fontWeight: '600', color: colors.ink },
    confirm: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    confirmText: { fontSize: type.label, fontWeight: '600', color: colors.onAccent },
  });
}
