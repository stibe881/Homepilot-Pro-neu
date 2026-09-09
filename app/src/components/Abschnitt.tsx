import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Colors, space, useColors } from '../theme';

/**
 * Eine Überschrift über mehreren Karten – die Gliederung einer Seite.
 *
 * Die Einstellungsseiten waren Stapel gleich aussehender Karten: Auf der
 * Konto-Seite lagen Profil, Erscheinungsbild, Ortung, Passwort, «Meine
 * Geräte», Face ID, Türrückfrage und die Push-Einstellungen
 * untereinander, jede so wichtig wie die nächste. Wer etwas suchte,
 * scrollte und las Titel – und wer sich verirrte, merkte es erst am Ende
 * der Seite.
 *
 * Eine Handvoll Überschriften macht daraus vier Blöcke, die man
 * überfliegen kann. Bewusst nur Text und kein weiterer Rahmen: Die
 * Karten haben schon einen, und ein Kasten um Kästen wäre die dritte
 * Ebene für eine Auskunft, die eine Zeile ist.
 */
export function Abschnitt({
  titel,
  /** Ein Satz darunter, wo die Überschrift allein zu knapp wäre. */
  hinweis,
  children,
}: {
  titel: string;
  hinweis?: string;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <View style={styles.abschnitt}>
      <View style={styles.kopf}>
        <Text style={styles.titel}>{titel}</Text>
        {hinweis ? <Text style={styles.hinweis}>{hinweis}</Text> : null}
      </View>
      {children}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    // Derselbe Abstand wie zwischen zwei Karten - der Block ist ein
    // Stück der Spalte und nicht etwas daneben.
    abschnitt: { gap: space.gap },
    /** Über dem ersten Kasten mehr Luft als darunter: Die Überschrift
     *  gehört zu dem, was folgt, nicht zu dem, was darüber steht. */
    kopf: { gap: 2, marginTop: 6, paddingHorizontal: 4 },
    // Auf dem Verlauf, nicht auf einer Karte - darum onGradient.
    titel: { color: colors.onGradient, fontSize: 17, fontWeight: '700' },
    hinweis: { color: colors.onGradientSoft, fontSize: 12, lineHeight: 17 },
  });
