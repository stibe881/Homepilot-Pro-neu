import React, { useEffect, useMemo, useState } from 'react';
import {
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
  useWindowDimensions,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Entity, HubSettings } from '../api/types';
import { EntityCard } from '../components/EntityCard';
import { HistoryChart } from '../components/HistoryChart';
import { Rail, Section } from '../components/Rail';
import { RoomTabs } from '../components/RoomTabs';
import { SceneRow } from '../components/SceneRow';
import { SidePanel } from '../components/SidePanel';
import { Toast } from '../components/Toast';
import { TopStrip } from '../components/TopStrip';
import { useHub } from '../hooks/useHub';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { breakpoints, Colors, space, type, useColors } from '../theme';
import { AutomationsScreen } from './AutomationsScreen';
import { SettingsScreen } from './SettingsScreen';
import { SystemScreen } from './SystemScreen';

const ALL_ROOMS = 'Alle';
const PANEL_WIDTH = 340;

interface Props {
  settings: HubSettings;
  onSaveSettings: (settings: HubSettings) => void;
}

/** Was gerade läuft – das will man beim Öffnen zuerst sehen. */
function isActive(entity: Entity): boolean {
  const value = entity.state.state;
  return value === 'on' || value === 'running' || value === 'alert';
}

export function DashboardScreen({ settings, onSaveSettings }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const {
    entities,
    activity,
    scenes,
    energy,
    status,
    user,
    error,
    pending,
    sendCommand,
    activateScene,
    dismissError,
  } = useHub(settings.url, settings.token);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [section, setSection] = useState<Section>('home');
  const [room, setRoom] = useState(ALL_ROOMS);
  const [now, setNow] = useState(() => new Date());
  const [gridWidth, setGridWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastTouch, setLastTouch] = useState(() => Date.now());

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Wandpanel: Bildschirm bleibt an, und nach drei Minuten ohne Berührung
  // kehrt die Ansicht zur Startseite zurück – ein fest montiertes iPad soll
  // nicht in den Einstellungen stehenbleiben.
  usePanelMode(!!settings.panel);
  usePushRegistration(settings, status === 'connected');
  useEffect(() => {
    if (!settings.panel) return;
    const timer = setInterval(() => {
      if (Date.now() - lastTouch > 180000) {
        setSection('home');
        setEditing(false);
        setRoom(ALL_ROOMS);
      }
    }, 30000);
    return () => clearInterval(timer);
  }, [settings.panel, lastTouch]);

  const favorites = settings.favorites ?? [];
  const hidden = settings.hidden ?? [];

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

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
  const inRoom =
    section === 'devices' || room === ALL_ROOMS
      ? entities
      : entities.filter((entity) => entity.room === room);

  // Ausgeblendete verschwinden von der Startseite, bleiben aber unter
  // „Geräte“ sichtbar – sonst käme man nie wieder an sie heran.
  const shown =
    section === 'home' && !editing
      ? inRoom.filter((entity) => !hidden.includes(entity.id))
      : inRoom;

  // Favoriten zuerst, dann was gerade läuft, dann der Rest.
  const byFavorite = (a: Entity, b: Entity) =>
    Number(favorites.includes(b.id)) - Number(favorites.includes(a.id));
  const running = section === 'home' ? shown.filter(isActive).sort(byFavorite) : [];
  const rest =
    section === 'home'
      ? shown.filter((entity) => !isActive(entity)).sort(byFavorite)
      : shown;

  const renderCard = (entity: Entity) => (
    <EntityCard
      key={entity.id}
      entity={entity}
      width={cardWidth!}
      pending={pending[entity.id]}
      pricePerKwh={energy?.price_per_kwh}
      currency={energy?.currency ?? 'CHF'}
      editing={editing}
      favorite={favorites.includes(entity.id)}
      hidden={hidden.includes(entity.id)}
      onToggleFavorite={() =>
        onSaveSettings({ ...settings, favorites: toggleIn(favorites, entity.id) })
      }
      onToggleHidden={() =>
        onSaveSettings({ ...settings, hidden: toggleIn(hidden, entity.id) })
      }
      onCommand={(command, data) => sendCommand(entity.id, command, data)}
      onPress={
        entity.kind === 'sensor' && !editing
          ? () => setExpanded((current) => (current === entity.id ? null : entity.id))
          : undefined
      }
      chart={
        expanded === entity.id && cardWidth ? (
          <HistoryChart entity={entity} settings={settings} width={cardWidth - 32} />
        ) : undefined
      }
    />
  );

  const content = () => {
    if (section === 'settings') {
      return <SettingsScreen initial={settings} onSave={onSaveSettings} user={user} embedded />;
    }
    if (section === 'automations') {
      return (
        <AutomationsScreen
          settings={settings}
          user={user}
          entities={entities}
          scenes={scenes}
        />
      );
    }
    if (section === 'system') {
      return <SystemScreen settings={settings} user={user} />;
    }
    return (
      <View style={hasSidePanel ? styles.split : styles.stack}>
        <View style={hasSidePanel ? styles.main : undefined}>
          {section === 'home' ? (
            <SceneRow scenes={scenes} onActivate={activateScene} />
          ) : null}
          {section === 'home' && rooms.length > 0 ? (
            <RoomTabs rooms={rooms} active={room} onSelect={setRoom} />
          ) : null}
          {section === 'home' || section === 'devices' ? (
            <Pressable
              onPress={() => setEditing((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Anpassen beenden' : 'Kacheln anpassen'}
              style={styles.editToggle}
            >
              <Text style={styles.editToggleText}>
                {editing ? 'Fertig' : 'Anpassen'}
              </Text>
            </Pressable>
          ) : null}

          <View
            style={styles.grid}
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
          >
            {cardWidth ? running.map(renderCard) : null}
          </View>
          {running.length > 0 && rest.length > 0 ? (
            <Text style={styles.sectionLabel}>Ruhend</Text>
          ) : null}
          <View style={styles.grid}>{cardWidth ? rest.map(renderCard) : null}</View>

          {inRoom.length === 0 ? (
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
    <View style={styles.root} onTouchStart={() => setLastTouch(Date.now())}>
      <View style={[styles.frame, { paddingTop: insets.top }]}>
        {hasRail ? (
          <Rail
            active={section}
            onSelect={setSection}
            vertical
            capabilities={user?.capabilities ?? []}
          />
        ) : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
        >
          <TopStrip entities={entities} status={status} now={now} />

          <View style={styles.greeting}>
            <Text
              style={[styles.greetingLine, !hasRail && { fontSize: type.greetingSmall }]}
            >
              {greetingName(settings, user)}
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
          capabilities={user?.capabilities ?? []}
        />
      ) : null}

      <Toast message={error} onDismiss={dismissError} bottomInset={insets.bottom} />
    </View>
  );
}

const PANEL_TAG = 'homepilot-panel';

/** Hält den Bildschirm wach, solange der Wandpanel-Modus aktiv ist.
 *
 * Bewusst über activate/deactivate statt useKeepAwake: Der Hook lässt sich
 * nicht abschalten, der Bildschirm bliebe also auch ohne Panel-Modus an.
 */
function usePanelMode(active: boolean) {
  useEffect(() => {
    if (!active) return;
    activateKeepAwakeAsync(PANEL_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(PANEL_TAG).catch(() => {});
    };
  }, [active]);
}

function greetingName(settings: HubSettings, user: { name: string } | null): string {
  const name = settings.name || user?.name;
  return name ? `Hallo ${name},` : 'Willkommen zuhause,';
}

function partOfDay(now: Date): string {
  const hour = now.getHours();
  if (hour < 11) return 'Guten Morgen.';
  if (hour < 18) return 'Schönen Tag.';
  return 'Guten Abend.';
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  root: { flex: 1 },
  frame: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: space.page,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 16,
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
  editToggle: {
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  editToggleText: {
    color: colors.onGradientSoft,
    fontSize: 13,
    fontWeight: '600',
  },
  sectionLabel: {
    color: colors.onGradientSoft,
    fontSize: 12,
    fontWeight: '700',
    letterSpacing: 1,
    textTransform: 'uppercase',
    marginTop: space.gap * 1.5,
  },
  empty: {
    color: colors.onGradientSoft,
    fontSize: 14,
    lineHeight: 21,
    marginTop: 24,
    maxWidth: 460,
  },
});
