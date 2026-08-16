import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { applySetup, QrScanner } from '../components/QrScanner';
import { Colors, radius, ThemeMode, type, useColors } from '../theme';

/** „Automatisch" schaltet ab 20 Uhr auf dunkel – die App wird abends im
    Bett geöffnet, nicht nur tagsüber. */
const MODES: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'auto', label: 'Nach Sonnenstand' },
  { key: 'light', label: 'Hell' },
  { key: 'dark', label: 'Dunkel' },
];

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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [url, setUrl] = useState(initial?.url ?? 'http://192.168.1.10:8123');
  const [token, setToken] = useState(initial?.token ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [theme, setTheme] = useState<ThemeMode>(initial?.theme ?? 'system');
  const [panel, setPanel] = useState(!!initial?.panel);
  const [scanning, setScanning] = useState(false);

  const form = (
    <Card style={styles.card}>
      <Text style={styles.title}>Hub verbinden</Text>
      {user ? (
        <Text style={styles.account}>
          Angemeldet als {user.name} · {user.role}
        </Text>
      ) : null}

      <Pressable
        onPress={() => setScanning(true)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.scan, pressed && { opacity: 0.75 }]}
      >
        <Ionicons name="qr-code-outline" size={20} color={colors.ink} />
        <Text style={styles.scanText}>QR-Code vom Hub scannen</Text>
      </Pressable>
      <Text style={styles.scanHint}>oder von Hand eintragen</Text>

      <QrScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={(setup) => {
          // Direkt speichern: Wer scannt, will verbinden, nicht noch tippen.
          const next = applySetup(initial, setup);
          setUrl(next.url);
          setToken(next.token);
          if (next.name) setName(next.name);
          onSave({ ...next, theme, panel });
        }}
      />

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

      <View style={styles.field}>
        <Text style={styles.label}>Erscheinungsbild</Text>
        <View style={styles.modes}>
          {MODES.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => setTheme(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: theme === option.key }}
              style={({ pressed }) => [
                styles.mode,
                theme === option.key && styles.modeActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[
                  styles.modeText,
                  theme === option.key && styles.modeTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.modeHint}>
          «Nach Sonnenstand» wird bei Sonnenuntergang dunkel und bei
          Sonnenaufgang wieder hell, «System» folgt der Geräteeinstellung.
        </Text>
      </View>

      <Pressable
        onPress={() => setPanel((value) => !value)}
        accessibilityRole="switch"
        accessibilityState={{ checked: panel }}
        style={({ pressed }) => [styles.panelRow, pressed && { opacity: 0.7 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Wandpanel-Modus</Text>
          <Text style={styles.panelHint}>
            Bildschirm bleibt an, Ansicht kehrt nach drei Minuten zur Startseite
            zurück – für ein fest montiertes iPad.
          </Text>
        </View>
        <View style={[styles.switch, panel && styles.switchOn]}>
          <View style={[styles.knob, panel && styles.knobOn]} />
        </View>
      </Pressable>

      <Pressable
        style={({ pressed }) => [styles.save, pressed && { opacity: 0.8 }]}
        onPress={() =>
          onSave({
            url: url.trim().replace(/\/+$/, ''),
            token: token.trim(),
            name: name.trim(),
            theme,
            panel,
            // Favoriten und Ausgeblendete bleiben erhalten.
            favorites: initial?.favorites,
            hidden: initial?.hidden,
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
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
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

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
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
  scan: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  scanText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  scanHint: {
    color: colors.inkFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: -8,
  },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  panelHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17, marginTop: 2 },
  switch: {
    width: 48,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.off,
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.on },
  knob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceStrong,
  },
  knobOn: { alignSelf: 'flex-end' },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mode: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  modeActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  modeText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  modeTextActive: { color: colors.surfaceStrong },
  modeHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17, marginTop: 6 },
  cancel: { alignItems: 'center', paddingVertical: 6 },
  cancelText: { color: colors.inkSoft, fontSize: 15 },
});
