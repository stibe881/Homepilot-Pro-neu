import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, radius, useColors } from '../theme';

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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

/**
 * Die kurze Bestätigung, dass etwas geklappt hat.
 *
 * Bisher schloss sich das Fenster nach dem Speichern eines Ablaufs
 * einfach – und man wusste nur, dass es weg ist, nicht ob es angekommen
 * ist. Bei einem Ablauf, der erst in einer Woche das erste Mal feuert,
 * merkt man den Unterschied sonst nie.
 *
 * Der Text sagt, *was* passiert ist («Ablauf gespeichert», «Szene
 * gelöscht»), nicht bloss «Erledigt». Drei Sekunden reichen – wer sie
 * verpasst, hat die Liste dahinter ohnehin schon aktualisiert vor sich.
 */
export function Bestaetigung({
  text,
  onDismiss,
  bottomInset = 0,
}: {
  text: string | null;
  onDismiss: () => void;
  bottomInset?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  useEffect(() => {
    if (!text) return;
    const timer = setTimeout(onDismiss, 3000);
    return () => clearTimeout(timer);
  }, [text, onDismiss]);

  if (!text) return null;

  return (
    <Pressable
      onPress={onDismiss}
      accessibilityRole="alert"
      accessibilityLiveRegion="polite"
      style={[styles.wrapper, { bottom: bottomInset + 20 }]}
    >
      <View style={styles.toast}>
        <Ionicons name="checkmark-circle-outline" size={20} color={colors.on} />
        <Text style={styles.text} numberOfLines={2}>
          {text}
        </Text>
      </View>
    </Pressable>
  );
}

/**
 * Das Angebot, die letzte Schaltung zurückzunehmen.
 *
 * Steht nur ein paar Sekunden: Ein «Rückgängig», das dauerhaft liegen
 * bleibt, nimmt später etwas zurück, an das sich niemand mehr erinnert.
 * Der Text sagt deshalb auch, *was* zurückgenommen würde.
 */
export function UndoToast({
  what,
  onUndo,
  onDismiss,
  bottomInset = 0,
}: {
  what: { name: string; label: string } | null;
  onUndo: () => void;
  onDismiss: () => void;
  bottomInset?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Die Beschreibung oben sagte «nur ein paar Sekunden», die Umsetzung
  // liess das Angebot stehen, bis etwas Neues kam. Bei einer Schaltung
  // fiel das nicht auf – da folgt schnell die nächste. Beim Abhaken im
  // Laden schon: Dort bliebe «Rückgängig» zwischen zwei Regalen liegen.
  useEffect(() => {
    if (!what) return;
    const timer = setTimeout(onDismiss, 6000);
    return () => clearTimeout(timer);
  }, [what, onDismiss]);

  if (!what) return null;

  return (
    <View style={[styles.wrapper, { bottom: bottomInset + 20 }]} pointerEvents="box-none">
      <View style={styles.toast}>
        <Ionicons name="checkmark-circle-outline" size={20} color={colors.on} />
        <Text style={styles.text} numberOfLines={2}>
          {what.name} {what.label}
        </Text>
        <Pressable
          onPress={onUndo}
          accessibilityRole="button"
          accessibilityLabel={`${what.name} zurückschalten`}
          hitSlop={8}
          style={styles.action}
        >
          <Text style={styles.actionText}>Rückgängig</Text>
        </Pressable>
        <Pressable onPress={onDismiss} accessibilityLabel="Ausblenden" hitSlop={8}>
          <Ionicons name="close" size={18} color={colors.inkFaint} />
        </Pressable>
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
  action: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  actionText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
});
