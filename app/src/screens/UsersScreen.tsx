import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, space, useColors } from '../theme';

/**
 * Benutzerverwaltung: Wer hat Zugang zum Haus, mit welcher Rolle?
 *
 * Beim Anlegen erzeugt der Hub ein Token und zeigt es genau einmal –
 * danach ist es nirgends mehr abrufbar. Benutzer aus der config.yaml
 * gehören der Datei und lassen sich hier nur ansehen.
 */

export const ROLE_LABELS: Record<string, string> = {
  besitzer: 'Besitzer',
  bewohner: 'Mitbewohner',
  gast: 'Gast',
};

const ROLE_HINTS: Record<string, string> = {
  besitzer: 'darf alles, auch Benutzer und Konfiguration verwalten',
  bewohner: 'bedient das ganze Haus, darf Abläufe pausieren',
  gast: 'sieht und schaltet nur Freigegebenes (Licht und Schalter)',
};

interface HubUser {
  name: string;
  role: string;
  allow: string[];
  editable: boolean;
}

interface Props {
  settings: HubSettings;
  currentUser?: { name: string; role: string } | null;
}

export function UsersScreen({ settings, currentUser }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${settings.token}` }),
    [settings.token]
  );

  const [users, setUsers] = useState<HubUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState('bewohner');
  const [createdToken, setCreatedToken] = useState<{ name: string; token: string } | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);

  const load = useCallback(() => {
    setError(null);
    fetch(`${settings.url}/api/users`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then(setUsers)
      .catch((err) => setError(String(err.message ?? err)));
  }, [settings.url, headers]);

  useEffect(load, [load]);

  const create = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      const response = await fetch(`${settings.url}/api/users`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ name: newName.trim(), role: newRole }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      setCreatedToken({ name: body.user.name, token: body.user.token });
      setNewName('');
      setCreating(false);
      load();
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  };

  const remove = async (name: string) => {
    setError(null);
    try {
      const response = await fetch(
        `${settings.url}/api/users/${encodeURIComponent(name)}`,
        { method: 'DELETE', headers }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      setConfirmDelete(null);
      load();
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  };

  return (
    <View style={styles.stack}>
      <Text style={styles.title}>Benutzerverwaltung</Text>
      <Text style={styles.intro}>
        Jede Person bekommt ein eigenes Token – so steht im Protokoll, wer
        geschaltet hat, und ein Zugang lässt sich einzeln zurückziehen.
      </Text>

      {createdToken ? (
        <Card style={styles.tokenCard}>
          <Text style={styles.tokenTitle}>
            Token für {createdToken.name} – jetzt notieren!
          </Text>
          <Text selectable style={styles.tokenValue}>
            {createdToken.token}
          </Text>
          <Text style={styles.tokenHint}>
            Es wird nur dieses eine Mal angezeigt. In der App der Person unter
            Einstellungen → Konto &amp; Verbindung eintragen.
          </Text>
          <Pressable onPress={() => setCreatedToken(null)} style={styles.smallButton}>
            <Text style={styles.smallButtonText}>Verstanden</Text>
          </Pressable>
        </Card>
      ) : null}

      {users === null && !error ? <Text style={styles.note}>Wird geladen …</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {(users ?? []).map((user) => (
        <Card key={user.name} style={styles.userCard}>
          <View style={styles.avatar}>
            <Text style={styles.avatarText}>{user.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>
              {user.name}
              {currentUser?.name === user.name ? '  (du)' : ''}
            </Text>
            <Text style={styles.userRole}>
              {ROLE_LABELS[user.role] ?? user.role}
              {!user.editable ? ' · aus config.yaml' : ''}
            </Text>
          </View>
          {user.editable && currentUser?.name !== user.name ? (
            confirmDelete === user.name ? (
              <Pressable onPress={() => remove(user.name)} style={styles.deleteConfirm}>
                <Text style={styles.deleteConfirmText}>Wirklich löschen</Text>
              </Pressable>
            ) : (
              <Pressable
                onPress={() => {
                  setConfirmDelete(user.name);
                  setTimeout(
                    () => setConfirmDelete((c) => (c === user.name ? null : c)),
                    4000
                  );
                }}
                accessibilityLabel={`${user.name} löschen`}
                style={styles.iconButton}
              >
                <Ionicons name="trash-outline" size={20} color={colors.danger} />
              </Pressable>
            )
          ) : null}
        </Card>
      ))}

      {creating ? (
        <Card style={styles.form}>
          <Text style={styles.formLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="z.B. Anna"
            placeholderTextColor={colors.inkFaint}
            autoFocus
          />
          <Text style={styles.formLabel}>Rolle</Text>
          <View style={styles.roleRow}>
            {Object.keys(ROLE_LABELS).map((role) => (
              <Pressable
                key={role}
                onPress={() => setNewRole(role)}
                accessibilityRole="radio"
                accessibilityState={{ selected: newRole === role }}
                style={[styles.roleChip, newRole === role && styles.roleChipActive]}
              >
                <Text
                  style={[styles.roleChipText, newRole === role && styles.roleChipTextActive]}
                >
                  {ROLE_LABELS[role]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.roleHint}>{ROLE_HINTS[newRole]}</Text>
          <View style={styles.formButtons}>
            <Pressable onPress={() => setCreating(false)} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={create}
              style={[styles.smallButton, styles.primaryButton]}
              disabled={!newName.trim()}
            >
              <Text style={styles.primaryButtonText}>Anlegen</Text>
            </Pressable>
          </View>
        </Card>
      ) : (
        <Pressable onPress={() => setCreating(true)} style={styles.newButton}>
          <Ionicons name="person-add-outline" size={18} color={colors.ink} />
          <Text style={styles.newButtonText}>Benutzer anlegen</Text>
        </Pressable>
      )}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: space.gap },
    title: { color: colors.onGradient, fontSize: 18, fontWeight: '700' },
    intro: { color: colors.onGradientSoft, fontSize: 13, lineHeight: 19, maxWidth: 520 },
    note: { color: colors.onGradientSoft, fontSize: 14 },
    error: { color: colors.danger, fontSize: 13, fontWeight: '600' },

    userCard: {
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
    userName: { color: colors.ink, fontSize: 16, fontWeight: '600' },
    userRole: { color: colors.inkSoft, fontSize: 13, marginTop: 1 },
    iconButton: { padding: 8 },
    deleteConfirm: {
      backgroundColor: colors.danger,
      borderRadius: radius.pill,
      paddingHorizontal: 12,
      paddingVertical: 8,
    },
    deleteConfirmText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },

    tokenCard: { minHeight: 0, gap: 8, borderWidth: 2, borderColor: colors.accent },
    tokenTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    tokenValue: {
      color: colors.ink,
      fontSize: 13,
      fontFamily: 'monospace',
      backgroundColor: colors.track,
      borderRadius: radius.control,
      padding: 10,
    },
    tokenHint: { color: colors.inkSoft, fontSize: 12, lineHeight: 17 },

    form: { minHeight: 0, gap: 8 },
    formLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    roleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    roleChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    roleChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    roleChipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    roleChipTextActive: { color: '#FFFFFF' },
    roleHint: { color: colors.inkFaint, fontSize: 12 },
    formButtons: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
    smallButton: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    smallButtonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    primaryButton: { backgroundColor: colors.accent, borderColor: colors.accent },
    primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

    newButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    newButtonText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  });
