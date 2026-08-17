import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity, Scene } from '../api/types';
import { SpotifyPanel } from '../components/EntityCard';
import { Card } from '../components/Card';
import { Colors, radius, space, useColors } from '../theme';

/**
 * Startseite: Überblick über die Wohnung statt aller Geräte.
 *
 * Jeder Platz (Türen, Haushalt, Termine, Musik …) zeigt das passende echte
 * Gerät, sobald es eingebunden ist. Fehlt die Integration noch, steht eine
 * Demo-Kachel da – erkennbar am „Demo“-Etikett, aber bedienbar, damit das
 * Layout schon stimmt.
 */

interface Props {
  entities: Entity[];
  scenes: Scene[];
  now: Date;
  pending: Record<string, boolean>;
  wide: boolean;
  onCommand: (entityId: string, command: string, data?: Record<string, any>) => void;
  onActivateScene: (sceneId: string) => void;
  /** Auf der Startseite markierte Countdowns (aus dem Familie-Modul). */
  countdowns?: { text: string; date: string; on_start?: boolean }[];
  /** Strompreis für die Energie-Kachel, z.B. 0.32 CHF/kWh. */
  pricePerKwh?: number;
  currency?: string;
  /** Anwesenheit je Person – wer gerade daheim ist. */
  presence?: { id?: string; member: string; home: boolean }[];
  members?: string[];
  onSetPresence?: (member: string, home: boolean) => void;
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

const SHORT_DAYS = ['So', 'Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa'];

/** «2026-08-18» → «Di» (rein, testbar). Heute/Morgen werden benannt. */
function shortDay(iso: string): string {
  const date = new Date(`${iso}T12:00:00`);
  if (Number.isNaN(date.getTime())) return iso;
  const today = new Date();
  const diff = Math.round(
    (date.setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000
  );
  if (diff === 0) return 'Heute';
  if (diff === 1) return 'Morgen';
  return SHORT_DAYS[new Date(`${iso}T12:00:00`).getDay()];
}

/** Erstes Gerät, das auf Art und (optional) Namensmuster passt. */
function pick(
  entities: Entity[],
  kind: string,
  pattern?: RegExp,
  integration?: string
): Entity | undefined {
  return entities.find(
    (entity) =>
      entity.kind === kind &&
      (!integration || entity.integration === integration) &&
      (!pattern || pattern.test(entity.name))
  );
}

export function OverviewScreen({
  entities,
  scenes,
  now,
  pending,
  wide,
  onCommand,
  onActivateScene,
  countdowns,
  pricePerKwh,
  currency = 'CHF',
  presence = [],
  members = [],
  onSetPresence,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Personenliste fürs Anwesenheits-Kachel: bekannte Benutzer plus alle, die
  // schon einen Anwesenheits-Eintrag haben. Doppelte raus.
  const presenceOf = (name: string) =>
    presence.find((entry) => entry.member === name)?.home ?? false;
  const people = Array.from(
    new Set([...members, ...presence.map((entry) => entry.member)])
  ).sort((a, b) => a.localeCompare(b));

  // ── Echte Geräte, wo vorhanden ─────────────────────────────────────────
  const frontDoor = pick(entities, 'lock', undefined, 'ring');
  const flatDoor =
    pick(entities, 'lock', /nuki|wohnung/i) ??
    entities.find((e) => e.integration === 'nuki' && e.kind === 'lock');
  const dishwasher = pick(entities, 'appliance', /geschirr/i);
  const washer = pick(entities, 'appliance', /wasch/i);
  const tumbler = entities.find(
    (e) => /tumbler|trockner/i.test(e.name) && typeof e.state.power === 'number'
  );
  const calendar = entities.find((e) => e.kind === 'calendar');
  const weather = entities.find((e) => e.kind === 'weather');
  const alert = entities.find((e) => e.kind === 'alert' && e.state.state === 'alert');
  const alarm = entities.find((e) => /alarm/i.test(e.name) && e.kind === 'switch');
  const players = entities.filter((e) => e.kind === 'media_player');
  // Spielt irgendwo Musik, zeigt die Kachel diesen Player; sonst Spotify
  // (Playlists + Boxen-Wahl) vor einer stillen Cast-Box.
  const player =
    players.find((e) => e.state.state === 'playing') ??
    players.find((e) => e.commands.includes('play_playlist')) ??
    players[0];
  const covers = entities.filter((e) => e.kind === 'cover');

  // Wetter-Vorhersage: die nächsten drei Tage (heute überspringen).
  const forecastDays: any[] = Array.isArray(weather?.state.days) ? weather!.state.days : [];
  const next3 = forecastDays.slice(1, 4);

  // Energie: aktuelle Gesamtleistung aller messenden Geräte plus Kosten/Stunde.
  const powerDevices = entities.filter((e) => typeof e.state.power === 'number');
  const totalWatts = Math.round(
    powerDevices.reduce((sum, e) => sum + Number(e.state.power ?? 0), 0)
  );
  const costPerHour =
    pricePerKwh != null ? (totalWatts / 1000) * pricePerKwh : null;
  const topConsumer = powerDevices
    .slice()
    .sort((a, b) => Number(b.state.power ?? 0) - Number(a.state.power ?? 0))[0];

  // Nachtmodus: Storen zu, Lichter aus, Wohnungstür abschliessen.
  const lights = entities.filter(
    (e) => e.kind === 'light' || (e.kind === 'switch' && e.commands.includes('turn_off'))
  );
  const nightScene = scenes.find((scene) => /nacht|schlaf/i.test(scene.name));
  const activateNight = () => {
    if (nightScene) {
      onActivateScene(nightScene.id);
      return;
    }
    covers.forEach((c) => onCommand(c.id, 'close'));
    lights.forEach((l) => onCommand(l.id, 'turn_off'));
    if (flatDoor) onCommand(flatDoor.id, 'lock');
  };

  // Schnellaktionen: alle im Szenen-Editor für die Startseite markierten
  // Szenen. Solange keine markiert ist, springen «Kino» und «Schlafen»
  // (per Namenserkennung) ein, damit die Knöpfe nicht leer starten.
  const flagged = scenes.filter((scene) => scene.on_start);
  const fallback = [
    scenes.find((scene) => /kino/i.test(scene.name)),
    scenes.find((scene) => /schlaf/i.test(scene.name)),
  ].filter(Boolean) as typeof scenes;
  const startScenes = flagged.length > 0 ? flagged : fallback;

  // Nächster auf der Startseite markierter Countdown (TT.MM.JJJJ → Tage).
  const countdown = useMemo(() => {
    const parse = (value: string): number | null => {
      const match = /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/.exec(String(value).trim());
      if (!match) return null;
      const target = new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
      return Math.ceil((target.getTime() - Date.now()) / 86_400_000);
    };
    const shown = (countdowns ?? [])
      .filter((entry) => entry.on_start)
      .map((entry) => ({ ...entry, days: parse(entry.date) }))
      .sort((a, b) => (a.days ?? 1e9) - (b.days ?? 1e9));
    return shown[0] ?? null;
  }, [countdowns]);

  // ── Demo-Zustände für noch nicht eingebundene Geräte ───────────────────
  const [demoFlatLocked, setDemoFlatLocked] = useState(true);
  const [demoAlarmArmed, setDemoAlarmArmed] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  /** Zwei-Schritt-Bestätigung: erster Tipp fragt, zweiter führt aus. */
  const confirmThen = (key: string, action: () => void) => {
    if (confirm === key) {
      setConfirm(null);
      action();
    } else {
      setConfirm(key);
      setTimeout(() => setConfirm((c) => (c === key ? null : c)), 4000);
    }
  };

  const tileWidth = wide ? ('31.5%' as const) : ('48%' as const);
  const morningFirst = now.getHours() >= 5 && now.getHours() < 11;

  // Bausteine stehen auf Modulebene (unten) – innerhalb der Komponente
  // definiert würden sie bei jedem Live-Update neu erzeugt und laufende
  // Berührungen abgebrochen.

  const applianceState = (entity: Entity | undefined, demoText: string) => {
    if (!entity) return { text: demoText, running: /läuft|trocknen/i.test(demoText) };
    const value = String(entity.state.state ?? '');
    const program = entity.state.program ? ` · ${entity.state.program}` : '';
    const minutes =
      entity.state.minutes_left != null ? ` · noch ${entity.state.minutes_left} min` : '';
    const running = value === 'running' || value === 'on';
    return {
      text: (running ? 'Läuft' : value === 'idle' || value === 'off' ? 'Bereit' : value) + program + minutes,
      running,
    };
  };

  const dish = applianceState(dishwasher, 'Bereit');
  const wash = applianceState(washer, 'Läuft · noch 32 min');
  // Der Tumbler hängt an einer Schalt-Messsteckdose: Ob er läuft, verrät
  // erst die Leistung – eingeschaltet ist die Steckdose auch danach noch.
  const tumblerWatts = tumbler ? Number(tumbler.state.power ?? 0) : 1450;
  const tumblerOff = tumbler ? String(tumbler.state.state) === 'off' : false;
  const tumblerRunning = !tumblerOff && tumblerWatts > 5;
  const tumblerText = tumblerOff
    ? 'Steckdose aus'
    : tumblerRunning
      ? 'Am Trocknen'
      : 'Fertig';

  // Kalender: nächster Termin und – als eigener Platz – nächster Geburtstag.
  const events: any[] = Array.isArray(calendar?.state.events) ? calendar!.state.events : [];
  const isBirthday = (event: any) =>
    event.birthday || /geburtstag|birthday/i.test(event.summary ?? '');
  const birthday = events.find(isBirthday);
  const nextEvent = events.find((event) => !isBirthday(event));

  const eventLine = (event: any | undefined, demoText: string, demoWhen: string) => {
    if (!calendar) return { title: demoText, when: demoWhen, demo: true };
    if (!event) return { title: 'Nichts geplant', when: '', demo: false };
    const when = event.all_day
      ? 'ganztägig'
      : new Date(event.start).toLocaleString('de-CH', {
          weekday: 'short',
          hour: '2-digit',
          minute: '2-digit',
        });
    return { title: event.summary ?? '—', when, demo: false };
  };

  const termin = eventLine(nextEvent, 'Zahnarzt', 'Mo 14:30');
  const geburtstag = birthday
    ? eventLine(birthday, '', '')
    : { title: 'Livia', when: 'in 12 Tagen', demo: true };

  // ── Anzeige ────────────────────────────────────────────────────────────

  return (
    <View style={styles.stack}>
      {/* Kopf: Uhr, Datum, Wetter, Warnung */}
      <View style={styles.headRow}>
        <Card style={styles.clockCard}>
          <Text style={styles.clock}>
            {two(now.getHours())}:{two(now.getMinutes())}
          </Text>
          <Text style={styles.date}>
            {WEEKDAYS[now.getDay()]}, {now.getDate()}. {MONTHS[now.getMonth()]}
          </Text>
        </Card>
        <Card style={styles.weatherCard}>
          {weather ? (
            <>
              <View style={styles.weatherNow}>
                <Ionicons
                  name={(weather.state.icon as any) ?? 'cloud-outline'}
                  size={34}
                  color={colors.ink}
                />
                <Text style={styles.weatherTemp}>
                  {weather.state.temperature != null ? `${weather.state.temperature}°` : '–'}
                </Text>
              </View>
              <Text style={styles.weatherText} numberOfLines={1}>
                {String(weather.state.state ?? '')} · {weather.name}
              </Text>
            </>
          ) : (
            <>
              <View style={styles.weatherNow}>
                <Ionicons name="partly-sunny-outline" size={34} color={colors.ink} />
                <Text style={styles.weatherTemp}>21°</Text>
              </View>
              <Text style={styles.weatherText}>Leicht bewölkt · Demo</Text>
            </>
          )}
          {alert ? (
            <View style={styles.alertRow}>
              <Ionicons name="warning" size={14} color={colors.danger} />
              <Text style={styles.alertText} numberOfLines={1}>
                {String(alert.state.headline ?? alert.state.event ?? 'Wetterwarnung')}
              </Text>
            </View>
          ) : null}
        </Card>
      </View>

      {/* Schnellaktionen */}
      <View style={styles.quickRow}>
        {startScenes.map((scene) => (
          <Action styles={styles}
            key={scene.id}
            label={scene.name}
            icon={sceneIcon(scene)}
            accent
            onPress={() => onActivateScene(scene.id)}
          />
        ))}
        <Action styles={styles}
          label="Storen hoch"
          icon="arrow-up-outline"
          onPress={() => covers.forEach((c) => onCommand(c.id, 'open'))}
          disabled={covers.length === 0}
        />
        <Action styles={styles}
          label="Storen runter"
          icon="arrow-down-outline"
          onPress={() => covers.forEach((c) => onCommand(c.id, 'close'))}
          disabled={covers.length === 0}
        />
      </View>
      {startScenes.length === 0 ? (
        <Text style={styles.hintLine}>
          Szenen wie «Kino» oder «Schlafen» unter Abläufe anlegen und dort
          «Als Schnellaktion anzeigen» wählen – dann erscheinen sie hier.
        </Text>
      ) : null}

      {/* Übersicht: Wettervorhersage, aktueller Verbrauch, Nachtmodus */}
      <Text style={styles.groupLabel}>Übersicht</Text>
      {next3.length > 0 ? (
        <Card style={styles.forecastCard}>
          <View style={styles.tileHead}>
            <Ionicons name="calendar-clear-outline" size={18} color={colors.inkSoft} />
            <Text style={styles.tileTitle}>Wetter · nächste Tage</Text>
          </View>
          <View style={styles.forecastRow}>
            {next3.map((day) => (
              <View key={day.date} style={styles.forecastDay}>
                <Text style={styles.forecastName}>{shortDay(day.date)}</Text>
                <Ionicons
                  name={(day.icon as any) ?? 'cloud-outline'}
                  size={24}
                  color={colors.ink}
                />
                <Text style={styles.forecastHigh}>
                  {day.high != null ? `${day.high}°` : '–'}
                </Text>
                {day.low != null ? (
                  <Text style={styles.forecastLow}>{day.low}°</Text>
                ) : null}
                {day.rain != null ? (
                  <View style={styles.forecastRainRow}>
                    <Ionicons name="water-outline" size={11} color={colors.inkFaint} />
                    <Text style={styles.forecastRain}>{day.rain}%</Text>
                  </View>
                ) : null}
              </View>
            ))}
          </View>
        </Card>
      ) : null}
      <View style={styles.tileRow}>
        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="flash-outline"
          title="Energie jetzt"
          demo={powerDevices.length === 0}
        >
          <Text style={styles.tileState}>{totalWatts} W</Text>
          {costPerHour != null ? (
            <Text style={styles.tileSub}>≈ {costPerHour.toFixed(2)} {currency}/h</Text>
          ) : null}
          {topConsumer ? (
            <Text style={styles.tileSub} numberOfLines={1}>
              Grösster: {topConsumer.name}
            </Text>
          ) : null}
        </Tile>
        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="moon-outline"
          title="Nachtmodus"
        >
          <Text style={styles.tileState} numberOfLines={1}>
            {nightScene ? nightScene.name : 'Storen zu · Licht aus'}
          </Text>
          <Action
            styles={styles}
            label="Aktivieren"
            icon="moon-outline"
            onPress={activateNight}
          />
        </Tile>
      </View>
      {onSetPresence && people.length > 0 ? (
        <Tile
          styles={styles}
          colors={colors}
          width={'100%' as any}
          icon="people-outline"
          title="Wer ist da?"
        >
          <View style={styles.presenceRow}>
            {people.map((name) => {
              const home = presenceOf(name);
              return (
                <Pressable
                  key={name}
                  onPress={() => onSetPresence(name, !home)}
                  accessibilityRole="button"
                  accessibilityLabel={`${name} ist ${home ? 'daheim' : 'weg'}`}
                  style={[styles.presenceChip, home && styles.presenceChipHome]}
                >
                  <Ionicons
                    name={home ? 'home' : 'walk-outline'}
                    size={15}
                    color={home ? '#FFFFFF' : colors.inkSoft}
                  />
                  <Text style={[styles.presenceName, home && { color: '#FFFFFF' }]}>
                    {name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
          <Text style={styles.tileSub}>
            {people.filter((name) => presenceOf(name)).length} von {people.length} daheim
          </Text>
        </Tile>
      ) : null}

      {/* Morgens interessiert zuerst der Tag (Termine, Musik), abends die
          Wohnung (Zugang, Haushalt) – die Blöcke tauschen je nach Uhrzeit. */}
      {morningFirst ? (
        <>
      {/* Termine & Musik */}
      <Text style={styles.groupLabel}>Heute</Text>
      <View style={styles.tileRow}>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="calendar-outline" title="Nächster Termin" demo={termin.demo}>
          <Text style={styles.tileState} numberOfLines={1}>
            {termin.title}
          </Text>
          {termin.when ? <Text style={styles.tileSub}>{termin.when}</Text> : null}
        </Tile>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="gift-outline" title="Nächster Geburtstag" demo={geburtstag.demo}>
          <Text style={styles.tileState} numberOfLines={1}>
            {geburtstag.title}
          </Text>
          {geburtstag.when ? <Text style={styles.tileSub}>{geburtstag.when}</Text> : null}
        </Tile>
        {countdown ? (
          <Tile styles={styles} colors={colors} width={tileWidth} icon="hourglass-outline" title={countdown.text}>
            <Text style={styles.tileState} numberOfLines={1}>
              {countdown.days != null
                ? countdown.days > 0
                  ? `noch ${countdown.days} Tage`
                  : countdown.days === 0
                    ? 'heute!'
                    : 'vorbei'
                : '—'}
            </Text>
            <Text style={styles.tileSub}>{countdown.date}</Text>
          </Tile>
        ) : null}
        <Tile styles={styles} colors={colors} width={tileWidth} icon="musical-notes-outline" title="Musik" demo={!player}>
          {player ? (
            <>
              <Text style={styles.tileState} numberOfLines={1}>
                {player.state.track ?? 'Nichts läuft'}
              </Text>
              {player.state.artist ? (
                <Text style={styles.tileSub} numberOfLines={1}>
                  {player.state.artist}
                </Text>
              ) : null}
              <View style={styles.actionRow}>
                <Pressable
                  onPress={() =>
                    onCommand(player.id, player.state.state === 'playing' ? 'pause' : 'play')
                  }
                  style={styles.playButton}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={player.state.state === 'playing' ? 'pause' : 'play'}
                    size={18}
                    color={colors.ink}
                  />
                </Pressable>
                {player.commands.includes('next') ? (
                  <Pressable
                    onPress={() => onCommand(player.id, 'next')}
                    style={styles.playButton}
                    accessibilityRole="button"
                  >
                    <Ionicons name="play-skip-forward" size={18} color={colors.ink} />
                  </Pressable>
                ) : null}
              </View>
              {/* Spotify: Box wählen und Playlist starten – auch aus Stille. */}
              {player.commands.includes('play_playlist') ? (
                <SpotifyPanel
                  entity={player}
                  onCommand={(command, data) => onCommand(player.id, command, data)}
                />
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.tileState}>Nothing But Thieves</Text>
              <Text style={styles.tileSub}>Impossible</Text>
            </>
          )}
        </Tile>
      </View>
      {/* Zugang & Sicherheit */}
      <Text style={styles.groupLabel}>Zugang</Text>
      <View style={styles.tileRow}>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="business-outline" title="Haustüre" demo={!frontDoor}>
          <Text style={styles.tileState}>
            {frontDoor ? 'Gegensprechanlage' : 'Ring Intercom'}
          </Text>
          <Action styles={styles}
            label={confirm === 'front' ? 'Wirklich öffnen?' : 'Öffnen'}
            accent={confirm === 'front'}
            onPress={() =>
              confirmThen('front', () =>
                frontDoor ? onCommand(frontDoor.id, 'open_door') : undefined
              )
            }
          />
        </Tile>

        <Tile styles={styles} colors={colors} width={tileWidth} icon="key-outline" title="Wohnungstüre" demo={!flatDoor}>
          <Text style={styles.tileState}>
            {flatDoor
              ? String(flatDoor.state.state) === 'locked'
                ? 'Abgeschlossen'
                : 'Aufgeschlossen'
              : demoFlatLocked
                ? 'Abgeschlossen'
                : 'Aufgeschlossen'}
          </Text>
          {/* Untereinander statt nebeneinander – zwei Textknöpfe passen in
              der schmalen Kachel nicht in eine Zeile. */}
          <View style={styles.actionCol}>
            <Action styles={styles}
              label={
                (flatDoor ? String(flatDoor.state.state) === 'locked' : demoFlatLocked)
                  ? 'Aufschliessen'
                  : 'Abschliessen'
              }
              onPress={() =>
                flatDoor
                  ? onCommand(
                      flatDoor.id,
                      String(flatDoor.state.state) === 'locked' ? 'unlock' : 'lock'
                    )
                  : setDemoFlatLocked((v) => !v)
              }
            />
            <Action styles={styles}
              label={confirm === 'flat' ? 'Sicher?' : 'Auf + öffnen'}
              accent={confirm === 'flat'}
              onPress={() =>
                confirmThen('flat', () =>
                  flatDoor ? onCommand(flatDoor.id, 'unlatch') : setDemoFlatLocked(false)
                )
              }
            />
          </View>
        </Tile>

        <Tile styles={styles} colors={colors} width={tileWidth} icon="shield-checkmark-outline" title="Alarmanlage" demo={!alarm}>
          <Text
            style={[
              styles.tileState,
              (alarm ? alarm.state.state === 'on' : demoAlarmArmed) && { color: colors.on },
            ]}
          >
            {(alarm ? alarm.state.state === 'on' : demoAlarmArmed) ? 'Scharf' : 'Unscharf'}
          </Text>
          <Action styles={styles}
            label={(alarm ? alarm.state.state === 'on' : demoAlarmArmed) ? 'Unscharf schalten' : 'Scharf schalten'}
            onPress={() =>
              alarm ? onCommand(alarm.id, 'toggle') : setDemoAlarmArmed((v) => !v)
            }
          />
        </Tile>
      </View>
      {/* Haushalt */}
      <Text style={styles.groupLabel}>Haushalt</Text>
      <View style={styles.tileRow}>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="sunny-outline" title="Tumbler" demo={!tumbler}>
          <Text style={[styles.tileState, tumblerRunning && { color: colors.accent }]}>
            {tumblerText}
          </Text>
          {!tumblerOff ? (
            <Text style={styles.tileSub}>{Math.round(tumblerWatts)} W</Text>
          ) : null}
        </Tile>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="water-outline" title="Waschmaschine" demo={!washer}>
          <Text style={[styles.tileState, wash.running && { color: colors.accent }]}>
            {wash.text}
          </Text>
        </Tile>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="restaurant-outline" title="Geschirrspüler" demo={!dishwasher}>
          <Text style={[styles.tileState, dish.running && { color: colors.accent }]}>
            {dish.text}
          </Text>
        </Tile>
      </View>
        </>
      ) : (
        <>
      {/* Zugang & Sicherheit */}
      <Text style={styles.groupLabel}>Zugang</Text>
      <View style={styles.tileRow}>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="business-outline" title="Haustüre" demo={!frontDoor}>
          <Text style={styles.tileState}>
            {frontDoor ? 'Gegensprechanlage' : 'Ring Intercom'}
          </Text>
          <Action styles={styles}
            label={confirm === 'front' ? 'Wirklich öffnen?' : 'Öffnen'}
            accent={confirm === 'front'}
            onPress={() =>
              confirmThen('front', () =>
                frontDoor ? onCommand(frontDoor.id, 'open_door') : undefined
              )
            }
          />
        </Tile>

        <Tile styles={styles} colors={colors} width={tileWidth} icon="key-outline" title="Wohnungstüre" demo={!flatDoor}>
          <Text style={styles.tileState}>
            {flatDoor
              ? String(flatDoor.state.state) === 'locked'
                ? 'Abgeschlossen'
                : 'Aufgeschlossen'
              : demoFlatLocked
                ? 'Abgeschlossen'
                : 'Aufgeschlossen'}
          </Text>
          {/* Untereinander statt nebeneinander – zwei Textknöpfe passen in
              der schmalen Kachel nicht in eine Zeile. */}
          <View style={styles.actionCol}>
            <Action styles={styles}
              label={
                (flatDoor ? String(flatDoor.state.state) === 'locked' : demoFlatLocked)
                  ? 'Aufschliessen'
                  : 'Abschliessen'
              }
              onPress={() =>
                flatDoor
                  ? onCommand(
                      flatDoor.id,
                      String(flatDoor.state.state) === 'locked' ? 'unlock' : 'lock'
                    )
                  : setDemoFlatLocked((v) => !v)
              }
            />
            <Action styles={styles}
              label={confirm === 'flat' ? 'Sicher?' : 'Auf + öffnen'}
              accent={confirm === 'flat'}
              onPress={() =>
                confirmThen('flat', () =>
                  flatDoor ? onCommand(flatDoor.id, 'unlatch') : setDemoFlatLocked(false)
                )
              }
            />
          </View>
        </Tile>

        <Tile styles={styles} colors={colors} width={tileWidth} icon="shield-checkmark-outline" title="Alarmanlage" demo={!alarm}>
          <Text
            style={[
              styles.tileState,
              (alarm ? alarm.state.state === 'on' : demoAlarmArmed) && { color: colors.on },
            ]}
          >
            {(alarm ? alarm.state.state === 'on' : demoAlarmArmed) ? 'Scharf' : 'Unscharf'}
          </Text>
          <Action styles={styles}
            label={(alarm ? alarm.state.state === 'on' : demoAlarmArmed) ? 'Unscharf schalten' : 'Scharf schalten'}
            onPress={() =>
              alarm ? onCommand(alarm.id, 'toggle') : setDemoAlarmArmed((v) => !v)
            }
          />
        </Tile>
      </View>
      {/* Haushalt */}
      <Text style={styles.groupLabel}>Haushalt</Text>
      <View style={styles.tileRow}>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="sunny-outline" title="Tumbler" demo={!tumbler}>
          <Text style={[styles.tileState, tumblerRunning && { color: colors.accent }]}>
            {tumblerText}
          </Text>
          {!tumblerOff ? (
            <Text style={styles.tileSub}>{Math.round(tumblerWatts)} W</Text>
          ) : null}
        </Tile>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="water-outline" title="Waschmaschine" demo={!washer}>
          <Text style={[styles.tileState, wash.running && { color: colors.accent }]}>
            {wash.text}
          </Text>
        </Tile>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="restaurant-outline" title="Geschirrspüler" demo={!dishwasher}>
          <Text style={[styles.tileState, dish.running && { color: colors.accent }]}>
            {dish.text}
          </Text>
        </Tile>
      </View>
      {/* Termine & Musik */}
      <Text style={styles.groupLabel}>Heute</Text>
      <View style={styles.tileRow}>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="calendar-outline" title="Nächster Termin" demo={termin.demo}>
          <Text style={styles.tileState} numberOfLines={1}>
            {termin.title}
          </Text>
          {termin.when ? <Text style={styles.tileSub}>{termin.when}</Text> : null}
        </Tile>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="gift-outline" title="Nächster Geburtstag" demo={geburtstag.demo}>
          <Text style={styles.tileState} numberOfLines={1}>
            {geburtstag.title}
          </Text>
          {geburtstag.when ? <Text style={styles.tileSub}>{geburtstag.when}</Text> : null}
        </Tile>
        {countdown ? (
          <Tile styles={styles} colors={colors} width={tileWidth} icon="hourglass-outline" title={countdown.text}>
            <Text style={styles.tileState} numberOfLines={1}>
              {countdown.days != null
                ? countdown.days > 0
                  ? `noch ${countdown.days} Tage`
                  : countdown.days === 0
                    ? 'heute!'
                    : 'vorbei'
                : '—'}
            </Text>
            <Text style={styles.tileSub}>{countdown.date}</Text>
          </Tile>
        ) : null}
        <Tile styles={styles} colors={colors} width={tileWidth} icon="musical-notes-outline" title="Musik" demo={!player}>
          {player ? (
            <>
              <Text style={styles.tileState} numberOfLines={1}>
                {player.state.track ?? 'Nichts läuft'}
              </Text>
              {player.state.artist ? (
                <Text style={styles.tileSub} numberOfLines={1}>
                  {player.state.artist}
                </Text>
              ) : null}
              <View style={styles.actionRow}>
                <Pressable
                  onPress={() =>
                    onCommand(player.id, player.state.state === 'playing' ? 'pause' : 'play')
                  }
                  style={styles.playButton}
                  accessibilityRole="button"
                >
                  <Ionicons
                    name={player.state.state === 'playing' ? 'pause' : 'play'}
                    size={18}
                    color={colors.ink}
                  />
                </Pressable>
                {player.commands.includes('next') ? (
                  <Pressable
                    onPress={() => onCommand(player.id, 'next')}
                    style={styles.playButton}
                    accessibilityRole="button"
                  >
                    <Ionicons name="play-skip-forward" size={18} color={colors.ink} />
                  </Pressable>
                ) : null}
              </View>
              {/* Spotify: Box wählen und Playlist starten – auch aus Stille. */}
              {player.commands.includes('play_playlist') ? (
                <SpotifyPanel
                  entity={player}
                  onCommand={(command, data) => onCommand(player.id, command, data)}
                />
              ) : null}
            </>
          ) : (
            <>
              <Text style={styles.tileState}>Nothing But Thieves</Text>
              <Text style={styles.tileSub}>Impossible</Text>
            </>
          )}
        </Tile>
      </View>
        </>
      )}
    </View>
  );
}

type OverviewStyles = ReturnType<typeof makeStyles>;

function Badge({ label, styles }: { label: string; styles: OverviewStyles }) {
  return (
    <View style={styles.badge}>
      <Text style={styles.badgeText}>{label}</Text>
    </View>
  );
}

function Tile({
  icon,
  title,
  demo,
  children,
  styles,
  colors,
  width,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  demo?: boolean;
  children: React.ReactNode;
  styles: OverviewStyles;
  colors: Colors;
  width: '31.5%' | '48%';
}) {
  return (
    <Card style={{ ...styles.tile, width }}>
      <View style={styles.tileHead}>
        <Ionicons name={icon} size={18} color={colors.inkSoft} />
        <Text style={styles.tileTitle} numberOfLines={1}>
          {title}
        </Text>
        {demo ? <Badge label="Demo" styles={styles} /> : null}
      </View>
      {children}
    </Card>
  );
}

/** Icon einer Schnellaktion: das im Szenen-Editor gewählte, sonst eines,
 *  das zum Namen passt («Kino» → Film, «Schlafen» → Mond). */
function sceneIcon(scene: { name: string; icon?: string }): keyof typeof Ionicons.glyphMap {
  if (scene.icon && scene.icon in Ionicons.glyphMap) {
    return scene.icon as keyof typeof Ionicons.glyphMap;
  }
  if (/kino|film|tv/i.test(scene.name)) return 'film-outline';
  if (/schlaf|nacht|bett/i.test(scene.name)) return 'moon-outline';
  if (/morgen|aufstehen/i.test(scene.name)) return 'sunny-outline';
  if (/essen|dinner/i.test(scene.name)) return 'restaurant-outline';
  return 'sparkles-outline';
}

function Action({
  label,
  icon,
  onPress,
  accent,
  disabled,
  styles,
}: {
  label: string;
  icon?: keyof typeof Ionicons.glyphMap;
  onPress: () => void;
  accent?: boolean;
  disabled?: boolean;
  styles: OverviewStyles;
}) {
  return (
    <Pressable
      onPress={onPress}
      disabled={disabled}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.action,
        accent && styles.actionAccent,
        (pressed || disabled) && { opacity: 0.6 },
      ]}
    >
      {icon ? (
        <Ionicons
          name={icon}
          size={16}
          color={accent ? '#FFFFFF' : undefined}
          style={accent ? undefined : styles.actionIcon}
        />
      ) : null}
      <Text style={[styles.actionText, accent && styles.actionTextAccent]} numberOfLines={1}>
        {label}
      </Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: space.gap },
    headRow: { flexDirection: 'row', gap: space.gap },
    clockCard: { flex: 1, minHeight: 0, justifyContent: 'center' },
    clock: { color: colors.ink, fontSize: 44, fontWeight: '700', letterSpacing: 1 },
    date: { color: colors.inkSoft, fontSize: 14, marginTop: 2 },
    weatherCard: { flex: 1, minHeight: 0, justifyContent: 'center', gap: 4 },
    weatherNow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    weatherTemp: { color: colors.ink, fontSize: 34, fontWeight: '700' },
    weatherText: { color: colors.inkSoft, fontSize: 13 },
    alertRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginTop: 2 },
    alertText: { color: colors.danger, fontSize: 12, fontWeight: '600', flex: 1 },

    quickRow: { flexDirection: 'row', gap: 10, flexWrap: 'wrap' },
    hintLine: { color: colors.onGradientSoft, fontSize: 12, marginTop: -6 },

    groupLabel: {
      color: colors.onGradient,
      fontSize: 15,
      fontWeight: '700',
      marginTop: 6,
    },
    tileRow: { flexDirection: 'row', flexWrap: 'wrap', gap: space.gap },
    tile: { minHeight: 0, gap: 8, flexGrow: 1 },
    tileHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    tileTitle: { color: colors.inkSoft, fontSize: 13, fontWeight: '700', flex: 1 },
    tileState: { color: colors.ink, fontSize: 16, fontWeight: '600' },
    tileSub: { color: colors.inkSoft, fontSize: 13 },

    forecastCard: { minHeight: 0, gap: 10 },
    forecastRow: { flexDirection: 'row', justifyContent: 'space-around' },
    forecastDay: { alignItems: 'center', gap: 3, flex: 1 },
    forecastName: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    forecastHigh: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    forecastLow: { color: colors.inkFaint, fontSize: 12 },
    forecastRainRow: { flexDirection: 'row', alignItems: 'center', gap: 2 },
    forecastRain: { color: colors.inkFaint, fontSize: 11 },

    presenceRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    presenceChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    presenceChipHome: { backgroundColor: colors.on, borderColor: colors.on },
    presenceName: { color: colors.ink, fontSize: 14, fontWeight: '600' },

    badge: {
      backgroundColor: colors.track,
      borderRadius: radius.pill,
      paddingHorizontal: 8,
      paddingVertical: 2,
    },
    badgeText: { color: colors.inkFaint, fontSize: 10, fontWeight: '700' },

    action: {
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.control,
      paddingHorizontal: 14,
      paddingVertical: 10,
      alignItems: 'center',
      justifyContent: 'center',
      flexDirection: 'row',
      gap: 6,
      flexGrow: 1,
    },
    actionIcon: { color: colors.ink },
    actionAccent: { backgroundColor: colors.accent, borderColor: colors.accent },
    actionText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
    actionTextAccent: { color: '#FFFFFF' },
    actionRow: { flexDirection: 'row', gap: 8 },
    actionCol: { gap: 8, alignSelf: 'stretch' },

    playButton: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
  });
