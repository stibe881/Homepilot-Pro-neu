import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import {
  Image,
  Modal,
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
import { skyFromIcon } from '../components/CoverVisual';
import { HistoryChart } from '../components/HistoryChart';
import { Rail, Section } from '../components/Rail';
import { RoomTabs } from '../components/RoomTabs';
import { RoomTile } from '../components/RoomTile';
import { SceneRow } from '../components/SceneRow';
import { ActivityCard, SidePanel } from '../components/SidePanel';
import { Toast } from '../components/Toast';
import { TopStrip } from '../components/TopStrip';
import { useHub } from '../hooks/useHub';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { breakpoints, Colors, radius, space, type, useColors } from '../theme';
import { AutomationsScreen } from './AutomationsScreen';
import { FamilyScreen } from './FamilyScreen';
import { OverviewScreen } from './OverviewScreen';
import { SettingsScreen } from './SettingsScreen';
import { SystemScreen } from './SystemScreen';
import { UsersScreen } from './UsersScreen';

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
    setEntityRoom,
    reloadScenes,
    dismissError,
  } = useHub(settings.url, settings.token);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  const [section, setSection] = useState<Section>('start');
  const [room, setRoom] = useState(ALL_ROOMS);
  const [now, setNow] = useState(() => new Date());
  const [gridWidth, setGridWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastTouch, setLastTouch] = useState(() => Date.now());
  // Türklingel-Vollbild: pro Klingel-Ereignis einmal zeigen, bis es
  // weggewischt wird (Schlüssel = Kamera + Zeitpunkt des Klingelns).
  const [dismissedRing, setDismissedRing] = useState<string | null>(null);

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
        setSection('start');
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

  // Gäste sehen nur die freigegebenen Bereiche in der Navigation.
  const hiddenSections = useMemo<Section[]>(() => {
    if (!user || user.role !== 'gast') return [];
    const features = user.features ?? [];
    const result: Section[] = [];
    if (!features.includes('raeume')) result.push('home');
    if (!features.includes('licht')) result.push('light');
    if (!features.includes('storen')) result.push('covers');
    if (!features.includes('familie')) result.push('family');
    return result;
  }, [user]);

  const ringingCamera = entities.find(
    (entity) => entity.kind === 'camera' && entity.state.ring === 'on'
  );
  const ringKey = ringingCamera
    ? `${ringingCamera.id}:${ringingCamera.state.last_ring ?? ''}`
    : null;
  const frontDoorLock = entities.find(
    (entity) => entity.kind === 'lock' && entity.integration === 'ring'
  );

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

  // Aktuelle Wetterlage aus dem Wetter-Gerät – für den Himmel hinter den
  // Storen-Fenstern. Fehlt das Gerät, bleibt es sonnig.
  const sky = useMemo(() => {
    const weather = entities.find((entity) => entity.kind === 'weather');
    return skyFromIcon(weather?.state?.icon, weather?.state?.state);
  }, [entities]);

  // „Licht“ und „Storen“ zeigen genau eine Geräteart, „Geräte“ bewusst
  // alles – jeweils unabhängig vom gewählten Raum.
  const base =
    section === 'light'
      ? entities.filter((entity) => entity.kind === 'light')
      : section === 'covers'
        ? entities.filter((entity) => entity.kind === 'cover')
        : entities;
  const inRoom =
    section !== 'home' || room === ALL_ROOMS
      ? base
      : base.filter((entity) => entity.room === room);

  // Ausgeblendete verschwinden aus den Alltagsansichten, bleiben aber unter
  // „Geräte“ sichtbar – sonst käme man nie wieder an sie heran.
  const shown =
    (section === 'home' || section === 'light' || section === 'covers') && !editing
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
  const grouped = section === 'home' && room === ALL_ROOMS && rooms.length > 2 && editing;
  // Raum-Kacheln: die «Räume»-Übersicht zeigt je Raum eine Kachel mit den
  // Geräten darin; Antippen öffnet die volle Raumansicht.
  const roomTiles =
    section === 'home' && room === ALL_ROOMS && !editing && rooms.length > 0;
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

  // Ein einzelner Raum wird nach Kategorien gegliedert: Szenen des Raums
  // oben, dann Beleuchtung, Store, Medien, alles Übrige unter „Weitere“.
  // Leere Kategorien werden weggelassen. „Store“ (Storen/Rollläden)
  // erscheint so von selbst nur in Räumen mit solchen Geräten.
  const categorized = section === 'home' && room !== ALL_ROOMS && !editing;
  const roomScenes = useMemo(
    () => (categorized ? scenes.filter((scene) => scene.room === room) : []),
    [categorized, scenes, room]
  );
  const categories = useMemo(() => {
    if (!categorized) return [];
    const order: { kind: string; label: string }[] = [
      { kind: 'light', label: 'Beleuchtung' },
      { kind: 'cover', label: 'Store' },
      { kind: 'media_player', label: 'Medien' },
    ];
    const result: { key: string; label: string; items: Entity[] }[] = [];
    const used = new Set<string>();
    for (const cat of order) {
      const items = shown.filter((entity) => entity.kind === cat.kind).sort(byFavorite);
      if (items.length > 0) {
        result.push({ key: cat.kind, label: cat.label, items });
        items.forEach((entity) => used.add(entity.id));
      }
    }
    const weitere = shown.filter((entity) => !used.has(entity.id)).sort(byFavorite);
    if (weitere.length > 0) {
      result.push({ key: '__weitere', label: 'Weitere', items: weitere });
    }
    return result;
  }, [categorized, shown, favorites]);

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
      rooms={editing ? roomOrder : undefined}
      onSetRoom={
        editing ? (room) => setEntityRoom(entity.id, room) : undefined
      }
      onCommand={(command, data) => sendCommand(entity.id, command, data)}
      sky={entity.kind === 'cover' ? sky : undefined}
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
    if (section === 'start') {
      return (
        <View style={hasSidePanel ? styles.split : styles.stack}>
          <View style={hasSidePanel ? styles.main : undefined}>
            <OverviewScreen
              entities={entities}
              scenes={scenes}
              now={now}
              pending={pending}
              wide={hasRail}
              onCommand={sendCommand}
              onActivateScene={activateScene}
            />
          </View>
          <SidePanel entities={entities} width={hasSidePanel ? PANEL_WIDTH : undefined} />
        </View>
      );
    }
    if (section === 'family') {
      return <FamilyScreen settings={settings} entities={entities} currentUser={user} />;
    }

    // Zurück-Zeile für alles, was über „Einstellungen“ erreicht wird.
    const back = (
      <Pressable
        onPress={() => setSection('settings')}
        accessibilityRole="button"
        accessibilityLabel="Zurück zu Einstellungen"
        style={styles.backRow}
      >
        <Ionicons name="chevron-back" size={18} color={colors.onGradient} />
        <Text style={styles.backText}>Einstellungen</Text>
      </Pressable>
    );

    if (section === 'settings') {
      const caps = user?.capabilities ?? [];
      const items: {
        key: Section;
        icon: keyof typeof Ionicons.glyphMap;
        label: string;
        detail: string;
        show: boolean;
      }[] = [
        {
          key: 'users',
          icon: 'people-circle-outline',
          label: 'Benutzerverwaltung',
          detail: 'Zugänge und Rollen: Besitzer, Mitbewohner, Gast',
          show: caps.includes('manage_users'),
        },
        {
          key: 'devices',
          icon: 'list-outline',
          label: 'Geräte',
          detail: 'Alle Geräte, auch ausgeblendete',
          show: true,
        },
        {
          key: 'automations',
          icon: 'git-branch-outline',
          label: 'Abläufe',
          detail: 'Automationen und Szenen',
          show: caps.includes('view_automations'),
        },
        {
          key: 'system',
          icon: 'pulse-outline',
          label: 'System',
          detail: 'Integrationen, Energie, Konfiguration',
          show: caps.includes('view_system'),
        },
        {
          key: 'activity',
          icon: 'timer-outline',
          label: 'Zuletzt passiert',
          detail: 'Protokoll der letzten Änderungen',
          show: true,
        },
        {
          key: 'account',
          icon: 'person-outline',
          label: 'Konto & Verbindung',
          detail: 'Hub-Adresse, Token, Darstellung',
          show: true,
        },
      ];
      return (
        <View style={styles.settingsList}>
          {items
            .filter((item) => item.show)
            .map((item) => (
              <Pressable
                key={item.key}
                onPress={() => setSection(item.key)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.settingsItem, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name={item.icon} size={22} color={colors.ink} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.settingsLabel}>{item.label}</Text>
                  <Text style={styles.settingsDetail}>{item.detail}</Text>
                </View>
                <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
              </Pressable>
            ))}
        </View>
      );
    }
    if (section === 'activity') {
      return (
        <View style={styles.stack}>
          {back}
          <ActivityCard activity={activity} />
        </View>
      );
    }
    if (section === 'users') {
      return (
        <View style={styles.stack}>
          {back}
          <UsersScreen settings={settings} currentUser={user} />
        </View>
      );
    }
    if (section === 'account') {
      return (
        <View style={styles.stack}>
          {back}
          <SettingsScreen initial={settings} onSave={onSaveSettings} user={user} embedded />
        </View>
      );
    }
    if (section === 'automations') {
      return (
        <View style={styles.stack}>
          {back}
          <AutomationsScreen
            settings={settings}
            user={user}
            entities={entities}
            scenes={scenes}
            onScenesChanged={reloadScenes}
          />
        </View>
      );
    }
    if (section === 'system') {
      return (
        <View style={styles.stack}>
          {back}
          <SystemScreen settings={settings} user={user} entities={entities} />
        </View>
      );
    }
    return (
      <View style={hasSidePanel ? styles.split : styles.stack}>
        <View style={hasSidePanel ? styles.main : undefined}>
          {section === 'devices' ? back : null}
          {/* Im „Alle“-Modus alle Szenen, im Raum nur dessen Szenen. */}
          {section === 'home' && room === ALL_ROOMS ? (
            <SceneRow scenes={scenes} onActivate={activateScene} />
          ) : null}
          {section === 'home' && editing && rooms.length > 0 ? (
            <RoomTabs rooms={rooms} active={room} onSelect={setRoom} />
          ) : null}
          {section === 'home' && room !== ALL_ROOMS && !editing ? (
            <Pressable
              onPress={() => setRoom(ALL_ROOMS)}
              accessibilityRole="button"
              accessibilityLabel="Zurück zu Räume"
              style={styles.backRow}
            >
              <Ionicons name="chevron-back" size={18} color={colors.onGradient} />
              <Text style={styles.backText}>Räume</Text>
            </Pressable>
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

          {/* Messpunkt für die Kachelbreite immer vorhanden. */}
          <View
            style={grouped || categorized ? styles.measure : styles.grid}
            onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
          >
            {!grouped && !categorized && !roomTiles && cardWidth ? running.map(renderCard) : null}
          </View>

          {/* «Räume»: eine Kachel je Raum mit den Geräten darin. */}
          {roomTiles && gridWidth > 0 ? (
            <View style={styles.grid}>
              {rooms
                .filter((name) => name !== ALL_ROOMS)
                .map((name) => ({
                  name,
                  items: shown.filter((entity) => entity.room === name),
                }))
                .concat(
                  shown.some((entity) => !entity.room)
                    ? [{ name: 'Weitere', items: shown.filter((entity) => !entity.room) }]
                    : []
                )
                .filter((tile) => tile.items.length > 0)
                .map((tile) => (
                  <RoomTile
                    key={tile.name}
                    name={tile.name}
                    items={tile.items}
                    width={
                      hasRail
                        ? Math.floor((gridWidth - space.gap) / 2)
                        : gridWidth
                    }
                    onOpen={() => (tile.name === 'Weitere' ? undefined : setRoom(tile.name))}
                    onCommand={(entityId, command) => sendCommand(entityId, command)}
                  />
                ))}
            </View>
          ) : null}

          {/* Ein Raum: nach Kategorien (Szenen, Beleuchtung, Store, Medien). */}
          {categorized ? (
            <>
              {roomScenes.length > 0 ? (
                <View style={styles.group}>
                  <Text style={styles.groupLabel}>Szenen</Text>
                  <SceneRow scenes={roomScenes} onActivate={activateScene} />
                </View>
              ) : null}
              {categories.map((group) => (
                <View key={group.key} style={styles.group}>
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  <View style={styles.grid}>
                    {cardWidth ? group.items.map(renderCard) : null}
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {/* „Alle“ mit vielen Räumen: nach Zimmer gruppiert. */}
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

          {!grouped && !categorized && !roomTiles && running.length > 0 && rest.length > 0 ? (
            <Text style={styles.sectionLabel}>Ruhend</Text>
          ) : null}
          {!grouped && !categorized && !roomTiles ? (
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

        <SidePanel entities={entities} width={hasSidePanel ? PANEL_WIDTH : undefined} />
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
            hidden={hiddenSections}
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
          hidden={hiddenSections}
        />
      ) : null}

      {ringingCamera && ringKey && dismissedRing !== ringKey ? (
        <DoorbellOverlay
          camera={ringingCamera}
          lock={frontDoorLock}
          settings={settings}
          onCommand={(entityId, command) => sendCommand(entityId, command)}
          onDismiss={() => setDismissedRing(ringKey)}
          colors={colors}
          styles={styles}
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

/**
 * Vollbild, wenn es an der Haustüre klingelt: Kamerabild gross, ein Knopf
 * zum Öffnen (mit Zwei-Schritt-Bestätigung), einer zum Schliessen. Gedacht
 * fürs Wandpanel genauso wie fürs Telefon in der Hosentasche.
 */
function DoorbellOverlay({
  camera,
  lock,
  settings,
  onCommand,
  onDismiss,
  colors,
  styles,
}: {
  camera: Entity;
  lock?: Entity;
  settings: HubSettings;
  onCommand: (entityId: string, command: string) => void;
  onDismiss: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [confirm, setConfirm] = useState(false);
  const [tick, setTick] = useState(0);
  // Alle 3 Sekunden ein frisches Bild, solange das Vollbild offen ist.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 3000);
    return () => clearInterval(timer);
  }, []);
  const uri =
    settings.url && settings.token
      ? `${settings.url.replace(/\/+$/, '')}/api/entities/${encodeURIComponent(
          camera.id
        )}/snapshot?token=${encodeURIComponent(settings.token)}&t=${tick}`
      : null;

  return (
    <Modal visible animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.doorbellRoot}>
        <Text style={styles.doorbellTitle}>🔔 Es klingelt</Text>
        {uri ? (
          <Image source={{ uri }} style={styles.doorbellImage} resizeMode="cover" />
        ) : (
          <View style={[styles.doorbellImage, { alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="videocam-off-outline" size={40} color="#FFFFFF" />
          </View>
        )}
        <View style={styles.doorbellButtons}>
          {lock ? (
            <Pressable
              onPress={() => {
                if (confirm) {
                  onCommand(lock.id, 'open_door');
                  onDismiss();
                } else {
                  setConfirm(true);
                  setTimeout(() => setConfirm(false), 4000);
                }
              }}
              style={[styles.doorbellOpen, confirm && { backgroundColor: colors.danger }]}
            >
              <Ionicons name="key" size={22} color="#FFFFFF" />
              <Text style={styles.doorbellOpenText}>
                {confirm ? 'Wirklich öffnen?' : 'Haustüre öffnen'}
              </Text>
            </Pressable>
          ) : null}
          <Pressable onPress={onDismiss} style={styles.doorbellClose}>
            <Text style={styles.doorbellCloseText}>Schliessen</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
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
  backRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 2,
    alignSelf: 'flex-start',
    paddingVertical: 4,
    paddingRight: 10,
  },
  backText: { color: colors.onGradient, fontSize: 15, fontWeight: '600' },
  settingsList: { gap: 10 },
  settingsItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    backgroundColor: colors.surface,
    borderRadius: radius.card,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  settingsLabel: { color: colors.ink, fontSize: 16, fontWeight: '600' },
  settingsDetail: { color: colors.inkSoft, fontSize: 13, marginTop: 1 },
  doorbellRoot: {
    flex: 1,
    backgroundColor: '#10141B',
    padding: 22,
    paddingTop: 64,
    gap: 18,
  },
  doorbellTitle: { color: '#FFFFFF', fontSize: 28, fontWeight: '700', textAlign: 'center' },
  doorbellImage: {
    flex: 1,
    borderRadius: radius.card,
    backgroundColor: '#1C2430',
    width: '100%',
  },
  doorbellButtons: { gap: 10 },
  doorbellOpen: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    backgroundColor: colors.on,
    borderRadius: radius.control,
    paddingVertical: 18,
  },
  doorbellOpenText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  doorbellClose: { alignItems: 'center', paddingVertical: 12 },
  doorbellCloseText: { color: 'rgba(255,255,255,0.7)', fontSize: 15, fontWeight: '600' },
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
