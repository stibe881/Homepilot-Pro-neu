import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { SYMBOL, type Begriff } from '../lib/symbole';
import { Card } from './Card';
import { Kennzahl } from './Kennzahl';
import { Klappe } from './Klappe';
import { Colors, radius, space, type, useColors } from '../theme';

/**
 * Das Musterblatt: die Gestaltungsmittel, wie sie gerade wirklich sind.
 *
 * Eine Gestaltung, die nur in den Köpfen steht, driftet. Man baut einen
 * Bildschirm, braucht ein Grau, nimmt eines, das passt – und ein halbes
 * Jahr später gibt es sieben Graustufen, von denen drei fast gleich
 * aussehen. Dasselbe mit Rundungen, Abständen, Symbolen. Von Auge merkt
 * man das nie, weil man immer nur einen Bildschirm auf einmal sieht.
 *
 * Deshalb dieses Blatt, und deshalb **aus dem Code erzeugt** und nicht
 * abgemalt: Es zeigt `lightColors`/`darkColors`, `type`, `radius`,
 * `space` und die Symbolsprache so, wie sie in diesem Bau stecken. Ein
 * abgemaltes Musterblatt wäre nach der ersten Änderung eine Lüge - und
 * eine, der man glaubt, weil sie so ordentlich aussieht.
 *
 * Es steht unter System, nicht in den Einstellungen: Es ist Werkzeug
 * für den, der etwas baut, keine Einstellung für den, der hier wohnt.
 *
 * Zwei Dinge kann es nicht, und das ist wichtig zu wissen: Es prüft
 * nichts (die Kontraste rechnet lib/kontrast.ts nach, in einem Test),
 * und es sieht nur, was in den Tafeln steht - eine Farbe, die jemand
 * von Hand in eine Datei geschrieben hat, taucht hier nicht auf.
 */

/** Die Farben, die eine Fläche sein können - mit ihrem Namen darunter. */
const FLAECHEN = [
  'surface',
  'surfaceStrong',
  'surfaceSoft',
  'surfaceBorder',
  'panel',
] as const;

/** Und die, die Text oder Zeichen sein können. */
const SCHRIFTEN = ['ink', 'inkSoft', 'inkFaint', 'accent', 'on', 'warn', 'danger'] as const;

export function Musterblatt() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Card style={styles.card}>
      <Klappe label="Musterblatt" stand="Farben, Schrift, Masse, Symbole" zuBeginnZu>
        <Text style={styles.hint}>
          Was hier steht, ist aus dem Code erzeugt und gilt für das gerade
          eingestellte Erscheinungsbild. Wer eine Farbe oder ein Mass ändert,
          sieht es hier – und wer eines sucht, findet es, statt ein neues zu
          erfinden.
        </Text>

        <Text style={styles.gruppe}>Flächen</Text>
        <View style={styles.reihe}>
          {FLAECHEN.map((name) => (
            <View key={name} style={styles.probe}>
              <View style={[styles.klecks, { backgroundColor: colors[name] }]} />
              <Text style={styles.probeName}>{name}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.gruppe}>Schrift und Zeichen</Text>
        <View style={styles.reihe}>
          {SCHRIFTEN.map((name) => (
            <View key={name} style={styles.probe}>
              {/* Auf der Karte und nicht auf dem Verlauf: Genau dort
                  steht der Text im Haus, und dort muss er lesbar sein.
                  Nachgerechnet wird das in lib/kontrast.test.ts. */}
              <View style={[styles.klecks, styles.textprobe]}>
                <Text style={{ color: colors[name], fontWeight: '700' }}>Aa</Text>
              </View>
              <Text style={styles.probeName}>{name}</Text>
            </View>
          ))}
        </View>

        <Text style={styles.gruppe}>Schriftgrössen</Text>
        {(Object.keys(type) as (keyof typeof type)[]).map((name) => (
          <View key={name} style={styles.zeile}>
            <Text style={[styles.beispiel, { fontSize: type[name] }]} numberOfLines={1}>
              Guten Abend
            </Text>
            <Text style={styles.mass}>
              {name} · {type[name]}
            </Text>
          </View>
        ))}

        <Text style={styles.gruppe}>Zahlen</Text>
        <Text style={styles.hint}>
          Die Zahl gross, die Einheit klein daneben, die Beschriftung darunter
          – und Ziffern mit fester Breite, damit nichts ruckt, wenn sich der
          Wert ändert (components/Kennzahl.tsx).
        </Text>
        <View style={styles.reihe}>
          <Kennzahl wert="21.5 °C" label="Wohnzimmer" />
          <Kennzahl wert="63%" label="Feuchte" />
          <Kennzahl wert="1240 W" label="gerade" />
          <Kennzahl wert="-3 °C" label="heute Nacht" farbe={colors.accent} />
        </View>

        <Text style={styles.gruppe}>Rundungen und Abstände</Text>
        <View style={styles.reihe}>
          {(Object.keys(radius) as (keyof typeof radius)[]).map((name) => (
            <View key={name} style={styles.probe}>
              <View
                style={[
                  styles.klecks,
                  { borderRadius: radius[name], backgroundColor: colors.surfaceSoft },
                ]}
              />
              <Text style={styles.probeName}>
                {name} · {radius[name]}
              </Text>
            </View>
          ))}
          {(Object.keys(space) as (keyof typeof space)[]).map((name) => (
            <View key={name} style={styles.probe}>
              <View style={[styles.abstand, { width: space[name] }]} />
              <Text style={styles.probeName}>
                {name} · {space[name]}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.gruppe}>Symbolsprache</Text>
        <Text style={styles.hint}>
          Je Begriff ein Zeichen – wer eines braucht, nimmt den Begriff. Dass
          daneben kein gleichbedeutendes im Umlauf ist, hält ein Test fest
          (lib/symbole.ts).
        </Text>
        <View style={styles.reihe}>
          {(Object.keys(SYMBOL) as Begriff[]).map((begriff) => (
            <View key={begriff} style={styles.probe}>
              <View style={[styles.klecks, styles.textprobe]}>
                <Ionicons name={SYMBOL[begriff]} size={20} color={colors.ink} />
              </View>
              <Text style={styles.probeName}>{begriff}</Text>
            </View>
          ))}
        </View>
      </Klappe>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    gruppe: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 6,
    },
    reihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    probe: { alignItems: 'center', gap: 4, width: 84 },
    klecks: {
      width: 48,
      height: 48,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    textprobe: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surface,
    },
    abstand: { height: 48, backgroundColor: colors.accent, borderRadius: 2 },
    probeName: { color: colors.inkFaint, fontSize: 10, textAlign: 'center' },
    zeile: { flexDirection: 'row', alignItems: 'baseline', gap: 10 },
    beispiel: { color: colors.ink, flexShrink: 1 },
    mass: { color: colors.inkFaint, fontSize: 11, marginLeft: 'auto' },
  });
