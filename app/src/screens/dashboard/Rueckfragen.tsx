import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Modal, Pressable, Text, TextInput, View } from 'react-native';

import { Entity } from '../../api/types';
import { Colors } from '../../theme';
import { DashboardStile } from './stile';

/**
 * Rückfrage vor dem Schalten eines gesperrten Geräts.
 *
 * Für alles, was man nicht im Vorbeigehen antippen will: Herd, Sauna, der
 * Serverschrank. Die Sperre verhindert nichts – sie fügt nur den einen
 * bewussten Schritt ein, der ein Versehen von einer Absicht trennt.
 */
export function LockConfirm({
  entity,
  command,
  gesperrt = true,
  onCancel,
  onConfirm,
  colors,
  styles,
}: {
  entity: Entity;
  command: string;
  /** Ist das Gerät wirklich gesperrt? Die Türe vom Sperrbildschirm fragt
   *  auch ungesperrt nach - dann darf der Titel nicht «ist gesperrt»
   *  behaupten, und der Hinweis nennt die Nachfrage-Einstellung statt
   *  des Anpassen-Modus. */
  gesperrt?: boolean;
  onCancel: () => void;
  onConfirm: () => void;
  colors: Colors;
  styles: DashboardStile;
}) {
  const was =
    command === 'open_door' || command === 'unlatch'
      ? 'öffnen'
      : command === 'turn_off' || command === 'close'
        ? 'ausschalten'
        : command === 'toggle'
          ? 'umschalten'
          : 'einschalten';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.lockBackdrop}>
        <View style={styles.lockSheet}>
          <Ionicons name="lock-closed" size={26} color={colors.accent} />
          <Text style={styles.lockTitle}>
            {gesperrt ? `${entity.name} ist gesperrt` : `${entity.name} ${was}?`}
          </Text>
          <Text style={styles.lockText}>
            {gesperrt
              ? `Wirklich ${was}? Die Sperre lässt sich im Anpassen-Modus wieder aufheben.`
              : `Wirklich ${was}? Diese Frage lässt sich in den Einstellungen abstellen («Rückfrage vor dem Türöffnen»).`}
          </Text>
          <View style={styles.lockActions}>
            <Pressable onPress={onCancel} style={styles.lockCancel}>
              <Text style={styles.lockCancelText}>Abbrechen</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={styles.lockConfirm}>
              <Text style={styles.lockConfirmText}>Ja, {was}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
  );
}

/** PIN-Feld vor dem Entschärfen - siehe lib/alarmpin.ts, warum es das
 *  neben dem Feld im Alarm-Bildschirm noch einmal gibt. */
export function AlarmPinAsk({
  entity,
  onCancel,
  onConfirm,
  colors,
  styles,
}: {
  entity: Entity;
  onCancel: () => void;
  onConfirm: (pin: string) => void;
  colors: Colors;
  styles: DashboardStile;
}) {
  const [pin, setPin] = useState('');
  const gesetzt = !!entity.state.pin_required;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.lockBackdrop}>
        <View style={styles.lockSheet}>
          <Ionicons name="keypad-outline" size={26} color={colors.accent} />
          <Text style={styles.lockTitle}>Anlage entschärfen</Text>
          <Text style={styles.lockText}>
            {gesetzt
              ? 'Zum Ausschalten die PIN eingeben.'
              : 'An diesem Gerät geht das nur mit PIN – es ist aber keine gesetzt. Wer die Alarmanlage verwaltet, kann sie dort setzen.'}
          </Text>
          {gesetzt ? (
            <TextInput
              style={styles.pinField}
              value={pin}
              onChangeText={(text) => setPin(text.replace(/[^0-9]/g, ''))}
              onSubmitEditing={() => pin.length >= 4 && onConfirm(pin)}
              placeholder="PIN"
              placeholderTextColor={colors.inkFaint}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
              autoFocus
              accessibilityLabel="PIN zum Entschärfen"
            />
          ) : null}
          <View style={styles.lockActions}>
            <Pressable onPress={onCancel} style={styles.lockCancel}>
              <Text style={styles.lockCancelText}>Abbrechen</Text>
            </Pressable>
            {gesetzt ? (
              <Pressable
                onPress={() => onConfirm(pin)}
                disabled={pin.length < 4}
                style={[styles.lockConfirm, pin.length < 4 && { opacity: 0.6 }]}
              >
                <Text style={styles.lockConfirmText}>Entschärfen</Text>
              </Pressable>
            ) : null}
          </View>
        </View>
      </View>
    </Modal>
  );
}
