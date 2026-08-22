/**
 * Anpassen-Dialoge einer Kachel: Raum, Name, Gruppe.
 *
 * Herausgelöst aus EntityCard.tsx (Punkt 59 der Werkbank).
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, Text, TextInput, View } from 'react-native';

import { useColors } from '../../theme';
import { makeStyles } from './stil';


export function RoomPicker({
  visible,
  current,
  rooms,
  onClose,
  onSelect,
}: {
  visible: boolean;
  current: string | null;
  rooms: string[];
  onClose: () => void;
  onSelect: (room: string | null) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const options: { key: string; label: string; value: string | null }[] = [
    { key: '__none', label: 'Kein Raum', value: null },
    ...rooms.map((name) => ({ key: name, label: name, value: name })),
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle}>Raum wählen</Text>
          <ScrollView>
            {options.map((option) => {
              const active = option.value === current;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => onSelect(option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.roomOption, active && styles.roomOptionActive]}
                >
                  <Text style={styles.roomOptionText}>{option.label}</Text>
                  {active ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Umbenennen-Dialog: ein Textfeld mit dem aktuellen Namen vorbelegt. */
export function RenameDialog({
  visible,
  current,
  onClose,
  onSubmit,
}: {
  visible: boolean;
  current: string;
  onClose: () => void;
  onSubmit: (name: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState(current);
  // Bei jedem Öffnen mit dem aktuellen Namen starten.
  useEffect(() => {
    if (visible) setName(current);
  }, [visible, current]);
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle}>Gerät umbenennen</Text>
          <TextInput
            style={styles.renameInput}
            value={name}
            onChangeText={setName}
            placeholder="Neuer Name"
            placeholderTextColor={colors.inkFaint}
            autoFocus
          />
          <View style={styles.renameRow}>
            <Pressable
              onPress={onClose}
              accessibilityRole="button"
              style={({ pressed }) => [styles.renameGhost, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.renameGhostText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={() => onSubmit(name.trim())}
              accessibilityRole="button"
              style={({ pressed }) => [styles.renameSave, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.renameSaveText}>Speichern</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/** Gruppenauswahl im Anpassen-Modus: bestehende Gruppen plus «neue anlegen». */
export function GroupPicker({
  visible,
  current,
  groups,
  onClose,
  onSelect,
}: {
  visible: boolean;
  current: string | null;
  groups: string[];
  onClose: () => void;
  onSelect: (group: string | null) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [fresh, setFresh] = useState('');
  useEffect(() => {
    if (visible) setFresh('');
  }, [visible]);
  const options: { key: string; label: string; value: string | null }[] = [
    { key: '__none', label: 'Keine Gruppe', value: null },
    ...groups.map((name) => ({ key: name, label: name, value: name })),
  ];
  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.roomBackdrop} onPress={onClose}>
        <Pressable style={styles.roomSheet} onPress={() => {}}>
          <Text style={styles.roomSheetTitle}>Gruppe wählen</Text>
          <ScrollView>
            {options.map((option) => {
              const active = option.value === current;
              return (
                <Pressable
                  key={option.key}
                  onPress={() => onSelect(option.value)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: active }}
                  style={[styles.roomOption, active && styles.roomOptionActive]}
                >
                  <Text style={styles.roomOptionText}>{option.label}</Text>
                  {active ? (
                    <Ionicons name="checkmark" size={20} color={colors.accent} />
                  ) : null}
                </Pressable>
              );
            })}
          </ScrollView>
          <View style={styles.renameRow}>
            <TextInput
              style={[styles.renameInput, { flex: 1, marginBottom: 0 }]}
              value={fresh}
              onChangeText={setFresh}
              placeholder="Neue Gruppe …"
              placeholderTextColor={colors.inkFaint}
            />
            <Pressable
              onPress={() => fresh.trim() && onSelect(fresh.trim())}
              accessibilityRole="button"
              style={({ pressed }) => [styles.renameSave, pressed && { opacity: 0.85 }]}
            >
              <Text style={styles.renameSaveText}>Anlegen</Text>
            </Pressable>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

export function EditButton({
  icon,
  active,
  label,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  active: boolean;
  label: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [styles.editButton, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={18} color={active ? colors.accent : colors.ink} />
    </Pressable>
  );
}

/** Türöffner (z.B. Ring Intercom): Öffnen braucht zwei Tipps – der erste
 *  bewaffnet den Knopf für vier Sekunden, erst der zweite öffnet wirklich.
 *  Eine Haustür soll sich nicht durch Wischen aus Versehen öffnen. */
