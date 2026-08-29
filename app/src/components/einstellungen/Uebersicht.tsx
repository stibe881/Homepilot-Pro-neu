/**
 * Die Einstellungen auf dem Telefon: eine Seite statt einer Liste von
 * Türen.
 *
 * Was sich geändert hat und warum:
 *
 * - **Ein Suchfeld ganz oben.** Fünfzehn Punkte liest niemand zweimal
 *   gern. Wer weiss, was er will, tippt drei Buchstaben – auch solche,
 *   die nirgends stehen: «push» findet das Konto, «wlan» den Besuch
 *   (lib/einstellungsgruppen.ts).
 * - **Gruppen statt einer Reihe.** Und keine Tür «Administrator» mehr:
 *   Sie sparte einen Bildschirm und kostete zwei Tipps. Weiterscrollen
 *   ist billiger.
 * - **Farbige Symbole.** Damit man zielt, statt zu lesen.
 * - **Plaketten.** «3» an «Nicht in Ordnung», «Scharf» an der Anlage.
 *   Die häufigste Frage an einen Punkt beantwortet die Liste selbst.
 *
 * Findet die Suche nichts, endet sie nicht im Nichts: Der letzte Weg
 * führt in die Suche über das ganze Haus – wer «Küche» eintippt, meint
 * meistens einen Raum und keine Einstellung.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { filtere } from '../../lib/einstellungsgruppen';
import { MAX_SCHRIFT } from '../../lib/schrift';
import { Colors, radius, useColors } from '../../theme';
import { EinstellungsListe, ListenPunkt } from './Liste';

export function EinstellungsUebersicht({
  punkte,
  onWahl,
  onHausSuche,
}: {
  punkte: ListenPunkt[];
  onWahl: (key: string) => void;
  /** Der Ausweg, wenn keine Einstellung passt: im ganzen Haus suchen. */
  onHausSuche: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [suche, setSuche] = useState('');
  const treffer = useMemo(() => filtere(punkte, suche), [punkte, suche]);
  const suchend = suche.trim().length > 0;

  return (
    <View style={styles.alles}>
      <View style={styles.feld}>
        <Ionicons name="search" size={17} color={colors.inkFaint} />
        <TextInput
          value={suche}
          onChangeText={setSuche}
          placeholder="Einstellung suchen"
          placeholderTextColor={colors.inkFaint}
          style={styles.eingabe}
          autoCorrect={false}
          autoCapitalize="none"
          returnKeyType="search"
          clearButtonMode="never"
          accessibilityLabel="Einstellung suchen"
        />
        {suchend ? (
          <Pressable
            onPress={() => setSuche('')}
            accessibilityRole="button"
            accessibilityLabel="Suche leeren"
            hitSlop={10}
          >
            <Ionicons name="close-circle" size={18} color={colors.inkFaint} />
          </Pressable>
        ) : null}
      </View>

      {treffer.length > 0 ? (
        <EinstellungsListe punkte={treffer} onWahl={onWahl} />
      ) : (
        <Text style={styles.leer} maxFontSizeMultiplier={MAX_SCHRIFT}>
          Keine Einstellung heisst so.
        </Text>
      )}

      {suchend ? (
        <Pressable
          onPress={onHausSuche}
          accessibilityRole="button"
          style={({ pressed }) => [styles.hausSuche, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="home-outline" size={18} color={colors.accent} />
          <Text style={styles.hausSucheText} numberOfLines={2}>
            Stattdessen im ganzen Haus nach «{suche.trim()}» suchen
          </Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    alles: { gap: 16 },
    feld: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 9,
      backgroundColor: colors.surface,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      paddingHorizontal: 14,
      paddingVertical: 11,
    },
    eingabe: { flex: 1, color: colors.ink, fontSize: 16, padding: 0 },
    leer: { color: colors.onGradientSoft, fontSize: 14, paddingHorizontal: 4 },
    hausSuche: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      paddingHorizontal: 14,
      paddingVertical: 13,
    },
    hausSucheText: { flex: 1, color: colors.ink, fontSize: 14, fontWeight: '600' },
  });
