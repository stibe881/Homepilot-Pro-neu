import { Ionicons } from '@expo/vector-icons';
import React, { useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius } from '../theme';

/**
 * Kurze Einblendung für fehlgeschlagene Befehle.
 *
 * Verschwindet von selbst, lässt sich aber wegtippen – eine Fehlermeldung,
 * die man wegklicken muss, unterbricht beim Bedienen mehr als sie hilft.
 */
export function Toast({
  message,
  onDismiss,
  bottomInset = 0,
}: {
  message: string | null;
  onDismiss: () => void;
  bottomInset?: number;
}) {
  useEffect(() => {
    if (!message) return;
    const timer = setTimeout(onDismiss, 5000);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);

  if (!message) return null;

  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="alert"
      style={[styles.wrapper, { bottom: bottomInset + 20 }]}
    >
      <View style={styles.toast}>
        <Ionicons name="alert-circle-outline" size={20} color={colors.danger} />
        <Text style={styles.text} numberOfLines={3}>
          {message}
        </Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  wrapper: {
    position: 'absolute',
    left: 16,
    right: 16,
    alignItems: 'center',
  },
  toast: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    maxWidth: 520,
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingVertical: 12,
    paddingHorizontal: 16,
    shadowColor: '#2A3444',
    shadowOpacity: 0.2,
    shadowRadius: 16,
    shadowOffset: { width: 0, height: 6 },
  },
  text: {
    color: colors.ink,
    fontSize: 14,
    flexShrink: 1,
  },
});
