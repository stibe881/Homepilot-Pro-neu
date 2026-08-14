import { Ionicons } from '@expo/vector-icons';
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
  dimmed,
  onPress,
}: {
  children: React.ReactNode;
  style?: ViewStyle;
  tint?: string;
  dimmed?: boolean;
  onPress?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const content = [
    styles.card,
    tint ? { backgroundColor: tint } : null,
    dimmed ? styles.dimmed : null,
    style,
  ];
  if (onPress) {
    return (
      <Pressable
        onPress={onPress}
        accessibilityRole="button"
        style={({ pressed }) => [...content, pressed && { opacity: 0.85 }]}
      >
        {children}
      </Pressable>
    );
  }
  return <View style={content}>{children}</View>;
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
  light,
  pending,
}: {
  title: string;
  subtitle?: string | null;
  on?: boolean;
  onToggle?: () => void;
  light?: boolean;
  pending?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.footer}>
      <Text
        numberOfLines={2}
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
          <PowerButton on={!!on} onPress={onToggle} pending={pending} />
        ) : null}
      </View>
    </View>
  );
}

export function PowerButton({
  on,
  onPress,
  pending,
}: {
  on: boolean;
  onPress: () => void;
  pending?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="switch"
      accessibilityState={{ checked: on, busy: !!pending }}
      accessibilityLabel={on ? 'Ausschalten' : 'Einschalten'}
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
