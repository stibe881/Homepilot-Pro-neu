import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { ActivityIndicator, Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, radius, useColors } from '../theme';

/**
 * Ein Muster für «noch nichts da».
 *
 * Vorher löste das jeder Bildschirm anders: mal ein blasses «Wird geladen
 * …», mal eine leere Fläche, mal gar nichts. Für sich genommen ist keines
 * davon falsch – zusammen wirkt die App unruhig, und beim leeren
 * Bildschirm weiss man nie, ob gerade geladen wird oder wirklich nichts
 * da ist.
 *
 * Drei Fälle, drei Bausteine, überall gleich:
 *
 * - {@link Laedt}       – unterwegs, gleich kommt etwas
 * - {@link Leer}        – angekommen, aber es gibt nichts zu zeigen
 * - {@link Fehlschlag}  – es kam nichts, und man kann es erneut versuchen
 *
 * Alle drei sagen ausdrücklich, *was* geladen wird oder fehlt. «Wird
 * geladen …» allein lässt offen, worauf man wartet – und wenn zwei
 * Abschnitte gleichzeitig laden, sieht man zweimal denselben Satz.
 */

/** Unterwegs. `was` steht im Genitiv-losen Klartext: «Abläufe», «Verlauf». */
export function Laedt({ was, klein }: { was: string; klein?: boolean }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View
      style={[styles.reihe, klein ? styles.reiheKlein : styles.reiheGross]}
      accessibilityRole="progressbar"
      accessibilityLabel={`${was} werden geladen`}
    >
      <ActivityIndicator size="small" color={colors.inkFaint} />
      <Text style={styles.text}>{was} …</Text>
    </View>
  );
}

/**
 * Ein Umriss von dem, was gleich kommt.
 *
 * Der Unterschied zum {@link Laedt} darüber ist nicht Zierde: Ein
 * Spinner sagt «warte», ein Umriss sagt «hier kommen drei Kacheln hin».
 * Das erste beantwortet die Frage nicht, die man beim Öffnen einer Seite
 * hat - *ist da etwas?* -, und deshalb tippt man in der Wartezeit
 * herum, statt hinzusehen. Und wenn die Kacheln dann kommen, springt
 * die Seite: Der Spinner nahm eine Zeile ein, der Inhalt nimmt
 * fünfhundert Punkte.
 *
 * Deshalb hat der Umriss die Grösse dessen, was er ersetzt. Wo er
 * steht, steht danach etwas gleich Grosses, und nichts springt.
 *
 * Bewusst ohne Animation: Ein pulsierender Block, der eine halbe
 * Sekunde lang zu sehen ist, ist Unruhe ohne Auskunft - und im Haus ist
 * der Hub im selben Netz, also ist es fast immer eine halbe Sekunde.
 * Wer die App von unterwegs öffnet, sieht ihn länger, und dann ist ein
 * ruhiger Umriss angenehmer als ein blinkender.
 */
export function Umriss({
  zeilen = 3,
  hoehe = 64,
  was,
}: {
  /** Wie viele Blöcke - so viele, wie danach dastehen werden. */
  zeilen?: number;
  /** Wie hoch einer davon ist. Kachelhöhe, Zeilenhöhe, was passt. */
  hoehe?: number;
  /** Was hier geladen wird - für die Vorlesehilfe. Ein Umriss ohne das
   *  ist für jemanden, der die App vorlesen lässt, gar nichts. */
  was: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View
      style={styles.umrissBlock}
      accessibilityRole="progressbar"
      accessibilityLabel={`${was} werden geladen`}
    >
      {Array.from({ length: Math.max(1, zeilen) }, (_, index) => (
        <View key={index} style={[styles.umriss, { height: hoehe }]} />
      ))}
    </View>
  );
}

/**
 * Angekommen, aber leer.
 *
 * `hinweis` ist der wichtigere Teil: Ein leerer Bildschirm, der nur «Keine
 * Abläufe» sagt, lässt jemanden ratlos zurück. Einer, der sagt, wie der
 * erste entsteht, nicht.
 */
export function Leer({
  icon,
  titel,
  hinweis,
  aktion,
}: {
  icon?: keyof typeof Ionicons.glyphMap;
  titel: string;
  hinweis?: string;
  aktion?: { label: string; onPress: () => void };
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.block} accessibilityRole="summary">
      {icon ? <Ionicons name={icon} size={26} color={colors.inkFaint} /> : null}
      <Text style={styles.titel}>{titel}</Text>
      {hinweis ? <Text style={styles.text}>{hinweis}</Text> : null}
      {aktion ? (
        <Pressable
          onPress={aktion.onPress}
          accessibilityRole="button"
          style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.knopfText}>{aktion.label}</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

/**
 * Es kam nichts.
 *
 * Mit Knopf, wenn ein erneuter Versuch etwas ändern kann – bei einer
 * abgebrochenen Verbindung ist das der Regelfall. Ohne Knopf bliebe nur
 * «App neu starten», und genau das tun Leute dann auch.
 */
export function Fehlschlag({
  text,
  onRetry,
}: {
  text: string;
  onRetry?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.block} accessibilityRole="alert">
      <Ionicons name="cloud-offline-outline" size={26} color={colors.danger} />
      <Text style={styles.titel}>{text}</Text>
      {onRetry ? (
        <Pressable
          onPress={onRetry}
          accessibilityRole="button"
          style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.knopfText}>Nochmal versuchen</Text>
        </Pressable>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    umrissBlock: { gap: 10 },
    umriss: {
      borderRadius: radius.card,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    reihe: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    reiheKlein: { paddingVertical: 4 },
    reiheGross: { paddingVertical: 18, justifyContent: 'center' },
    block: {
      alignItems: 'center',
      gap: 8,
      paddingVertical: 24,
      paddingHorizontal: 16,
    },
    titel: { color: colors.ink, fontSize: 15, fontWeight: '600', textAlign: 'center' },
    text: { color: colors.inkSoft, fontSize: 13, textAlign: 'center', lineHeight: 19 },
    knopf: {
      marginTop: 4,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    knopfText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  });
