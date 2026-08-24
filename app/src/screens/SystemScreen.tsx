import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Platform,
  Pressable,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';

import { HubFehler, hubClient } from '../api/client';
import { Entity, HubSettings, LogEntry, SystemStatus, User } from '../api/types';
import { PushState, pushHint } from '../hooks/usePushRegistration';
import { AccessLog } from '../components/AccessLog';
import { Card } from '../components/Card';
import { Maintenance } from '../components/Maintenance';
import { Fehlschlag, Laedt } from '../components/Zustand';
import { ConfigCard } from './system/konfiguration';
import { datumUhr } from '../lib/format';
import { integrationDetail } from '../lib/integrationszeile';
import { LaufArt, LetzterLauf, letzterLaufSatz } from '../lib/letzterlauf';
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

  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const load = useCallback(() => {
    // Der Bildschirm hat seine eigene Fehleranzeige - deshalb «still»,
    // sonst käme dieselbe Meldung zusätzlich als Einblendung.
    hub
      .get<SystemStatus>('/api/system/status', { still: true })
      .then(setStatus)
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));

    if (user?.capabilities?.includes('manage_users')) {
      hub.get<User[] | null>('/api/users', { fallback: null, still: true }).then(setUsers);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hub, user?.role]);

  useEffect(load, [load]);

  if (error) {
    return <Fehlschlag text={`Systemzustand nicht abrufbar: ${error}`} onRetry={load} />;
  }
  if (!status) {
    return <Laedt was="Systemzustand" />;
  }

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
            onPress={status.unavailable > 0 ? () => setShowOffline((on) => !on) : undefined}
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
        <AppVersionNote />
        <WasIstNeu settings={settings} />

        {showOffline ? (
          offline(entities).length === 0 ? (
            <Text style={styles.hint}>
              Der Hub zählt {status.unavailable}, die App kennt aber keine – vermutlich
              Geräte, die für dich nicht freigegeben sind.
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
                    {/* «nie gesehen» sagt, dass etwas fehlt, aber nicht
                        was zu tun ist. Weiss der Hub den Grund – etwa,
                        wie der Datenpunkt bei diesem Gerät wirklich
                        heisst –, gehört er hierher und nicht nur ins
                        Log. */}
                    {entity.state?.problem ? (
                      <Text style={styles.rowProblem}>{String(entity.state.problem)}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </View>
          )
        ) : null}
      </Card>

      <Maintenance settings={settings} />
      {/* Die Geräte-Gesundheit steht jetzt unter «Geräte» – dort sucht
          man nach einem Gerät, hier nach dem Hub. */}

      <IntegrationsCard
        integrations={status.integrations}
        settings={settings}
        onReloaded={load}
      />

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
                  {datumUhr(outage.since * 1000)}
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
            {status.disk.total_gb} GB frei. Läuft der Datenträger voll, lässt sich nichts
            mehr speichern: keine Konfiguration, keine Lautsprecher, keine Sicherung.
          </Text>
          <Text style={styles.hint}>
            Meist sind es Docker-Reste. Auf dem Host aufräumen mit{'\n'}
            docker image prune -a -f{'\n'}
            docker builder prune -f
          </Text>
        </Card>
      ) : null}

      {user?.capabilities?.includes('edit_config') ? (
        <ConfigCard settings={settings} />
      ) : null}

      {user?.capabilities?.includes('edit_config') ? <LogCard settings={settings} /> : null}

      {user?.capabilities?.includes('edit_config') ? (
        <AccessLog settings={settings} />
      ) : null}

      {/* Die Karte «Automationen» stand hier zwischen Speicherplatz und
          Benutzern - drei Ecken entfernt von der Seite, auf der die
          Abläufe stehen. Wer sie ruhen lassen will, ist dort. Seit dem
          Umzug steht sie als eine Zeile zuoberst unter «Abläufe». */}

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
            Neue Benutzer legst du in der config.yaml des Hubs an – dann bleiben sie auch
            nach einem Neustart erhalten.
          </Text>
        </Card>
      ) : null}

      <PushTestCard settings={settings} push={push} />

      <ShortcutsCard settings={settings} />

      {user?.capabilities?.includes('edit_config') ? (
        <BackupCard settings={settings} />
      ) : null}

      <VoiceHelpCard />
    </View>
  );
}

/**
 * Die letzten Warnungen und Fehler des Hubs.
 *
 * Beantwortet die Frage «warum ist nichts passiert», ohne dass jemand per
 * SSH ins Container-Log steigen muss. Bewusst erst auf Antippen geladen –
 * niemand braucht das Log bei jedem Öffnen des System-Screens.
 */
function LogCard({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [entries, setEntries] = useState<LogEntry[] | null>(null);
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const load = async () => {
    setBusy(true);
    setNote(null);
    try {
      // Die Karte zeigt Fehler selbst an - deshalb «still».
      const body = await hub.get<{ entries?: LogEntry[] }>('/api/system/log?limit=100', {
        still: true,
      });
      setEntries(Array.isArray(body.entries) ? body.entries : []);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
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
                    name={
                      entry.level === 'ERROR' || entry.level === 'CRITICAL'
                        ? 'alert-circle'
                        : 'warning-outline'
                    }
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
                      {datumUhr(entry.at * 1000)} · {entry.logger}
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

function ShortcutsCard({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [items, setItems] = useState<Kurzbefehl[] | null>(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  useEffect(() => {
    if (!open || items) return;
    hub
      .get<{ shortcuts?: Kurzbefehl[] }>('/api/shortcuts', {
        fallback: { shortcuts: [] },
        still: true,
      })
      .then((data) => setItems(data.shortcuts ?? []));
  }, [open, items, hub]);

  const shown = (items ?? []).filter((item) =>
    item.name.toLowerCase().includes(query.trim().toLowerCase())
  );

  const share = async (item: Kurzbefehl) => {
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
            Antippen teilt die fertigen Angaben. In der App «Kurzbefehle» eine Aktion
            «Inhalte von URL abrufen» anlegen und einsetzen – der Name des Kurzbefehls wird
            der Satz, den du Siri sagst.
          </Text>
          <Text style={styles.hint}>
            Derselbe Kurzbefehl lässt sich auf einen NFC-Aufkleber legen: einer am Eingang
            für «Alles aus», einer am Nachttisch für «Schlafen». Schritt für Schritt in
            docs/nfc-und-widget.md.
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
            <Laedt was="Dateien" klein />
          ) : (
            shown.slice(0, 40).map((item) => (
              <Pressable
                key={`${item.kind}:${item.name}`}
                onPress={() => share(item)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <Ionicons
                  name={
                    item.kind === 'scene' ? 'sparkles-outline' : 'hardware-chip-outline'
                  }
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
          {copied ? <Text style={styles.rowDetail}>«{copied}» geteilt.</Text> : null}
          <Text style={styles.hint}>
            Achtung: Die Angaben enthalten dein Token. Wer sie hat, kann alles schalten, was
            du darfst – also nicht in eine Gruppenchat schicken. Für Siri lohnt sich ein
            eigener Benutzer mit eigenem Token, den man einzeln zurückziehen kann (siehe
            docs/siri-und-widgets.md).
          </Text>
        </>
      ) : null}
    </Card>
  );
}

/** Ein fertiger Siri-Kurzbefehl, wie /api/shortcuts ihn liefert. */
interface Kurzbefehl {
  kind: string;
  name: string;
  url: string;
  method: string;
  headers: Record<string, string>;
  body?: unknown;
}

/** Eine Sicherung aus /api/system/backups. */
interface Sicherung {
  name: string;
  created: number;
  size: number;
}

/** Stand der Off-Site-Kopie in Supabase. */
interface Offsite {
  ok: boolean;
  at: number;
  name: string;
  error?: string | null;
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
  /** Der Ausgang des letzten Laufs, über Neustarts des Dienstes hinweg.
   *  Fehlt bei älteren Update-Diensten – dann bleibt es wie bisher. */
  last_run?: LetzterLauf | null;
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
 * «Was ist neu» – auch noch nach zwei Wochen.
 *
 * Die Karte nach dem Update zeigt sich genau einmal und ist danach weg.
 * Wer später wissen will, was sich geändert hat, hatte keinen Weg dorthin
 * – dabei liegt die Liste ohnehin im Hub (changes.txt, vom Bau-Skript
 * daneben gelegt).
 *
 * Hier steht sie zusammengeklappt: eine Zeile, die man antippt. Immer
 * ausgeklappt wäre sie in dem Bildschirm, in dem man nach einem Fehler
 * sucht, nur Lärm.
 */
function WasIstNeu({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [offen, setOffen] = useState(false);
  const [changes, setChanges] = useState<string[] | null>(null);

  useEffect(() => {
    if (!offen || changes !== null) return;
    hub
      .get<{ changes?: string[] } | null>('/api/system/changes', {
        fallback: null,
        still: true,
      })
      .then((data) => setChanges(Array.isArray(data?.changes) ? data.changes : []));
  }, [offen, changes, hub]);

  return (
    <>
      <Pressable
        onPress={() => setOffen((v) => !v)}
        accessibilityRole="button"
        accessibilityState={{ expanded: offen }}
      >
        <Text style={styles.hint}>Was dieses Update mitbrachte {offen ? '▾' : '▸'}</Text>
      </Pressable>
      {offen ? (
        <View style={{ gap: 2, marginTop: 2 }}>
          {changes === null ? (
            <Text style={styles.hint}>Wird geholt …</Text>
          ) : changes.length === 0 ? (
            <Text style={styles.hint}>
              Keine Liste vorhanden – sie entsteht beim Bau und fehlt, wenn der Hub von Hand
              gestartet wurde.
            </Text>
          ) : (
            changes.map((zeile, index) => (
              <Text key={index} style={styles.hint}>
                · {zeile}
              </Text>
            ))
          )}
        </View>
      ) : null}
    </>
  );
}

/**
 * Welchen Stand die installierte App selbst ausführt.
 *
 * Für den Browser gab es das schon (WebVersionNote, version.json) – auf
 * dem Telefon gab es gar nichts. Nach einem TestFlight-Update blieb
 * deshalb nur ein Gefühl: «meine Änderung ist nicht drin», ohne
 * Möglichkeit, es nachzusehen.
 *
 * Die eigentliche Falle ist dabei nicht der Bau, sondern was danach
 * kommt: Die App fragt beim Start bei EAS nach einer Aktualisierung
 * (``checkAutomatically: ON_LOAD``), und weil ``runtimeVersion`` an der
 * App-Version hängt, die sich selten ändert, passt eine *ältere*
 * veröffentlichte Fassung formal noch auf einen frischen Build. Läuft
 * sie, zeigt die App alten Code, obwohl TestFlight gerade Neues gebracht
 * hat. Genau das steht hier: mitgeliefert oder nachgeladen.
 */
function AppVersionNote() {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  if (Platform.OS === 'web') return null;

  const gebaut = Updates.createdAt ? localTime(Updates.createdAt.toISOString()) : null;
  const nachgeladen = Updates.isEmbeddedLaunch === false;
  return (
    <>
      <Text style={styles.hint}>
        App {Constants.expoConfig?.version ?? '?'}
        {Updates.runtimeVersion ? ` · Laufzeit ${Updates.runtimeVersion}` : ''}
        {gebaut ? ` · Stand ${gebaut}` : ''}
        {nachgeladen ? ' · nachgeladen' : ' · mitgeliefert'}
      </Text>
      {nachgeladen ? (
        <Text style={[styles.hint, { color: colors.warn }]}>
          Diese App führt nicht ihren eigenen Stand aus, sondern eine über die Luft
          nachgeladene Fassung – die kann älter sein als das, was TestFlight gerade gebracht
          hat. Fehlt eine Änderung, die im Build drin sein müsste, ist das der
          wahrscheinliche Grund.
        </Text>
      ) : null}
    </>
  );
}

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
      // Nur eine Zusatzinfo im Web - ohne sie fehlt bloss die Zeile.
      .catch(() => {});
  }, []);

  if (Platform.OS !== 'web' || !webCommit || webCommit === hubCommit) {
    return null;
  }
  return (
    <Text style={[styles.hint, { color: colors.warn }]}>
      Die geladene Web-Fassung ist Stand {webCommit}, der Hub läuft mit {hubCommit}. Die
      Seite einmal komplett neu laden – zeigt sie danach immer noch den alten Stand, ist
      beim Update der Web-Bau fehlgeschlagen (die Meldung dazu erscheint nach dem nächsten
      Update hier beim Update-Knopf).
    </Text>
  );
}

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
function UpdateButton({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [note, setNote] = useState<string | null>(null);
  // Nicht bloss «rot oder nicht»: Ein Lauf, der durchgelaufen ist und
  // dabei etwas anmerkt, ist kein gescheitertes Update. Rot las sich so,
  // und man suchte nach einem Schaden, den es nicht gab.
  const [noteArt, setNoteArt] = useState<LaufArt | null>(null);
  const [busy, setBusy] = useState(false);
  const [progress, setProgress] = useState<UpdateStatus | null>(null);
  // Der Hub merkt an der Antwort des Update-Dienstes, ob der den
  // iOS-Schalter überhaupt versteht. Ein Ref statt State, weil die
  // Antwort erst eintrifft, wenn die laufende Abfrage unten schon
  // gestartet ist - sie soll den frischen Wert sehen.
  const iosIgnored = useRef(false);
  // Der Status des Update-Dienstes ist ein einziger, der auch nach dem
  // Bau stehen bleibt. Zwischen «Update gedrückt» und «der Dienst hat
  // begonnen» liegen ein, zwei Sekunden - in denen die Abfrage noch das
  // ERGEBNIS DES VORIGEN LAUFS liest. Wurde der rot beendet, färbte das
  // die frische Meldung «Angestossen …» rot, obwohl nichts schiefging.
  // Deshalb zählt der Status erst, wenn er einmal «running» gesagt hat.
  const laufBegonnen = useRef(false);

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};

  // Die Abrufe hier bleiben roh (ohne hubClient): Sie unterscheiden
  // Statuscodes einzeln (404 = älterer Hub ohne den Endpunkt) und laufen
  // während eines Updates, wenn der Hub absichtlich neu startet - eine
  // Einblendung je fehlgeschlagenem Poll wäre dann nur Lärm.
  // Beim Öffnen einmal nachsehen, ob auf dem Host gerade gebaut wird –
  // etwa weil man während eines Laufs kurz woanders war (der Fortschritt
  // lebt nur in diesem Bildschirm) oder jemand anderes das Update
  // angestossen hat. Läuft etwas, hängt sich der Balken wieder dran.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const response = await fetch(`${settings.url}/api/system/update/status`, {
          headers,
        });
        if (cancelled || !response.ok) return;
        const data = (await response.json()) as UpdateStatus;
        if (cancelled) return;
        if (data.available && data.state === 'running') {
          laufBegonnen.current = true;
          setProgress(data);
          setBusy(true); // startet die laufende Abfrage unten
          return;
        }
        // Läuft nichts: Dann interessiert, wie der letzte Lauf ausging.
        // Er ist der einzige Ort, an dem ein gescheitertes Update noch
        // steht, wenn niemand zugeschaut hat.
        const rueckblick = letzterLaufSatz(data.last_run, Date.now() / 1000);
        if (rueckblick) {
          setNoteArt(rueckblick.art);
          setNote(rueckblick.text);
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
        const response = await fetch(`${settings.url}/api/system/update/status`, {
          headers,
        });
        if (cancelled) return;
        if (!response.ok) {
          if (response.status === 404) setBusy(false); // älterer Hub ohne dieses Endpunkt
          return;
        }
        const data = (await response.json()) as UpdateStatus;
        if (cancelled) return;
        if (!laufBegonnen.current && data.available) {
          // Noch nicht angelaufen: Was hier steht, gehört zum vorherigen
          // Lauf. Warten, statt dessen Ergebnis für unseres zu halten.
          if (data.state !== 'running') return;
          laufBegonnen.current = true;
        }
        setProgress(data);
        if (!data.available || data.state === 'ok' || data.state === 'error') {
          setBusy(false);
          if (data.state === 'error') {
            setNoteArt('fehler');
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
            if (iosIgnored.current) {
              // Der Hub ist neu, aber der iOS-Build blieb aus - der
              // Update-Dienst auf dem Server ist noch eine Fassung, die
              // den Schalter nicht kennt. Ohne diesen Hinweis sähe alles
              // nach Erfolg aus, und TestFlight bliebe stumm.
              setNoteArt('fehler');
              setNote(
                [
                  'Fertig - der Hub ist neu, aber der iOS-Build wurde nicht angestossen:',
                  'Der Update-Dienst auf dem Server ist noch eine ältere Fassung und kennt den iOS-Schalter nicht.',
                  'Auf dem Server einmal «sudo systemctl restart homepilot-update» ausführen - beim nächsten Update klappt es dann.',
                ].join('\n')
              );
            } else if (warned.length > 0) {
              // «Fertig» wäre hier die halbe Wahrheit: Der Hub ist neu,
              // aber etwas blieb auf dem alten Stand - das gehört vor
              // die Augen, nicht ins Journal auf dem Host. In Rot stand
              // es dort allerdings wie ein gescheitertes Update.
              setNoteArt('hinweis');
              setNote(['Fertig, aber mit Vorbehalt:', ...warned].join('\n'));
            } else {
              setNoteArt(null);
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
        setNoteArt('fehler');
        setNote(
          'Keine Rückmeldung mehr vom Update-Dienst – im Log auf dem Host nachsehen.'
        );
      }
    };
    poll();
    // Bewusst kein useTakt: Dieser Poll läuft nur, solange ein Update
    // läuft und jemand zuschaut - und er darf im Hintergrund gerade
    // nicht schweigen, sonst verpasst er das Ende des Baus und meldet
    // beim Zurückkommen «keine Rückmeldung», obwohl alles gut ging.
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
    setNoteArt(null);
    setProgress(null);
    iosIgnored.current = false;
    laufBegonnen.current = false;
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
      if (!response.ok)
        throw new Error(body?.detail ?? `Hub antwortet mit ${response.status}`);
      iosIgnored.current = Boolean(body?.ios_ignored);
      if (iosIgnored.current) {
        setNoteArt('fehler');
        setNote(
          'Angestossen - aber der Update-Dienst auf dem Server kennt den iOS-Schalter noch nicht. ' +
            'Es wird nur der Hub gebaut. Abhilfe: auf dem Server einmal ' +
            '«sudo systemctl restart homepilot-update» ausführen.'
        );
      } else if (body?.nur_ausrollen) {
        // Die eingerichtete Adresse ist ein blosser Portainer-Webhook.
        // Der erstellt den Container neu - aus demselben Abbild. Der
        // Knopf tut also etwas und ändert doch nie den Stand.
        setNoteArt('fehler');
        setNote(
          [
            'Angestossen - aber diese Adresse rollt nur aus, sie baut nicht neu.',
            'Der Container wird neu erstellt, aus demselben Abbild: Der Stand unten bleibt derselbe.',
            'Damit der Knopf wirklich baut, gehört unter update.webhook_url der Update-Dienst des Hosts (Adresse endet auf /update), nicht der Portainer-Webhook - siehe deploy/portainer.md.',
          ].join('\n')
        );
      } else {
        setNote(
          ios
            ? 'Angestossen. Der Host baut den Hub, danach geht der iOS-Build an EAS – TestFlight meldet sich.'
            : 'Angestossen. Der Host baut jetzt – das dauert ein paar Minuten.'
        );
      }
    } catch (err) {
      setBusy(false);
      setNoteArt('fehler');
      setNote(String(err instanceof Error ? err.message : err));
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
            Der Host holt den neusten Stand, baut den Hub neu und startet ihn – das dauert
            ein paar Minuten, die App ist dabei kurz getrennt. «Hub + iOS-Build» reicht die
            App zusätzlich über EAS bei App Store Connect ein; das braucht es nur, wenn sich
            an der App selbst etwas geändert hat.
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
          style={[
            styles.noteText,
            noteArt === 'fehler' && { color: colors.danger },
            noteArt === 'hinweis' && { color: colors.warn },
          ]}
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
      (a, b) => (a.room ?? '').localeCompare(b.room ?? '') || a.name.localeCompare(b.name)
    );
}

/** Integrationen - eingeklappt, weil sie im Normalfall nichts zu sagen haben.
 *
 * Der Regelfall ist «alles läuft», und dann sind zehn Zeilen Haken nur
 * Weg zwischen den Karten, die man wirklich sucht. Was nicht läuft,
 * bleibt trotzdem sichtbar: Eine Störung einzuklappen hiesse, genau die
 * eine Auskunft zu verstecken, für die es diese Karte gibt.
 */
function IntegrationsCard({
  integrations,
  settings,
  onReloaded,
}: {
  integrations: SystemStatus['integrations'];
  settings: HubSettings;
  /** Nach einem Neuladen: Status frisch holen. */
  onReloaded: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [open, setOpen] = useState(false);
  const [busyName, setBusyName] = useState<string | null>(null);
  const [reloadNote, setReloadNote] = useState<string | null>(null);

  /** Eine Integration neu anlaufen lassen – config.yaml geändert, neu
   *  laden, fertig. Vorher hiess das: den ganzen Hub durchstarten. */
  const reload = async (name: string) => {
    setBusyName(name);
    setReloadNote(null);
    try {
      // Roh statt über den Client: Die Begründung eines Fehlschlags
      // steckt im detail-Feld der Antwort.
      const response = await fetch(
        `${settings.url}/api/integrations/${encodeURIComponent(name)}/reload`,
        {
          method: 'POST',
          headers: settings.token ? { Authorization: `Bearer ${settings.token}` } : {},
        }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.detail ?? `Hub antwortet mit ${response.status}`);
      }
      setReloadNote(
        body.ok
          ? `${name} neu geladen.`
          : `${name}: ${body.error ?? 'Neuladen fehlgeschlagen'}`
      );
    } catch (err) {
      setReloadNote(err instanceof Error ? err.message : String(err));
    } finally {
      setBusyName(null);
      onReloaded();
    }
  };
  const broken = integrations.filter((integration) => !integration.ok);
  // Eine Integration kann laufen und trotzdem halb taub sein: Ring lädt
  // seine Geräte, aber der Ereigniskanal steht nicht, und dann klingelt
  // es nur noch in der Wohnung. Von aussen sieht das aus wie «alles in
  // Ordnung» – deshalb kommt es hier neben die echten Störungen.
  const gestoert = integrations.filter(
    (integration) => integration.ok && integration.health?.ok === false
  );
  const shown = open ? integrations : [...broken, ...gestoert];

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.integrationHead}
      >
        <Text style={[styles.heading, { flex: 1 }]}>Integrationen</Text>
        <Text
          style={[
            styles.rowDetail,
            gestoert.length > 0 && { color: colors.warn },
            broken.length > 0 && { color: colors.danger },
          ]}
        >
          {broken.length > 0
            ? `${broken.length} gestört`
            : gestoert.length > 0
              ? `${gestoert.length} eingeschränkt`
              : `${integrations.length} · alle in Ordnung`}
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.inkSoft}
        />
      </Pressable>
      {reloadNote ? <Text style={styles.hint}>{reloadNote}</Text> : null}
      {shown.map((integration) => {
        const detail = integrationDetail(integration);
        return (
          <View key={integration.name} style={styles.row}>
            <Ionicons
              name={
                !integration.ok
                  ? 'alert-circle'
                  : integration.health?.ok === false
                    ? 'warning'
                    : 'checkmark-circle'
              }
              size={20}
              color={
                !integration.ok
                  ? colors.danger
                  : integration.health?.ok === false
                    ? colors.warn
                    : colors.on
              }
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.rowTitle}>{integration.name}</Text>
              {detail ? (
                <Text style={styles.rowDetail} numberOfLines={2}>
                  {detail}
                </Text>
              ) : null}
              {integration.health ? (
                <Text style={styles.rowDetail}>{healthText(integration.health)}</Text>
              ) : null}
            </View>
            <Pressable
              onPress={() => reload(integration.name)}
              disabled={busyName !== null}
              accessibilityRole="button"
              accessibilityLabel={`${integration.name} neu laden`}
              hitSlop={8}
            >
              <Ionicons
                name={
                  busyName === integration.name ? 'hourglass-outline' : 'refresh-outline'
                }
                size={18}
                color={busyName ? colors.inkFaint : colors.inkSoft}
              />
            </Pressable>
          </View>
        );
      })}
    </Card>
  );
}

/** Was eine Integration über ihren eigenen Zustand meldet (rein, testbar).
 *
 * Es geht immer um dieselbe Art Störung: Die Verbindung steht, Geräte sind
 * da, und trotzdem kommt nichts mehr an – bei Homematic, wenn die CCU den
 * Hub als Empfänger vergessen hat, bei Ring, wenn der Ereigniskanal nicht
 * zustande kam. Beides sieht von aussen aus wie «es ist halt nichts
 * passiert».
 *
 * Wer den Satz selbst schreiben kann, schickt ihn als `detail` mit – die
 * Integration weiss besser als dieser Bildschirm, was ihre Zahlen
 * bedeuten. Ohne `detail` gilt die Homematic-Form. */
export function healthText(health: Record<string, unknown>): string {
  if (typeof health.detail === 'string' && health.detail) {
    return typeof health.last_event === 'number'
      ? `${health.detail} · letztes Ereignis ${lastSeen(health.last_event)}`
      : health.detail;
  }
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
function PushTestCard({ settings, push }: { settings: HubSettings; push: PushState }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Die angemeldeten Telefone. Ohne diese Liste zeigte die Fehlermeldung
  // «alte Einträge entfernen» auf eine Tür, die es nicht gab - man sah
  // nur eine Zahl und konnte nichts tun.
  const [devices, setDevices] = useState<
    { token: string; user: string; label: string }[] | null
  >(null);

  const loadDevices = useCallback(() => {
    hub
      .get<{
        devices?: { token: string; user: string; label: string }[];
      } | null>('/api/push/devices', { fallback: null, still: true })
      .then((data) => setDevices(data?.devices ?? null));
  }, [hub]);

  useEffect(() => {
    loadDevices();
  }, [loadDevices]);

  const removeDevice = async (token: string) => {
    // Der nächste loadDevices zeigt den echten Stand.
    await hub.post('/api/push/unregister', { token }, { fallback: null, still: true });
    loadDevices();
  };

  const test = async () => {
    setBusy(true);
    setMessage(null);
    try {
      const data = await hub.post<{ sent?: number; errors?: string[] }>(
        '/api/push/test',
        undefined,
        { still: true }
      );
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
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
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
            Ein entferntes Gerät meldet sich beim nächsten Öffnen der App von selbst wieder
            an. Entfernen lohnt sich für Altlasten – etwa Tokens aus der Expo-Go-Zeit, die
            Apple mit «gehört zu einer anderen App-Kennung» ablehnt.
          </Text>
        </View>
      ) : null}
    </Card>
  );
}

/** Sicherungen der App-Daten: täglich automatisch, hier auch von Hand. */
function BackupCard({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  // Für die Rohabrufe unten (Blob/Text) - der Client liefert nur JSON.
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${settings.token}` }),
    [settings.token]
  );
  const [backups, setBackups] = useState<Sicherung[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [listOpen, setListOpen] = useState(false);
  const [confirmRestore, setConfirmRestore] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [offsite, setOffsite] = useState<{
    ok: boolean;
    at: number;
    name: string;
    error?: string | null;
  } | null>(null);

  const load = useCallback(() => {
    hub
      .get<{ backups?: Sicherung[]; offsite?: Offsite }>('/api/system/backups', {
        fallback: { backups: [] },
        still: true,
      })
      .then((data) => {
        setBackups(data.backups ?? []);
        setOffsite(data.offsite ?? null);
      });
  }, [hub]);

  useEffect(load, [load]);

  const runBackup = async () => {
    setBusy(true);
    try {
      const data = await hub.post<{ backups?: Sicherung[] } | null>(
        '/api/system/backup',
        undefined,
        { fallback: null }
      );
      if (data) setBackups(data.backups ?? []);
    } finally {
      setBusy(false);
    }
  };

  const latest = backups && backups[0];
  const when = latest ? datumUhr(latest.created * 1000) : null;

  const download = async (name: string) => {
    // Nur im Web: Dort kann der Browser die Datei speichern. Der Link
    // allein genügt nicht - der Abruf braucht das Token im Header.
    try {
      const response = await fetch(
        `${settings.url}/api/system/backups/${encodeURIComponent(name)}`,
        { headers }
      );
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = name;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  /**
   * Alles Eigene als eine Datei – Abläufe, Szenen, Listen, Räume.
   *
   * Nicht dasselbe wie eine Sicherung: Die bleibt im Haus und enthält
   * alles. Der Export geht auf ein Telefon oder in eine Mail, und dort
   * haben Token, Sitzungen und das Zugriffsprotokoll nichts verloren –
   * der Hub lässt sie weg.
   *
   * Nur im Browser, wie beim Herunterladen einer Sicherung: Das Telefon
   * hat keinen Ort, an dem eine Datei liegen bliebe. Auf dem Telefon
   * steht deshalb der Satz, wo es geht, statt eines Knopfes, der nichts
   * tut.
   */
  const exportieren = async () => {
    setNote(null);
    try {
      const response = await fetch(`${settings.url}/api/system/export`, { headers });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      const blob = await response.blob();
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `homepilot-${new Date().toISOString().slice(0, 10)}.json`;
      link.click();
      URL.revokeObjectURL(url);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  /**
   * Das Haus auf einem Blatt – für die Ferienvertretung.
   *
   * Der Hub stellt es zusammen (core/hausblatt.py), damit es auf jedem
   * Gerät dasselbe ist und nur enthält, was die anfragende Person auch
   * sehen darf. Hier bleibt nur die Frage, was damit geschieht: im
   * Browser drucken, auf dem Telefon teilen.
   */
  const hausblatt = async () => {
    setNote(null);
    try {
      const response = await fetch(`${settings.url}/api/system/hausblatt`, { headers });
      if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      const text = await response.text();
      if (Platform.OS !== 'web') {
        await Share.share({ title: 'Hausblatt', message: text });
        return;
      }
      // Ein eigenes Fenster statt window.print() auf der App selbst: Sonst
      // druckte man die Bedienoberfläche mit Kacheln und Schaltern aus.
      const fenster = window.open('', '_blank');
      if (!fenster) {
        setNote('Der Browser hat das Druckfenster blockiert.');
        return;
      }
      fenster.document.write(
        '<html><head><title>Hausblatt</title></head><body>' +
          '<pre style="font:13px/1.5 ui-monospace,monospace;white-space:pre-wrap">' +
          text.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' })[c]!) +
          '</pre></body></html>'
      );
      fenster.document.close();
      fenster.focus();
      fenster.print();
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  const restore = async (name: string) => {
    if (confirmRestore !== name) {
      setConfirmRestore(name);
      return;
    }
    setConfirmRestore(null);
    setBusy(true);
    setNote(null);
    try {
      // Roh statt über den Client: Bei einem Fehlschlag steckt die
      // eigentliche Begründung des Hubs im detail-Feld der Antwort.
      const response = await fetch(
        `${settings.url}/api/system/backups/${encodeURIComponent(name)}/restore`,
        { method: 'POST', headers }
      );
      const body = await response.json().catch(() => ({}));
      if (!response.ok)
        throw new Error(body.detail ?? `Hub antwortet mit ${response.status}`);
      setNote(body.hinweis ?? 'Zurückgespielt - der Hub startet neu.');
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setListOpen((open) => !open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: listOpen }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Text style={[styles.heading, { flex: 1 }]}>Sicherung</Text>
        <Ionicons
          name={listOpen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.inkSoft}
        />
      </Pressable>
      <Text style={styles.rowDetail}>
        {backups == null
          ? 'wird geladen …'
          : backups.length === 0
            ? 'Noch keine Sicherung.'
            : `${backups.length} Sicherung(en) · zuletzt ${when}`}
      </Text>
      <View style={styles.buttons}>
        <Button label={busy ? 'Arbeitet …' : 'Jetzt sichern'} onPress={runBackup} primary />
        {Platform.OS === 'web' ? (
          <Button label="Alles als Datei" onPress={exportieren} />
        ) : null}
        <Button
          label={Platform.OS === 'web' ? 'Hausblatt drucken' : 'Hausblatt teilen'}
          onPress={hausblatt}
        />
      </View>
      <Text style={styles.rowDetail}>
        {Platform.OS === 'web'
          ? 'Die Datei enthält Abläufe, Szenen, Listen und Räume – keine Token, keine Sitzungen, kein Zugriffsprotokoll.'
          : 'Alles als Datei herunterladen geht in der Web-Fassung – das Telefon hat keinen Ort, an dem sie liegen bliebe.'}
      </Text>
      <Text style={styles.rowDetail}>
        Das Hausblatt ist eine Seite für die Ferienvertretung: Räume, Szenen und vor allem,
        was von selbst passiert.
      </Text>

      {listOpen
        ? (backups ?? []).map((entry) => (
            <View key={entry.name} style={styles.row}>
              <View style={{ flex: 1 }}>
                <Text style={styles.rowDetail}>
                  {datumUhr(entry.created * 1000)}
                  {' · '}
                  {Math.max(1, Math.round(entry.size / 1024))} kB
                </Text>
              </View>
              {Platform.OS === 'web' ? (
                <Pressable
                  onPress={() => download(entry.name)}
                  accessibilityLabel="Herunterladen"
                  hitSlop={8}
                >
                  <Ionicons name="download-outline" size={18} color={colors.inkSoft} />
                </Pressable>
              ) : null}
              <Pressable
                onPress={() => restore(entry.name)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.smallAction,
                  confirmRestore === entry.name && { borderColor: colors.danger },
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text
                  style={[
                    styles.smallActionText,
                    confirmRestore === entry.name && { color: colors.danger },
                  ]}
                >
                  {confirmRestore === entry.name ? 'Wirklich?' : 'Zurückspielen'}
                </Text>
              </Pressable>
            </View>
          ))
        : null}
      {note ? (
        <Text style={styles.rowDetail} selectable>
          {note}
        </Text>
      ) : null}
      {offsite ? (
        <Text style={[styles.rowDetail, !offsite.ok && { color: colors.warn }]} selectable>
          {offsite.ok
            ? `Off-Site-Kopie in Supabase: zuletzt ${datumUhr(offsite.at * 1000)}`
            : `Off-Site-Kopie fehlgeschlagen: ${offsite.error ?? 'unbekannt'}`}
        </Text>
      ) : null}
      <Text style={styles.hint}>
        Benutzer, Abläufe, Szenen und Familien-Daten werden täglich automatisch gesichert
        (die letzten 14). Zurückspielen sichert den aktuellen Stand zuerst und startet den
        Hub neu. Fürs Herunterladen die Web-Fassung am Computer öffnen - eine Kopie
        ausserhalb des Hubs schützt auch bei einem Plattenschaden.
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
        Geräte, Szenen und Musik lassen sich über die verknüpften Google-Home- Lautsprecher
        per Sprache steuern. Beispiele:
      </Text>
      {examples.map((line) => (
        <View key={line} style={styles.voiceRow}>
          <Ionicons name="mic-outline" size={15} color={colors.inkSoft} />
          <Text style={styles.voiceText}>{line}</Text>
        </View>
      ))}
      <Text style={styles.hint}>
        Namen frei wählbar: Benenne ein Gerät im Anpassen-Modus um, dann hört Google auf
        denselben Namen. Szenen heissen wie im Abläufe-Editor.
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

function roleIcon(role: string): keyof typeof Ionicons.glyphMap {
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
    integrationHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    rowDetail: { color: colors.inkSoft, fontSize: 13 },
    // Der Grund, warum nichts ankommt. In der Warnfarbe, weil er eine
    // Aufgabe ist, und mit Zeilenabstand, weil er ein Satz ist.
    rowProblem: { color: colors.warn, fontSize: 12, lineHeight: 17, marginTop: 2 },
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
    logHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
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
    smallAction: {
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: 999,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    smallActionText: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
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
