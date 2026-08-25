import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Card } from './Card';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Schalter für die Rückfrage vor dem Türöffnen.
 *
 * «Öffnen» wurde zu «Wirklich öffnen?», und erst der zweite Tipp zog die
 * Falle – fest eingebaut, für alle und immer. Gegen den Ellbogen am
 * Wandpanel ist das richtig; mit zwei Händen voll Einkauf ist es ein
 * Tipp zu viel, und der erste verfällt nach vier Sekunden.
 *
 * Haushaltsweit wie die übrigen Einstellungen dieser Art: Eine Türe, die
 * am Panel nachfragt und auf dem Telefon nicht, ist keine Regel, sondern
 * ein Ratespiel.
 *
 * Der Schalter steht nur der Besitzerin offen. Der Hub liesse ihn jedem
 * (Hausansichten brauchen bloss `control`), aber eine Hürde vor der
 * Haustüre abzuräumen ist keine Ansichtssache – und sie gilt danach auch
 * für alle anderen.
 */
export function TuerRueckfrage({
  /** Undefiniert = noch nie eingestellt; dann wird gefragt. */
  enabled,
  onChange,
}: {
  enabled?: boolean;
  onChange: (on: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const an = enabled !== false;

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => onChange(!an)}
        accessibilityRole="switch"
        accessibilityState={{ checked: an }}
        style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
      >
        <Ionicons
          name={an ? 'help-circle' : 'log-in-outline'}
          size={22}
          color={an ? colors.accent : colors.inkSoft}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.title}>Rückfrage vor dem Türöffnen</Text>
          <Text style={styles.hint}>
            {an
              ? 'Aus «Öffnen» wird erst «Wirklich öffnen?» – die Türe geht auf den zweiten Tipp auf.'
              : 'Aus: Ein Tipp auf «Öffnen» öffnet die Türe sofort.'}
          </Text>
        </View>
        <Ionicons
          name={an ? 'toggle' : 'toggle-outline'}
          size={30}
          color={an ? colors.accent : colors.inkFaint}
        />
      </Pressable>
      <Text style={styles.hint}>
        Gilt fürs ganze Haus und nur fürs Öffnen – Aufschliessen bleibt, wie es war. Ein
        einzeln gesperrtes Gerät («schaltet nur nach Rückfrage») und die Face-ID-Hürde
        darüber fragen weiterhin.
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
