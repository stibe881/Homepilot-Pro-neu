/**
 * «Wohin?» – das Blatt hinter dem Seitentitel.
 *
 * Der Ersatz für die schiebbare Pillenzeile. Die sparte zwar einen Tipp,
 * kostete aber jedes Mal Suchen: Von fünfzehn Punkten waren drei zu
 * sehen. Hier steht alles untereinander, gruppiert wie in der Übersicht,
 * der offene mit Haken – und ein Suchfeld darüber, für die Tage, an
 * denen auch das zu lang ist.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { filtere } from '../../lib/einstellungsgruppen';
import { MAX_SCHRIFT } from '../../lib/schrift';
import { Colors, radius, useColors } from '../../theme';
import { EinstellungsListe, ListenPunkt } from './Liste';

export function Wechselblatt({
  punkte,
  aktiv,
  onWahl,
  onSchliessen,
}: {
  punkte: ListenPunkt[];
  aktiv: string | null;
  onWahl: (key: string) => void;
  onSchliessen: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [suche, setSuche] = useState('');
  const treffer = useMemo(() => filtere(punkte, suche), [punkte, suche]);

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onSchliessen}>
      {/* Der Grund schliesst: Wer daneben tippt, meint «doch nicht». */}
      <Pressable style={styles.grund} onPress={onSchliessen} accessibilityLabel="Schliessen" />
      <View style={styles.blatt}>
        <View style={styles.griff} />
        <Text style={styles.titel} maxFontSizeMultiplier={MAX_SCHRIFT}>
          Wohin?
        </Text>
        <View style={styles.feld}>
          <Ionicons name="search" size={17} color={colors.inkFaint} />
          <TextInput
            value={suche}
            onChangeText={setSuche}
            placeholder="Bereich suchen"
            placeholderTextColor={colors.inkFaint}
            style={styles.eingabe}
            autoCorrect={false}
            autoCapitalize="none"
            returnKeyType="search"
            accessibilityLabel="Bereich suchen"
          />
        </View>
        <ScrollView
          contentContainerStyle={styles.liste}
          showsVerticalScrollIndicator={false}
          keyboardShouldPersistTaps="handled"
        >
          {treffer.length > 0 ? (
            <EinstellungsListe
              punkte={treffer}
              aktiv={aktiv}
              kompakt
              aufPanel
              onWahl={onWahl}
            />
          ) : (
            <Text style={styles.leer}>Kein Bereich heisst so.</Text>
          )}
        </ScrollView>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    grund: { flex: 1, backgroundColor: 'rgba(0, 0, 0, 0.45)' },
    blatt: {
      // Höchstens drei Viertel des Schirms: Darüber soll der Grund
      // sichtbar bleiben, sonst sieht es aus wie eine neue Seite und
      // niemand kommt auf die Idee, danebenzutippen.
      maxHeight: '76%',
      backgroundColor: colors.panel,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      paddingHorizontal: 16,
      paddingTop: 8,
      paddingBottom: 26,
      gap: 12,
    },
    griff: {
      alignSelf: 'center',
      width: 38,
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.track,
    },
    titel: { color: colors.ink, fontSize: 20, fontWeight: '700' },
    feld: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      paddingHorizontal: 13,
      paddingVertical: 10,
    },
    eingabe: { flex: 1, color: colors.ink, fontSize: 16, padding: 0 },
    liste: { paddingBottom: 8 },
    leer: { color: colors.inkSoft, fontSize: 14, paddingVertical: 12 },
  });
