import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Linking, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { ConnectionStatus } from '../hooks/useHub';
import { Colors, radius, type, useColors } from '../theme';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'verbunden',
  connecting: 'verbinde …',
  disconnected: 'getrennt',
};

function statusColor(colors: Colors, status: ConnectionStatus): string {
  if (status === 'connected') return colors.on;
  return status === 'connecting' ? colors.warn : colors.danger;
}

/** Der nächste echte Termin – dasselbe Ereignis, das der Hub in
 *  `state.state`/`next_start` zusammenfasst, hier aber mit allem drum
 *  herum (Ort, Ende, ganztägig) für die Detailansicht (rein, testbar). */
export function nextCalendarEvent(calendar: Entity | undefined): any | null {
  const events: any[] = Array.isArray(calendar?.state.events) ? calendar!.state.events : [];
  return events.find((event) => !event.birthday) ?? null;
}

/** Routen-Adressen zu einem Termin-Ort (rein, testbar). Beide zeigen die
 *  Route ab dem aktuellen Standort, nicht bloss die Karte des Ziels. */
export function googleMapsRoute(destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

export function appleMapsRoute(destination: string): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`;
}

/**
 * Kopfzeile: links Messwerte aus dem Haus, rechts Verbindung und Uhrzeit.
 *
 * Gezeigt werden die ersten Sensoren mit passender Einheit – ohne Sensoren
 * bleibt die Zeile leer statt Platzhalter zu erfinden. Die Licht- und die
 * Termin-Kachel lassen sich antippen: Licht zeigt, was genau an ist,
 * Termin den ganzen Eintrag statt nur der Kurzfassung.
 */
export function TopStrip({
  entities,
  status,
  now,
  onCommand,
}: {
  entities: Entity[];
  status: ConnectionStatus;
  now: Date;
  /** Für «Licht aus» direkt aus dem Popup – ohne sie bleibt die Zeile
   *  reine Anzeige. */
  onCommand?: (entityId: string, command: string, data?: Record<string, any>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [lightsOpen, setLightsOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  // Nachfrage «womit öffnen?» nach dem Tipp auf den Termin-Ort.
  const [routeAsk, setRouteAsk] = useState(false);
  const temperature = entities.find(
    (entity) => entity.kind === 'sensor' && entity.state.unit === '°C'
  );
  const humidity = entities.find(
    (entity) => entity.kind === 'sensor' && entity.state.unit === '%'
  );
  const people = entities.find((entity) => entity.id.endsWith('anyone_home'));

  // Die Zwei-Sekunden-Übersicht: Was ist an, was läuft, was steht an?
  const litEntities = entities.filter(
    (entity) =>
      (entity.kind === 'light' || entity.kind === 'switch') &&
      entity.state.state === 'on'
  );
  const lightsOn = litEntities.length;
  const vacuum = entities.find(
    (entity) => entity.kind === 'vacuum' && entity.state.state === 'cleaning'
  );
  const calendar = entities.find(
    (entity) => entity.kind === 'calendar' && entity.state.next_start
  );
  const event = nextCalendarEvent(calendar);
  const alerts = entities.find(
    (entity) => entity.kind === 'alert' && entity.state.state === 'alert'
  );

  return (
    <View style={styles.row}>
      <View style={styles.chips}>
        {temperature ? (
          <Chip icon="thermometer-outline" text={`${round(temperature.state.state)} °C`} />
        ) : null}
        {humidity ? (
          <Chip icon="water-outline" text={`${round(humidity.state.state)} %`} />
        ) : null}
        {people ? (
          <Chip
            icon="people-outline"
            text={people.state.state === 'on' ? 'jemand da' : 'niemand da'}
          />
        ) : null}
        {lightsOn > 0 ? (
          <Chip
            icon="bulb-outline"
            text={lightsOn === 1 ? '1 an' : `${lightsOn} an`}
            onPress={() => setLightsOpen(true)}
          />
        ) : null}
        {vacuum ? <Chip icon="sparkles-outline" text="saugt" /> : null}
        {calendar ? (
          <Chip
            icon="calendar-outline"
            text={`${clockTime(calendar.state.next_start)} ${calendar.state.state}`}
            onPress={event ? () => setEventOpen(true) : undefined}
          />
        ) : null}
        {alerts ? (
          <Chip
            icon="warning-outline"
            text={`${alerts.state.count ?? ''} Warnung${alerts.state.count === 1 ? '' : 'en'}`}
            tone={colors.warn}
          />
        ) : null}
      </View>

      <View style={styles.chips}>
        <View style={styles.chip}>
          <View style={[styles.dot, { backgroundColor: statusColor(colors, status) }]} />
          <Text style={styles.chipText}>{STATUS_LABEL[status]}</Text>
        </View>
        <Text style={styles.clock}>
          {now.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })}
        </Text>
      </View>

      <Modal
        visible={lightsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLightsOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setLightsOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.heading}>
              {litEntities.length === 1 ? '1 Licht an' : `${litEntities.length} Lichter an`}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {litEntities.map((entity) => (
                <View key={entity.id} style={styles.lightRow}>
                  <Ionicons name="bulb" size={18} color={colors.warn} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lightName}>{entity.name}</Text>
                    {entity.room ? (
                      <Text style={styles.lightRoom}>{entity.room}</Text>
                    ) : null}
                  </View>
                  {onCommand && entity.commands.includes('turn_off') ? (
                    <Pressable
                      onPress={() => onCommand(entity.id, 'turn_off')}
                      accessibilityRole="button"
                      accessibilityLabel={`${entity.name} ausschalten`}
                      style={({ pressed }) => [styles.offButton, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.offButtonText}>Aus</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setLightsOpen(false)} style={styles.close}>
              <Text style={styles.closeText}>Schliessen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={eventOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setEventOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setEventOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {event ? (
              <>
                <Text style={styles.heading}>{event.summary ?? '—'}</Text>
                <Text style={styles.eventWhen}>{eventWhenText(event)}</Text>
                {event.location ? (
                  <Pressable
                    onPress={() => setRouteAsk((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={`Route zu ${event.location}`}
                    style={({ pressed }) => [
                      styles.eventLocationRow,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Ionicons name="location-outline" size={16} color={colors.accent} />
                    <Text style={[styles.eventLocation, { color: colors.accent }]}>
                      {event.location}
                    </Text>
                    <Ionicons
                      name={routeAsk ? 'chevron-up' : 'navigate-outline'}
                      size={14}
                      color={colors.inkSoft}
                    />
                  </Pressable>
                ) : null}
                {routeAsk && event.location ? (
                  <View style={styles.routeRow}>
                    <Pressable
                      onPress={() => {
                        Linking.openURL(googleMapsRoute(String(event.location))).catch(() => {});
                        setRouteAsk(false);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.routeButton, pressed && { opacity: 0.7 }]}
                    >
                      <Ionicons name="map-outline" size={15} color={colors.ink} />
                      <Text style={styles.routeButtonText}>Google Maps</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        Linking.openURL(appleMapsRoute(String(event.location))).catch(() => {});
                        setRouteAsk(false);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.routeButton, pressed && { opacity: 0.7 }]}
                    >
                      <Ionicons name="navigate-circle-outline" size={15} color={colors.ink} />
                      <Text style={styles.routeButtonText}>Apple Karten</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}
            <Pressable
              onPress={() => {
                setEventOpen(false);
                setRouteAsk(false);
              }}
              style={styles.close}
            >
              <Text style={styles.closeText}>Schliessen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

function Chip({
  icon,
  text,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tone?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const content = (
    <>
      <Ionicons name={icon} size={15} color={tone ?? colors.onGradientSoft} />
      <Text style={[styles.chipText, tone ? { color: tone } : null]} numberOfLines={1}>
        {text}
      </Text>
    </>
  );
  if (!onPress) return <View style={styles.chip}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  );
}

function round(value: any): string {
  return typeof value === 'number' ? String(Math.round(value * 10) / 10) : String(value ?? '–');
}

/** "16:00" aus einem ISO-Zeitstempel – ganztägige Termine haben keinen. */
function clockTime(iso: any): string {
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
}

/** Datum/Zeit eines Termins ausgeschrieben – für die Detailansicht (rein,
 *  testbar). */
export function eventWhenText(event: any): string {
  if (event.all_day) {
    const date = new Date(String(event.start));
    if (Number.isNaN(date.getTime())) return 'ganztägig';
    return `Ganztägig · ${date.toLocaleDateString('de-CH', {
      weekday: 'long',
      day: 'numeric',
      month: 'long',
    })}`;
  }
  const start = new Date(String(event.start));
  if (Number.isNaN(start.getTime())) return '';
  const day = start.toLocaleDateString('de-CH', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
  });
  const startTime = start.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' });
  const end = event.end ? new Date(String(event.end)) : null;
  const endTime =
    end && !Number.isNaN(end.getTime())
      ? end.toLocaleTimeString('de-CH', { hour: '2-digit', minute: '2-digit' })
      : null;
  return endTime ? `${day} · ${startTime}–${endTime}` : `${day} · ${startTime}`;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    rowGap: 4,
    flexShrink: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: {
    color: colors.onGradientSoft,
    fontSize: 13,
    fontWeight: '500',
  },
  clock: {
    color: colors.onGradient,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    gap: 10,
    padding: 18,
    borderRadius: radius.card,
    backgroundColor: colors.gradient[1],
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
  lightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  lightName: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  lightRoom: { color: colors.inkFaint, fontSize: 12 },
  offButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  offButtonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  eventWhen: { color: colors.inkSoft, fontSize: 15, fontWeight: '500' },
  eventLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventLocation: { color: colors.inkSoft, fontSize: 14, flexShrink: 1 },
  routeRow: { flexDirection: 'row', gap: 8 },
  routeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  routeButtonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  close: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  closeText: { color: colors.inkSoft, fontSize: 15, fontWeight: '700' },
});
