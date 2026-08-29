/**
 * Die Einstellungen als gruppierte Liste – einmal geschrieben, zweimal
 * gebraucht: als ganze Seite (Übersicht) und als Blatt von unten
 * (Bereichswechsel).
 *
 * Nicht fünfzehn einzeln schwebende Karten, sondern je Gruppe eine Karte
 * mit Trennstrichen darin. Das ist dichter, ruhiger und zeigt von selbst,
 * was zusammengehört – bei fünfzehn gleich grossen Kacheln sah alles
 * gleich wichtig aus.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Plakette, farbeVon, gruppiere } from '../../lib/einstellungsgruppen';
import { MAX_SCHRIFT } from '../../lib/schrift';
import { Colors, radius, useColors } from '../../theme';

export interface ListenPunkt {
  key: string;
  icon: keyof typeof Ionicons.glyphMap;
  label: string;
  detail: string;
  /** Was es hier zu melden gibt, ohne die Seite zu öffnen. */
  plakette?: Plakette;
}

export function EinstellungsListe({
  punkte,
  aktiv,
  kompakt,
  aufPanel,
  onWahl,
}: {
  punkte: ListenPunkt[];
  /** Der Punkt, auf dem man gerade steht – im Blatt mit Haken. */
  aktiv?: string | null;
  /** Für das Blatt: eine Zeile ohne Beschreibung, damit mehr hineinpasst. */
  kompakt?: boolean;
  /**
   * Steht die Liste auf dem deckenden Grund eines Blattes statt auf dem
   * Farbverlauf der Seite? Dann sind die Überschriften dunkel – weisse
   * wären dort unsichtbar.
   */
  aufPanel?: boolean;
  onWahl: (key: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const gruppen = useMemo(() => gruppiere(punkte), [punkte]);

  return (
    <View style={styles.alles}>
      {gruppen.map((gruppe) => (
        <View key={gruppe.key} style={styles.gruppe}>
          <Text
            style={[styles.gruppenTitel, aufPanel && { color: colors.inkFaint }]}
            maxFontSizeMultiplier={MAX_SCHRIFT}
          >
            {gruppe.titel}
          </Text>
          <View
            style={[styles.karte, aufPanel && { backgroundColor: colors.surfaceStrong }]}
          >
            {gruppe.punkte.map((punkt, index) => {
              const offen = punkt.key === aktiv;
              const farbe = farbeVon(punkt.key);
              return (
                <Pressable
                  key={punkt.key}
                  onPress={() => onWahl(punkt.key)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: offen }}
                  accessibilityLabel={
                    punkt.plakette ? `${punkt.label}, ${punkt.plakette.text}` : punkt.label
                  }
                  style={({ pressed }) => [
                    styles.zeile,
                    kompakt && styles.zeileKompakt,
                    index > 0 && styles.strich,
                    offen && styles.zeileOffen,
                    pressed && styles.gedrueckt,
                  ]}
                >
                  {/* Das farbige Plättchen: Es macht aus Lesen ein Zielen.
                      Der Ton kommt aus lib/einstellungsgruppen.ts und ist
                      in jedem Erscheinungsbild derselbe. */}
                  <View style={[styles.plaettchen, { backgroundColor: `${farbe}26` }]}>
                    <Ionicons name={punkt.icon} size={18} color={farbe} />
                  </View>
                  <View style={styles.mitte}>
                    <Text style={styles.label} numberOfLines={1}>
                      {punkt.label}
                    </Text>
                    {/* Eine Zeile, nicht zwei: Bei fünfzehn Punkten macht
                        die zweite aus einem Bildschirm anderthalb - und
                        die Beschreibung ist ein Hinweis, keine
                        Anleitung. */}
                    {kompakt ? null : (
                      <Text style={styles.detail} numberOfLines={1}>
                        {punkt.detail}
                      </Text>
                    )}
                  </View>
                  {punkt.plakette ? (
                    <View
                      style={[
                        styles.plakette,
                        punkt.plakette.ton === 'gut' && { backgroundColor: colors.onSoft },
                        punkt.plakette.ton === 'warnung' && {
                          backgroundColor: colors.dangerSoft,
                        },
                      ]}
                    >
                      <Text
                        style={[
                          styles.plaketteText,
                          punkt.plakette.ton === 'gut' && { color: colors.on },
                          punkt.plakette.ton === 'warnung' && { color: colors.danger },
                        ]}
                        maxFontSizeMultiplier={MAX_SCHRIFT}
                        numberOfLines={1}
                      >
                        {punkt.plakette.text}
                      </Text>
                    </View>
                  ) : null}
                  <Ionicons
                    name={offen ? 'checkmark' : 'chevron-forward'}
                    size={offen ? 20 : 17}
                    color={offen ? colors.accent : colors.inkFaint}
                  />
                </Pressable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    alles: { gap: 18 },
    gruppe: { gap: 7 },
    gruppenTitel: {
      color: colors.onGradientSoft,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.7,
      textTransform: 'uppercase',
      paddingLeft: 4,
    },
    karte: {
      backgroundColor: colors.surface,
      borderRadius: radius.card,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      overflow: 'hidden',
    },
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 13,
      paddingHorizontal: 14,
      // 14 oben und unten plus 34 Plättchen ergibt 62 – deutlich über den
      // 44 Punkten, unter denen eine Trefferfläche zum Zielen wird.
      paddingVertical: 14,
    },
    zeileKompakt: { paddingVertical: 11 },
    strich: { borderTopWidth: StyleSheet.hairlineWidth, borderTopColor: colors.surfaceBorder },
    zeileOffen: { backgroundColor: colors.surfaceStrong },
    gedrueckt: { opacity: 0.75 },
    plaettchen: {
      width: 34,
      height: 34,
      borderRadius: 10,
      alignItems: 'center',
      justifyContent: 'center',
    },
    mitte: { flex: 1, gap: 1 },
    label: { color: colors.ink, fontSize: 16, fontWeight: '600' },
    detail: { color: colors.inkSoft, fontSize: 13, lineHeight: 17 },
    plakette: {
      paddingHorizontal: 9,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.track,
      maxWidth: 120,
    },
    plaketteText: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
  });
