import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { Section } from '../lib/bereiche';
import { hilfeFuer, knopfWort } from '../lib/seitenhilfe';
import { Colors, radius, useColors } from '../theme';

/**
 * Die Hilfe zu der Seite, auf der man gerade steht.
 *
 * Das Blatt beantwortet zwei Fragen und sonst keine: Wofür ist diese
 * Seite da, und was tut man hier? Was woanders wohnt, wird nicht
 * beschrieben, sondern angeboten - der Knopf geht hin und schliesst das
 * Blatt hinter sich.
 *
 * Warum das der Unterschied ist: «Das findest du unter Einstellungen →
 * Verbindungen» ist eine Aufgabe für den Leser. Er muss das Blatt
 * schliessen, sich den Weg merken, ihn gehen - und wenn er dort ist,
 * steht die Erklärung nicht mehr daneben. Genau daran scheiterte das
 * alte Hilfeblatt, das für die ganze App dieselben drei Antworten
 * gab, egal wo man stand.
 *
 * Die Texte stehen in lib/seitenhilfe.ts; hier ist nur die Anzeige.
 */
export function Seitenhilfe({
  section,
  offen,
  onZu,
  onGehe,
}: {
  section: Section;
  offen: boolean;
  onZu: () => void;
  /** Zu einem anderen Bereich - dasselbe Ziel wie ein Tipp im Menü. */
  onGehe: (ziel: Section) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hilfe = hilfeFuer(section);

  if (!hilfe) return null;

  return (
    <Modal visible={offen} transparent animationType="fade" onRequestClose={onZu}>
      <Pressable style={styles.hintergrund} onPress={onZu}>
        <Pressable style={styles.blatt} onPress={() => {}}>
          <View style={styles.kopf}>
            <Ionicons name="help-circle" size={22} color={colors.accent} />
            <Text style={styles.wofuer}>{hilfe.wofuer}</Text>
          </View>

          <ScrollView
            style={{ maxHeight: 420 }}
            contentContainerStyle={{ gap: 14 }}
            showsVerticalScrollIndicator={false}
          >
            {hilfe.punkte.map((punkt) => (
              <View key={punkt.text} style={styles.punkt}>
                <Text style={styles.text}>{punkt.text}</Text>
                {punkt.ziel ? (
                  <Pressable
                    onPress={() => {
                      const ziel = punkt.ziel;
                      onZu();
                      if (ziel) onGehe(ziel);
                    }}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.knopfText}>{knopfWort(punkt)}</Text>
                    <Ionicons name="arrow-forward" size={15} color={colors.accent} />
                  </Pressable>
                ) : null}
              </View>
            ))}
          </ScrollView>

          <Pressable onPress={onZu} accessibilityRole="button" style={styles.schliessen}>
            <Text style={styles.schliessenText}>Verstanden</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    hintergrund: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 20,
    },
    blatt: {
      width: '100%',
      maxWidth: 440,
      gap: 14,
      padding: 20,
      borderRadius: radius.card,
      // Der deckende Blatt-Grund, nicht die Farbe des Verlaufs - sonst
      // liegen die Schriften auf einem Ton, für den sie nie gemacht
      // waren (siehe TopStrip, sheet).
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    kopf: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    /** Der eine Satz zuoberst, in Lesegrösse: Wer das Blatt aufmacht,
     *  soll nach einer Zeile wissen, ob er hier richtig ist. */
    wofuer: { color: colors.ink, fontSize: 16, fontWeight: '700', flex: 1, lineHeight: 22 },
    punkt: { gap: 6 },
    text: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
    knopf: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    knopfText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
    schliessen: {
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.ink,
    },
    schliessenText: { color: colors.panel, fontSize: 15, fontWeight: '700' },
  });
