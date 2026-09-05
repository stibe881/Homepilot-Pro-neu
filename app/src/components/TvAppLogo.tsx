import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TvLogo } from '../lib/tvlogo';
import { Colors, useColors } from '../theme';

/**
 * Der runde Logo-Knopf einer Fernseh-App: Markenfarbe als Grund, darauf
 * die Glyphe oder der Schriftzug aus lib/tvlogo.ts.
 *
 * Nur der Anblick – das Pressable liegt beim Aufrufer, denn die
 * Fernbedienung drückt anders (Haptik, Fehler wegräumen) als die Liste
 * auf der Kachel.
 */
export function TvAppLogo({
  logo,
  size = 46,
  aktiv,
}: {
  logo: TvLogo;
  size?: number;
  /** Läuft die App gerade? Dann trägt der Knopf einen Ring. */
  aktiv?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View
      style={[
        styles.kreis,
        { width: size, height: size, borderRadius: size / 2, backgroundColor: logo.farbe },
        aktiv && styles.kreisAktiv,
      ]}
    >
      {logo.icon ? (
        <MaterialCommunityIcons
          name={logo.icon as keyof typeof MaterialCommunityIcons.glyphMap}
          size={Math.round(size * 0.55)}
          color="#FFFFFF"
        />
      ) : (
        <Text
          style={[
            styles.schriftzug,
            // «Z» und «D+» gross wie eine Glyphe; «prime» muss als Wort
            // in den Kreis passen und bleibt darum klein.
            { fontSize: (logo.schriftzug ?? '').length <= 2 ? size * 0.42 : size * 0.24 },
          ]}
          allowFontScaling={false}
        >
          {logo.schriftzug}
        </Text>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    kreis: {
      alignItems: 'center',
      justifyContent: 'center',
      // Der feine Rand ist für Zattoo da: Ein schwarzer Kreis versänke
      // sonst im dunklen Thema spurlos im Grund der Karte.
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    kreisAktiv: { borderWidth: 2, borderColor: colors.accent },
    schriftzug: { color: '#FFFFFF', fontWeight: '800', letterSpacing: 0.2 },
  });
