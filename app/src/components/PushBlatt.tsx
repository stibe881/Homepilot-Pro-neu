/**
 * Das Blatt, das ein Tipp auf eine Nachricht aufmacht.
 *
 * Ein Tipp bringt einen an den richtigen Ort - aber oft weiss man schon
 * vorher, was man dort tun will. «Waschmaschine fertig» und der Trockner
 * soll laufen; «Es wird dunkel» und die Storen sollen runter. Statt dort
 * erst die Kachel zu suchen, steht der Handgriff gleich hier.
 *
 * Was darauf steht, bestimmt der Ablauf selbst (Einstellungen → Abläufe →
 * Nachricht). Der Hub reicht es unverändert durch; gedrückt wird es
 * erst hier, hinter der Anmeldung - ein Knopf am Sperrbildschirm, der
 * schaltet, wäre etwas anderes.
 *
 * Es geht von selbst zu, sobald man einen Handgriff gemacht hat: Wer
 * getippt hat, was er wollte, will danach die App sehen und nicht noch
 * ein Blatt wegwischen.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { PushKnopf } from '../lib/pushziel';
import { Colors, radius, space, type, useColors } from '../theme';

export function PushBlatt({
  titel,
  text,
  knoepfe,
  onDruck,
  onSchliessen,
}: {
  titel?: string;
  text?: string;
  knoepfe: PushKnopf[];
  onDruck: (knopf: PushKnopf) => void;
  onSchliessen: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Modal visible animationType="fade" transparent onRequestClose={onSchliessen}>
      <Pressable style={styles.grund} onPress={onSchliessen}>
        {/* Der Tipp auf das Blatt selbst schliesst nicht: Sonst trifft
            man beim Zielen auf einen Knopf daneben und alles ist weg. */}
        <Pressable style={styles.blatt} onPress={() => {}}>
          {titel ? <Text style={styles.titel}>{titel}</Text> : null}
          {text ? <Text style={styles.text}>{text}</Text> : null}
          {knoepfe.map((knopf) => (
            <Pressable
              key={`${knopf.label}:${knopf.scene ?? knopf.entity}`}
              onPress={() => {
                onDruck(knopf);
                onSchliessen();
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.8 }]}
            >
              <Ionicons
                name={knopf.scene ? 'sparkles' : 'flash'}
                size={18}
                color="#FFFFFF"
              />
              <Text style={styles.knopfText} numberOfLines={1}>
                {knopf.label}
              </Text>
            </Pressable>
          ))}
          <Pressable
            onPress={onSchliessen}
            accessibilityRole="button"
            style={styles.zu}
          >
            <Text style={styles.zuText}>Nur ansehen</Text>
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
    titel: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    text: { color: colors.inkSoft, fontSize: 14 },
    knopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    knopfText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    zu: { alignItems: 'center', paddingVertical: 8 },
    zuText: { color: colors.inkFaint, fontSize: 14, fontWeight: '600' },
  });
