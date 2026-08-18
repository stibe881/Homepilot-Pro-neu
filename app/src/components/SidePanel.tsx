import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Activity, Entity } from '../api/types';
import { Colors, radius, type, useColors } from '../theme';
import { Bar } from './Bar';
import { Card } from './Card';
import { ShuffleRepeat, SpotifyPanel } from './EntityCard';

function severityColor(colors: Colors, severity: string): string {
  return severity === 'Extreme' || severity === 'Severe' ? colors.danger : colors.warn;
}

/**
 * Breite Spalte rechts (Tablet) bzw. Abschnitt unten (Telefon):
 * Wetterlage und was zuletzt im Haus passiert ist.
 */
export function SidePanel({
  entities,
  width,
  onCommand,
}: {
  entities: Entity[];
  width?: number;
  /** Für den Player – ohne ihn bleibt er weg statt tot dazustehen. */
  onCommand?: (entityId: string, command: string, data?: Record<string, any>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const weather = entities.find((entity) => entity.kind === 'weather');
  const alert = entities.find((entity) => entity.kind === 'alert');
  // Warnung nur zeigen, wenn es wirklich eine gibt (für den gewählten Ort).
  const hasAlert = alert && (alert.state.count ?? 0) > 0;
  const players = useMemo(
    () => entities.filter((entity) => entity.kind === 'media_player'),
    [entities]
  );
  // Von Hand gewählte Box, solange es sie noch gibt – sonst die naheliegende
  // (siehe pickPlayer): So sieht man immer nur eine Karte, aber jede Box
  // lässt sich ansehen und bedienen, nicht nur die gerade spielende.
  const [chosenId, setChosenId] = useState<string | null>(null);
  const player =
    (chosenId ? players.find((entity) => entity.id === chosenId) : undefined) ??
    pickPlayer(entities);

  return (
    <View style={[styles.column, width ? { width } : { flex: 1 }]}>
      {weather ? <WeatherPanel entity={weather} /> : null}
      {player && onCommand ? (
        <MediaPanel
          entity={player}
          players={players}
          onSelect={setChosenId}
          onCommand={onCommand}
        />
      ) : null}
      {hasAlert ? <AlertPanel entity={alert!} /> : null}
    </View>
  );
}

/** Welcher Player gehört auf die Startseite? (rein, testbar)
 *
 * Spielt irgendwo Musik, ist es dieser; sonst Spotify mit Playlists und
 * Boxenwahl vor einer stillen Cast-Box. */
export function pickPlayer(entities: Entity[]): Entity | undefined {
  const players = entities.filter((entity) => entity.kind === 'media_player');
  return (
    players.find((entity) => entity.state.state === 'playing') ??
    players.find((entity) => entity.commands.includes('play_playlist')) ??
    players[0]
  );
}

/** Der Player – unter dem Wetter, weil er dort die volle Spaltenbreite hat.
 *
 * In der Kachelreihe der Startseite zwang der Spotify-Bereich die
 * Nachbarkacheln auf seine Höhe; hier stört er niemanden. */
function MediaPanel({
  entity,
  players,
  onSelect,
  onCommand,
}: {
  entity: Entity;
  /** Alle Medien-Geräte, nicht nur das gerade gezeigte – für die
   *  Lautsprecherwahl. Bei nur einem Gerät bleibt die Zeile weg. */
  players: Entity[];
  onSelect: (entityId: string) => void;
  onCommand: (entityId: string, command: string, data?: Record<string, any>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const playing = entity.state.state === 'playing';
  const command = (name: string, data?: Record<string, any>) =>
    onCommand(entity.id, name, data);

  return (
    <Card style={styles.mediaCard}>
      <View style={styles.mediaHead}>
        <Ionicons name="musical-notes-outline" size={18} color={colors.inkSoft} />
        <Text style={styles.heading}>Musik</Text>
      </View>
      {players.length > 1 ? (
        <View style={styles.speakerRow}>
          {players.map((speaker) => {
            const selected = speaker.id === entity.id;
            return (
              <Pressable
                key={speaker.id}
                onPress={() => onSelect(speaker.id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${speaker.name} anzeigen`}
                style={[styles.speakerChip, selected && styles.speakerChipActive]}
              >
                <Ionicons
                  name={
                    speaker.state.state === 'playing'
                      ? 'volume-high-outline'
                      : 'volume-medium-outline'
                  }
                  size={13}
                  color={selected ? '#FFFFFF' : colors.inkSoft}
                />
                <Text
                  style={[styles.speakerChipText, selected && styles.speakerChipTextActive]}
                  numberOfLines={1}
                >
                  {speaker.name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <Text style={styles.mediaTrack} numberOfLines={1}>
        {entity.state.track ?? 'Nichts läuft'}
      </Text>
      {entity.state.artist ? (
        <Text style={styles.mediaArtist} numberOfLines={1}>
          {entity.state.artist}
        </Text>
      ) : null}

      <View style={styles.mediaButtons}>
        <Pressable
          onPress={() => command(playing ? 'pause' : 'play')}
          accessibilityRole="button"
          accessibilityLabel={playing ? 'Pause' : 'Abspielen'}
          style={styles.playButton}
        >
          <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.ink} />
        </Pressable>
        {entity.commands.includes('next') ? (
          <Pressable
            onPress={() => command('next')}
            accessibilityRole="button"
            accessibilityLabel="Nächster Titel"
            style={styles.playButton}
          >
            <Ionicons name="play-skip-forward" size={18} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>

      <ShuffleRepeat entity={entity} onCommand={(name, data) => command(name, data)} />

      {entity.commands.includes('set_volume') ? (
        <View style={styles.volumeRow}>
          <Ionicons
            name={
              entity.state.muted || entity.state.volume === 0
                ? 'volume-mute'
                : 'volume-low'
            }
            size={18}
            color={colors.inkSoft}
          />
          <View style={{ flex: 1 }}>
            <Bar
              height={26}
              value={typeof entity.state.volume === 'number' ? entity.state.volume : 0}
              onChange={(value) => command('set_volume', { volume: value })}
            />
          </View>
          <Ionicons name="volume-high" size={18} color={colors.inkSoft} />
        </View>
      ) : null}

      {entity.commands.includes('play_playlist') ? (
        <SpotifyPanel entity={entity} onCommand={(name, data) => command(name, data)} />
      ) : null}
    </Card>
  );
}

/** Protokoll «Zuletzt passiert» – eigenständige Karte, eingebunden unter
 *  Einstellungen. */
export function ActivityCard({ activity, limit = 30 }: { activity: Activity[]; limit?: number }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Card style={styles.activityCard}>
      <Text style={styles.heading}>Zuletzt passiert</Text>
      {activity.length === 0 ? (
        <Text style={styles.empty}>
          Noch keine Änderung, seit die App verbunden ist.
        </Text>
      ) : (
        <View style={styles.list}>
          {activity.slice(0, limit).map((item) => (
            <View key={item.id} style={styles.activityRow}>
              <View style={styles.bullet} />
              <Text numberOfLines={1} style={styles.activityName}>
                {item.name}
              </Text>
              <Text style={styles.activitySummary}>
                {item.summary}
                {/* Beantwortet „warum ist das passiert?" */}
                {item.source && item.sourceKind !== 'device'
                  ? ` · ${item.source}`
                  : ''}
              </Text>
              <Text style={styles.activityTime}>
                {new Date(item.at).toLocaleTimeString('de-CH', {
                  hour: '2-digit',
                  minute: '2-digit',
                })}
              </Text>
            </View>
          ))}
        </View>
      )}
    </Card>
  );
}

/** Wetterlage: aktuell gross, darunter die nächsten sieben Tage als
 *  Streifen mit Symbol, Höchst- und Tiefstwert. */
function WeatherPanel({ entity }: { entity: Entity }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const days: any[] = Array.isArray(entity.state.days) ? entity.state.days : [];

  return (
    <Card style={styles.alertCard}>
      <View style={styles.weatherNow}>
        <Ionicons
          name={(entity.state.icon as any) ?? 'partly-sunny-outline'}
          size={40}
          color={colors.ink}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.weatherTemp}>
            {entity.state.temperature != null ? `${entity.state.temperature}°` : '–'}
          </Text>
          <Text style={styles.alertSource}>
            {entity.state.state} · {entity.name}
          </Text>
        </View>
      </View>

      {days.length > 0 ? (
        <View style={styles.weekRow}>
          {days.map((day, index) => (
            <View key={day.date ?? index} style={styles.dayCol}>
              <Text style={styles.dayName}>
                {index === 0 ? 'Heute' : weekdayShort(day.date)}
              </Text>
              <Ionicons name={(day.icon as any) ?? 'cloud-outline'} size={20} color={colors.inkSoft} />
              <Text style={styles.dayHigh}>{day.high != null ? `${day.high}°` : '–'}</Text>
              <Text style={styles.dayLow}>{day.low != null ? `${day.low}°` : ''}</Text>
              {day.rain != null && day.rain >= 20 ? (
                <Text style={styles.dayRain}>{day.rain}%</Text>
              ) : null}
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

/** Wochentagskürzel aus einem ISO-Datum (YYYY-MM-DD). */
function weekdayShort(date: string): string {
  const parsed = new Date(`${date}T12:00:00`);
  if (Number.isNaN(parsed.getTime())) return '';
  return parsed.toLocaleDateString('de-CH', { weekday: 'short' }).replace('.', '');
}

function AlertPanel({ entity }: { entity: Entity }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const count = entity.state.count ?? 0;
  const severity = entity.state.max_severity;
  const tone = count > 0 ? severityColor(colors, severity) : colors.on;
  const alerts: any[] = entity.state.alerts ?? [];

  return (
    <Card style={styles.alertCard}>
      <View style={styles.alertHead}>
        <Ionicons
          name={count > 0 ? 'thunderstorm-outline' : 'sunny-outline'}
          size={26}
          color={tone}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Wetterlage</Text>
          <Text style={styles.alertSource}>{entity.name}</Text>
        </View>
      </View>

      <Text style={[styles.alertCount, { color: tone }]}>
        {count > 0 ? `${count} Warnungen` : 'Keine Warnungen'}
      </Text>

      <View style={styles.list}>
        {alerts.slice(0, 4).map((item, index) => (
          <View key={index} style={styles.alertRow}>
            <View
              style={[
                styles.severityBar,
                { backgroundColor: severityColor(colors, item.severity) },
              ]}
            />
            <View style={{ flex: 1 }}>
              <Text numberOfLines={1} style={styles.alertEvent}>
                {item.event ?? item.title}
              </Text>
              <Text numberOfLines={1} style={styles.alertArea}>
                {item.area}
              </Text>
            </View>
          </View>
        ))}
      </View>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  column: { gap: 14 },
  mediaCard: { gap: 8, minHeight: 0 },
  mediaHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  speakerRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  speakerChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    maxWidth: '100%',
  },
  speakerChipActive: {
    backgroundColor: colors.accent,
    borderColor: colors.accent,
  },
  speakerChipText: { fontSize: 12, color: colors.inkSoft, flexShrink: 1 },
  speakerChipTextActive: { color: '#FFFFFF' },
  mediaTrack: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  mediaArtist: { color: colors.inkSoft, fontSize: 13 },
  mediaButtons: { flexDirection: 'row', gap: 8, marginTop: 2 },
  playButton: {
    width: 40,
    height: 34,
    borderRadius: radius.control,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  volumeRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  alertCard: { gap: 12, minHeight: 0 },
  activityCard: { gap: 12, minHeight: 0, flexShrink: 1 },
  alertHead: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
  },
  heading: {
    color: colors.ink,
    fontSize: type.cardTitle,
    fontWeight: '700',
  },
  alertSource: {
    color: colors.inkFaint,
    fontSize: 12,
    marginTop: 1,
  },
  alertCount: {
    fontSize: 28,
    fontWeight: '700',
  },
  weatherNow: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  weatherTemp: { color: colors.ink, fontSize: 30, fontWeight: '700', letterSpacing: -0.5 },
  weekRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 2,
  },
  dayCol: { alignItems: 'center', gap: 3, flex: 1 },
  dayName: { color: colors.inkSoft, fontSize: 11, fontWeight: '600' },
  dayHigh: { color: colors.ink, fontSize: 13, fontWeight: '700', fontVariant: ['tabular-nums'] },
  dayLow: { color: colors.inkFaint, fontSize: 12, fontVariant: ['tabular-nums'] },
  dayRain: { color: colors.accent, fontSize: 10, fontWeight: '600' },
  list: { gap: 10 },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  severityBar: {
    width: 3,
    height: 30,
    borderRadius: radius.pill,
  },
  alertEvent: {
    color: colors.ink,
    fontSize: 14,
    fontWeight: '500',
  },
  alertArea: {
    color: colors.inkSoft,
    fontSize: 12,
  },
  activityRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  bullet: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: colors.inkFaint,
  },
  activityName: {
    color: colors.ink,
    fontSize: 13,
    fontWeight: '500',
    flexShrink: 1,
  },
  activitySummary: {
    color: colors.inkSoft,
    fontSize: 13,
    flex: 1,
  },
  activityTime: {
    color: colors.inkFaint,
    fontSize: 12,
    fontVariant: ['tabular-nums'],
  },
  empty: {
    color: colors.inkSoft,
    fontSize: 13,
    lineHeight: 19,
  },
});
