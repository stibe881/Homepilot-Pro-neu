import React, { useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { HubSettings } from '../api/types';
import { colors, radius } from '../theme';

interface Props {
  initial: HubSettings | null;
  onSave: (settings: HubSettings) => void;
  onCancel?: () => void;
}

export function SettingsScreen({ initial, onSave, onCancel }: Props) {
  const [url, setUrl] = useState(initial?.url ?? 'http://192.168.1.10:8123');
  const [token, setToken] = useState(initial?.token ?? '');

  return (
    <KeyboardAvoidingView
      style={styles.container}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.form}>
        <Text style={styles.title}>Hub verbinden</Text>
        <Text style={styles.label}>Hub-URL</Text>
        <TextInput
          style={styles.input}
          value={url}
          onChangeText={setUrl}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="url"
          placeholder="http://192.168.1.10:8123"
          placeholderTextColor={colors.off}
        />
        <Text style={styles.label}>Token</Text>
        <TextInput
          style={styles.input}
          value={token}
          onChangeText={setToken}
          autoCapitalize="none"
          autoCorrect={false}
          secureTextEntry
          placeholder="Token aus config.yaml"
          placeholderTextColor={colors.off}
        />
        <Pressable
          style={styles.saveButton}
          onPress={() => onSave({ url: url.trim().replace(/\/+$/, ''), token: token.trim() })}
        >
          <Text style={styles.saveText}>Speichern & verbinden</Text>
        </Pressable>
        {onCancel && (
          <Pressable style={styles.cancelButton} onPress={onCancel}>
            <Text style={styles.cancelText}>Abbrechen</Text>
          </Pressable>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: colors.bg,
    justifyContent: 'center',
    padding: 24,
  },
  form: {
    width: '100%',
    maxWidth: 420,
    alignSelf: 'center',
    gap: 8,
  },
  title: {
    color: colors.text,
    fontSize: 26,
    fontWeight: '800',
    marginBottom: 16,
  },
  label: {
    color: colors.textDim,
    fontSize: 13,
    fontWeight: '600',
    marginTop: 8,
  },
  input: {
    backgroundColor: colors.card,
    borderColor: colors.cardBorder,
    borderWidth: 1,
    borderRadius: radius / 2,
    color: colors.text,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  saveButton: {
    backgroundColor: colors.accent,
    borderRadius: radius / 2,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 20,
  },
  saveText: {
    color: colors.bg,
    fontWeight: '800',
    fontSize: 16,
  },
  cancelButton: {
    paddingVertical: 12,
    alignItems: 'center',
  },
  cancelText: {
    color: colors.textDim,
    fontSize: 15,
  },
});
