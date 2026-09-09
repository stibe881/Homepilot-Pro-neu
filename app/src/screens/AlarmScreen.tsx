import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { VideoView, useVideoPlayer } from 'expo-video';
import Svg, { Circle } from 'react-native-svg';

import { HubFehler, hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Klappe } from '../components/Klappe';
import { Fehlschlag, Laedt } from '../components/Zustand';
import { useTakt } from '../hooks/useTakt';
import {
  DURCHBRUCH,
  durchbruchAn,
  durchbruchUmschalten,
} from '../lib/saugerdurchbruch';
import {
  Eskalation,
  FRIST_STUFEN,
  eskalationLesen,
  eskalationStand,
  fristLabel,
  sensorenStand,
  sirenenKandidaten,
  verlaufPasst,
} from '../lib/eskalation';
import { datumUhr } from '../lib/format';
import { melderArt } from '../lib/geraeteart';
import { BlattZeile, blattWuerdig, blattZeilen } from '../lib/ereignisblatt';
import { ringAnteil } from '../lib/alarmring';
import { tapped, triggered } from '../lib/haptics';
import { Colors, radius, space, type, useColors } from '../theme';

/**
 * Alarmanlage: Modus schalten, Sensoren zuordnen, Verlauf ansehen.
 *
 * Die Anlage selbst läuft im Hub – dieser Screen ist nur das Bedienteil.
 * Deshalb steht hier auch kein Zustand doppelt: Jede Änderung geht zum Hub
 * und kommt von dort zurück.
 */

/** Die Einstellungen der Anlage, wie der Hub sie speichert - offen, weil
 *  die Felder dem Hub gehören (Punkt 60 der Werkbank). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AlarmConfig = Record<string, any>;

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
  /** Wie lang die laufende Frist insgesamt war – für den Ring. */
  seconds_total?: number | null;
  /** Was am Ende des Countdowns passiert: 'arm' | 'trigger' | 'rearm'. */
  next_action?: string | null;
  last_trigger?: {
    name: string;
    at: number;
    mode?: string;
    /** Kurzer Mitschnitt, sobald er fertig ist. */
    clip?: string | null;
  } | null;
  /** Zum Entschärfen braucht es die PIN. */
  pin_required?: boolean;
}

/** Ein Schaltbefehl, den die Anlage selbst auslöst. */
interface AlarmAction {
  entity_id: string;
  command: string;
}

interface After {
  action: string;
  after: number;
}

interface Overview {
  state: AlarmState;
  sensors: Sensor[];
  settings: AlarmConfig;
  after_trigger: Record<string, After>;
  /** Die zweite Stufe: was passiert, wenn niemand entschärft (Punkt 255
   *  der Werkbank). Offen getippt, weil ein älterer Hub das Feld nicht
   *  schickt – lib/eskalation.ts liest es mit Vorgaben ein. */
  escalation?: unknown;
  actions: Record<string, AlarmAction[]>;
  history: { kind: string; text: string; by?: string; at: number }[];
  candidates: Candidate[];
  /** Kann der Hub überhaupt ein Bild mitschicken? Dafür braucht es
   *  `push.public_url` in der config.yaml – ohne kommt die Nachricht
   *  ohne Bild, und das soll dort stehen, wo man es erwartet. */
  images?: boolean;
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

/**
 * Eine vom Hub gelieferte Adresse vollständig machen (rein, testbar).
 *
 * Ist ``push.public_url`` gesetzt, kommt schon eine ganze Adresse – die
 * gilt dann auch von unterwegs. Sonst nur der Pfad, und der gehört an die
 * Hub-Adresse gehängt, mit der die App ohnehin verbunden ist.
 */
export function absolute(url: string, base: string): string {
  return /^https?:\/\//i.test(url) ? url : `${base.replace(/\/+$/, '')}${url}`;
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

/**
 * Der Countdown als Ring: Er leert sich, die Sekunden stehen darin.
 *
 * An der Stelle der Zustandslampe, nicht daneben - während einer Frist
 * *ist* der Ring der Zustand.
 */
function CountdownRing({
  anteil,
  sekunden,
  farbe,
}: {
  anteil: number;
  sekunden: number;
  farbe: string;
}) {
  const colors = useColors();
  const groesse = 44;
  const dicke = 4;
  const radiusRing = (groesse - dicke) / 2;
  const umfang = 2 * Math.PI * radiusRing;
  return (
    <View
      style={{ width: groesse, height: groesse, alignItems: 'center', justifyContent: 'center' }}
      accessibilityLabel={`Noch ${sekunden} Sekunden`}
    >
      <Svg width={groesse} height={groesse} style={{ position: 'absolute' }}>
        <Circle
          cx={groesse / 2}
          cy={groesse / 2}
          r={radiusRing}
          stroke={colors.track}
          strokeWidth={dicke}
          fill="none"
        />
        <Circle
          cx={groesse / 2}
          cy={groesse / 2}
          r={radiusRing}
          stroke={farbe}
          strokeWidth={dicke}
          fill="none"
          strokeLinecap="round"
          strokeDasharray={`${umfang}`}
          strokeDashoffset={umfang * (1 - anteil)}
          // Bei 12 Uhr beginnen, im Uhrzeigersinn leeren.
          transform={`rotate(-90 ${groesse / 2} ${groesse / 2})`}
        />
      </Svg>
      <Text style={{ color: farbe, fontSize: 13, fontWeight: '700' }}>
        {sekunden}
      </Text>
    </View>
  );
}

export function AlarmScreen({
  settings,
  onEntity,
  entities = [],
  user,
}: {
  settings: HubSettings;
  /** Einen Sensor in der Geräteliste zeigen – für die antippbaren Namen
   *  in der «noch offen»-Warnung. */
  onEntity?: (name: string) => void;
  /** Alle Geräte – für die Auswahl, was die Anlage selbst schalten soll. */
  entities?: Entity[];
  /** Wer gerade bedient. Am Gemeinschaftsgerät ist die PIN Pflicht. */
  user?: { shared?: boolean } | null;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [pendingMode, setPendingMode] = useState<string | null>(null);
  // PIN-Abfrage vor dem Entschärfen (nur wenn eine PIN gesetzt ist).
  const [pinAsk, setPinAsk] = useState(false);
  const [pinValue, setPinValue] = useState('');
  const [pinError, setPinError] = useState<string | null>(null);
  // Welcher Modus gerade zusammengestellt wird.
  const [tab, setTab] = useState('nacht');
  // Adresse des Mitschnitts, solange er im Vollbild läuft.
  const [clip, setClip] = useState<string | null>(null);
  // Das Ereignisblatt: der Zeitpunkt des angetippten Verlaufs-Eintrags.
  const [blattAt, setBlattAt] = useState<number | null>(null);
  // Verlauf: welcher Art, und ob alle fünfzig oder nur der Anfang.
  const [historyKind, setHistoryKind] = useState<'alle' | 'armed' | 'disarmed' | 'triggered'>(
    'alle'
  );
  const [historyAll, setHistoryAll] = useState(false);
  // Namen der offenen Sensoren aus der letzten Scharfschalt-Absage.
  const [offenBeimScharfschalten, setOffenBeimScharfschalten] = useState<string[]>([]);
  const [testNote, setTestNote] = useState<string | null>(null);

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};
  // Die Schalt-Aufrufe unten bleiben rohe fetch-Aufrufe mit Absicht: Ihre
  // Antworten tragen auch im Fehlerfall Inhalt (detail, offene Sensoren,
  // schwache Batterien), den der zentrale Client nicht durchreicht.
  const client = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const load = useCallback(() => {
    // Der Bildschirm zeigt Fehler selbst an - deshalb «still».
    client
      .get<Overview>('/api/alarm', { still: true })
      .then(setData)
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));
  }, [client]);

  useEffect(load, [load]);

  // Während einer Verzögerung läuft ein Countdown – da muss die Anzeige
  // öfter nachziehen als sonst.
  const running =
    data?.state.state === 'scharfschaltend' || data?.state.state === 'eintritt';
  // Die Wartezeit bis zum Wiederscharfschalten dauert Minuten – da reicht
  // ein gemächlicherer Takt als bei den Verzögerungen von Sekunden.
  const waiting = data?.state.next_action === 'rearm';
  useTakt(load, running ? 1000 : waiting ? 5000 : 15000);

  const save = async (patch: AlarmConfig) => {
    // Sofort im Bild nachziehen, damit das Antippen nicht hakt.
    setData((prev) => (prev ? { ...prev, ...patch } : prev));
    // Ging es schief, holt der Sekunden-Takt oben gleich den echten
    // Stand - die optimistische Anzeige steht dann sichtbar zurück.
    await client.put('/api/alarm', patch, { fallback: null, still: true });
    load();
  };

  const arm = async (mode: string, force = false) => {
    // Scharfschalten ist die folgenreichste Schaltung der App – und man
    // macht sie oft im Weggehen, mit dem Blick schon an der Tür.
    triggered();
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
        // Die offenen für die antippbaren Chips daneben – ein Name als
        // toter Text hilft niemandem, der mit dem Telefon an der Tür
        // steht und nicht weiss, welches Fenster gemeint ist.
        setOffenBeimScharfschalten(Array.isArray(body.open) ? body.open : []);
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
      setOffenBeimScharfschalten([]);
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
    load();
  };

  // Am Wandtablet im Flur ist die PIN Pflicht: Dort steht die App immer
  // offen, und ohne PIN entschärfte die Anlage, wer immer vorbeigeht.
  // Ist keine gesetzt, lehnt der Hub ab - dann muss es hier stehen,
  // sonst tippt jemand ins Leere.
  const pinFehlt = !!user?.shared && !data?.state.pin_required;

  const disarm = async (pin?: string) => {
    if (pinFehlt) {
      setPinError(
        'An diesem Gerät braucht das Entschärfen eine PIN. Sie wird unten ' +
          'unter «PIN» gesetzt.'
      );
      return;
    }
    // Mit gesetzter PIN erst das Feld zeigen - der Hub würde ohne PIN
    // ohnehin ablehnen, aber die App soll fragen statt fehlschlagen.
    if (data?.state.pin_required && pin === undefined) {
      setPinAsk(true);
      setPinValue('');
      return;
    }
    tapped();
    setNote(null);
    setPendingMode(null);
    try {
      const response = await fetch(`${settings.url}/api/alarm/disarm`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ pin: pin ?? '' }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        // Falsche PIN & Co.: Feld offen lassen, Fehler dort zeigen.
        setPinError(body.detail ?? `Hub antwortet mit ${response.status}`);
        return;
      }
      setPinAsk(false);
      setPinError(null);
    } catch (err) {
      setPinError(String(err instanceof Error ? err.message : err));
      return;
    }
    load();
  };

  if (error) return <Fehlschlag text={`Alarmanlage nicht abrufbar: ${error}`} onRetry={load} />;
  if (!data) return <Laedt was="Alarmanlage" />;

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
  // Was im Kopf der zugeklappten Sensoren-Karte steht: wie viele Sensoren
  // im gerade gewählten Modus wachen. «0» ist dabei die wichtigste Zahl -
  // eine scharfe Anlage ohne zugeordneten Sensor bewacht nichts.
  const wachen = data.sensors.filter((entry) => entry.modes.includes(tab)).length;
  const sensorenKopf = sensorenStand(tabLabel, wachen);

  // «escalated» zählt zum Filter «Alarm» – siehe lib/eskalation.ts.
  const gefilterterVerlauf = data.history.filter((event) =>
    verlaufPasst(event.kind, historyKind)
  );
  const gezeigterVerlauf = historyAll ? gefilterterVerlauf : gefilterterVerlauf.slice(0, 12);

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
      {/* Dieselbe Einfärbung wie bei der Wohnungstüre: Eine scharfe
          Anlage ist ein Zustand, den man sehen soll, bevor man die Türe
          aufmacht - nicht einer, den man liest. */}
      <Card
        style={styles.card}
        tint={data.state.state !== 'unscharf' ? colors.dangerSoft : undefined}
      >
        <View style={styles.stateHead}>
          {ringAnteil(data.state) != null ? (
            <CountdownRing
              anteil={ringAnteil(data.state)!}
              sekunden={data.state.seconds_left ?? 0}
              farbe={look.color}
            />
          ) : (
            <View style={[styles.lamp, { backgroundColor: look.color }]} />
          )}
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>{look.text}</Text>
            {countdownText(data.state) != null ? (
              <Text style={styles.rowDetail}>{countdownText(data.state)}</Text>
            ) : data.state.last_trigger ? (
              <Text style={styles.rowDetail}>
                Zuletzt ausgelöst: {data.state.last_trigger.name}
              </Text>
            ) : null}
            {data.state.last_trigger?.clip ? (
              <Pressable
                onPress={() => setClip(absolute(data.state.last_trigger!.clip!, settings.url))}
                accessibilityRole="button"
                style={({ pressed }) => [styles.clipRow, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="play-circle-outline" size={18} color={colors.accent} />
                <Text style={styles.clipText}>Mitschnitt ansehen</Text>
              </Pressable>
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
            onPress={() => disarm()}
            accessibilityRole="button"
            style={({ pressed }) => [styles.disarm, pressed && { opacity: 0.85 }]}
          >
            <Text style={styles.disarmText}>Unscharf schalten</Text>
          </Pressable>
        ) : null}

        {pinAsk ? (
          <View style={styles.pinRow}>
            <TextInput
              style={styles.pinInput}
              value={pinValue}
              onChangeText={(text) => {
                setPinValue(text.replace(/[^0-9]/g, ''));
                setPinError(null);
              }}
              placeholder="PIN"
              placeholderTextColor={colors.inkFaint}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
              autoFocus
              onSubmitEditing={() => disarm(pinValue)}
            />
            <Pressable
              onPress={() => disarm(pinValue)}
              disabled={pinValue.length < 4}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.pinConfirm,
                (pressed || pinValue.length < 4) && { opacity: 0.6 },
              ]}
            >
              <Text style={styles.pinConfirmText}>Entschärfen</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                setPinAsk(false);
                setPinError(null);
              }}
              hitSlop={8}
              accessibilityLabel="Abbrechen"
            >
              <Ionicons name="close" size={20} color={colors.inkSoft} />
            </Pressable>
          </View>
        ) : null}
        {pinError ? <Text style={styles.warn}>{pinError}</Text> : null}

        {note ? (
          <>
            <Text style={styles.warn}>{note}</Text>
            {offenBeimScharfschalten.length > 0 && onEntity ? (
              <View style={styles.chipRow}>
                {offenBeimScharfschalten.map((name) => (
                  <Pressable
                    key={name}
                    onPress={() => onEntity(name)}
                    accessibilityRole="button"
                    accessibilityLabel={`${name} in der Geräteliste zeigen`}
                    style={({ pressed }) => [styles.smallButton, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.smallButtonText}>{name} →</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
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

      {/* Sensoren – je Modus einzeln zusammenstellen. Zugeklappt, weil
          die Karte lang ist und man sie einmal einrichtet: Wer die Seite
          öffnet, will fast immer schalten und nicht zuordnen. Wie viele
          Sensoren im gerade gewählten Modus wachen, steht im Kopf - das
          ist die Frage, die man auch ohne Aufklappen hat. */}
      <Card style={styles.card}>
        <Klappe label="Sensoren" stand={sensorenKopf} zuBeginnZu>
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
                // Was für ein Melder ist das? «Balkon» allein sagt es
                // nicht - und genau daran hängt die Entscheidung, die
                // hier getroffen wird: Nachts gehören Türen und Fenster
                // dazu, Bewegungsmelder nicht. Wer die Art nicht sieht,
                // hakt nach Namen ab und rät dabei.
                const art = melderArt(candidate, entities);
                return (
                  <View key={candidate.entity_id} style={styles.sensor}>
                    <Pressable
                      onPress={() => toggleMode(candidate.entity_id, tab)}
                      accessibilityRole="checkbox"
                      accessibilityState={{ checked: on }}
                      accessibilityLabel={`${candidate.name}, ${art.label}`}
                      style={styles.sensorHead}
                    >
                      <Ionicons
                        name={on ? 'checkmark-circle' : 'ellipse-outline'}
                        size={24}
                        color={on ? colors.on : colors.inkFaint}
                      />
                      <View style={{ flex: 1, minWidth: 0 }}>
                        <Text style={styles.rowTitle} numberOfLines={1}>
                          {candidate.name}
                        </Text>
                        <View style={styles.artZeile}>
                          <Ionicons
                            name={art.icon as keyof typeof Ionicons.glyphMap}
                            size={13}
                            color={colors.inkFaint}
                          />
                          <Text style={styles.art} numberOfLines={1}>
                            {art.label}
                          </Text>
                        </View>
                      </View>
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
        </Klappe>
      </Card>

      <EskalationKarte
        raw={data.escalation}
        entities={entities}
        onSave={(escalation) => save({ escalation })}
      />

      <AlarmActions
        actions={data.actions ?? {}}
        entities={entities}
        onSave={(actions) => save({ actions })}
      />

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

      <PinCard
        hub={settings}
        required={!!data.state.pin_required}
        pflicht={pinFehlt}
        alarmSettings={data.settings}
        onSaveSettings={(next) => save({ settings: next })}
        onChanged={load}
      />

      <AlarmSettings
        settings={data.settings}
        images={data.images !== false}
        onSave={(next) => save({ settings: next })}
      />

      {/* Probealarm: Ob Sirene, Lichter und Nachricht überhaupt
          funktionieren, erfährt man sonst beim ersten echten Einbruch. */}
      <Card style={styles.card}>
        <Klappe label="Probealarm">
        <Text style={styles.hint}>
          Spielt einmal durch, was ein Einbruch auslösen würde: Nachricht,
          dann für drei Sekunden die eingestellten Schaltbefehle, dann
          wieder aus. Geht nur bei unscharfer Anlage.
        </Text>
        <Pressable
          onPress={async () => {
            setTestNote(null);
            try {
              const response = await fetch(`${settings.url}/api/alarm/test`, {
                method: 'POST',
                headers,
              });
              const body = await response.json().catch(() => ({}));
              if (!response.ok) {
                throw new Error(body.detail ?? `Hub antwortet mit ${response.status}`);
              }
              setTestNote(String(body.hinweis ?? 'Probealarm durchgespielt.'));
            } catch (err) {
              setTestNote(err instanceof Error ? err.message : String(err));
            }
            load();
          }}
          accessibilityRole="button"
          style={({ pressed }) => [styles.smallButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.smallButtonText}>Jetzt durchspielen</Text>
        </Pressable>
        {testNote ? <Text style={styles.hint}>{testNote}</Text> : null}
        </Klappe>
      </Card>

      {/* Der Verlauf ganz unten und zugeklappt: «Was ist passiert?»
          fragt man selten, und die Karte ist die längste der Seite.
          Die Zahl im Kopf sagt zugeklappt, ob sich das Aufklappen lohnt. */}
      {data.history.length > 0 ? (
        <Card style={styles.card}>
          <Klappe
            label="Verlauf"
            stand={
              data.history.length === 1 ? '1 Eintrag' : `${data.history.length} Einträge`
            }
            zuBeginnZu
          >
            {/* Nach einem Einbruch fragt man «wann war die Anlage unscharf,
                während niemand da war?» – zwölf Zeilen ohne Filter waren
                dafür eine Sackgasse, obwohl der Hub fünfzig aufhebt. */}
            <View style={styles.chipRow}>
              {(
                [
                  ['alle', 'Alles'],
                  ['armed', 'Scharf'],
                  ['disarmed', 'Unscharf'],
                  ['triggered', 'Alarm'],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  onPress={() => setHistoryKind(key)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected: historyKind === key }}
                  style={[styles.smallButton, historyKind === key && styles.tabOn]}
                >
                  <Text
                    style={[
                      styles.smallButtonText,
                      historyKind === key && { color: '#FFFFFF' },
                    ]}
                  >
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            {/* Hinter einem Alarm, einer Eskalation oder einer Bewegung
                steckt eine Geschichte - antippen öffnet das Ereignisblatt
                mit allem aus der Viertelstunde: was schaltete, welche
                Bilder die Kameras sahen, welcher Mitschnitt entstand. */}
            {gezeigterVerlauf.map((event, index) => (
              <Pressable
                key={index}
                onPress={
                  blattWuerdig(event.kind) ? () => setBlattAt(event.at) : undefined
                }
                disabled={!blattWuerdig(event.kind)}
                accessibilityRole={blattWuerdig(event.kind) ? 'button' : undefined}
                style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
              >
                <Ionicons
                  name={
                    event.kind === 'triggered'
                      ? 'alert-circle'
                      : // Die zweite Stufe: Sirene und Licht sind an, weil
                        // niemand entschärft hat. Ein eigenes Symbol, damit
                        // die Zeile nicht wie ein zweiter Alarm aussieht.
                        event.kind === 'escalated'
                        ? 'megaphone-outline'
                        : event.kind === 'armed'
                          ? 'lock-closed-outline'
                          : event.kind === 'entry'
                            ? 'time-outline'
                            : // Kamerabewegung, während scharf war: kein Alarm,
                              // aber der Grund, warum das Telefon gebrummt hat.
                              event.kind === 'motion'
                              ? 'videocam-outline'
                              : 'lock-open-outline'
                  }
                  size={18}
                  color={
                    event.kind === 'triggered' || event.kind === 'escalated'
                      ? colors.danger
                      : colors.inkSoft
                  }
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.rowTitle}>{event.text}</Text>
                  <Text style={styles.rowDetail}>
                    {datumUhr(event.at * 1000)}
                    {event.by ? ` · ${event.by}` : ''}
                  </Text>
                </View>
                {blattWuerdig(event.kind) ? (
                  <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
                ) : null}
              </Pressable>
            ))}
            {gefilterterVerlauf.length > gezeigterVerlauf.length ? (
              <Pressable
                onPress={() => setHistoryAll(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.smallButton, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.smallButtonText}>
                  Alle {gefilterterVerlauf.length} zeigen
                </Text>
              </Pressable>
            ) : null}
          </Klappe>
        </Card>
      ) : null}

      {clip ? <ClipPlayer uri={clip} onClose={() => setClip(null)} /> : null}
      {blattAt != null ? (
        <Ereignisblatt
          at={blattAt}
          settings={settings}
          // Erst das Blatt zu, dann der Player: Zwei native Modals
          // übereinander verträgt iOS nicht verlässlich.
          onClip={(uri) => {
            setBlattAt(null);
            setClip(uri);
          }}
          onClose={() => setBlattAt(null)}
        />
      ) : null}
    </View>
  );
}

/**
 * Der Mitschnitt zum letzten Alarm im Vollbild.
 *
 * Nur ein paar Sekunden lang und nur so lange abrufbar, wie die Adresse
 * gilt – danach ist er weg. Das ist Absicht: Ein Alarmvideo, das für immer
 * herumliegt, ist eine Überwachungsanlage, keine Alarmanlage.
 */
/**
 * Das Ereignisblatt: die Viertelstunde um einen Verlaufs-Eintrag.
 *
 * Bisher brauchte «was war da eigentlich?» vier Orte - den
 * Alarm-Verlauf, den Haus-Rückblick, das Clip-Archiv und die
 * Push-Bilder, die nach zehn Minuten weg waren. Der Hub zieht die
 * Viertelstunde zusammen (/api/alarm/ereignis), das Bild-Archiv
 * (core/bildarchiv.py) hält die Standbilder vom Moment fest, und hier
 * steht alles als eine Zeitleiste.
 */
function Ereignisblatt({
  at,
  settings,
  onClip,
  onClose,
}: {
  at: number;
  settings: HubSettings;
  onClip: (uri: string) => void;
  onClose: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [zeilen, setZeilen] = useState<BlattZeile[] | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);

  useEffect(() => {
    let weg = false;
    hub
      .get<Parameters<typeof blattZeilen>[0]>(`/api/alarm/ereignis?at=${at}`, {
        still: true,
      })
      .then((antwort) => {
        if (!weg) setZeilen(blattZeilen(antwort));
      })
      .catch((err) => {
        if (!weg) setFehler(String(err instanceof Error ? err.message : err));
      });
    return () => {
      weg = true;
    };
  }, [hub, at]);

  const symbol = (zeile: BlattZeile) => {
    if (zeile.art === 'bild') return 'image-outline' as const;
    if (zeile.art === 'clip') return 'play-circle-outline' as const;
    if (zeile.art === 'geraet') return 'flash-outline' as const;
    return zeile.hervor ? ('alert-circle' as const) : ('shield-half-outline' as const);
  };

  return (
    <Modal visible transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.blattGrund} onPress={onClose}>
        {/* Die Karte selbst schluckt den Tipp - zu geht es am Rand. */}
        <Pressable style={styles.blattKarte} onPress={() => {}}>
          <Text style={styles.heading}>Ereignisblatt</Text>
          <Text style={styles.rowDetail}>
            Die Viertelstunde um {datumUhr(at * 1000)}
          </Text>
          {fehler ? <Text style={styles.blattFehler}>{fehler}</Text> : null}
          {zeilen === null && !fehler ? (
            <Text style={styles.rowDetail}>Wird zusammengetragen …</Text>
          ) : null}
          <ScrollView
            style={{ maxHeight: 460 }}
            contentContainerStyle={{ gap: 10, paddingBottom: 4 }}
          >
            {zeilen?.length === 0 ? (
              <Text style={styles.rowDetail}>
                Aus dieser Viertelstunde ist nichts (mehr) da - Bilder und
                Mitschnitte werden nach der eingestellten Frist weggeräumt.
              </Text>
            ) : null}
            {(zeilen ?? []).map((zeile, index) => (
              <View key={index} style={{ gap: 6 }}>
                <Pressable
                  disabled={zeile.art !== 'clip'}
                  onPress={
                    zeile.art === 'clip' && zeile.clipId
                      ? () =>
                          onClip(
                            `${settings.url.replace(/\/+$/, '')}/api/clips/${encodeURIComponent(String(zeile.clipId))}?token=${encodeURIComponent(settings.token)}`
                          )
                      : undefined
                  }
                  accessibilityRole={zeile.art === 'clip' ? 'button' : undefined}
                  style={({ pressed }) => [styles.row, pressed && { opacity: 0.7 }]}
                >
                  <Ionicons
                    name={symbol(zeile)}
                    size={18}
                    color={zeile.hervor ? colors.danger : colors.inkSoft}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.rowTitle}>{zeile.titel}</Text>
                    <Text style={styles.rowDetail}>
                      {datumUhr(zeile.at * 1000)}
                      {zeile.unter ? ` · ${zeile.unter}` : ''}
                    </Text>
                  </View>
                </Pressable>
                {zeile.art === 'bild' && zeile.kennung ? (
                  <Image
                    source={{
                      uri: `${settings.url.replace(/\/+$/, '')}/api/alarm/bild/${encodeURIComponent(zeile.kennung)}?token=${encodeURIComponent(settings.token)}`,
                    }}
                    style={styles.blattBild}
                    resizeMode="cover"
                    accessibilityLabel={`Bild von ${zeile.titel}`}
                  />
                ) : null}
              </View>
            ))}
          </ScrollView>
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            style={({ pressed }) => [styles.smallButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.smallButtonText}>Schliessen</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

function ClipPlayer({ uri, onClose }: { uri: string; onClose: () => void }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = true;
    instance.play();
  });

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onClose}>
      <Pressable style={styles.clipBackdrop} onPress={onClose}>
        <VideoView
          player={player}
          style={styles.clipVideo}
          nativeControls
          contentFit="contain"
        />
        <Text style={styles.clipHint}>
          Tippen zum Schliessen. Der Mitschnitt läuft nach wenigen Minuten ab.
        </Text>
      </Pressable>
    </Modal>
  );
}

/**
 * Die Eskalation: Sirene, Licht und Durchsage, wenn niemand entschärft
 * (Punkt 255 der Werkbank).
 *
 * Eigene Karte neben «Was die Anlage selbst schaltet», weil es eine
 * andere Frage ist: Dort steht, was *sofort* beim Auslösen passiert –
 * hier, was erst nach einer Frist kommt. Die Frist ist der Kern: In ihr
 * lässt sich ein Fehlalarm noch entschärfen, bevor die Sirene die
 * Nachbarschaft weckt.
 *
 * Auf Modulebene wie AfterTrigger, damit die Textfelder beim Tippen
 * nicht neu montiert werden. Gelesen und normalisiert wird in
 * lib/eskalation.ts.
 */
function EskalationKarte({
  raw,
  entities,
  onSave,
}: {
  raw: unknown;
  entities: Entity[];
  onSave: (next: Eskalation) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const eskalation = useMemo(() => eskalationLesen(raw), [raw]);
  // Textfelder lokal, Übernahme beim Verlassen – wie bei den
  // Verzögerungen: Jeder Tastendruck als PUT wäre ein Dauerfeuer.
  const [announce, setAnnounce] = useState(eskalation.announce);
  const [volume, setVolume] = useState(
    eskalation.volume == null ? '' : String(eskalation.volume)
  );
  const kandidaten = useMemo(() => sirenenKandidaten(entities), [entities]);

  const commitTexte = () =>
    onSave({
      ...eskalation,
      announce: announce.trim(),
      // Leer heisst «Vorgabe des Hubs», nicht «stumm».
      volume: volume.trim() === '' ? null : Math.max(0, Math.min(100, Number(volume) || 0)),
    });

  const toggleSirene = (entityId: string) => {
    const sirens = eskalation.sirens.includes(entityId)
      ? eskalation.sirens.filter((id) => id !== entityId)
      : [...eskalation.sirens, entityId];
    onSave({ ...eskalation, sirens });
  };

  return (
    <Card style={styles.card}>
      <Klappe label="Eskalation" stand={eskalationStand(eskalation)} zuBeginnZu>
        <Text style={styles.hint}>
          Die zweite Stufe nach dem Auslösen: Erst geht nur die Nachricht
          hinaus – wer dann innerhalb der Frist nicht entschärft, bekommt
          Sirene, Licht und Durchsage. Die Frist gibt es, damit ein
          Fehlalarm noch entschärfbar ist, bevor die Nachbarschaft wach
          wird.
        </Text>

        <Toggle
          label="Eskalation einschalten"
          detail="Ohne sie bleibt es bei Nachricht und den Schaltbefehlen von «Beim Auslösen»."
          value={eskalation.enabled}
          onChange={(value) => onSave({ ...eskalation, enabled: value })}
        />

        {eskalation.enabled ? (
          <>
            <View style={styles.field}>
              <Text style={styles.label}>Frist bis zur Eskalation</Text>
              <View style={styles.chipRow}>
                {FRIST_STUFEN.map((sekunden) => {
                  const on = eskalation.after === sekunden;
                  return (
                    <Pressable
                      key={sekunden}
                      onPress={() => onSave({ ...eskalation, after: sekunden })}
                      accessibilityRole="radio"
                      accessibilityState={{ selected: on }}
                      accessibilityLabel={`Eskalation ${fristLabel(sekunden)} nach dem Auslösen`}
                      style={({ pressed }) => [
                        styles.chip,
                        on && styles.chipOn,
                        pressed && { opacity: 0.7 },
                      ]}
                    >
                      <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>
                        {fristLabel(sekunden)}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Sirenen</Text>
              {kandidaten.length === 0 ? (
                <Text style={styles.hint}>
                  Kein schaltbares Gerät gefunden, das als Sirene taugt.
                  Sirenen und Schalter erscheinen hier automatisch.
                </Text>
              ) : (
                <View style={styles.chipRow}>
                  {kandidaten.map((entity) => {
                    const on = eskalation.sirens.includes(entity.id);
                    return (
                      <Pressable
                        key={entity.id}
                        onPress={() => toggleSirene(entity.id)}
                        accessibilityRole="checkbox"
                        accessibilityState={{ checked: on }}
                        accessibilityLabel={`${entity.name} als Sirene einschalten`}
                        style={({ pressed }) => [
                          styles.chip,
                          on && styles.chipOn,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Text style={[styles.chipText, on && { color: '#FFFFFF' }]}>
                          {entity.name}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
              )}
            </View>

            <Toggle
              label="Alle Lichter einschalten"
              detail="Einbrecher mögen kein Rampenlicht – und wer nachschauen geht, keinen dunklen Flur. Beim Entschärfen gehen nur die Sirenen wieder aus."
              value={eskalation.all_lights}
              onChange={(value) => onSave({ ...eskalation, all_lights: value })}
            />

            <View style={styles.field}>
              <Text style={styles.label}>Durchsage auf die Boxen</Text>
              <TextInput
                style={styles.input}
                value={announce}
                onChangeText={setAnnounce}
                onBlur={commitTexte}
                placeholder="Leer lassen für keine Durchsage"
                placeholderTextColor={colors.inkFaint}
                accessibilityLabel="Text der Eskalations-Durchsage"
              />
            </View>

            <View style={styles.field}>
              <Text style={styles.label}>Lautstärke der Durchsage (0–100)</Text>
              <TextInput
                style={styles.input}
                value={volume}
                onChangeText={(text) => setVolume(text.replace(/[^0-9]/g, ''))}
                onBlur={commitTexte}
                keyboardType="number-pad"
                maxLength={3}
                placeholder="Vorgabe"
                placeholderTextColor={colors.inkFaint}
                accessibilityLabel="Lautstärke der Eskalations-Durchsage"
              />
            </View>

            {eskalationStand(eskalation) === 'an, aber ohne Wirkung' ? (
              <Text style={styles.warn}>
                Eingeschaltet, aber ohne Sirene, Licht und Durchsage tut die
                Eskalation nichts – oben etwas auswählen.
              </Text>
            ) : null}
          </>
        ) : null}
      </Klappe>
    </Card>
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
      <Klappe label="Nach einem Alarm">
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
      </Klappe>
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
/** Anlässe, zu denen die Anlage selbst schaltet. */
const SLOTS = [
  {
    key: 'trigger',
    label: 'Beim Auslösen',
    hint: 'Sirene, alle Lichter, Storen hoch. Eine Nachricht informiert nur – erst Lärm und Licht vertreiben jemanden.',
  },
  {
    key: 'warning',
    label: 'Beim Hereinkommen',
    hint: 'Kurzes Zeichen, während die Eingangsverzögerung läuft. Sagt dem Berechtigten «schalt mich ab» – und dem Unberechtigten, dass die Uhr tickt.',
  },
  {
    key: 'clear',
    label: 'Beim Unscharfschalten',
    hint: 'Hier gehört zurückgenommen, was oben eingeschaltet wurde – sonst heult die Sirene weiter, obwohl die Anlage aus ist.',
  },
];

/**
 * Was die Anlage selbst schaltet.
 *
 * Bewusst hier und nicht in einem Ablauf: Eine Alarmanlage, die nur eine
 * Nachricht schickt, informiert bloss. Und wer den Alarm in einen Ablauf
 * auslagert, hat ihn beim nächsten Aufräumen versehentlich abgeschaltet.
 */
function AlarmActions({
  actions,
  entities,
  onSave,
}: {
  actions: Record<string, AlarmAction[]>;
  entities: Entity[];
  onSave: (actions: Record<string, AlarmAction[]>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Nur, was sich überhaupt schalten lässt.
  const schaltbar = entities.filter(
    (entity) =>
      entity.commands.includes('turn_on') ||
      entity.commands.includes('open') ||
      entity.commands.includes('close')
  );

  const toggle = (slot: string, entity: Entity, command: string) => {
    const current = actions[slot] ?? [];
    const found = current.find(
      (entry) => entry.entity_id === entity.id && entry.command === command
    );
    onSave({
      ...actions,
      [slot]: found
        ? current.filter((entry) => entry !== found)
        : [...current, { entity_id: entity.id, command }],
    });
  };

  if (schaltbar.length === 0) return null;

  return (
    <Card style={styles.card}>
      <Klappe label="Was die Anlage selbst schaltet">
      {SLOTS.map((slot) => {
        const chosen = actions[slot.key] ?? [];
        return (
          <View key={slot.key} style={styles.field}>
            <Text style={styles.label}>{slot.label}</Text>
            <Text style={styles.hint}>{slot.hint}</Text>
            <View style={styles.actionWrap}>
              {schaltbar.map((entity) => {
                const einCommand = entity.commands.includes('turn_on') ? 'turn_on' : 'open';
                const ausCommand = entity.commands.includes('turn_off') ? 'turn_off' : 'close';
                const an = chosen.some(
                  (entry) => entry.entity_id === entity.id && entry.command === einCommand
                );
                const aus = chosen.some(
                  (entry) => entry.entity_id === entity.id && entry.command === ausCommand
                );
                return (
                  <View key={entity.id} style={styles.actionRow}>
                    <Text style={styles.actionName} numberOfLines={1}>
                      {entity.name}
                    </Text>
                    <Pressable
                      onPress={() => toggle(slot.key, entity, einCommand)}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: an }}
                      style={[styles.actionChip, an && styles.actionChipOn]}
                    >
                      <Text style={[styles.actionChipText, an && styles.actionChipTextOn]}>
                        {einCommand === 'open' ? 'auf' : 'an'}
                      </Text>
                    </Pressable>
                    <Pressable
                      onPress={() => toggle(slot.key, entity, ausCommand)}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: aus }}
                      style={[styles.actionChip, aus && styles.actionChipOn]}
                    >
                      <Text style={[styles.actionChipText, aus && styles.actionChipTextOn]}>
                        {ausCommand === 'close' ? 'zu' : 'aus'}
                      </Text>
                    </Pressable>
                  </View>
                );
              })}
            </View>
          </View>
        );
      })}
      </Klappe>
    </Card>
  );
}

function AlarmSettings({
  settings,
  images,
  onSave,
}: {
  settings: AlarmConfig;
  /** Ob der Hub Bilder mitschicken kann (push.public_url gesetzt). */
  images: boolean;
  onSave: (settings: AlarmConfig) => void;
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
      <Klappe label="Einstellungen">

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
      <Toggle
        label="Push, wenn eine Kamera Bewegung sieht"
        detail={
          images
            ? 'Solange die Anlage scharf ist – mit Standbild. Ein Tipp auf die Nachricht öffnet die Kamera. Auch für Kameras, die kein Alarmsensor sind.'
            : 'Solange die Anlage scharf ist. Ein Tipp auf die Nachricht öffnet die Kamera.'
        }
        value={settings.notify_camera_motion !== false}
        onChange={(value) => onSave({ ...settings, notify_camera_motion: value })}
      />
      {/* Der Fall, für den es den Schalter gibt: Das Haus schickt beim
          Weggehen den Sauger los und schaltet die Anlage scharf. Der
          erste Bewegungsmelder sieht ihn - und die Sirene geht. */}
      <Toggle
        label="Bewegungsmelder ruhen, solange der Sauger fährt"
        detail="Fenster- und Türkontakte bleiben scharf – ein Sauger öffnet kein Fenster. Nach der Rückkehr gilt es noch fünf Minuten, weil Melder ihre Meldung so lange halten."
        value={settings.ignore_vacuum !== false}
        onChange={(value) => onSave({ ...settings, ignore_vacuum: value })}
      />
      {/* Was auch dann auslöst: Ein Saugroboter ist keine Person und
          kein Tier, und die Kamera weiss das. Nur Kameras mit
          Erkennung (UniFi Protect) - eine, die bloss Bewegung meldet,
          kann den Unterschied nicht sehen. */}
      {settings.ignore_vacuum !== false ? (
        <View style={styles.field}>
          <Text style={styles.label}>Löst trotzdem aus</Text>
          <View style={styles.chipRow}>
            {DURCHBRUCH.map((eintrag) => {
              const gewaehlt = durchbruchAn(settings.vacuum_detections, eintrag.key);
              return (
                <Pressable
                  key={eintrag.key}
                  onPress={() =>
                    onSave({
                      ...settings,
                      vacuum_detections: durchbruchUmschalten(
                        settings.vacuum_detections,
                        eintrag.key,
                      ),
                    })
                  }
                  accessibilityRole="checkbox"
                  accessibilityState={{ checked: gewaehlt }}
                  accessibilityLabel={`${eintrag.label} löst während der Saugerfahrt aus`}
                  style={({ pressed }) => [
                    styles.chip,
                    gewaehlt && styles.chipOn,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text style={[styles.chipText, gewaehlt && { color: '#FFFFFF' }]}>
                    {eintrag.label}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.hint}>
            Erkennt die Kamera eine Person oder ein Tier, geht die Sirene auch
            mitten in der Reinigung los. Braucht eine Kamera mit Erkennung
            (UniFi Protect) – eine, die nur Bewegung meldet, kann den Sauger
            nicht von jemandem unterscheiden und bleibt so lange still.
          </Text>
        </View>
      ) : null}
      {settings.notify_camera_motion !== false && !images ? (
        <Text style={styles.hint}>
          Ohne «push.public_url» in der config.yaml des Hubs kommt die
          Nachricht ohne Bild: Das Telefon zeigt sie an, bevor die App läuft,
          und kann sie deshalb nicht mit Anmeldung nachladen. Die Kamera
          öffnet sich beim Antippen trotzdem.
        </Text>
      ) : null}
      </Klappe>
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

/** PIN fürs Entschärfen: setzen, ändern, entfernen (nur Besitzer).
 *
 * Die Anlage lässt sich aus der App entschärfen, sobald das Telefon
 * entsperrt ist - die PIN schützt, falls es offen herumliegt. Sie gilt
 * für alles, was jemand *antippt*: App, Wandtablet, Szene, Karte.
 *
 * Hier stand einmal «gilt überall, auch für Abläufe: eine Hintertür
 * wäre keine PIN». Das klang richtig und war es nicht: Ein Ablauf hat
 * keine Tastatur. Die Anlage schaltete sich bei der Heimkehr nicht mehr
 * ab, weil der Ablauf still an der fehlenden PIN scheiterte - und
 * niemand sah, warum. Jetzt dürfen Abläufe entschärfen, und wer das
 * nicht will, legt den Schalter darunter um (siehe
 * alarm_rules.ohne_pin_erlaubt im Hub). */
function PinCard({
  hub,
  required,
  pflicht = false,
  alarmSettings,
  onSaveSettings,
  onChanged,
}: {
  hub: HubSettings;
  required: boolean;
  /** Dieses Gerät braucht eine PIN, es ist aber keine gesetzt. */
  pflicht?: boolean;
  /** Die Einstellungen der Anlage - für den Ablauf-Schalter unten. Er
   *  steht hier und nicht bei den übrigen Einstellungen: Er ergibt nur
   *  Sinn, solange eine PIN gesetzt ist, und die setzt man hier. */
  alarmSettings: Record<string, unknown>;
  onSaveSettings: (next: Record<string, unknown>) => void;
  onChanged: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [value, setValue] = useState('');
  const [note, setNote] = useState<string | null>(null);

  const submit = async (pin: string) => {
    setNote(null);
    try {
      const response = await fetch(`${hub.url}/api/alarm/pin`, {
        method: 'PUT',
        headers: {
          ...(hub.token ? { Authorization: `Bearer ${hub.token}` } : {}),
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ pin }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail ?? `Hub antwortet mit ${response.status}`);
      setValue('');
      setNote(pin ? 'PIN gesetzt.' : 'PIN entfernt.');
      onChanged();
    } catch (err) {
      setNote(String(err instanceof Error ? err.message : err));
    }
  };

  return (
    <Card style={styles.card}>
      <Klappe label="PIN fürs Entschärfen" stand={required ? 'gesetzt' : 'keine'}>
      <Text style={[styles.rowDetail, pflicht && styles.warn]}>
        {required
          ? 'Eine PIN ist gesetzt - Entschärfen geht nur noch mit ihr, auch aus Szenen und von Karten. Abläufe sind ausgenommen, siehe unten.'
          : pflicht
            ? 'Dieses Gerät gehört allen und hängt offen im Raum - hier geht Entschärfen nur mit PIN. Solange keine gesetzt ist, lässt sich die Anlage von hier aus nicht ausschalten. 4 bis 8 Ziffern.'
            : 'Ohne PIN kann jeder mit entsperrtem Telefon die Anlage entschärfen. 4 bis 8 Ziffern.'}
      </Text>
      <View style={styles.pinRow}>
        <TextInput
          style={styles.pinInput}
          value={value}
          onChangeText={(text) => setValue(text.replace(/[^0-9]/g, ''))}
          placeholder={required ? 'Neue PIN' : 'PIN wählen'}
          placeholderTextColor={colors.inkFaint}
          keyboardType="number-pad"
          secureTextEntry
          maxLength={8}
        />
        <Pressable
          onPress={() => submit(value)}
          disabled={value.length < 4}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.pinConfirm,
            (pressed || value.length < 4) && { opacity: 0.6 },
          ]}
        >
          <Text style={styles.pinConfirmText}>{required ? 'Ändern' : 'Setzen'}</Text>
        </Pressable>
        {required ? (
          <Pressable
            onPress={() => submit('')}
            accessibilityRole="button"
            style={({ pressed }) => [styles.pinRemove, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.pinRemoveText}>Entfernen</Text>
          </Pressable>
        ) : null}
      </View>
      {note ? <Text style={styles.rowDetail}>{note}</Text> : null}

      {/* Der Fall, für den es diesen Schalter gibt: Die Anlage schaltete
          sich bei der Heimkehr nicht mehr ab. Der Ablauf war
          unverändert - nur war inzwischen eine PIN gesetzt, und er hat
          keine Tastatur. Nur sichtbar, solange eine PIN gesetzt ist:
          Ohne sie entschärft ohnehin jeder Ablauf. */}
      {required ? (
        <Toggle
          label="Abläufe dürfen ohne PIN entschärfen"
          detail={
            'Für «komme nach Hause → Anlage aus». Ein Ablauf hat keine ' +
            'Tastatur; ohne diesen Schalter bleibt die Anlage scharf. Wer ' +
            'ihn ausschaltet, muss von Hand entschärfen. Szenen und ' +
            'Karten brauchen die PIN in jedem Fall.'
          }
          value={alarmSettings.automation_disarm !== false}
          onChange={(value) =>
            onSaveSettings({ ...alarmSettings, automation_disarm: value })
          }
        />
      ) : null}
      </Klappe>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: space.gap },
    card: { minHeight: 0, gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    note: { color: colors.onGradientSoft, fontSize: 14, marginTop: 20 },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    clipRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 6 },
    // Das Ereignisblatt: eine Karte über abgedunkeltem Grund - wie der
    // Player, nur hell genug zum Lesen.
    blattGrund: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    blattKarte: {
      width: '100%',
      maxWidth: 520,
      borderRadius: radius.card,
      backgroundColor: colors.panel,
      padding: 18,
      gap: 10,
    },
    blattBild: {
      width: '100%',
      height: 190,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
    },
    blattFehler: { color: colors.danger, fontSize: 13 },
    clipBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.92)',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 12,
      padding: 16,
    },
    clipVideo: { width: '100%', maxWidth: 900, aspectRatio: 16 / 9 },
    clipHint: { color: '#B9C2D0', fontSize: 12 },
    clipText: { color: colors.accent, fontSize: 13, fontWeight: '700' },
    actionWrap: { gap: 6, marginTop: 4 },
    actionRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    actionName: { color: colors.ink, fontSize: 14, flex: 1 },
    actionChip: {
      paddingVertical: 5,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    actionChipOn: { backgroundColor: colors.accent, borderColor: colors.accent },
    actionChipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    actionChipTextOn: { color: '#FFFFFF' },
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
    pinRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    pinInput: {
      flex: 1,
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 16,
      letterSpacing: 4,
    },
    pinConfirm: {
      paddingVertical: 11,
      paddingHorizontal: 16,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    pinConfirmText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    pinRemove: {
      paddingVertical: 11,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    pinRemoveText: { color: colors.inkSoft, fontSize: 14, fontWeight: '600' },
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
    /** Die Art unter dem Namen - leise, aber vorhanden. Sie beantwortet
     *  die Frage, die der Name offen lässt: «Balkon» kann der
     *  Bewegungsmelder auf dem Balkon sein oder der Kontakt an seiner
     *  Türe, und nachts gehört nur das eine dazu. */
    artZeile: { flexDirection: 'row', alignItems: 'center', gap: 4, marginTop: 1 },
    art: { color: colors.inkFaint, fontSize: 12, flexShrink: 1 },
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
