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
    roomOrder,
    status,
    user,
    error,
    pending,
    sendCommand,
    activateScene,
    reloadScenes,
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

  // Räume in der Reihenfolge aus der config.yaml (meistgenutzte zuerst),
  // nicht alphabetisch. Räume mit Geräten, die (noch) nicht in der Config
  // stehen, kommen hinten dran, damit nie eines verlorengeht.
  const rooms = useMemo(() => {
    const withDevices = new Set(
      entities.map((entity) => entity.room).filter(Boolean) as string[]
    );
    const ordered = roomOrder.filter((name) => withDevices.has(name));
    const extra = Array.from(withDevices)
      .filter((name) => !roomOrder.includes(name))
      .sort((a, b) => a.localeCompare(b));
    const named = [...ordered, ...extra];
    return named.length > 0 ? [ALL_ROOMS, ...named] : [];
  }, [entities, roomOrder]);

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

  // Bei vielen Räumen wird die Startseite im „Alle“-Modus nach Räumen
  // gruppiert (Überschrift je Zimmer), damit man das ganze Haus auf einen
  // Blick durchscrollt und alles schnell erreicht. Favoriten stehen als
  // eigene Gruppe ganz oben – der schnelle Griff ins andere Zimmer.
  const grouped = section === 'home' && room === ALL_ROOMS && rooms.length > 2;
  const groups = useMemo(() => {
    if (!grouped) return [];
    const order = rooms.filter((name) => name !== ALL_ROOMS);
    const favs = shown.filter((entity) => favorites.includes(entity.id));
    const result: { key: string; label: string; items: Entity[] }[] = [];
    if (favs.length > 0) {
      result.push({ key: '__fav', label: 'Favoriten', items: favs });
    }
    for (const name of order) {
      const items = shown.filter(
        (entity) => entity.room === name && !favorites.includes(entity.id)
      );
      if (items.length > 0) result.push({ key: name, label: name, items });
    }
    const noRoom = shown.filter(
      (entity) => !entity.room && !favorites.includes(entity.id)
    );
    if (noRoom.length > 0) {
      result.push({ key: '__none', label: 'Weitere', items: noRoom });
    }
    return result;
  }, [grouped, rooms, shown, favorites]);

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
      snapshotUri={
        // Kameras: Livebild. Sauger: die Karte – beides über denselben Endpunkt.
        (entity.kind === 'camera' || entity.kind === 'vacuum') &&
        settings.url &&
        settings.token
          ? `${settings.url.replace(/\/+$/, '')}/api/entities/${encodeURIComponent(
              entity.id
            )}/snapshot?token=${encodeURIComponent(settings.token)}`
          : undefined
      }
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
          onScenesChanged={reloadScenes}
        />
      );
    }
    if (section === 'system') {
      return <SystemScreen settings={settings} user={user} entities={entities} />;
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

          {/* Messpunkt für die Kachelbreite immer vorhanden, auch gruppiert. */}
          <View
            style={grouped ? styles.measure : styles.grid}
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
          >
            {!grouped && cardWidth ? running.map(renderCard) : null}
          </View>

          {grouped
            ? groups.map((group) => (
                <View key={group.key} style={styles.group}>
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  <View style={styles.grid}>
                    {cardWidth ? group.items.map(renderCard) : null}
                  </View>
                </View>
              ))
            : null}

          {!grouped && running.length > 0 && rest.length > 0 ? (
            <Text style={styles.sectionLabel}>Ruhend</Text>
          ) : null}
          {!grouped ? (
            <View style={styles.grid}>{cardWidth ? rest.map(renderCard) : null}</View>
          ) : null}

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
  // Nur zum Messen der Breite, ohne eigenen Abstand.
  measure: { height: 0 },
  group: { marginTop: space.gap * 1.2 },
  groupLabel: {
    color: colors.onGradient,
    fontSize: 19,
    fontWeight: '700',
    letterSpacing: -0.2,
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
