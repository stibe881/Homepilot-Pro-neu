import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import {
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';

import { CommandData, Entity, KalenderEintrag, Scene } from '../api/types';
import { Card } from '../components/Card';
import { DraggableList } from '../components/DraggableList';
import { KIND_ICONS, shortState } from '../components/RoomTile';
import { appleMapsRoute, googleMapsRoute } from '../components/TopStrip';
import { VacuumHome } from '../components/VacuumHome';
import { wochentagUhr } from '../lib/format';
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
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
  onActivateScene: (sceneId: string) => void;
  /** Auf der Startseite markierte Countdowns (aus dem Familie-Modul). */
  countdowns?: { text: string; date: string; on_start?: boolean }[];
  /** Karten-/Schnappschuss-Adresse eines Geräts – für die Saugerkarte. */
  snapshotUri?: (entity: Entity) => string | undefined;
  /** Als Favorit markierte Geräte-IDs. Kommt von aussen, weil der Stern
   *  in der Geräteliste in die Geräte-Einstellungen schreibt und nicht in
   *  die Entität – wer nur `entity.favorite` liest, sieht nie etwas. */
  favoriteIds?: string[];
  /** Selbst gezogene Reihenfolge der Favoriten (Gerätekennungen). */
  favoriteOrder?: string[];
  onReorderFavorites?: (ids: string[]) => void;
}

const WEEKDAYS = ['Sonntag', 'Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag'];
const MONTHS = [
  'Januar', 'Februar', 'März', 'April', 'Mai', 'Juni',
  'Juli', 'August', 'September', 'Oktober', 'November', 'Dezember',
];

function two(value: number): string {
  return value < 10 ? `0${value}` : String(value);
}

/** «in X Tagen» bis zu einem Datum – für den nächsten Geburtstag (rein,
 *  testbar). Reine Datumsangaben («2026-08-20») werden auf Mittag gesetzt,
 *  damit die Zeitzone die Tageszahl nicht verschiebt. */
function daysUntilText(value: unknown): string {
  const raw = String(value ?? '').trim();
  const iso = /^\d{4}-\d{2}-\d{2}$/.test(raw) ? `${raw}T12:00:00` : raw;
  const target = new Date(iso);
  if (Number.isNaN(target.getTime())) return '';
  const today = new Date();
  const days = Math.round(
    (new Date(target).setHours(0, 0, 0, 0) - today.setHours(0, 0, 0, 0)) / 86_400_000
  );
  if (days <= 0) return 'heute! 🎉';
  if (days === 1) return 'morgen';
  return `in ${days} Tagen`;
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
  snapshotUri,
  favoriteIds = [],
  favoriteOrder,
  onReorderFavorites,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // ── Echte Geräte, wo vorhanden ─────────────────────────────────────────
  const frontDoor = pick(entities, 'lock', undefined, 'ring');
  // Die Wohnungstüre ist das Schloss, das sich auf- und abschliessen
  // lässt - unabhängig davon, wie es angebunden ist. Vorher stand hier
  // der Herstellername, im Muster wie in der Integration: Dasselbe Nuki
  // über Matter fiel damit heraus, und die Kachel zeigte wieder die
  // Demo, obwohl das Schloss danebenstand.
  //
  // Der Name hat trotzdem Vorrang: Wer eines «Wohnungstüre» nennt, meint
  // dieses. Sonst das erste echte Schloss - «echt» heisst, es kann
  // abschliessen; ein blosser Türöffner wie die Gegensprechanlage kann
  // das nicht und ist oben schon die Haustüre.
  const flatDoor =
    entities.find(
      (entity) =>
        entity.kind === 'lock' &&
        entity.id !== frontDoor?.id &&
        /wohnung|haustür|wohnungstür/i.test(entity.name)
    ) ??
    entities.find(
      (entity) =>
        entity.kind === 'lock' &&
        entity.id !== frontDoor?.id &&
        entity.commands.includes('lock')
    );
  const vacuum = pick(entities, 'vacuum');
  const dishwasher = pick(entities, 'appliance', /geschirr/i);
  const washer = pick(entities, 'appliance', /wasch/i);
  const tumbler = entities.find(
    (e) => /tumbler|trockner/i.test(e.name) && typeof e.state.power === 'number'
  );
  const calendar = entities.find((e) => e.kind === 'calendar');
  const weather = entities.find((e) => e.kind === 'weather');
  const alert = entities.find((e) => e.kind === 'alert' && e.state.state === 'alert');
  // Die echte Alarmanlage des Hubs; ein per Namen erkannter Schalter ist
  // nur der Notnagel für Aufbauten ohne sie.
  const alarm =
    entities.find((e) => e.kind === 'alarm') ??
    entities.find((e) => /alarm/i.test(e.name) && e.kind === 'switch');
  const covers = entities.filter((e) => e.kind === 'cover');
  // In der Geräteliste als Favorit markiert – die stehen hier griffbereit.
  // Beide Wege zählen: der Stern auf der Kachel (Geräte-Einstellungen) und
  // die Markierung an der Entität selbst.
  const favoriten = entities.filter(
    (e) => favoriteIds.includes(e.id) || e.favorite
  );
  // Selbst gezogene Reihenfolge anwenden; neu hinzugekommene Favoriten
  // hängen sich hinten an, statt die gewachsene Ordnung durcheinander zu
  // bringen. Dieselbe Regel wie bei den Familien-Kacheln.
  const favRang = new Map((favoriteOrder ?? []).map((id, index) => [id, index]));
  const favorites = [...favoriten].sort((a, b) => {
    const ai = favRang.has(a.id) ? (favRang.get(a.id) as number) : Infinity;
    const bi = favRang.has(b.id) ? (favRang.get(b.id) as number) : Infinity;
    return ai !== bi ? ai - bi : favoriten.indexOf(a) - favoriten.indexOf(b);
  });
  const [favOrdnen, setFavOrdnen] = useState(false);

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
  // Nachfrage «Route womit öffnen?» unter dem Termin-Ort.
  const [routeAsk, setRouteAsk] = useState(false);
  const [demoAlarmArmed, setDemoAlarmArmed] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);

  // Scharf ist alles ausser «unscharf» – auch während der Verzögerung und
  // erst recht, wenn sie ausgelöst hat.
  const alarmArmed = alarm
    ? alarm.kind === 'alarm'
      ? String(alarm.state.state ?? 'unscharf') !== 'unscharf'
      : alarm.state.state === 'on'
    : demoAlarmArmed;
  const alarmText = !alarm
    ? demoAlarmArmed
      ? 'Scharf'
      : 'Unscharf'
    : alarm.kind !== 'alarm'
      ? alarmArmed
        ? 'Scharf'
        : 'Unscharf'
      : String(alarm.state.state) === 'ausgeloest'
        ? 'Alarm ausgelöst'
        : String(alarm.state.state) === 'unscharf'
          ? 'Unscharf'
          : `Scharf · ${alarm.state.mode_label ?? ''}`;

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
  const events: KalenderEintrag[] = Array.isArray(calendar?.state.events) ? calendar!.state.events : [];
  const isBirthday = (event: KalenderEintrag) =>
    event.birthday || /geburtstag|birthday/i.test(event.summary ?? '');
  const birthday = events.find(isBirthday);
  const nextEvent = events.find((event) => !isBirthday(event));

  const eventLine = (event: KalenderEintrag | undefined, demoText: string, demoWhen: string) => {
    if (!calendar) return { title: demoText, when: demoWhen, demo: true };
    if (!event) return { title: 'Nichts geplant', when: '', demo: false };
    const when = event.all_day
      ? 'ganztägig'
      : wochentagUhr(new Date(event.start));
    return {
      title: event.summary ?? '—',
      when,
      demo: false,
      location: typeof event.location === 'string' ? event.location : null,
    };
  };

  const termin = eventLine(nextEvent, 'Zahnarzt', 'Mo 14:30');
  const geburtstag = birthday
    ? { title: birthday.summary ?? '—', when: daysUntilText(birthday.start), demo: false }
    : { title: 'Livia', when: 'in 12 Tagen', demo: true };

  // ── Anzeige ────────────────────────────────────────────────────────────

  // Die drei Blöcke einmal bauen und unten in der passenden Reihenfolge
  // ausgeben – vorher stand jeder doppelt im Code, einmal pro Tageszeit.
  const zugangBlock = (
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

        {/* Beide Kacheln färben sich, statt es nur danebenzuschreiben:
            Eine offene Wohnungstüre und eine scharfe Alarmanlage sind
            Zustände, die man im Vorbeigehen sehen soll - dieselbe Farbe
            wie auf der Gerätekachel. */}
        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="key-outline"
          title="Wohnungstüre"
          demo={!flatDoor}
          tint={
            (flatDoor ? String(flatDoor.state.state) !== 'locked' : !demoFlatLocked)
              ? colors.dangerSoft
              : undefined
          }
        >
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

        <Tile
          styles={styles}
          colors={colors}
          width={tileWidth}
          icon="shield-checkmark-outline"
          title="Alarmanlage"
          demo={!alarm}
          tint={alarmArmed ? colors.dangerSoft : undefined}
        >
          <Text
            style={[
              styles.tileState,
              alarmArmed && { color: colors.on },
              String(alarm?.state.state) === 'ausgeloest' && { color: colors.danger },
            ]}
          >
            {alarmText}
          </Text>
          <Action styles={styles}
            label={alarmArmed ? 'Unscharf schalten' : 'Scharf schalten'}
            onPress={() =>
              alarm ? onCommand(alarm.id, 'toggle') : setDemoAlarmArmed((v) => !v)
            }
          />
        </Tile>
      </View>
    </>
  );

  const haushaltBlock = (
    <>
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
      {vacuum ? (
        <View style={styles.tileRow}>
          <Tile styles={styles} colors={colors} width="100%" icon="hardware-chip-outline" title={vacuum.name}>
            <VacuumHome
              entity={vacuum}
              uri={snapshotUri?.(vacuum)}
              now={now}
              onCommand={onCommand}
            />
          </Tile>
        </View>
      ) : null}
    </>
  );

  const heuteBlock = (
    <>
      {/* Termine & Musik */}
      <Text style={styles.groupLabel}>Heute</Text>
      <View style={styles.tileRow}>
        <Tile styles={styles} colors={colors} width={tileWidth} icon="calendar-outline" title="Nächster Termin" demo={termin.demo}>
          <Text style={styles.tileState} numberOfLines={1}>
            {termin.title}
          </Text>
          {termin.when ? <Text style={styles.tileSub}>{termin.when}</Text> : null}
          {'location' in termin && termin.location ? (
            <>
              <Pressable
                onPress={() => setRouteAsk((v) => !v)}
                accessibilityRole="button"
                accessibilityLabel={`Route zu ${termin.location}`}
                style={({ pressed }) => [styles.terminOrtRow, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="location-outline" size={13} color={colors.accent} />
                <Text style={styles.terminOrt} numberOfLines={1}>
                  {termin.location}
                </Text>
              </Pressable>
              {routeAsk ? (
                <View style={styles.routeRow}>
                  <Action
                    styles={styles}
                    label="Google Maps"
                    icon="map-outline"
                    onPress={() => {
                      // Keine Karten-App ist kein Fehler dieser Karte.
                      Linking.openURL(googleMapsRoute(termin.location!)).catch(() => {});
                      setRouteAsk(false);
                    }}
                  />
                  <Action
                    styles={styles}
                    label="Apple Karten"
                    icon="navigate-outline"
                    onPress={() => {
                      // Wie daneben: ohne Karten-App passiert nichts.
                      Linking.openURL(appleMapsRoute(termin.location!)).catch(() => {});
                      setRouteAsk(false);
                    }}
                  />
                </View>
              ) : null}
            </>
          ) : null}
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
      </View>
    </>
  );

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
                  name={(weather.state.icon as keyof typeof Ionicons.glyphMap) ?? 'cloud-outline'}
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

      {/* Favoriten aus der Geräteliste – zwischen Schnellaktionen und
          Zugang, damit die eigenen Griffbereit-Geräte oben stehen. */}
      {favorites.length > 0 ? (
        <>
          <View style={styles.favHead}>
            <Text style={[styles.groupLabel, { flex: 1 }]}>Favoriten</Text>
            {onReorderFavorites && favorites.length > 1 ? (
              <Pressable
                onPress={() => setFavOrdnen(true)}
                accessibilityRole="button"
                accessibilityLabel="Reihenfolge der Favoriten ändern"
                hitSlop={8}
                style={({ pressed }) => [pressed && { opacity: 0.6 }]}
              >
                <Ionicons name="swap-vertical" size={16} color={colors.onGradient} />
              </Pressable>
            ) : null}
          </View>
          <Modal
            visible={favOrdnen}
            animationType="slide"
            onRequestClose={() => setFavOrdnen(false)}
          >
            <View style={styles.reorderSheet}>
              <View style={styles.reorderHead}>
                <Text style={styles.reorderTitle}>Favoriten ordnen</Text>
                <Pressable onPress={() => setFavOrdnen(false)} accessibilityLabel="Fertig">
                  <Ionicons name="checkmark" size={26} color={colors.ink} />
                </Pressable>
              </View>
              <Text style={styles.reorderHint}>
                Am Griff ☰ ziehen. Die Reihenfolge wird bei deinem Benutzer
                gespeichert und gilt auf allen deinen Geräten.
              </Text>
              <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                <DraggableList
                  items={favorites.map((entity) => ({
                    id: entity.id,
                    name: entity.name,
                  }))}
                  onReorder={(ids) => onReorderFavorites?.(ids)}
                />
              </ScrollView>
            </View>
          </Modal>
          <View style={styles.favRow}>
            {favorites.map((entity) => (
              <FavoriteChip
                key={entity.id}
                entity={entity}
                pending={!!pending[entity.id]}
                onCommand={onCommand}
                styles={styles}
                colors={colors}
              />
            ))}
          </View>
        </>
      ) : null}

      {/* Zugang steht immer gleich unter den Schnellaktionen. Danach
          tauschen Haushalt und Heute je nach Tageszeit den Platz: morgens
          zuerst der Tag (Termine, Musik), abends zuerst die Wohnung. */}
      {zugangBlock}
      {morningFirst ? (
        <>
          {heuteBlock}
          {haushaltBlock}
        </>
      ) : (
        <>
          {haushaltBlock}
          {heuteBlock}
        </>
      )}
    </View>
  );
}

type OverviewStyles = ReturnType<typeof makeStyles>;

/** Ein Favorit als kompakter Chip: Symbol, Name, Zustand. Schaltbares
 *  schaltet ein Tipp um; Storen wechseln zwischen auf und zu; der Rest
 *  zeigt nur an. Auf Modulebene wie Tile und Action – innerhalb der
 *  Komponente definiert würde jeder Live-Update laufende Berührungen
 *  abbrechen. */
function FavoriteChip({
  entity,
  pending,
  onCommand,
  styles,
  colors,
}: {
  entity: Entity;
  pending: boolean;
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
  styles: OverviewStyles;
  colors: Colors;
}) {
  const state = String(entity.state.state ?? '');
  const active = state === 'on' || state === 'playing' || state === 'cleaning';
  const tap = () => {
    if (entity.commands.includes('toggle')) {
      onCommand(entity.id, 'toggle');
    } else if (entity.commands.includes('turn_on')) {
      onCommand(entity.id, state === 'on' ? 'turn_off' : 'turn_on');
    } else if (entity.kind === 'cover' && entity.commands.includes('open')) {
      onCommand(entity.id, state === 'closed' ? 'open' : 'close');
    }
  };
  const switchable =
    entity.commands.includes('toggle') ||
    entity.commands.includes('turn_on') ||
    (entity.kind === 'cover' && entity.commands.includes('open'));

  return (
    <Pressable
      onPress={switchable ? tap : undefined}
      disabled={!switchable}
      accessibilityRole={switchable ? 'button' : undefined}
      accessibilityLabel={entity.name}
      style={({ pressed }) => [
        styles.favChip,
        active && styles.favChipActive,
        (pressed || pending) && { opacity: 0.6 },
      ]}
    >
      <Ionicons
        name={KIND_ICONS[entity.kind] ?? 'cube-outline'}
        size={18}
        color={active ? colors.accent : colors.inkSoft}
      />
      <View style={{ flexShrink: 1 }}>
        <Text style={styles.favName} numberOfLines={1}>
          {entity.name}
        </Text>
        <Text style={[styles.favState, active && { color: colors.accent }]} numberOfLines={1}>
          {entity.kind === 'light' || entity.kind === 'switch'
            ? state === 'on'
              ? 'An'
              : 'Aus'
            : shortState(entity)}
        </Text>
      </View>
    </Pressable>
  );
}

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
  tint,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  demo?: boolean;
  children: React.ReactNode;
  styles: OverviewStyles;
  colors: Colors;
  width: '31.5%' | '48%' | '100%';
  /** Hintergrund für Zustände, die man im Vorbeigehen sehen soll. */
  tint?: string;
}) {
  return (
    <Card style={{ ...styles.tile, width }} tint={tint}>
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
    favHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    reorderSheet: { flex: 1, backgroundColor: colors.panel, padding: 20, paddingTop: 60, gap: 10 },
    reorderHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    reorderTitle: { color: colors.ink, fontSize: 18, fontWeight: '700' },
    reorderHint: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
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
    terminOrtRow: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    terminOrt: { color: colors.accent, fontSize: 12, flexShrink: 1 },
    routeRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },

    favRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    favChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      maxWidth: '100%',
    },
    favChipActive: { borderColor: colors.accent },
    favName: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    favState: { color: colors.inkFaint, fontSize: 12 },


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
  });
