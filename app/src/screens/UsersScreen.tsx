import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, space, useColors } from '../theme';

/**
 * Benutzerverwaltung: Wer hat Zugang zum Haus, mit welcher Rolle?
 *
 * Beim Anlegen erzeugt der Hub ein Token. Antippen eines Benutzers zeigt
 * den Kopplungs-QR-Code – die Person scannt ihn in ihrer App («QR-Code vom
 * Hub scannen») und ist verbunden, ohne etwas abzutippen. Gäste lassen sich
 * auf Bereiche einschränken und jederzeit sperren/entsperren, ohne dass sie
 * ein neues Token brauchen. Benutzer aus der config.yaml gehören der Datei
 * und sind hier nur lesbar.
 */

export const ROLE_LABELS: Record<string, string> = {
  besitzer: 'Besitzer',
  bewohner: 'Mitbewohner',
  gast: 'Gast',
};

const ROLE_HINTS: Record<string, string> = {
  besitzer: 'darf alles, auch Benutzer und Konfiguration verwalten',
  bewohner: 'bedient das ganze Haus, darf Abläufe pausieren',
  gast: 'sieht und schaltet nur die freigegebenen Bereiche',
};

/** Freigebbare Bereiche für Gäste – Schlüssel wie auf dem Hub. */
export const FEATURE_LABELS: Record<string, string> = {
  licht: 'Licht',
  storen: 'Storen',
  familie: 'Familie',
  haustuere: 'Haustüre',
  wohnungstuere: 'Wohnungstüre',
  kalender: 'Kalender',
  haushalt: 'Haushalt',
  raeume: 'Räume',
};

interface HubUser {
  name: string;
  role: string;
  allow: string[];
  editable: boolean;
  enabled?: boolean;
  features?: string[];
}

interface Props {
  settings: HubSettings;
  currentUser?: { name: string; role: string } | null;
}

/** Mehrfach-Auswahl der Gast-Bereiche als Chips. */
function FeatureChips({
  selected,
  onToggle,
  styles,
}: {
  selected: string[];
  onToggle: (feature: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.roleRow}>
      {Object.entries(FEATURE_LABELS).map(([key, label]) => {
        const active = selected.includes(key);
        return (
          <Pressable
            key={key}
            onPress={() => onToggle(key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            style={[styles.roleChip, active && styles.roleChipActive]}
          >
            <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
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
  const [newFeatures, setNewFeatures] = useState<string[]>(['licht']);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Detailansicht: gewählter Benutzer + geladene Kopplungs-Daten.
  const [detail, setDetail] = useState<HubUser | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);

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

  const openDetail = async (user: HubUser) => {
    setDetail(user);
    setPairing(null);
    try {
      const response = await fetch(
        `${settings.url}/api/users/${encodeURIComponent(user.name)}/pairing`,
        { headers }
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      setPairing(body.payload);
    } catch (err: any) {
      setError(`Kopplungs-Code nicht abrufbar (${err.message ?? err})`);
    }
  };

  const patchUser = async (name: string, body: Record<string, any>) => {
    setError(null);
    try {
      const response = await fetch(
        `${settings.url}/api/users/${encodeURIComponent(name)}`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      if (payload?.user) setDetail(payload.user);
      load();
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      const response = await fetch(`${settings.url}/api/users`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          role: newRole,
          features: newRole === 'gast' ? newFeatures : [],
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      setNewName('');
      setCreating(false);
      load();
      // Direkt die Detailansicht mit dem QR-Code öffnen – so lässt sich das
      // neue Mitglied sofort koppeln.
      openDetail(body.user);
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
      setDetail(null);
      load();
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  };

  const toggleNewFeature = (feature: string) =>
    setNewFeatures((current) =>
      current.includes(feature)
        ? current.filter((entry) => entry !== feature)
        : [...current, feature]
    );

  return (
    <View style={styles.stack}>
      <Text style={styles.title}>Benutzerverwaltung</Text>
      <Text style={styles.intro}>
        Benutzer antippen zeigt den Kopplungs-QR-Code. Gäste lassen sich auf
        Bereiche einschränken und jederzeit sperren – ohne neues Token.
      </Text>

      {users === null && !error ? <Text style={styles.note}>Wird geladen …</Text> : null}
      {error ? <Text style={styles.error}>{error}</Text> : null}

      {(users ?? []).map((user) => (
        <Card key={user.name} style={styles.userCard} onPress={() => openDetail(user)}>
          <View style={[styles.avatar, user.enabled === false && styles.avatarDisabled]}>
            <Text style={styles.avatarText}>{user.name.slice(0, 1).toUpperCase()}</Text>
          </View>
          <View style={{ flex: 1 }}>
            <Text style={styles.userName}>
              {user.name}
              {currentUser?.name === user.name ? '  (du)' : ''}
            </Text>
            <Text style={styles.userRole}>
              {ROLE_LABELS[user.role] ?? user.role}
              {user.role === 'gast' && (user.features?.length ?? 0) > 0
                ? ` · ${user.features!.map((f) => FEATURE_LABELS[f] ?? f).join(', ')}`
                : ''}
              {!user.editable ? ' · aus config.yaml' : ''}
            </Text>
          </View>
          {user.enabled === false ? (
            <View style={styles.disabledBadge}>
              <Text style={styles.disabledBadgeText}>Deaktiviert</Text>
            </View>
          ) : (
            <Ionicons name="qr-code-outline" size={20} color={colors.inkFaint} />
          )}
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
          {newRole === 'gast' ? (
            <>
              <Text style={styles.formLabel}>Darf sehen und bedienen</Text>
              <FeatureChips
                selected={newFeatures}
                onToggle={toggleNewFeature}
                styles={styles}
              />
            </>
          ) : null}
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

      {/* Detail: QR-Code, Sperren, Bereiche, Löschen */}
      <Modal
        visible={detail !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <ScrollView contentContainerStyle={styles.modalContent}>
              {detail ? (
                <>
                  <View style={styles.modalHead}>
                    <Text style={styles.modalTitle}>{detail.name}</Text>
                    <Pressable onPress={() => setDetail(null)} accessibilityLabel="Schliessen">
                      <Ionicons name="close" size={26} color={colors.ink} />
                    </Pressable>
                  </View>
                  <Text style={styles.userRole}>
                    {ROLE_LABELS[detail.role] ?? detail.role}
                    {!detail.editable ? ' · aus config.yaml' : ''}
                  </Text>

                  {detail.enabled === false ? (
                    <Text style={styles.disabledNote}>
                      Deaktiviert – die Anmeldung ist gesperrt, das Token bleibt
                      gültig und funktioniert nach dem Aktivieren sofort wieder.
                    </Text>
                  ) : (
                    <>
                      <View style={styles.qrBox}>
                        {pairing ? (
                          <QRCode value={pairing} size={220} backgroundColor="#FFFFFF" />
                        ) : (
                          <Text style={styles.note}>Kopplungs-Code wird geladen …</Text>
                        )}
                      </View>
                      <Text style={styles.qrHint}>
                        In der HomePilot-App der Person: «QR-Code vom Hub scannen» –
                        Verbindung und Token werden automatisch übernommen.
                      </Text>
                    </>
                  )}

                  {detail.editable && detail.role === 'gast' ? (
                    <>
                      <Text style={styles.formLabel}>Darf sehen und bedienen</Text>
                      <FeatureChips
                        selected={detail.features ?? []}
                        onToggle={(feature) => {
                          const current = detail.features ?? [];
                          const next = current.includes(feature)
                            ? current.filter((entry) => entry !== feature)
                            : [...current, feature];
                          patchUser(detail.name, { features: next });
                        }}
                        styles={styles}
                      />
                    </>
                  ) : null}

                  {detail.editable && currentUser?.name !== detail.name ? (
                    <View style={styles.modalButtons}>
                      <Pressable
                        onPress={() =>
                          patchUser(detail.name, { enabled: detail.enabled === false })
                        }
                        style={[styles.smallButton, { flex: 1 }]}
                      >
                        <Text style={styles.smallButtonText}>
                          {detail.enabled === false ? 'Aktivieren' : 'Deaktivieren'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          confirmDelete === detail.name
                            ? remove(detail.name)
                            : setConfirmDelete(detail.name)
                        }
                        style={[styles.smallButton, styles.dangerButton, { flex: 1 }]}
                      >
                        <Text style={styles.dangerButtonText}>
                          {confirmDelete === detail.name ? 'Wirklich löschen' : 'Löschen'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
      </Modal>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: space.gap },
    title: { color: colors.onGradient, fontSize: 18, fontWeight: '700' },
    intro: { color: colors.onGradientSoft, fontSize: 13, lineHeight: 19, maxWidth: 520 },
    note: { color: colors.inkSoft, fontSize: 14 },
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
    avatarDisabled: { backgroundColor: colors.inkFaint },
    avatarText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
    userName: { color: colors.ink, fontSize: 16, fontWeight: '600' },
    userRole: { color: colors.inkSoft, fontSize: 13, marginTop: 1 },
    disabledBadge: {
      backgroundColor: colors.track,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    disabledBadgeText: { color: colors.inkFaint, fontSize: 11, fontWeight: '700' },
    disabledNote: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },

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
      alignItems: 'center',
    },
    smallButtonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    primaryButton: { backgroundColor: colors.accent, borderColor: colors.accent },
    primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    dangerButton: { backgroundColor: colors.danger, borderColor: colors.danger },
    dangerButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

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

    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: colors.panel,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      maxHeight: '88%',
    },
    modalContent: { padding: 22, gap: 12 },
    modalHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    modalTitle: { color: colors.ink, fontSize: 22, fontWeight: '700' },
    qrBox: {
      alignSelf: 'center',
      backgroundColor: '#FFFFFF',
      padding: 16,
      borderRadius: radius.control,
      marginTop: 6,
    },
    qrHint: {
      color: colors.inkSoft,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
    },
    modalButtons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  });
