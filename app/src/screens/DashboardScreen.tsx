import React, { useEffect, useMemo, useState } from 'react';
import {
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Entity, HubSettings } from '../api/types';
import { EntityCard } from '../components/EntityCard';
import { Rail, Section } from '../components/Rail';
import { RoomTabs } from '../components/RoomTabs';
import { SidePanel } from '../components/SidePanel';
import { TopStrip } from '../components/TopStrip';
import { useHub } from '../hooks/useHub';
import { breakpoints, colors, space, type } from '../theme';
import { AutomationsScreen } from './AutomationsScreen';
import { SettingsScreen } from './SettingsScreen';

const ALL_ROOMS = 'Alle';
const PANEL_WIDTH = 340;

interface Props {
  settings: HubSettings;
  onSaveSettings: (settings: HubSettings) => void;
}

export function DashboardScreen({ settings, onSaveSettings }: Props) {
  const { entities, activity, status, sendCommand } = useHub(
    settings.url,
    settings.token
  );
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [section, setSection] = useState<Section>('home');
  const [room, setRoom] = useState(ALL_ROOMS);
  const [now, setNow] = useState(() => new Date());
  const [gridWidth, setGridWidth] = useState(0);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  const hasRail = width >= breakpoints.rail;
  const hasSidePanel = width >= breakpoints.sidePanel;
  const columns = hasRail ? 3 : width >= 380 ? 2 : 1;
  const cardWidth =
    gridWidth > 0
      ? Math.floor((gridWidth - space.gap * (columns - 1)) / columns)
      : undefined;

  const rooms = useMemo(() => {
    const named = Array.from(
      new Set(entities.map((entity) => entity.room).filter(Boolean) as string[])
    ).sort((a, b) => a.localeCompare(b));
    return named.length > 0 ? [ALL_ROOMS, ...named] : [];
  }, [entities]);

  // „Geräte“ zeigt bewusst alles, unabhängig vom gewählten Raum.
  const visible =
    section === 'devices' || room === ALL_ROOMS
      ? entities
      : entities.filter((entity) => entity.room === room);

  const content = () => {
    if (section === 'settings') {
      return <SettingsScreen initial={settings} onSave={onSaveSettings} embedded />;
    }
    if (section === 'automations') {
      return <AutomationsScreen settings={settings} />;
    }
    return (
      <View style={hasSidePanel ? styles.split : styles.stack}>
        {/* flex:1 nur in der Zeile – im gestapelten Layout würde es die
            Kacheln über die rechte Spalte legen. */}
        <View style={hasSidePanel ? styles.main : undefined}>
          {section === 'home' && rooms.length > 0 ? (
            <RoomTabs rooms={rooms} active={room} onSelect={setRoom} />
          ) : null}
          <View
            style={styles.grid}
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
          >
            {cardWidth
              ? visible.map((entity: Entity) => (
                  <EntityCard
                    key={entity.id}
                    entity={entity}
                    width={cardWidth}
                    onCommand={(command, data) =>
                      sendCommand(entity.id, command, data)
                    }
                  />
                ))
              : null}
          </View>
          {visible.length === 0 ? (
            <Text style={styles.empty}>
              {status === 'connected'
                ? room === ALL_ROOMS
                  ? 'Noch keine Geräte – Integrationen in der config.yaml des Hubs aktivieren.'
                  : `Für ${room} ist noch nichts zugeordnet.`
                : 'Warte auf Verbindung zum Hub …'}
            </Text>
          ) : null}
        </View>

        <SidePanel
          entities={entities}
          activity={activity}
          width={hasSidePanel ? PANEL_WIDTH : undefined}
        />
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <View style={[styles.frame, { paddingTop: insets.top }]}>
        {hasRail ? <Rail active={section} onSelect={setSection} vertical /> : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <TopStrip entities={entities} status={status} now={now} />

          <View style={styles.greeting}>
            <Text
              style={[
                styles.greetingLine,
                !hasRail && { fontSize: type.greetingSmall },
              ]}
            >
              {settings.name ? `Hallo ${settings.name},` : 'Willkommen zuhause,'}
            </Text>
            <Text
              style={[
                styles.greetingLine,
                styles.greetingSecond,
                !hasRail && { fontSize: type.greetingSmall },
              ]}
            >
              {partOfDay(now)}
            </Text>
          </View>

          {content()}
        </ScrollView>
      </View>

      {!hasRail ? (
        <Rail
          active={section}
          onSelect={setSection}
          vertical={false}
          bottomInset={insets.bottom}
        />
      ) : null}
    </View>
  );
}

function partOfDay(now: Date): string {
  const hour = now.getHours();
  if (hour < 11) return 'Guten Morgen.';
  if (hour < 18) return 'Schönen Tag.';
  return 'Guten Abend.';
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  frame: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: space.page,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 18,
  },
  greeting: { gap: 2 },
  greetingLine: {
    color: colors.onGradient,
    fontSize: type.greeting,
    fontWeight: '300',
    letterSpacing: 0.2,
  },
  greetingSecond: { color: colors.onGradientSoft },
  split: {
    flexDirection: 'row',
    gap: space.gap * 1.4,
    alignItems: 'flex-start',
  },
  stack: { gap: space.gap * 1.4 },
  main: { flex: 1 },
  grid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: space.gap,
    marginTop: space.gap,
  },
  empty: {
    color: colors.onGradientSoft,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 24,
    maxWidth: 460,
  },
});
