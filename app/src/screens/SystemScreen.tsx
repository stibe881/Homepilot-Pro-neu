import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { Entity, HubSettings, SystemStatus, User } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, space, type, useColors } from '../theme';

/**
 * Systemzustand: Was läuft, was klemmt – und die Bedienung dafür.
 *
 * Bei sechzehn Geräteherstellern will man nicht per SSH im Log suchen,
 * welche Integration gerade nicht antwortet.
 */
export function SystemScreen({
  settings,
  user,
  entities = [],
}: {
  settings: HubSettings;
  user: User | null;
  entities?: Entity[];
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};

  const load = useCallback(() => {
    fetch(`${settings.url}/api/system/status`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then(setStatus)
      .catch((err) => setError(String(err.message ?? err)));

    if (user?.capabilities?.includes('manage_users')) {
      fetch(`${settings.url}/api/users`, { headers })
        .then((response) => (response.ok ? response.json() : null))
        .then(setUsers)
        .catch(() => setUsers(null));
    }
  }, [settings.url, settings.token, user?.role]);

  useEffect(load, [load]);

  const pause = async (seconds: number) => {
    await fetch(`${settings.url}/api/automations/pause`, {
      method: 'POST',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify({ seconds }),
    }).catch(() => {});
    load();
  };

  if (error) {
    return <Text style={styles.note}>Systemzustand nicht abrufbar: {error}</Text>;
  }
  if (!status) {
    return <Text style={styles.note}>Wird geladen …</Text>;
  }

  const paused = status.automations.paused_until;

  return (
    <View style={styles.list}>
      <Card style={styles.card}>
        <Text style={styles.heading}>Überblick</Text>
        <View style={styles.facts}>
          <Fact label="Geräte" value={String(status.entities)} />
          <Fact
            label="nicht erreichbar"
            value={String(status.unavailable)}
            tone={status.unavailable > 0 ? colors.warn : colors.on}
          />
          <Fact label="Laufzeit" value={uptime(status.uptime_seconds)} />
          <Fact label="Datenbank" value={status.database ?? 'keine'} />
          <Fact label="Push-Geräte" value={String(status.push_devices)} />
        </View>
      </Card>

      <Card style={styles.card}>
        <Text style={styles.heading}>Integrationen</Text>
        {status.integrations.map((integration) => (
          <View key={integration.name} style={styles.row}>
            <Ionicons
              name={integration.ok ? 'checkmark-circle' : 'alert-circle'}
              size={20}
              color={integration.ok ? colors.on : colors.danger}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{integration.name}</Text>
              <Text style={styles.rowDetail} numberOfLines={2}>
                {integration.ok
                  ? `${integration.entities} Geräte` +
                    (integration.unavailable
                      ? `, ${integration.unavailable} nicht erreichbar`
                      : '')
                  : integration.error}
              </Text>
            </View>
          </View>
        ))}
      </Card>

      <EnergyCard entities={entities} energy={status.energy} />

      {user?.capabilities?.includes('edit_config') ? (
        <ConfigCard settings={settings} headers={headers} />
      ) : null}

      {user?.capabilities?.includes('pause_automations') ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Automationen</Text>
          <Text style={styles.rowDetail}>
            {status.automations.count} Abläufe ·{' '}
            {paused
              ? `pausiert bis ${new Date(paused).toLocaleTimeString('de-CH', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}`
              : 'aktiv'}
          </Text>
          <View style={styles.buttons}>
            {paused ? (
              <Button label="Wieder aktivieren" onPress={() => pause(0)} primary />
            ) : (
              <>
                <Button label="1 Stunde pausieren" onPress={() => pause(3600)} />
                <Button label="Bis morgen" onPress={() => pause(12 * 3600)} />
              </>
            )}
          </View>
        </Card>
      ) : null}

      {users ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Benutzer</Text>
          {users.map((entry) => (
            <View key={entry.name} style={styles.row}>
              <Ionicons name={roleIcon(entry.role)} size={20} color={colors.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{entry.name}</Text>
                <Text style={styles.rowDetail}>
                  {entry.role}
                  {entry.allow.length ? ` · ${entry.allow.join(', ')}` : ''}
                </Text>
              </View>
            </View>
          ))}
          <Text style={styles.hint}>
            Neue Benutzer legst du in der config.yaml des Hubs an – dann bleiben
            sie auch nach einem Neustart erhalten.
          </Text>
        </Card>
      ) : null}
    </View>
  );
}

/** Die config.yaml des Hubs direkt in der App bearbeiten.
 *
 *  Der Hub validiert vor dem Speichern die komplette Datei – eine kaputte
 *  Konfiguration kann hier also nicht auf der Platte landen. Nach dem
 *  Neustart verbindet sich die App von selbst wieder. */
function ConfigCard({
  settings,
  headers,
}: {
  settings: HubSettings;
  headers: Record<string, string>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [content, setContent] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const load = () => {
    setMessage(null);
    fetch(`${settings.url}/api/config`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then((data) => setContent(data.content))
      .catch((err) => setMessage(String(err.message ?? err)));
  };

  const save = async (restart: boolean) => {
    if (content == null) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${settings.url}/api/config`, {
        method: 'PUT',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null);
        throw new Error(body?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      if (restart) {
        await fetch(`${settings.url}/api/system/restart`, { method: 'POST', headers });
        setMessage('Gespeichert – der Hub startet neu. Die App verbindet sich gleich wieder.');
      } else {
        setMessage('Gespeichert. Wirksam wird die Änderung beim nächsten Neustart.');
      }
    } catch (err: any) {
      // Hier steht bei Tippfehlern die genaue Validierungsmeldung des Hubs.
      setMessage(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    if (content == null) return;
    try {
      await Share.share({
        title: 'HomePilot-Konfiguration',
        message: content,
      });
    } catch (err: any) {
      setMessage(String(err.message ?? err));
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Konfiguration</Text>
      {content == null ? (
        <>
          <Text style={styles.rowDetail}>
            Die config.yaml des Hubs ansehen und ändern – Integrationen,
            Räume, Benutzer. Vor dem Speichern prüft der Hub die ganze Datei.
          </Text>
          <View style={styles.buttons}>
            <Button label="Konfiguration laden" onPress={load} />
          </View>
        </>
      ) : (
        <>
          <TextInput
            multiline
            value={content}
            onChangeText={setContent}
            autoCapitalize="none"
            autoCorrect={false}
            spellCheck={false}
            style={styles.configInput}
          />
          <View style={styles.buttons}>
            <Button label={busy ? 'Speichert …' : 'Speichern'} onPress={() => save(false)} />
            <Button
              label="Speichern & neu starten"
              onPress={() => save(true)}
              primary
            />
          </View>
          <View style={styles.buttons}>
            <Button label="Backup teilen" onPress={backup} />
          </View>
          <Text style={styles.rowDetail}>
            „Backup teilen" sichert die aktuelle config.yaml über das Teilen-Menü
            (Dateien, E-Mail …). Zum Wiederherstellen den gesicherten Text hier
            einfügen und speichern.
          </Text>
        </>
      )}
      {message ? <Text style={styles.configMessage}>{message}</Text> : null}
    </Card>
  );
}

/** Energie-Übersicht: aktuelle Leistung und Tageskosten über alle Geräte,
 *  die Messwerte liefern – grösste Verbraucher zuerst. */
function EnergyCard({
  entities,
  energy,
}: {
  entities: Entity[];
  energy?: { price_per_kwh?: number; currency?: string } | null;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const measured = entities.filter(
    (entity) => entity.state.power != null || entity.state.energy_today != null
  );
  if (measured.length === 0) return null;

  const price = energy?.price_per_kwh ?? 0;
  const currency = energy?.currency ?? 'CHF';
  const totalPower = measured.reduce(
    (sum, entity) => sum + (Number(entity.state.power) || 0), 0
  );
  const totalKwh = measured.reduce(
    (sum, entity) => sum + (Number(entity.state.energy_today) || 0), 0
  );
  const byPower = [...measured].sort(
    (a, b) => (Number(b.state.power) || 0) - (Number(a.state.power) || 0)
  );

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Energie</Text>
      <View style={styles.facts}>
        <Fact label="gerade jetzt" value={`${Math.round(totalPower)} W`} />
        <Fact label="heute" value={`${totalKwh.toFixed(2)} kWh`} />
        {price ? (
          <Fact label="Kosten heute" value={`${(totalKwh * price).toFixed(2)} ${currency}`} />
        ) : null}
      </View>
      {byPower.slice(0, 5).map((entity) => (
        <View key={entity.id} style={styles.row}>
          <Ionicons name="flash-outline" size={18} color={colors.inkSoft} />
          <View style={{ flex: 1 }}>
            <Text style={styles.rowTitle}>{entity.name}</Text>
            <Text style={styles.rowDetail}>
              {entity.state.power != null ? `${entity.state.power} W` : '–'}
              {entity.state.energy_today != null
                ? ` · heute ${Number(entity.state.energy_today).toFixed(2)} kWh` +
                  (price
                    ? ` (${(Number(entity.state.energy_today) * price).toFixed(2)} ${currency})`
                    : '')
                : ''}
            </Text>
          </View>
        </View>
      ))}
    </Card>
  );
}

function Fact({ label, value, tone }: { label: string; value: string; tone?: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.fact}>
      <Text style={[styles.factValue, tone ? { color: tone } : null]}>{value}</Text>
      <Text style={styles.factLabel}>{label}</Text>
    </View>
  );
}

function Button({
  label,
  onPress,
  primary,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.button,
        primary && { backgroundColor: colors.ink },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.buttonText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

function roleIcon(role: string): any {
  if (role === 'besitzer') return 'key-outline';
  if (role === 'gast') return 'person-outline';
  return 'people-outline';
}

function uptime(seconds: number): string {
  if (seconds < 3600) return `${Math.round(seconds / 60)} min`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} h`;
  return `${Math.round(seconds / 86400)} T`;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  list: { gap: space.gap, marginTop: 4 },
  card: { minHeight: 0, gap: 12 },
  heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
  facts: { flexDirection: 'row', flexWrap: 'wrap', gap: 22 },
  fact: { gap: 2 },
  factValue: { color: colors.ink, fontSize: 22, fontWeight: '700' },
  factLabel: { color: colors.inkSoft, fontSize: 12 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  rowDetail: { color: colors.inkSoft, fontSize: 13 },
  hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
  buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
  button: {
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  buttonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  configInput: {
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    color: colors.ink,
    padding: 12,
    minHeight: 320,
    maxHeight: 480,
    fontSize: 13,
    lineHeight: 19,
    fontFamily: 'Menlo',
    textAlignVertical: 'top',
  },
  configMessage: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
  note: {
    color: colors.onGradientSoft,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 20,
    maxWidth: 460,
  },
});
