import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo } from 'react';
import {
  ActivityIndicator,
  Pressable,
  StyleSheet,
  Text,
  View,
  ViewStyle,
} from 'react-native';

import { Colors, radius, type, useColors } from '../theme';

/** Gemeinsame Glaskachel: Fläche, Rundung, Schatten. */
export function Card({
  children,
  style,
  tint,
  verlauf,
  label,
  dimmed,
  onPress,
  onLongPress,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  tint?: string;
  /** Zwei Töne, und die ganze Kachel trägt sie. Für die Kacheln, die
   *  selbst der Knopf sind - die Szene trägt so ihre Farbe, statt sie
   *  in einem Feld darin zu zeigen (lib/szenenfarbe.ts). Ein flacher
   *  `tint` täte es nicht: Der Verlauf ist es, der die Fläche als Knopf
   *  lesbar macht statt als eingefärbte Karte. */
  verlauf?: [string, string, ...string[]];
  /** Vorlesetext, wenn die ganze Kachel ein Knopf ist. Ohne ihn läse
   *  VoiceOver den ganzen Inhalt vor, statt zu sagen, was passiert. */
  label?: string;
  dimmed?: boolean;
  onPress?: () => void;
  onLongPress?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const content = [
    styles.card,
    tint ? { backgroundColor: tint } : null,
    // Der Verlauf liegt als eigene Fläche darin und braucht die
    // Beschneidung - sonst stünde er über die Rundung hinaus.
    verlauf ? { overflow: 'hidden' as const } : null,
    dimmed ? styles.dimmed : null,
    style,
  ];
  const inhalt = (
    <>
      {verlauf ? (
        <LinearGradient
          colors={verlauf}
          start={{ x: 0, y: 0 }}
          end={{ x: 1, y: 1 }}
          style={StyleSheet.absoluteFill}
          pointerEvents="none"
        />
      ) : null}
      {children}
    </>
  );
  if (onPress || onLongPress) {
    return (
      <Pressable
        onPress={onPress}
        onLongPress={onLongPress}
        accessibilityRole="button"
        accessibilityLabel={label}
        style={({ pressed }) => [...content, pressed && { opacity: 0.85 }]}
      >
        {inhalt}
      </Pressable>
    );
  }
  return <View style={content}>{inhalt}</View>;
}

/**
 * Fusszeile jeder Kachel.
 *
 * Der Name steht auf voller Breite, Raum und Ein/Aus-Knopf teilen sich die
 * Zeile darunter – sonst bricht ein Name wie „Licht Schlafzimmer“ auf einer
 * schmalen Telefonkachel mitten im Wort.
 */
export function CardFooter({
  title,
  subtitle,
  on,
  onToggle,
  toggleLabel,
  light,
  pending,
  onLongPress,
}: {
  title: string;
  subtitle?: string | null;
  on?: boolean;
  onToggle?: () => void;
  /** Was der Knopf hier bedeutet, wenn nicht «Ein-/Ausschalten». Auf
   *  einer pausierten Box heisst er «Weiterspielen» - eine Vorlesehilfe,
   *  die «Einschalten» sagt, führt dort in die Irre. */
  toggleLabel?: string;
  light?: boolean;
  pending?: boolean;
  /** Was ein langer Druck auf den Namen tut. Der Name ist das einzige
   *  Stück Kachel, das nie unter einem Knopf liegt - bei einem Schloss
   *  oder einem Sauger ist die Fläche darüber vollständig belegt. */
  onLongPress?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.footer}>
      <Text
        numberOfLines={2}
        onLongPress={onLongPress}
        style={[styles.title, light && { color: colors.onGradient }]}
      >
        {title}
      </Text>
      <View style={styles.footerRow}>
        <Text
          numberOfLines={1}
          style={[styles.subtitle, light && { color: colors.onGradientSoft }]}
        >
          {subtitle ?? ''}
        </Text>
        {onToggle ? (
          <PowerButton
            on={!!on}
            onPress={onToggle}
            pending={pending}
            label={toggleLabel}
          />
        ) : null}
      </View>
    </View>
  );
}

export function PowerButton({
  on,
  onPress,
  pending,
  label,
}: {
  on: boolean;
  onPress: () => void;
  pending?: boolean;
  label?: string;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, busy: !!pending }}
      accessibilityLabel={label ?? (on ? 'Ausschalten' : 'Einschalten')}
      style={({ pressed }) => [
        styles.power,
        { borderColor: on ? colors.on : colors.off },
        on && { backgroundColor: colors.onSoft },
        (pressed || pending) && { opacity: 0.55 },
      ]}
    >
      {pending ? (
        <ActivityIndicator size="small" color={on ? colors.on : colors.inkFaint} />
      ) : (
        <Ionicons name="power" size={17} color={on ? colors.on : colors.inkFaint} />
      )}
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    padding: 16,
    justifyContent: 'space-between',
    gap: 12,
    minHeight: 138,
    shadowColor: '#2A3444',
    shadowOpacity: 0.12,
    shadowRadius: 18,
    shadowOffset: { width: 0, height: 8 },
  },
  dimmed: { opacity: 0.55 },
  footer: { gap: 2 },
  footerRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 8,
    minHeight: 34,
  },
  title: {
    color: colors.ink,
    fontSize: type.cardTitle,
    fontWeight: '600',
  },
  subtitle: {
    color: colors.inkSoft,
    fontSize: type.cardSub,
    flexShrink: 1,
  },
  power: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1.5,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
