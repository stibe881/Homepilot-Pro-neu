import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { ConfigVersion, Entity, HubSettings, LogEntry, SystemStatus, User } from '../api/types';
import { PushState, pushHint } from '../hooks/usePushRegistration';
import { AccessLog } from '../components/AccessLog';
import { Card } from '../components/Card';
import { DeviceHealth } from '../components/DeviceHealth';
import { localTime, timeAgo } from '../lib/zeit';
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
  push = { state: 'idle' },
}: {
  settings: HubSettings;
  user: User | null;
  /** Alle Geräte – für die Liste hinter «nicht erreichbar». */
  entities?: Entity[];
  /** Stand der Push-Anmeldung dieses Geräts. */
  push?: PushState;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [status, setStatus] = useState<SystemStatus | null>(null);
  const [users, setUsers] = useState<User[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  // «7 nicht erreichbar» beantwortet nicht die Frage, die man dann hat:
  // welche sieben?
  const [showOffline, setShowOffline] = useState(false);

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
            onPress={
              status.unavailable > 0 ? () => setShowOffline((on) => !on) : undefined
            }
            expanded={showOffline}
          />
          <Fact label="Laufzeit" value={uptime(status.uptime_seconds)} />
          <Fact label="Datenbank" value={status.database ?? 'keine'} />
          <Fact label="Push-Geräte" value={String(status.push_devices)} />
          {status.disk ? (
            <Fact
              label="Speicher belegt"
              value={`${status.disk.percent} %`}
              tone={
                status.disk.percent >= 90
                  ? colors.danger
                  : status.disk.percent >= 85
                    ? colors.warn
                    : colors.on
              }
            />
          ) : null}
        </View>

        {status.build ? (
          <View style={styles.buildRow}>
            <View style={styles.buildText}>
              <Text style={styles.rowDetail}>
                HomePilot {status.build.version} · Stand {status.build.commit}
              </Text>
              {localTime(status.build.built_at) ? (
                <Text style={styles.rowDetail}>
                  gebaut {localTime(status.build.built_at)}
                  {timeAgo(status.build.built_at)
                    ? ` (${timeAgo(status.build.built_at)})`
                    : ''}
                </Text>
              ) : null}
            </View>
            <UpdateButton settings={settings} />
          </View>
        ) : null}
        {status.build ? <WebVersionNote hubCommit={status.build.commit} /> : null}

        {showOffline ? (
          offline(entities).length === 0 ? (
            <Text style={styles.hint}>
              Der Hub zählt {status.unavailable}, die App kennt aber keine –
              vermutlich Geräte, die für dich nicht freigegeben sind.
            </Text>
          ) : (
            <View style={styles.offlineList}>
              {offline(entities).map((entity) => (
                <View key={entity.id} style={styles.row}>
                  <Ionicons name="cloud-offline-outline" size={18} color={colors.warn} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{entity.name}</Text>
                    <Text style={styles.rowDetail}>
                      {[entity.room, entity.integration].filter(Boolean).join(' · ')}
                      {' · '}
                      {lastSeen(entity.last_seen)}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )
        ) : null}
      </Card>

      <DeviceHealth entities={entities} />

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
              {integration.health ? (
                <Text style={styles.rowDetail}>{healthText(integration.health)}</Text>
              ) : null}
            </View>
          </View>
        ))}
      </Card>

      {(status.outages ?? []).length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Ausfälle</Text>
          {(status.outages ?? []).slice(0, 8).map((outage, index) => (
            <View key={index} style={styles.row}>
              <Ionicons
                name={outage.ended ? 'checkmark-circle-outline' : 'alert-circle'}
                size={18}
                color={outage.ended ? colors.on : colors.danger}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{outage.integration}</Text>
                <Text style={styles.rowDetail}>
                  {new Date(outage.since * 1000).toLocaleString('de-CH', {
                    day: 'numeric',
                    month: 'short',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {outage.ended
                    ? ` – wieder da nach ${Math.max(
                        1,
                        Math.round((outage.ended - outage.since) / 60)
                      )} min`
                    : ' – noch ausgefallen'}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}

      {status.disk && status.disk.percent >= 85 ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Speicherplatz wird knapp</Text>
          <Text style={styles.rowDetail}>
            {status.disk.percent} % belegt – noch {status.disk.free_gb} von{' '}
            {status.disk.total_gb} GB frei. Läuft der Datenträger voll, lässt sich
            nichts mehr speichern: keine Konfiguration, keine Lautsprecher, keine
            Sicherung.
          </Text>
          <Text style={styles.hint}>
            Meist sind es Docker-Reste. Auf dem Host aufräumen mit{'\n'}
            docker image prune -a -f{'\n'}
            docker builder prune -f
          </Text>
        </Card>
      ) : null}

      {user?.capabilities?.includes('edit_config') ? (
        <ConfigCard settings={settings} headers={headers} />
      ) : null}

      {user?.capabilities?.includes('edit_config') ? (
        <LogCard settings={settings} headers={headers} />
      ) : null}

      {user?.capabilities?.includes('edit_config') ? (
        <AccessLog settings={settings} headers={headers} />
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

      <PushTestCard settings={settings} headers={headers} push={push} />

      <ShortcutsCard settings={settings} headers={headers} />

      {user?.capabilities?.includes('edit_config') ? (
        <BackupCard settings={settings} headers={headers} />
      ) : null}

      <VoiceHelpCard />
    </View>
  );
}

/** Die config.yaml des Hubs direkt in der App bearbeiten.
 *
 *  Der Hub validiert vor dem Speichern die komplette Datei – eine kaputte
 *  Konfiguration kann hier also nicht auf der Platte landen. Nach dem
 *  Neustart verbindet sich die App von selbst wieder. */
/**
 * Die letzten Warnungen und Fehler des Hubs.
 *
 * Beantwortet die Frage «warum ist nichts passiert», ohne dass jemand per
 * SSH ins Container-Log steigen muss. Bewusst erst auf Antippen geladen –
 * niemand braucht das Log bei jedem Öffnen des System-Screens.
 */
function LogCard({
  settings,
  headers,
}: {
  settings: HubSettings;
  headers: Record<string, string>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setNote(null);
    try {
      const response = await fetch(`${settings.url}/api/system/log?limit=100`, { headers });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      const body = await response.json();
      setEntries(Array.isArray(body.entries) ? body.entries : []);
    } catch (err: any) {
      setNote(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => {
          const next = !open;
          setOpen(next);
          if (next && entries === null) load();
        }}
        accessibilityRole="button"
        style={styles.logHead}
      >
        <Text style={styles.heading}>Protokoll</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.inkSoft}
        />
      </Pressable>
      {!open ? (
        <Text style={styles.hint}>
          Die letzten Warnungen und Fehler des Hubs – antippen zum Öffnen.
        </Text>
      ) : (
        <>
          {note ? <Text style={styles.errorLine}>{note}</Text> : null}
          {entries === null ? (
            <Text style={styles.hint}>{busy ? 'Wird geladen …' : ''}</Text>
          ) : entries.length === 0 ? (
            <Text style={styles.hint}>
              Nichts zu melden – seit dem letzten Start gab es keine Warnung.
            </Text>
          ) : (
            <View style={styles.logList}>
              {entries.map((entry, index) => (
                <View key={index} style={styles.logRow}>
                  <Ionicons
                    name={entry.level === 'ERROR' || entry.level === 'CRITICAL'
                      ? 'alert-circle'
                      : 'warning-outline'}
                    size={16}
                    color={
                      entry.level === 'ERROR' || entry.level === 'CRITICAL'
                        ? colors.danger
                        : colors.warn
                    }
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.logMessage}>{entry.message}</Text>
                    <Text style={styles.rowDetail}>
                      {new Date(entry.at * 1000).toLocaleString('de-CH', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}{' '}
                      · {entry.logger}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}
          <Button label={busy ? 'Lädt …' : 'Aktualisieren'} onPress={load} />
        </>
      )}
    </Card>
  );
}

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
  // Hinweise des Hubs: doppelte Geräteadressen, Räume, die auf nichts
  // zeigen. Die liefen bisher nur beim Start ins Log.
  const [warnings, setWarnings] = useState<string[]>([]);
  // Frühere Fassungen – erst auf Wunsch geladen.
  const [versions, setVersions] = useState<ConfigVersion[] | null>(null);
  const [restoring, setRestoring] = useState<string | null>(null);

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
      const body = await response.json().catch(() => null);
      setWarnings(body?.warnings ?? []);
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

  /** Prüfen, ohne zu speichern – damit man den Fehler sieht, bevor er auf
   *  der Platte steht. */
  const check = async () => {
    if (content == null) return;
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${settings.url}/api/config/check`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ content }),
      });
      const body = await response.json();
      setWarnings(body.warnings ?? []);
      setMessage(
        body.ok
          ? body.warnings?.length
            ? 'Gültig – aber sieh dir die Hinweise unten an.'
            : 'Gültig, nichts auffällig.'
          : body.error
      );
    } catch (err: any) {
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
            <Button label={busy ? 'Prüft …' : 'Nur prüfen'} onPress={check} />
            <Button label={busy ? 'Speichert …' : 'Speichern'} onPress={() => save(false)} />
            <Button
              label="Speichern & neu starten"
              onPress={() => save(true)}
              primary
            />
          </View>
          <View style={styles.buttons}>
            <Button label="Backup teilen" onPress={backup} />
            <Button
              label={versions === null ? 'Frühere Fassungen' : 'Fassungen ausblenden'}
              onPress={async () => {
                if (versions !== null) {
                  setVersions(null);
                  return;
                }
                try {
                  const response = await fetch(`${settings.url}/api/config/history`, {
                    headers,
                  });
                  const body = await response.json();
                  setVersions(Array.isArray(body.versions) ? body.versions : []);
                } catch {
                  setVersions([]);
                }
              }}
            />
          </View>
          {versions !== null ? (
            <View style={styles.warnBox}>
              {versions.length === 0 ? (
                <Text style={styles.rowDetail}>
                  Noch keine früheren Fassungen – ab dem nächsten Speichern
                  wird jede vorherige Fassung hier aufbewahrt.
                </Text>
              ) : (
                versions.map((version) => (
                  <View key={version.name} style={styles.versionRow}>
                    <Ionicons name="document-text-outline" size={16} color={colors.inkSoft} />
                    <Text style={[styles.rowDetail, { flex: 1 }]}>
                      {new Date(version.created * 1000).toLocaleString('de-CH', {
                        day: 'numeric',
                        month: 'short',
                        hour: '2-digit',
                        minute: '2-digit',
                      })}
                    </Text>
                    <Button
                      label={restoring === version.name ? 'Wirklich?' : 'Ansehen'}
                      onPress={async () => {
                        try {
                          const response = await fetch(
                            `${settings.url}/api/config/history/${version.name}`,
                            { headers }
                          );
                          const body = await response.json();
                          if (typeof body.content === 'string') {
                            setContent(body.content);
                            setMessage(
                              'Fassung geladen – sie steht jetzt im Feld oben. ' +
                                'Mit «Speichern» wird sie übernommen.'
                            );
                          }
                        } catch {
                          setMessage('Fassung nicht lesbar.');
                        }
                      }}
                    />
                  </View>
                ))
              )}
              <Text style={styles.rowDetail}>
                Vor jedem Speichern legt der Hub die bisherige Fassung hier ab –
                die letzten zwanzig bleiben erhalten.
              </Text>
            </View>
          ) : null}
          <Text style={styles.rowDetail}>
            „Backup teilen" sichert die aktuelle config.yaml über das Teilen-Menü
            (Dateien, E-Mail …). Zum Wiederherstellen den gesicherten Text hier
            einfügen und speichern.
          </Text>
        </>
      )}
      {message ? <Text style={styles.configMessage}>{message}</Text> : null}
      {warnings.length > 0 ? (
        <View style={styles.warnBox}>
          {warnings.map((warning, index) => (
            <View key={index} style={styles.row}>
              <Ionicons name="warning-outline" size={16} color={colors.warn} />
              <Text style={styles.warnText}>{warning}</Text>
            </View>
          ))}
          <Text style={styles.rowDetail}>
            Kein Fehler – der Hub startet damit. Aber beides sind Dinge, die
            man sonst erst Wochen später bemerkt, weil nichts abstürzt.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/**
 * Fertige Bausteine für Apple Kurzbefehle.
 *
 * Die Anleitung erklärt, wie man einen von Hand zusammensetzt – und genau
 * das ist die Hürde: URL, Methode, zwei Header und ein JSON-Rumpf, für jede
 * Szene aufs Neue. Hier steht alles fertig zum Kopieren.
 *
 * Das eigene Token liegt bei. Deshalb steht die Karte hinter dem üblichen
 * Login und nicht auf der Startseite – und deshalb liefert der Hub nur, was
 * der Anfragende ohnehin sehen darf.
 */
function ShortcutsCard({
  settings,
  headers,
}: {
  settings: HubSettings;
  headers: Record<string, string>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [items, setItems] = useState<any[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open || items) return;
    fetch(`${settings.url}/api/shortcuts`, { headers })
      .then((response) => (response.ok ? response.json() : { shortcuts: [] }))
      .then((data) => setItems(data.shortcuts ?? []))
      .catch(() => setItems([]));
  }, [open, items, settings.url]);

  const shown = (items ?? []).filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const share = async (item: any) => {
    const lines = [
      `URL: ${item.url}`,
      `Methode: ${item.method}`,
      ...Object.entries(item.headers).map(([key, value]) => `${key}: ${value}`),
      ...(item.body ? [`Anfragetext (JSON): ${JSON.stringify(item.body)}`] : []),
    ];
    try {
      await Share.share({ title: item.name, message: lines.join('\n') });
      setCopied(item.name);
    } catch {
      // Abgebrochen – nichts zu tun.
    }
  };

  return (
    <Card style={styles.card}>
      <Pressable onPress={() => setOpen((on) => !on)} accessibilityRole="button">
        <View style={styles.row}>
          <Ionicons name="mic-outline" size={20} color={colors.inkSoft} />
          <Text style={[styles.heading, { flex: 1 }]}>Siri-Kurzbefehle</Text>
          <Ionicons
            name={open ? 'chevron-up' : 'chevron-down'}
            size={16}
            color={colors.inkFaint}
          />
        </View>
      </Pressable>
      {open ? (
        <>
          <Text style={styles.hint}>
            Antippen teilt die fertigen Angaben. In der App «Kurzbefehle» eine
            Aktion «Inhalte von URL abrufen» anlegen und einsetzen – der Name
            des Kurzbefehls wird der Satz, den du Siri sagst.
          </Text>
          <Text style={styles.hint}>
            Derselbe Kurzbefehl lässt sich auf einen NFC-Aufkleber legen:
            einer am Eingang für «Alles aus», einer am Nachttisch für
            «Schlafen». Schritt für Schritt in docs/nfc-und-widget.md.
          </Text>
          <TextInput
            style={styles.configInput}
            value={query}
            onChangeText={setQuery}
            placeholder="Suchen …"
            placeholderTextColor={colors.inkFaint}
            multiline={false}
          />
          {items == null ? (
            <Text style={styles.hint}>Wird geladen …</Text>
          ) : (
            shown.slice(0, 40).map((item) => (
              <Pressable
                key={`${item.kind}:${item.name}`}
                onPress={() => share(item)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <Ionicons
                  name={item.kind === 'scene' ? 'sparkles-outline' : 'hardware-chip-outline'}
                  size={18}
                  color={colors.accent}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{item.name}</Text>
                  <Text style={styles.rowDetail} numberOfLines={1}>
                    {item.method} {item.url}
                  </Text>
                </View>
                <Ionicons name="share-outline" size={16} color={colors.inkFaint} />
              </Pressable>
            ))
          )}
          {copied ? (
            <Text style={styles.rowDetail}>«{copied}» geteilt.</Text>
          ) : null}
          <Text style={styles.hint}>
            Achtung: Die Angaben enthalten dein Token. Wer sie hat, kann alles
            schalten, was du darfst – also nicht in eine Gruppenchat schicken.
            Für Siri lohnt sich ein eigener Benutzer mit eigenem Token, den man
            einzeln zurückziehen kann (siehe docs/siri-und-widgets.md).
          </Text>
        </>
      ) : null}
    </Card>
  );
}

interface UpdateStatus {
  available: boolean;
  state?: 'idle' | 'running' | 'ok' | 'error';
  stage?: string | null;
  message?: string | null;
  /** Ursache und Abhilfe, mehrzeilig – nur im Fehlerfall gesetzt. */
  detail?: string | null;
  /** Schiefgegangenes, das den Bau nicht stoppte – etwa ein
   *  fehlgeschlagener Web-Bau, bei dem die alte Fassung online bleibt. */
  warnings?: string[];
}

const STAGE_LABEL: Record<string, string> = {
  clone: 'Code holen',
  web: 'Web-Fassung bauen',
  build: 'Abbild bauen',
  built: 'Abbild fertig',
  ios: 'iOS-Build an EAS übergeben',
  deploy: 'Ausrollen anstossen',
  deploy_wait: 'Auf Wechsel warten',
  manual: 'Bereit – von Hand ausrollen',
  done: 'Fertig',
};

// Feste Stufen statt echter Prozente: Der Bau selbst (docker build, ebenso
// der Web-Export) meldet keinen Fortschritt in Zahlen, nur diese Phasen.
// Der Balken springt also zwischen ihnen statt gleichmässig zu laufen –
// ehrlicher als ein Balken, der eine Genauigkeit vortäuscht, die es nicht
// gibt. "web" kommt bei den meisten Aufbauten nie vor (kein Web-Ordner
// eingerichtet) – dann geht es direkt von "clone" zu "build".
const STAGE_PERCENT: Record<string, number> = {
  clone: 5,
  web: 20,
  build: 50,
  built: 70,
  ios: 75,
  deploy: 80,
  deploy_wait: 90,
  manual: 95,
  done: 100,
};

const POLL_MS = 2000;
// Nach 20 Minuten ohne Ergebnis eher aufhören als endlos weiterzufragen –
// der Host-Wächter in rebuild-hub.sh gibt ohnehin nach einer Stunde auf.
const MAX_POLLS = 600;

/**
 * Update anstossen.
 *
 * Der Hub kann sich nicht selbst neu bauen – er läuft in einem Container
 * und hat weder das Repository noch Docker zur Hand. Was er kann: eine
 * Adresse aufrufen, die das auf dem Host anstösst. Steht keine in der
 * config.yaml, sagt der Knopf genau das, statt so zu tun als ob.
 *
 * Läuft dort der beiliegende update-listener.py, liefert er einen echten
 * Fortschritt (welche Phase gerade dran ist) – den fragt diese Karte alle
 * zwei Sekunden ab und zeigt ihn als Balken. Bei einem reinen Portainer-
 * Webhook gibt es das nicht; dann bleibt es wie bisher bei "läuft".
 */
/** Passt das Bundle im Browser zum laufenden Hub? (nur Web)
 *
 * Das Bau-Skript legt neben die Web-Fassung eine version.json mit dem
 * Commit. Weicht er vom Hub ab, zeigt der Browser einen alten Stand -
 * meist hängt er im Cache, manchmal ist der Web-Bau beim Update
 * fehlgeschlagen. Genau diese Frage («warum sehe ich die neue Funktion
 * nicht?») war bisher nur per SSH zu beantworten. */
function WebVersionNote({ hubCommit }: { hubCommit: string }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [webCommit, setWebCommit] = useState<string | null>(null);

  useEffect(() => {
    if (Platform.OS !== 'web') return;
    fetch('/version.json', { cache: 'no-store' })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setWebCommit(data?.commit ?? null))
      .catch(() => {});
  }, []);

  if (Platform.OS !== 'web' || !webCommit || webCommit === hubCommit) {
    return null;
  }
  return (
    <Text style={[styles.hint, { color: colors.warn }]}>
      Die geladene Web-Fassung ist Stand {webCommit}, der Hub läuft mit{' '}
      {hubCommit}. Die Seite einmal komplett neu laden – zeigt sie danach
      immer noch den alten Stand, ist beim Update der Web-Bau
      fehlgeschlagen (die Meldung dazu erscheint nach dem nächsten Update
      hier beim Update-Knopf).
    </Text>
  );
}

function UpdateButton({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [note, setNote] = useState<string | null>(null);
  const [noteError, setNoteError] = useState(false);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UpdateStatus | null>(null);

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};

  // Beim Öffnen einmal nachsehen, ob auf dem Host gerade gebaut wird –
  // etwa weil man während eines Laufs kurz woanders war (der Fortschritt
  // lebt nur in diesem Bildschirm) oder jemand anderes das Update
  // angestossen hat. Läuft etwas, hängt sich der Balken wieder dran.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${settings.url}/api/system/update/status`, { headers });
        if (cancelled || !response.ok) return;
        const data = (await response.json()) as UpdateStatus;
        if (cancelled) return;
        if (data.available && data.state === 'running') {
          setProgress(data);
          setBusy(true); // startet die laufende Abfrage unten
        }
      } catch {
        // Kein Status erreichbar – dann eben kein Balken beim Einstieg.
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Solange ein Bau laufen könnte, alle zwei Sekunden nach dem Stand
  // fragen – hört von selbst auf, sobald er fertig ist, fehlschlägt, oder
  // der Dienst gar keinen Fortschritt kennt (available: false).
  useEffect(() => {
    if (!busy) return undefined;
    let cancelled = false;
    let polls = 0;
    const poll = async () => {
      polls += 1;
      try {
        const response = await fetch(`${settings.url}/api/system/update/status`, { headers });
        if (cancelled) return;
        if (!response.ok) {
          if (response.status === 404) setBusy(false); // älterer Hub ohne dieses Endpunkt
          return;
        }
        const data = (await response.json()) as UpdateStatus;
        if (cancelled) return;
        setProgress(data);
        if (!data.available || data.state === 'ok' || data.state === 'error') {
          setBusy(false);
          if (data.state === 'error') {
            setNoteError(true);
            // Die Ursache steht in den Zeilen nach der Fehlermeldung.
            // Sie hier wegzulassen hiesse: «ging schief», Punkt – und
            // die Suche beginnt per SSH auf dem Host von vorne.
            setNote(
              [data.message || 'Bau fehlgeschlagen.', data.detail]
                .filter(Boolean)
                .join('\n')
            );
          } else if (data.state === 'ok') {
            const warned = (data.warnings ?? []).filter(Boolean);
            if (warned.length > 0) {
              // «Fertig» wäre hier die halbe Wahrheit: Der Hub ist neu,
              // aber etwas blieb auf dem alten Stand - das gehört vor
              // die Augen, nicht ins Journal auf dem Host.
              setNoteError(true);
              setNote(
                ['Fertig, aber mit Vorbehalt:', ...warned].join('\n')
              );
            } else {
              setNoteError(false);
              setNote('Fertig – der Hub läuft mit dem frischen Stand.');
            }
          }
        }
      } catch {
        // Ein verpasster Poll ist kein Grund aufzugeben – der nächste in
        // zwei Sekunden reicht.
      }
      if (!cancelled && polls >= MAX_POLLS) {
        setBusy(false);
        setNoteError(true);
        setNote('Keine Rückmeldung mehr vom Update-Dienst – im Log auf dem Host nachsehen.');
      }
    };
    poll();
    const timer = setInterval(poll, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy, settings.url, settings.token]);

  // Erst fragen, dann bauen: Ein iOS-Build kostet Bauminuten im
  // EAS-Kontingent und erzeugt eine neue TestFlight-Fassung - das soll
  // eine bewusste Wahl sein, kein Nebeneffekt jedes Updates.
  const [asking, setAsking] = useState(false);

  const run = async (ios: boolean) => {
    setAsking(false);
    setBusy(true);
    setNote(null);
    setNoteError(false);
    setProgress(null);
    try {
      const response = await fetch(`${settings.url}/api/system/update`, {
        method: 'POST',
        headers: {
          ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ ios }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) throw new Error(body?.detail ?? `Hub antwortet mit ${response.status}`);
      setNote(
        ios
          ? 'Angestossen. Der Host baut den Hub, danach geht der iOS-Build an EAS – TestFlight meldet sich.'
          : 'Angestossen. Der Host baut jetzt – das dauert ein paar Minuten.'
      );
    } catch (err: any) {
      setBusy(false);
      setNoteError(true);
      setNote(String(err.message ?? err));
    }
  };

  const showBar = busy && progress?.available !== false;
  const percent = progress?.stage ? (STAGE_PERCENT[progress.stage] ?? 5) : 5;

  return (
    <>
      <Pressable
        onPress={() => setAsking(true)}
        disabled={busy}
        accessibilityRole="button"
        style={({ pressed }) => [styles.updateButton, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="cloud-download-outline" size={16} color={colors.ink} />
        <Text style={styles.updateText}>{busy ? 'Läuft …' : 'Update'}</Text>
      </Pressable>

      {asking ? (
        <View style={styles.updateAsk}>
          <Text style={styles.updateAskTitle}>Update wirklich starten?</Text>
          <Text style={styles.updateAskText}>
            Der Host holt den neusten Stand, baut den Hub neu und startet ihn
            – das dauert ein paar Minuten, die App ist dabei kurz getrennt.
            «Hub + iOS-Build» reicht die App zusätzlich über EAS bei App
            Store Connect ein; das braucht es nur, wenn sich an der App
            selbst etwas geändert hat.
          </Text>
          <View style={styles.updateAskRow}>
            <Pressable
              onPress={() => setAsking(false)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.updateAskButton, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.updateAskButtonText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={() => run(false)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.updateAskButton, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.updateAskButtonText}>Nur Hub</Text>
            </Pressable>
            <Pressable
              onPress={() => run(true)}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.updateAskButton,
                styles.updateAskPrimary,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.updateAskButtonText, { color: '#FFFFFF' }]}>
                Hub + iOS-Build
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}
      {showBar ? (
        <View
          style={styles.progressTrack}
          accessibilityRole="progressbar"
          accessibilityValue={{ min: 0, max: 100, now: percent }}
        >
          <View style={[styles.progressFill, { width: `${percent}%` }]} />
        </View>
      ) : null}
      {showBar && progress?.stage ? (
        <Text style={styles.rowDetail}>
          {STAGE_LABEL[progress.stage] ?? progress.stage}
          {progress.message ? ` · ${progress.message}` : ''}
        </Text>
      ) : null}
      {note ? (
        <Text
          style={[styles.noteText, noteError && { color: colors.danger }]}
          selectable
        >
          {note}
        </Text>
      ) : null}
    </>
  );
}

function Fact({
  label,
  value,
  tone,
  onPress,
  expanded = false,
}: {
  label: string;
  value: string;
  tone?: string;
  /** Antippbar, wenn es dahinter etwas zu sehen gibt. */
  onPress?: () => void;
  expanded?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const body = (
    <>
      <Text style={[styles.factValue, tone ? { color: tone } : null]}>{value}</Text>
      <View style={styles.factLabelRow}>
        <Text style={styles.factLabel}>{label}</Text>
        {onPress ? (
          <Ionicons
            name={expanded ? 'chevron-up' : 'chevron-down'}
            size={13}
            color={colors.inkFaint}
          />
        ) : null}
      </View>
    </>
  );
  if (!onPress) return <View style={styles.fact}>{body}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ expanded }}
      accessibilityLabel={`${value} ${label} anzeigen`}
      style={({ pressed }) => [styles.fact, pressed && { opacity: 0.7 }]}
    >
      {body}
    </Pressable>
  );
}

/** Die nicht erreichbaren Geräte, Raum für Raum lesbar sortiert (rein,
 *  testbar). */
export function offline(entities: Entity[]): Entity[] {
  return entities
    .filter((entity) => !entity.available)
    .sort(
      (a, b) =>
        (a.room ?? '').localeCompare(b.room ?? '') || a.name.localeCompare(b.name)
    );
}

/** Was eine Integration über ihren eigenen Zustand meldet (rein, testbar).
 *
 * Heute nur Homematic: Ob die CCU den Hub noch als Event-Empfänger kennt
 * und wann zuletzt etwas ankam. Bleibt das lange leer, obwohl Geräte aktiv
 * sind, ist die Anmeldung weg – und dann kommt gar nichts mehr an, ohne
 * dass irgendwo ein Fehler stünde. */
export function healthText(health: Record<string, any>): string {
  const parts: string[] = [];
  const registered = health.registered as string[] | undefined;
  parts.push(
    registered && registered.length > 0
      ? `angemeldet (${registered.join(', ')})`
      : 'Anmeldung noch nicht bestätigt'
  );
  if (typeof health.last_event === 'number') {
    parts.push(`letztes Ereignis ${lastSeen(health.last_event)}`);
  } else {
    parts.push('noch kein Ereignis');
  }
  return parts.join(' · ');
}

/** «Zuletzt gesehen» in Alltagssprache (rein, testbar). */
export function lastSeen(epochSeconds?: number | null): string {
  if (!epochSeconds) return 'nie gesehen';
  const seconds = Math.max(0, Date.now() / 1000 - epochSeconds);
  if (seconds < 90) return 'gerade eben';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `seit ${minutes} Min.`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `seit ${hours} Std.`;
  return `seit ${Math.round(hours / 24)} Tagen`;
}

/** Push testen: schickt dem angemeldeten Gerät eine Probe-Benachrichtigung. */
function PushTestCard({
  settings,
  headers,
  push,
}: {
  settings: HubSettings;
  headers: Record<string, string>;
  push: PushState;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Die angemeldeten Telefone. Ohne diese Liste zeigte die Fehlermeldung
  // «alte Einträge entfernen» auf eine Tür, die es nicht gab - man sah
  // nur eine Zahl und konnte nichts tun.
  const [devices, setDevices] = useState<
    { token: string; user: string; label: string }[] | null
  >(null);

  const loadDevices = useCallback(() => {
    fetch(`${settings.url}/api/push/devices`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setDevices(data?.devices ?? null))
      .catch(() => setDevices(null));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.url, settings.token]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const removeDevice = async (token: string) => {
    try {
      await fetch(`${settings.url}/api/push/unregister`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ token }),
      });
    } catch {
      // Der nächste loadDevices zeigt den echten Stand.
    }
    loadDevices();
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const response = await fetch(`${settings.url}/api/push/test`, {
        method: 'POST',
        headers,
      });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      const data = await response.json();
      // Der Hub wartet auf die Zustell-Quittung. Meldet der Push-Dienst
      // etwas, ist das der eigentliche Grund – wichtiger als jede Zählung.
      const problems: string[] = Array.isArray(data.errors) ? data.errors : [];
      if (problems.length > 0) {
        setMessage(problems.join(' '));
      } else if (Number(data.sent ?? 0) > 0) {
        setMessage(
          `Zugestellt an ${data.sent} Gerät(e). Kommt trotzdem nichts an, ` +
            'liegt es an den Benachrichtigungs-Einstellungen des Geräts ' +
            '(Fokus/Nicht stören, Mitteilungen für die App).'
        );
      } else {
        setMessage(pushHint(push));
      }
    } catch (err: any) {
      setMessage(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Benachrichtigungen</Text>
      <Text style={styles.rowDetail}>
        Prüft, ob Push-Nachrichten auf deinem Gerät ankommen.
      </Text>
      <View style={styles.buttons}>
        <Button label={busy ? 'Sendet …' : 'Push testen'} onPress={test} primary />
      </View>
      <Text style={styles.hint}>{message ?? pushHint(push)}</Text>

      {devices && devices.length > 0 ? (
        <View style={styles.pushList}>
          {devices.map((device) => (
            <View key={device.token} style={styles.pushRow}>
              <Ionicons name="phone-portrait-outline" size={16} color={colors.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>
                  {device.label || 'Unbenanntes Gerät'} · {device.user}
                </Text>
                <Text style={styles.rowDetail} numberOfLines={1}>
                  {device.token.slice(0, 28)}…
                </Text>
              </View>
              <Pressable
                onPress={() => removeDevice(device.token)}
                accessibilityRole="button"
                accessibilityLabel={`${device.label || device.user} abmelden`}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={17} color={colors.inkSoft} />
              </Pressable>
            </View>
          ))}
          <Text style={styles.hint}>
            Ein entferntes Gerät meldet sich beim nächsten Öffnen der App von
            selbst wieder an. Entfernen lohnt sich für Altlasten – etwa Tokens
            aus der Expo-Go-Zeit, die Apple mit «gehört zu einer anderen
            App-Kennung» ablehnt.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/** Sicherungen der App-Daten: täglich automatisch, hier auch von Hand. */
function BackupCard({
  settings,
  headers,
}: {
  settings: HubSettings;
  headers: Record<string, string>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [backups, setBackups] = useState<any[] | null>(null);
  const [busy, setBusy] = useState(false);

  const load = useCallback(() => {
    fetch(`${settings.url}/api/system/backups`, { headers })
      .then((response) => (response.ok ? response.json() : { backups: [] }))
      .then((data) => setBackups(data.backups ?? []))
      .catch(() => setBackups([]));
  }, [settings.url, settings.token]);

  useEffect(load, [load]);

  const runBackup = async () => {
    setBusy(true);
    try {
      const response = await fetch(`${settings.url}/api/system/backup`, {
        method: 'POST',
        headers,
      });
      if (response.ok) {
        const data = await response.json();
        setBackups(data.backups ?? []);
      }
    } finally {
      setBusy(false);
    }
  };

  const latest = backups && backups[0];
  const when = latest
    ? new Date(latest.created * 1000).toLocaleString('de-CH', {
        day: '2-digit',
        month: '2-digit',
        hour: '2-digit',
        minute: '2-digit',
      })
    : null;

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Sicherung</Text>
      <Text style={styles.rowDetail}>
        {backups == null
          ? 'wird geladen …'
          : backups.length === 0
            ? 'Noch keine Sicherung.'
            : `${backups.length} Sicherung(en) · zuletzt ${when}`}
      </Text>
      <View style={styles.buttons}>
        <Button label={busy ? 'Sichert …' : 'Jetzt sichern'} onPress={runBackup} primary />
      </View>
      <Text style={styles.hint}>
        Benutzer, Abläufe, Szenen und Familien-Daten werden täglich automatisch
        gesichert (die letzten 14). Die Kopien liegen im Ordner „backups“ neben
        der homepilot-data.json auf dem Hub.
      </Text>
    </Card>
  );
}

/** Kurze Doku der Sprachbefehle – die Steuerung läuft über Google Home. */
function VoiceHelpCard() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const examples = [
    'Hey Google, schalt das Wohnzimmerlicht ein.',
    'Hey Google, mach die Storen im Büro zu.',
    'Hey Google, stell die Storen auf fünfzig Prozent.',
    'Hey Google, starte die Szene Kino.',
    'Hey Google, spiel meine Playlist im Wohnzimmer.',
    'Hey Google, ist die Waschmaschine fertig?',
  ];
  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Sprachbefehle</Text>
      <Text style={styles.rowDetail}>
        Geräte, Szenen und Musik lassen sich über die verknüpften Google-Home-
        Lautsprecher per Sprache steuern. Beispiele:
      </Text>
      {examples.map((line) => (
        <View key={line} style={styles.voiceRow}>
          <Ionicons name="mic-outline" size={15} color={colors.inkSoft} />
          <Text style={styles.voiceText}>{line}</Text>
        </View>
      ))}
      <Text style={styles.hint}>
        Namen frei wählbar: Benenne ein Gerät im Anpassen-Modus um, dann hört
        Google auf denselben Namen. Szenen heissen wie im Abläufe-Editor.
      </Text>
    </Card>
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
  factLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  offlineList: { gap: 8, marginTop: 4 },
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
  voiceRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  voiceText: { color: colors.ink, fontSize: 14, flex: 1 },
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
  logHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  logList: { gap: 12 },
  logRow: { flexDirection: 'row', gap: 10 },
  logMessage: { color: colors.ink, fontSize: 13, lineHeight: 18 },
  errorLine: { color: colors.danger, fontSize: 13, fontWeight: '600' },
  versionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
  buildRow: { gap: 8, marginTop: 4 },
  // Zwei Zeilen statt einer langen: Der Zeitstempel bricht sonst mitten
  // im Datum um und liest sich wie ein Fehler.
  buildText: { gap: 2 },
  pushList: { gap: 10, marginTop: 4 },
  pushRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  updateAsk: {
    gap: 8,
    padding: 12,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  updateAskTitle: { color: colors.ink, fontSize: 14, fontWeight: '700' },
  updateAskText: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
  updateAskRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  updateAskButton: {
    paddingVertical: 9,
    paddingHorizontal: 14,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  updateAskPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
  updateAskButtonText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  // Mehrzeilig und markierbar: Im Fehlerfall steht hier die Ursache samt
  // Abhilfe – oft ein Befehl, den man kopieren will.
  noteText: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
  updateButton: {
    flexDirection: 'row',
    alignItems: 'center',
    alignSelf: 'flex-start',
    gap: 8,
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  updateText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  progressTrack: {
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.surfaceSoft,
    overflow: 'hidden',
  },
  progressFill: {
    height: '100%',
    borderRadius: 3,
    backgroundColor: colors.accent,
  },
  warnBox: {
    gap: 6,
    padding: 12,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  warnText: { color: colors.ink, fontSize: 13, lineHeight: 19, flex: 1 },
  note: {
    color: colors.onGradientSoft,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 20,
    maxWidth: 460,
  },
});
