import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { colors, radius, type } from '../theme';

interface Props {
  initial: HubSettings | null;
  onSave: (settings: HubSettings) => void;
  onCancel?: () => void;
  /** Eingebettet in die Kachelfläche statt als ganzer Bildschirm. */
  embedded?: boolean;
  /** Angemeldeter Benutzer – zeigt Name und Rolle an. */
  user?: { name: string; role: string } | null;
}

export function SettingsScreen({ initial, onSave, onCancel, embedded, user }: Props) {
  const [url, setUrl] = useState(initial?.url ?? 'http://192.168.1.10:8123');
  const [token, setToken] = useState(initial?.token ?? '');
  const [name, setName] = useState(initial?.name ?? '');

  const form = (
    <Card style={styles.card}>
      <Text style={styles.title}>Hub verbinden</Text>
      {user ? (
        <Text style={styles.account}>
          Angemeldet als {user.name} · {user.role}
        </Text>
      ) : null}

      <Field
        label="Hub-URL"
        value={url}
        onChange={setUrl}
        placeholder="http://192.168.1.10:8123"
        keyboardType="url"
      />
      <Field
        label="Token"
        value={token}
        onChange={setToken}
        placeholder="Token aus config.yaml"
        secure
      />
      <Field
        label="Dein Name (für die Begrüssung)"
        value={name}
        onChange={setName}
        placeholder="optional"
      />

      <Pressable
        style={({ pressed }) => [styles.save, pressed && { opacity: 0.8 }]}
        onPress={() =>
          onSave({
            url: url.trim().replace(/\/+$/, ''),
            token: token.trim(),
            name: name.trim(),
          })
        }
      >
        <Text style={styles.saveText}>Speichern & verbinden</Text>
      </Pressable>

      {onCancel ? (
        <Pressable style={styles.cancel} onPress={onCancel}>
          <Text style={styles.cancelText}>Abbrechen</Text>
        </Pressable>
      ) : null}
    </Card>
  );

  if (embedded) {
    return <View style={styles.embedded}>{form}</View>;
  }
  return <View style={styles.screen}>{form}</View>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: 'url';
}) {
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  embedded: { marginTop: 4 },
  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    minHeight: 0,
    gap: 14,
    padding: 22,
  },
  title: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
  },
  field: { gap: 6 },
  label: {
    color: colors.inkSoft,
    fontSize: type.cardSub,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    color: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  save: {
    backgroundColor: colors.ink,
    borderRadius: radius.control,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  saveText: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 16,
  },
  account: { color: colors.inkSoft, fontSize: 13, marginTop: -8 },
  cancel: { alignItems: 'center', paddingVertical: 6 },
  cancelText: { color: colors.inkSoft, fontSize: 15 },
});
