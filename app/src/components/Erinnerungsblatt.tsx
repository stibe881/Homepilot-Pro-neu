/**
 * «Sag mir später Bescheid» – zu diesem Gerät.
 *
 * Die Waschmaschine läuft, man geht aus dem Haus, und in zwei Stunden
 * möchte man daran erinnert werden. Bisher baute man dafür einen Ablauf:
 * Auslöser suchen, Bedingung setzen, Nachricht texten - für eine Frage,
 * die man einmal hat und danach nie wieder.
 *
 * Vier Angebote, und keines davon ist eine Minutenzahl zum Eintippen:
 * Wer daran denkt, denkt in «nachher» und «heute Abend»
 * (lib/erinnerungsfrist.ts).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { FRISTEN, fristMinuten } from '../lib/erinnerungsfrist';
import { Colors, radius, space, type, useColors } from '../theme';

export function Erinnerungsblatt({
  entity,
  onWahl,
  onSchliessen,
}: {
  entity: Entity;
  /** Die gewählte Frist in Minuten – gerechnet, nicht getippt. */
  onWahl: (minuten: number) => void;
  onSchliessen: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onSchliessen}>
      <Pressable style={styles.grund} onPress={onSchliessen}>
        <Pressable style={styles.blatt} onPress={() => {}}>
          <View style={styles.kopf}>
            <Ionicons name="alarm-outline" size={20} color={colors.inkSoft} />
            <Text style={styles.titel}>{entity.name}</Text>
          </View>
          <Text style={styles.satz}>
            Wann sollen wir dich daran erinnern? Die Nachricht kommt nur bei
            dir an und führt beim Antippen hierher zurück.
          </Text>
          {FRISTEN.map((frist) => (
            <Pressable
              key={frist.key}
              onPress={() => onWahl(fristMinuten(frist.key, new Date()))}
              accessibilityRole="button"
              style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.8 }]}
            >
              <Text style={styles.knopfText}>{frist.label}</Text>
            </Pressable>
          ))}
          <Pressable onPress={onSchliessen} style={styles.zu} accessibilityRole="button">
            <Text style={styles.zuText}>Abbrechen</Text>
          </Pressable>
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
    blatt: {
      backgroundColor: colors.panel,
      borderRadius: radius.card,
      padding: 18,
      gap: 10,
    },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    titel: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700', flex: 1 },
    satz: { color: colors.inkSoft, fontSize: 13 },
    knopf: {
      alignItems: 'center',
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    knopfText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    zu: { alignItems: 'center', paddingVertical: 8 },
    zuText: { color: colors.inkFaint, fontSize: 14, fontWeight: '600' },
  });
