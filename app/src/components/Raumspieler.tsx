import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { CommandData, Entity } from '../api/types';
import { kopfmusik, kopfmusikLabel } from '../lib/kopfmusik';
import { Colors, radius, useColors } from '../theme';

/**
 * Die Musik des Zimmers im Raumkopf – ein Streifen neben den Szenen.
 *
 * Er beantwortet die zwei Fragen, die man beim Betreten stellt: Läuft
 * hier etwas, und wie mache ich es leiser oder aus. Alles Weitere –
 * Playlist, Sender, Box, Warteschlange – steckt hinter dem Pfeil: Dann
 * klappt darunter dieselbe grosse Karte auf, die früher rechts in der
 * Spalte stand (components/SidePanel.tsx, MediaPanel).
 *
 * Zugeklappt ist die Voreinstellung, und das ist der Punkt: Die Karte
 * nahm im Zimmer eine ganze Spalte ein, für eine Auskunft, die in zwei
 * Zeilen passt.
 */
export function Raumspieler({
  entity,
  offen,
  onToggle,
  onCommand,
}: {
  entity: Entity;
  /** Steht die grosse Karte darunter offen? */
  offen: boolean;
  onToggle: () => void;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const musik = kopfmusik(entity);
  const bild = entity.state.image ? String(entity.state.image) : null;

  return (
    <View style={styles.streifen}>
      <Pressable
        onPress={onToggle}
        accessibilityRole="button"
        accessibilityState={{ expanded: offen }}
        accessibilityLabel={kopfmusikLabel(entity)}
        style={({ pressed }) => [styles.text, pressed && { opacity: 0.7 }]}
      >
        {bild ? (
          <Image
            source={{ uri: bild }}
            style={styles.cover}
            accessibilityIgnoresInvertColors
          />
        ) : (
          <View style={styles.coverLeer}>
            <Ionicons
              name={musik.da ? 'musical-notes' : 'cloud-offline-outline'}
              size={16}
              color={musik.laeuft ? colors.accent : colors.inkSoft}
            />
          </View>
        )}
        <View style={styles.zeilen}>
          <Text style={styles.titel} numberOfLines={1}>
            {musik.titel}
          </Text>
          <Text style={styles.unter} numberOfLines={1}>
            {musik.unter}
          </Text>
        </View>
        <Ionicons
          name={offen ? 'chevron-up' : 'chevron-down'}
          size={15}
          color={colors.inkFaint}
        />
      </Pressable>
      {/* Der Knopf bleibt auch stehen, wenn die Box gerade nicht
          antwortet: Ein Griff, der nichts tut, ist ärgerlich – ein
          Knopf, der plötzlich fehlt, lässt einen suchen. Der Hub sagt
          hinterher, was daraus wurde. */}
      <Pressable
        onPress={() => onCommand(entity.id, musik.laeuft ? 'pause' : 'play')}
        accessibilityRole="button"
        accessibilityLabel={musik.laeuft ? 'Pause' : 'Abspielen'}
        style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
      >
        <Ionicons name={musik.laeuft ? 'pause' : 'play'} size={17} color={colors.ink} />
      </Pressable>
      {/* Weiter nur, solange etwas läuft: Auf einer stillen Box
          überspringt man nichts, und der Knopf stünde nur da. */}
      {musik.laeuft && entity.commands.includes('next') ? (
        <Pressable
          onPress={() => onCommand(entity.id, 'next')}
          accessibilityRole="button"
          accessibilityLabel="Nächster Titel"
          style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="play-skip-forward" size={17} color={colors.ink} />
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    // Dieselbe Pille wie die Szenenknöpfe daneben – der Kopf soll wie
    // eine Zeile aussehen und nicht wie zwei Bauteile.
    streifen: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingLeft: 8,
      paddingRight: 6,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      // Genug für zwei Zeilen Text, aber nie mehr als ein Drittel des
      // Kopfes: Der Raumname bleibt das Erste, was man liest.
      minWidth: 210,
      maxWidth: 340,
      flexGrow: 1,
      flexShrink: 1,
    },
    text: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 1, minWidth: 0 },
    cover: { width: 30, height: 30, borderRadius: 6 },
    coverLeer: {
      width: 30,
      height: 30,
      borderRadius: 6,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSoft,
    },
    zeilen: { flex: 1, minWidth: 0 },
    titel: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    unter: { color: colors.inkSoft, fontSize: 11 },
    knopf: {
      width: 32,
      height: 32,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
