import { MaterialCommunityIcons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { TvLogo } from '../lib/tvlogo';
import { Colors, useColors } from '../theme';

/** Schriftgrösse relativ zum Kreis, nach Länge des Schriftzugs (rein,
 *  testbar über die Anzeige - hier nur eine Staffel, kein Geheimnis). */
function schriftzugAnteil(schriftzug: string): number {
  if (schriftzug.length <= 2) return 0.42;
  if (schriftzug.length <= 4) return 0.26;
  return 0.19;
}

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
            // Gestaffelt nach Länge: «D+» gross wie eine Glyphe, «joyn»
            // mittel, «prime» und «zattoo» müssen als ganzes Wort in den
            // Kreis passen und bleiben klein.
            { fontSize: size * schriftzugAnteil(logo.schriftzug ?? '') },
          ]}
          allowFontScaling={false}
          numberOfLines={1}
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
