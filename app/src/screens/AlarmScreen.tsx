import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Colors, radius, space, type, useColors } from '../theme';

/**
 * Alarmanlage: Modus schalten, Sensoren zuordnen, Verlauf ansehen.
 *
 * Die Anlage selbst läuft im Hub – dieser Screen ist nur das Bedienteil.
 * Deshalb steht hier auch kein Zustand doppelt: Jede Änderung geht zum Hub
 * und kommt von dort zurück.
 */

interface Sensor {
  entity_id: string;
  modes: string[];
  delayed?: boolean;
  bypass?: boolean;
}

interface Candidate {
  entity_id: string;
  name: string;
  room?: string | null;
  kind: string;
  device_class?: string | null;
  open: boolean;
  available: boolean;
}

interface AlarmState {
  state: string;
  mode?: string | null;
  mode_label?: string;
  seconds_left?: number | null;
  /** Was am Ende des Countdowns passiert: 'arm' | 'trigger' | 'rearm'. */
  next_action?: string | null;
  last_trigger?: { name: string; at: number; mode?: string } | null;
}

interface After {
  action: string;
  after: number;
}

interface Overview {
  state: AlarmState;
  sensors: Sensor[];
  settings: Record<string, any>;
  after_trigger: Record<string, After>;
  history: { kind: string; text: string; by?: string; at: number }[];
  candidates: Candidate[];
}

const MODES = [
  { key: 'nacht', label: 'Nacht', icon: 'moon-outline' as const },
  { key: 'ausser_haus', label: 'Ausser Haus', icon: 'exit-outline' as const },
  { key: 'urlaub', label: 'Urlaub', icon: 'airplane-outline' as const },
];

/** Farbe und Text zum Zustand der Anlage (rein, testbar). */
export function stateLook(
  state: AlarmState,
  colors: Colors
): { text: string; color: string } {
  switch (state.state) {
    case 'scharf':
      return { text: `Scharf · ${state.mode_label}`, color: colors.on };
    case 'scharfschaltend':
      return { text: 'Wird scharf …', color: colors.warn };
    case 'eintritt':
      return { text: 'Eintritt – jetzt unscharf schalten', color: colors.warn };
    case 'ausgeloest':
      return { text: 'Alarm ausgelöst', color: colors.danger };
    default:
      return { text: 'Unscharf', color: colors.inkSoft };
  }
}

/** Beschriftung des laufenden Countdowns (rein, testbar).
 *
 * Ohne das stünde bei jeder Wartezeit dasselbe da – und «noch 240
 * Sekunden» beim ausgelösten Alarm liest sich sonst wie eine Frist zum
 * Unscharfschalten, obwohl die Anlage gleich wieder scharf wird. */
export function countdownText(state: AlarmState): string | null {
  const left = state.seconds_left;
  if (left == null) return null;
  const time = left >= 90 ? `${Math.round(left / 60)} Minuten` : `${left} Sekunden`;
  switch (state.next_action) {
    case 'rearm':
      return `Wieder scharf in ${time}`;
    case 'trigger':
      return `Alarm in ${time} – jetzt unscharf schalten`;
    default:
      return `noch ${time}`;
  }
}

/** Sensoren nach Raum gruppieren, Räume alphabetisch (rein, testbar). */
export function byRoom(candidates: Candidate[]): { room: string; items: Candidate[] }[] {
  const rooms = Array.from(
    new Set(candidates.map((entry) => entry.room || 'Ohne Raum'))
  ).sort((a, b) =>
    a === 'Ohne Raum' ? 1 : b === 'Ohne Raum' ? -1 : a.localeCompare(b)
  );
  return rooms.map((room) => ({
    room,
    items: candidates.filter((entry) => (entry.room || 'Ohne Raum') === room),
  }));
}

export function AlarmScreen({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  // Welcher Modus gerade zusammengestellt wird.
  const [tab, setTab] = useState('nacht');

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};

  const load = useCallback(() => {
    fetch(`${settings.url}/api/alarm`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then(setData)
      .catch((err) => setError(String(err.message ?? err)));
  }, [settings.url, settings.token]);

  useEffect(load, [load]);

  // Während einer Verzögerung läuft ein Countdown – da muss die Anzeige
  // öfter nachziehen als sonst.
  useEffect(() => {
    const running =
      data?.state.state === 'scharfschaltend' || data?.state.state === 'eintritt';
    // Die Wartezeit bis zum Wiederscharfschalten dauert Minuten – da reicht
    // ein gemächlicherer Takt als bei den Verzögerungen von Sekunden.
    const waiting = data?.state.next_action === 'rearm';
    const timer = setInterval(load, running ? 1000 : waiting ? 5000 : 15000);
    return () => clearInterval(timer);
  }, [load, data?.state.state, data?.state.next_action]);

  const save = async (patch: Record<string, any>) => {
    // Sofort im Bild nachziehen, damit das Antippen nicht hakt.
    setData((prev) => (prev ? { ...prev, ...patch } : prev));
    await fetch(`${settings.url}/api/alarm`, {
      method: 'PUT',
      headers: { ...headers, 'Content-Type': 'application/json' },
      body: JSON.stringify(patch),
    }).catch(() => {});
    load();
  };

  const arm = async (mode: string, force = false) => {
    setPendingMode(mode);
    setNote(null);
    try {
      const response = await fetch(`${settings.url}/api/alarm/arm`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ mode, force }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail ?? `Hub antwortet mit ${response.status}`);
      if (body.ok === false) {
        // Nicht heimlich trotzdem scharf schalten – erst sagen, was im Weg
        // ist. Ein stummer Sensor wiegt schwerer als ein offenes Fenster:
        // Den sieht man nicht.
        const parts: string[] = [];
        if ((body.open ?? []).length > 0) {
          parts.push(`Noch offen: ${body.open.join(', ')}`);
        }
        if ((body.offline ?? []).length > 0) {
          parts.push(`Antwortet nicht: ${body.offline.join(', ')}`);
        }
        if ((body.battery ?? []).length > 0) {
          parts.push(`Batterie schwach: ${body.battery.join(', ')}`);
        }
        setNote(
          `${parts.join(' · ')}. Beheben – oder unten trotzdem scharf schalten.`
        );
        setPendingMode(mode);
        return;
      }
      setPendingMode(null);
    } catch (err: any) {
      setNote(String(err.message ?? err));
    }
    load();
  };

  const disarm = async () => {
    setNote(null);
    setPendingMode(null);
    await fetch(`${settings.url}/api/alarm/disarm`, { method: 'POST', headers }).catch(
      () => {}
    );
    load();
  };

  if (error) return <Text style={styles.note}>Alarmanlage nicht abrufbar: {error}</Text>;
  if (!data) return <Text style={styles.note}>Wird geladen …</Text>;

  const look = stateLook(data.state, colors);
  const assigned = new Map(data.sensors.map((entry) => [entry.entity_id, entry]));

  const setSensor = (entityId: string, patch: Partial<Sensor>) => {
    const current = assigned.get(entityId) ?? { entity_id: entityId, modes: [] };
    const next = { ...current, ...patch };
    const others = data.sensors.filter((entry) => entry.entity_id !== entityId);
    // Ohne Modus ist ein Sensor nicht zugeordnet – dann ganz weglassen.
    const sensors = next.modes.length > 0 ? [...others, next] : others;
    save({ sensors });
  };

  const tabLabel = MODES.find((mode) => mode.key === tab)?.label ?? '';

  /** Alle Sensoren auf einmal in den gewählten Modus nehmen oder daraus
   *  entfernen – «Ausser Haus» heisst meistens schlicht alles. */
  const setAllForTab = (include: boolean) => {
    const sensors = data.candidates
      .map((candidate) => {
        const current = assigned.get(candidate.entity_id) ?? {
          entity_id: candidate.entity_id,
          modes: [] as string[],
        };
        const modes = current.modes.filter((entry) => entry !== tab);
        return { ...current, modes: include ? [...modes, tab] : modes };
      })
      .filter((entry) => entry.modes.length > 0);
    save({ sensors });
  };

  const toggleMode = (entityId: string, mode: string) => {
    const current = assigned.get(entityId);
    const modes = current?.modes ?? [];
    setSensor(entityId, {
      modes: modes.includes(mode)
        ? modes.filter((entry) => entry !== mode)
        : [...modes, mode],
    });
  };

  return (
    <View style={styles.list}>
      {/* Zustand und Bedienung */}
      <Card style={styles.card}>
        <View style={styles.stateHead}>
          <View style={[styles.lamp, { backgroundColor: look.color }]} />
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>{look.text}</Text>
            {countdownText(data.state) != null ? (
              <Text style={styles.rowDetail}>{countdownText(data.state)}</Text>
            ) : data.state.last_trigger ? (
              <Text style={styles.rowDetail}>
                Zuletzt ausgelöst: {data.state.last_trigger.name}
              </Text>
            ) : null}
          </View>
        </View>

        <View style={styles.modeRow}>
          {MODES.map((mode) => {
            const active = data.state.mode === mode.key && data.state.state !== 'unscharf';
            return (
              <Pressable
                key={mode.key}
                onPress={() => arm(mode.key)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.mode,
                  active && styles.modeActive,
                  pressed && { opacity: 0.8 },
                ]}
              >
                <Ionicons
                  name={mode.icon}
                  size={20}
                  color={active ? '#FFFFFF' : colors.ink}
                />
                <Text style={[styles.modeText, active && { color: '#FFFFFF' }]}>
                  {mode.label}
                </Text>
              </Pressable>
            );
          })}
        </View>

        {data.state.state !== 'unscharf' ? (
          <Pressable
            onPress={disarm}
            accessibilityRole="button"
            style={({ pressed }) => [styles.disarm, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.disarmText}>Unscharf schalten</Text>
          </Pressable>
        ) : null}

        {note ? (
          <>
            <Text style={styles.warn}>{note}</Text>
            {pendingMode ? (
              <Pressable
                onPress={() => arm(pendingMode, true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.force, pressed && { opacity: 0.85 }]}
              >
                <Text style={styles.forceText}>Trotzdem scharf schalten</Text>
              </Pressable>
            ) : null}
          </>
        ) : null}
      </Card>

      {/* Sensoren – je Modus einzeln zusammenstellen */}
      <Card style={styles.card}>
        <Text style={styles.heading}>Sensoren</Text>
        <View style={styles.tabRow}>
          {MODES.map((mode) => {
            const on = tab === mode.key;
            const count = data.sensors.filter((entry) =>
              entry.modes.includes(mode.key)
            ).length;
            return (
              <Pressable
                key={mode.key}
                onPress={() => setTab(mode.key)}
                accessibilityRole="tab"
                accessibilityState={{ selected: on }}
                style={[styles.tab, on && styles.tabOn]}
              >
                <Text style={[styles.tabText, on && { color: '#FFFFFF' }]}>
                  {mode.label}
                </Text>
                <Text style={[styles.tabCount, on && { color: '#FFFFFF' }]}>
                  {count}
                </Text>
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.hint}>
          Welche Sensoren wachen im Modus «{tabLabel}»? Jeder Modus wird
          einzeln zusammengestellt – nachts gehören meist nur Türen und
          Fenster dazu, weil Bewegungsmelder jeden Gang zur Toilette melden
          würden.
        </Text>

        {data.candidates.length === 0 ? (
          <Text style={styles.hint}>
            Noch keine geeigneten Sensoren gefunden. Tür-/Fensterkontakte und
            Bewegungsmelder erscheinen hier automatisch.
          </Text>
        ) : (
          <View style={styles.chipRow}>
            <Pressable onPress={() => setAllForTab(true)} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>Alle auswählen</Text>
            </Pressable>
            <Pressable onPress={() => setAllForTab(false)} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>Keine</Text>
            </Pressable>
          </View>
        )}

        {byRoom(data.candidates).map((group) => (
          <View key={group.room} style={styles.group}>
            <Text style={styles.groupTitle}>{group.room}</Text>
            {group.items.map((candidate) => {
              const entry = assigned.get(candidate.entity_id);
              const on = (entry?.modes ?? []).includes(tab);
              return (
                <View key={candidate.entity_id} style={styles.sensor}>
                  <Pressable
                    onPress={() => toggleMode(candidate.entity_id, tab)}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: on }}
                    style={styles.sensorHead}
                  >
                    <Ionicons
                      name={on ? 'checkmark-circle' : 'ellipse-outline'}
                      size={24}
                      color={on ? colors.on : colors.inkFaint}
                    />
                    <Text style={styles.rowTitle} numberOfLines={1}>
                      {candidate.name}
                    </Text>
                    {!candidate.available ? (
                      <Text style={styles.offline}>offline</Text>
                    ) : candidate.open ? (
                      <Text style={styles.offline}>offen</Text>
                    ) : null}
                  </Pressable>
                  {on ? (
                    <View style={styles.chipRow}>
                      <Pressable
                        onPress={() =>
                          setSensor(candidate.entity_id, { delayed: !entry?.delayed })
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: !!entry?.delayed }}
                        style={[styles.chip, entry?.delayed && styles.chipOn]}
                      >
                        <Text
                          style={[styles.chipText, entry?.delayed && { color: '#FFFFFF' }]}
                        >
                          verzögert
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          setSensor(candidate.entity_id, { bypass: !entry?.bypass })
                        }
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: !!entry?.bypass }}
                        style={[styles.chip, entry?.bypass && styles.chipWarn]}
                      >
                        <Text
                          style={[styles.chipText, entry?.bypass && { color: '#FFFFFF' }]}
                        >
                          überbrückt
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </View>
              );
            })}
          </View>
        ))}
        <Text style={styles.hint}>
          «Verzögert» ist für die Tür, durch die du selbst hereinkommst: Sie
          startet die Eingangsverzögerung, statt sofort auszulösen.
          «Überbrückt» lässt einen Sensor vorübergehend aus, ohne die
          Zuordnung zu verlieren – für das Fenster, das gekippt bleiben soll.
          Beides gilt für den Sensor in allen Modi.
        </Text>
      </Card>

      <AfterTrigger
        after={data.after_trigger ?? {}}
        onSave={(mode, patch) => {
          const current = data.after_trigger ?? {};
          // Ganze Karte schicken, nicht nur den einen Modus: Sonst zeigt die
          // Anzeige bis zum nächsten Laden für die anderen Modi Vorgaben an.
          save({
            after_trigger: {
              ...current,
              [mode]: { ...(current[mode] ?? { action: 'stay', after: 300 }), ...patch },
            },
          });
        }}
      />

      <AlarmSettings settings={data.settings} onSave={(next) => save({ settings: next })} />

      {data.history.length > 0 ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Verlauf</Text>
          {data.history.slice(0, 12).map((event, index) => (
            <View key={index} style={styles.row}>
              <Ionicons
                name={
                  event.kind === 'triggered'
                    ? 'alert-circle'
                    : event.kind === 'armed'
                      ? 'lock-closed-outline'
                      : event.kind === 'entry'
                        ? 'time-outline'
                        : 'lock-open-outline'
                }
                size={18}
                color={event.kind === 'triggered' ? colors.danger : colors.inkSoft}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.rowTitle}>{event.text}</Text>
                <Text style={styles.rowDetail}>
                  {new Date(event.at * 1000).toLocaleString('de-CH', {
                    day: '2-digit',
                    month: '2-digit',
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                  {event.by ? ` · ${event.by}` : ''}
                </Text>
              </View>
            </View>
          ))}
        </Card>
      ) : null}
    </View>
  );
}

const AFTER_CHOICES = [
  { key: 'stay', label: 'Ausgelöst bleiben' },
  { key: 'disarm', label: 'Abschalten' },
  { key: 'rearm', label: 'Wieder scharf' },
];

/** Was nach einem Alarm passiert – je Modus einzeln.
 *
 * Eigene Komponente auf Modulebene, damit das Zahlenfeld beim Tippen nicht
 * neu montiert wird. */
function AfterTrigger({
  after,
  onSave,
}: {
  after: Record<string, After>;
  onSave: (mode: string, patch: Partial<After>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Nach einem Alarm</Text>
      <Text style={styles.hint}>
        Was soll die Anlage tun, nachdem sie ausgelöst und alle benachrichtigt
        hat? Das lässt sich je Modus getrennt einstellen, weil es davon
        abhängt, ob jemand zuhause ist: Nachts schaltet man selbst ab, im
        Urlaub tut das niemand.
      </Text>

      {MODES.map((mode) => {
        const entry = after[mode.key] ?? { action: 'stay', after: 300 };
        return (
          <View key={mode.key} style={styles.afterBlock}>
            <View style={styles.afterHead}>
              <Ionicons name={mode.icon} size={18} color={colors.inkSoft} />
              <Text style={styles.groupTitle}>{mode.label}</Text>
            </View>
            <View style={styles.chipRow}>
              {AFTER_CHOICES.map((choice) => {
                const on = entry.action === choice.key;
                return (
                  <Pressable
                    key={choice.key}
                    onPress={() => onSave(mode.key, { action: choice.key })}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: on }}
                    style={[styles.chip, on && styles.chipOn]}
                  >
                    <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>
                      {choice.label}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            {entry.action === 'rearm' ? (
              <RearmMinutes
                seconds={entry.after}
                onCommit={(seconds) => onSave(mode.key, { after: seconds })}
              />
            ) : null}
          </View>
        );
      })}

      <Text style={styles.hint}>
        «Ausgelöst bleiben» wartet, bis jemand von Hand unscharf schaltet –
        nichts schaltet sich unbemerkt ab. «Abschalten» meldet den Alarm und
        macht danach still. «Wieder scharf» wacht nach der Wartezeit von
        selbst weiter, auch wenn die aufgebrochene Tür noch offen steht; was
        offen ist, steht dann im Verlauf.
      </Text>
    </Card>
  );
}

/** Wartezeit in Minuten – Sekunden wären hier eine Zumutung. */
function RearmMinutes({
  seconds,
  onCommit,
}: {
  seconds: number;
  onCommit: (seconds: number) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [text, setText] = useState(String(Math.max(1, Math.round(seconds / 60))));

  return (
    <View style={styles.field}>
      <Text style={styles.label}>Wieder scharf nach (Minuten)</Text>
      <TextInput
        style={styles.input}
        value={text}
        onChangeText={setText}
        onBlur={() => onCommit(Math.max(1, Number(text) || 5) * 60)}
        keyboardType="number-pad"
      />
    </View>
  );
}

/** Verzögerungen und Benachrichtigungen. Eigene Komponente auf Modulebene,
 *  damit die Zahlenfelder beim Tippen nicht neu montiert werden. */
function AlarmSettings({
  settings,
  onSave,
}: {
  settings: Record<string, any>;
  onSave: (settings: Record<string, any>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [exit, setExit] = useState(String(settings.exit_delay ?? 45));
  const [entry, setEntry] = useState(String(settings.entry_delay ?? 30));

  const commit = () =>
    onSave({
      ...settings,
      exit_delay: Number(exit) || 0,
      entry_delay: Number(entry) || 0,
    });

  return (
    <Card style={styles.card}>
      <Text style={styles.heading}>Einstellungen</Text>

      <View style={styles.field}>
        <Text style={styles.label}>Ausgangsverzögerung (Sekunden)</Text>
        <TextInput
          style={styles.input}
          value={exit}
          onChangeText={setExit}
          onBlur={commit}
          keyboardType="number-pad"
        />
        <Text style={styles.hint}>Zeit zum Verlassen des Hauses nach dem Scharfschalten.</Text>
      </View>

      <View style={styles.field}>
        <Text style={styles.label}>Eingangsverzögerung (Sekunden)</Text>
        <TextInput
          style={styles.input}
          value={entry}
          onChangeText={setEntry}
          onBlur={commit}
          keyboardType="number-pad"
        />
        <Text style={styles.hint}>
          Zeit zum Unscharfschalten, nachdem ein verzögerter Sensor ausgelöst hat.
        </Text>
      </View>

      <Toggle
        label="Push beim Auslösen"
        detail="Alle Bewohner bekommen sofort eine Nachricht."
        value={settings.notify_trigger !== false}
        onChange={(value) => onSave({ ...settings, notify_trigger: value })}
      />
      <Toggle
        label="Push beim Scharf-/Unscharfschalten"
        detail="Nützlich, wenn mehrere Personen die Anlage bedienen."
        value={!!settings.notify_arming}
        onChange={(value) => onSave({ ...settings, notify_arming: value })}
      />
    </Card>
  );
}

function Toggle({
  label,
  detail,
  value,
  onChange,
}: {
  label: string;
  detail: string;
  value: boolean;
  onChange: (value: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={() => onChange(!value)}
      accessibilityRole="switch"
      accessibilityState={{ checked: value }}
      style={styles.row}
    >
      <Ionicons
        name={value ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={value ? colors.on : colors.inkFaint}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.rowTitle}>{label}</Text>
        <Text style={styles.rowDetail}>{detail}</Text>
      </View>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: space.gap },
    card: { minHeight: 0, gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    note: { color: colors.onGradientSoft, fontSize: 14, marginTop: 20 },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    warn: { color: colors.warn, fontSize: 13, lineHeight: 19, fontWeight: '600' },

    stateHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    lamp: { width: 14, height: 14, borderRadius: 7 },
    modeRow: { flexDirection: 'row', gap: 8 },
    tabRow: { flexDirection: 'row', gap: 6 },
    tab: {
      flex: 1,
      alignItems: 'center',
      gap: 2,
      paddingVertical: 9,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    tabOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    tabText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
    tabCount: { color: colors.inkSoft, fontSize: 11 },
    smallButton: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    smallButtonText: { color: colors.accent, fontSize: 12, fontWeight: '700' },
    mode: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    modeActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    modeText: { color: colors.ink, fontSize: 12, fontWeight: '700' },
    disarm: {
      paddingVertical: 13,
      borderRadius: radius.control,
      alignItems: 'center',
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    disarmText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    force: { alignItems: 'center', paddingVertical: 10 },
    forceText: { color: colors.danger, fontSize: 14, fontWeight: '700' },

    afterBlock: {
      gap: 8,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    afterHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    group: { gap: 8 },
    groupTitle: { color: colors.inkSoft, fontSize: 13, fontWeight: '700', marginTop: 6 },
    sensor: {
      gap: 6,
      paddingVertical: 8,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    sensorHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    offline: { color: colors.warn, fontSize: 11, fontWeight: '700' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipWarn: { backgroundColor: colors.warn, borderColor: colors.warn },
    chipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },

    row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 6 },
    rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600', flex: 1 },
    rowDetail: { color: colors.inkSoft, fontSize: 12 },
    field: { gap: 6 },
    label: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontSize: 16,
    },
  });
