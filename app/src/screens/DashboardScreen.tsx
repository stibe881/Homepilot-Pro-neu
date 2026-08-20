import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { Entity, HubSettings } from '../api/types';
import { Bar } from '../components/Bar';
import { Card } from '../components/Card';
import { DraggableList } from '../components/DraggableList';
import { CellLayout, DragCell, reorderByDrop } from '../components/DragGrid';
import { EntityCard } from '../components/EntityCard';
import { skyFromIcon } from '../components/CoverVisual';
import { HistoryChart } from '../components/HistoryChart';
import { CameraLive } from '../components/CameraLive';
import { CameraTimeline } from '../components/CameraTimeline';
import { OpenDoors } from '../components/OpenDoors';
import { RunningAppliances } from '../components/RunningAppliances';
import { Rail, Section } from '../components/Rail';
import { RoomTabs } from '../components/RoomTabs';
import { RoomTile } from '../components/RoomTile';
import { SceneRow } from '../components/SceneRow';
import { AllOff } from '../components/AllOff';
import { GlobalSearch } from '../components/GlobalSearch';
import { PushPrefs } from '../components/PushPrefs';
import { ActivityCard, SidePanel } from '../components/SidePanel';
import { Toast, UndoToast } from '../components/Toast';
import { TopStrip } from '../components/TopStrip';
import { useHub } from '../hooks/useHub';
import { Tap, useNotificationTap } from '../hooks/useNotificationTap';
import { usePrefs } from '../hooks/usePrefs';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { breakpoints, Colors, radius, space, type, useColors } from '../theme';
import { AutomationsScreen } from './AutomationsScreen';
import { FamilyScreen } from './FamilyScreen';
import { OverviewScreen } from './OverviewScreen';
import { SettingsScreen } from './SettingsScreen';
import { AlarmScreen } from './AlarmScreen';
import { EnergyScreen } from './EnergyScreen';
import { SpeakersScreen } from './SpeakersScreen';
import { SystemScreen } from './SystemScreen';
import { EntityHistory } from '../components/EntityHistory';
import { Broadcast } from '../components/Broadcast';
import { GoodNight } from '../components/GoodNight';
import { WhatsNew } from '../components/WhatsNew';
import { LightGroups } from '../components/LightGroups';
import { UsersScreen } from './UsersScreen';

const ALL_ROOMS = 'Alle';
/** Befehle, die ein gesperrtes Gerät nur nach Rückfrage annimmt. Lesende
 *  Befehle und Lautstärke gehören nicht dazu – gesperrt ist der Herd, nicht
 *  die Fernbedienung. */
const SWITCHING = new Set([
  'turn_on',
  'turn_off',
  'toggle',
  'open',
  'close',
  'set_position',
  'start',
  'stop',
  'unlock',
]);
// Pseudo-Raum für Geräte ohne Zuordnung – als Kachel und Ansicht öffenbar.
const NO_ROOM = 'Weitere';
// Gerätearten mit eigenem Verlauf (Tipp auf die Kachel unter Geräte).
// Sensoren öffnen stattdessen ihre Messwert-Kurve, Kameras das Livebild.
const HISTORY_KINDS = new Set([
  'light',
  'switch',
  'cover',
  'lock',
  'climate',
  'vacuum',
  'appliance',
  'media_player',
  'binary_sensor',
]);
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
    cachedAt,
    pending,
    undo,
    undoLast,
    dismissUndo,
    sendCommand,
    activateScene,
    setEntityRoom,
    setEntityMeta,
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
  const [reorderOpen, setReorderOpen] = useState(false);
  // Suchbegriff der Geräteliste.
  const [query, setQuery] = useState('');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastTouch, setLastTouch] = useState(() => Date.now());
  // Türklingel-Vollbild: pro Klingel-Ereignis einmal zeigen, bis es
  // weggewischt wird (Schlüssel = Kamera + Zeitpunkt des Klingelns).
  const [dismissedRing, setDismissedRing] = useState<string | null>(null);
  // Angetippte Kamera im Vollbild (Entitäts-ID, damit Live-Updates ankommen).
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  // Gerät, dessen Verlauf gerade offen ist (Geräte-Ansicht, Tipp auf die Kachel).
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  // Auf der Startseite markierte Countdowns aus dem Familie-Modul.
  const [startCountdowns, setStartCountdowns] = useState<
    { text: string; date: string; on_start?: boolean }[]
  >([]);
  const [searchOpen, setSearchOpen] = useState(false);
  // Abläufe – nur für die Suche; die Liste selbst lebt im Ablauf-Screen.
  const [automations, setAutomations] = useState<
    { id: string; alias: string; category?: string | null }[]
  >([]);
  // Rückfrage vor dem Schalten eines gesperrten Geräts.
  const [confirm, setConfirm] = useState<{
    entity: Entity;
    command: string;
    data?: Record<string, any>;
  } | null>(null);

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 30000);
    return () => clearInterval(timer);
  }, []);

  // Startseiten-Countdowns laden (und minütlich frisch halten, damit ein
  // frisch gesetzter Stern zeitnah erscheint).
  useEffect(() => {
    if (!settings.url || !settings.token) return;
    let alive = true;
    const load = () =>
      fetch(`${settings.url}/api/family/countdowns`, {
        headers: { Authorization: `Bearer ${settings.token}` },
      })
        .then((response) => (response.ok ? response.json() : []))
        .then((rows) => {
          if (alive) setStartCountdowns(Array.isArray(rows) ? rows : []);
        })
        .catch(() => {});
    load();
    const timer = setInterval(load, 60000);
    return () => {
      alive = false;
      clearInterval(timer);
    };
  }, [settings.url, settings.token]);

  // Die Ablaufnamen einmal holen, damit die Suche sie kennt.
  useEffect(() => {
    if (!settings.url || !settings.token || status !== 'connected') return;
    let alive = true;
    fetch(`${settings.url}/api/automations`, {
      headers: { Authorization: `Bearer ${settings.token}` },
    })
      .then((response) => (response.ok ? response.json() : []))
      .then((rows) => {
        if (alive) setAutomations(Array.isArray(rows) ? rows : []);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings.url, settings.token, status]);

  // Beim Verlassen der Geräteliste die Suche zurücksetzen – wer später
  // zurückkommt, will die volle Liste sehen, nicht den alten Suchbegriff.
  useEffect(() => {
    if (section !== 'devices') setQuery('');
  }, [section]);

  // Wandpanel: Bildschirm bleibt an, und nach drei Minuten ohne Berührung
  // kehrt die Ansicht zur Startseite zurück – ein fest montiertes iPad soll
  // nicht in den Einstellungen stehenbleiben.
  usePanelMode(!!settings.panel);
  const push = usePushRegistration(settings, status === 'connected');
  // Persönliche Reihenfolgen – je Benutzer auf dem Hub, geräteübergreifend.
  const { prefs, setOrder, setSeenChanges } = usePrefs(settings, status === 'connected');

  // Antippen einer Alarm-Nachricht führt direkt zur Kamera des betroffenen
  // Raums. Wer nachts geweckt wird, soll nicht erst durch die Räume suchen.
  const onNotificationTap = useCallback((tap: Tap) => {
    if (tap.camera) {
      setFullscreen(tap.camera);
      return;
    }
    if (tap.type === 'alarm') setSection('alarm');
  }, []);
  useNotificationTap(onNotificationTap);

  // Abkürzungen aus dem Widget und von NFC-Aufklebern: homepilot://door
  // öffnet die Türe (mit Rückfrage), //alloff und //alarm springen an die
  // passende Stelle. Bewusst kein blindes Schalten aus dem Sperrbildschirm
  // heraus - die Türe geht erst nach dem zweiten Tipp auf.
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url || !url.startsWith('homepilot://')) return;
      const what = url.replace('homepilot://', '').split(/[/?]/)[0];
      if (what === 'door') {
        const door =
          entities.find(
            (entity) => entity.kind === 'lock' && entity.commands.includes('open_door')
          ) ?? entities.find((entity) => entity.kind === 'lock');
        if (door) {
          setSection('home');
          setConfirm({ entity: door, command: door.commands.includes('open_door') ? 'open_door' : 'unlatch' });
        }
      } else if (what === 'alloff') {
        setSection('home');
        setRoom(ALL_ROOMS);
      } else if (what === 'alarm') {
        setSection('alarm');
      }
    };
    Linking.getInitialURL().then(handle).catch(() => {});
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, [entities]);
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
  const locked = settings.locked ?? [];

  /**
   * Ein gesperrtes Gerät schaltet nur nach ausdrücklicher Rückfrage.
   *
   * Zentral hier und nicht in der Kachel: So greift die Sperre auf jedem
   * Weg – Kachel, Raumfliese, Schnellzugriff –, statt an der einen Stelle
   * zu fehlen, an die niemand gedacht hat.
   */
  const guardedCommand = useCallback(
    (entityId: string, command: string, data?: Record<string, any>) => {
      const entity = entities.find((item) => item.id === entityId);
      if (entity && locked.includes(entityId) && SWITCHING.has(command)) {
        setConfirm({ entity, command, data });
        return;
      }
      sendCommand(entityId, command, data);
    },
    [entities, locked, sendCommand]
  );

  const toggleIn = (list: string[], id: string) =>
    list.includes(id) ? list.filter((item) => item !== id) : [...list, id];

  // Gäste sehen nur die freigegebenen Bereiche in der Navigation.
  const hiddenSections = useMemo<Section[]>(() => {
    const result: Section[] = [];
    // Ohne Kameras kein Kamera-Reiter – ein leerer Bereich hilft niemandem.
    if (!entities.some((entity) => entity.kind === 'camera')) result.push('cameras');
    if (!user || user.role !== 'gast') return result;
    const features = user.features ?? [];
    if (!features.includes('raeume')) result.push('home');
    if (!features.includes('licht')) result.push('light');
    if (!features.includes('storen')) result.push('covers');
    if (!features.includes('familie')) result.push('family');
    if (!features.includes('kameras')) result.push('cameras');
    return result;
  }, [user, entities]);

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
  // Kameras brauchen Fläche – dort weniger Spalten als bei Schaltkacheln.
  const columns =
    section === 'cameras' ? (hasRail ? 2 : 1) : hasRail ? 3 : width >= 380 ? 2 : 1;
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

  // Alle vergebenen Gruppennamen – für die Auswahl im Anpassen-Modus.
  const groupNames = useMemo(
    () =>
      Array.from(
        new Set(entities.map((entity) => entity.group).filter(Boolean) as string[])
      ).sort((a, b) => a.localeCompare(b)),
    [entities]
  );

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
        : section === 'cameras'
          ? entities.filter((entity) => entity.kind === 'camera')
          : entities;
  const inRoom =
    section !== 'home' || room === ALL_ROOMS
      ? base
      : room === NO_ROOM
        ? base.filter((entity) => !entity.room)
        : base.filter((entity) => entity.room === room);

  // Ausgeblendete und in einer Leuchte aufgegangene Spots verschwinden
  // aus den Alltagsansichten, bleiben aber unter „Geräte“ sichtbar –
  // sonst käme man nie wieder an sie heran, und beim Ausrichten nach dem
  // Einbau braucht man den einzelnen Spot.
  const shown =
    (section === 'home' ||
      section === 'light' ||
      section === 'covers' ||
      section === 'cameras') &&
    !editing
      ? inRoom.filter(
          (entity) => !hidden.includes(entity.id) && !entity.combined_into
        )
      : inRoom;

  // Favoriten zuerst, dann was gerade läuft, dann der Rest.
  const byFavorite = (a: Entity, b: Entity) =>
    Number(favorites.includes(b.id)) - Number(favorites.includes(a.id));
  // Welche Ansicht hat gerade eine eigene Reihenfolge? Räume je Raum,
  // die Geräteart-Seiten je Seite. «Alle» auf der Startseite bewusst
  // nicht: Dort gruppiert die Ansicht selbst.
  const orderScope =
    section === 'devices'
      ? 'devices'
      : section === 'light'
        ? 'light'
        : section === 'covers'
          ? 'covers'
          : section === 'home' && room !== ALL_ROOMS
            ? `room:${room}`
            : null;
  // Selbst gezogene Reihenfolge – je Benutzer auf dem Hub gespeichert.
  // Die alte, nur lokal gespeicherte Geräte-Reihenfolge bleibt als
  // Rückfalloption, bis einmal neu gezogen wurde.
  const orderIds =
    (orderScope ? prefs.order?.[orderScope] : undefined) ??
    (orderScope === 'devices' ? settings.order ?? [] : []);
  const orderIndex = new Map(orderIds.map((id, i) => [id, i]));
  const byOrder = (a: Entity, b: Entity) => {
    const ai = orderIndex.has(a.id) ? (orderIndex.get(a.id) as number) : Infinity;
    const bi = orderIndex.has(b.id) ? (orderIndex.get(b.id) as number) : Infinity;
    return ai !== bi ? ai - bi : a.name.localeCompare(b.name);
  };
  // Suchfeld der Geräteliste: sucht über Name, Raum, Gruppe und Integration,
  // damit «Küche», «Storen Süd» oder «hue» genauso finden wie der Gerätename.
  const needle = query.trim().toLowerCase();
  const searching = section === 'devices' && needle.length > 0;
  const found = searching
    ? shown.filter((entity) =>
        [entity.name, entity.room ?? '', entity.group ?? '', entity.integration]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      )
    : shown;

  // Hat ein Raum eine selbst gezogene Reihenfolge, gilt genau sie - dann
  // entfällt auch die Zweiteilung «Aktiv/Ruhend», die Kacheln stehen, wo
  // man sie hingezogen hat.
  const customOrdered =
    orderScope != null && (orderIds.length > 0 || (editing && !searching));
  const running =
    section === 'home' && !customOrdered ? shown.filter(isActive).sort(byFavorite) : [];
  const rest =
    section === 'home'
      ? customOrdered
        ? [...shown].sort(byOrder)
        : shown.filter((entity) => !isActive(entity)).sort(byFavorite)
      : [...found].sort(byOrder);

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
  const categorized =
    section === 'home' && room !== ALL_ROOMS && !editing && !customOrdered;
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

  /** Standbild-Adresse einer Kamera (oder der Saugerkarte) am Hub. */
  const snapshotUrl = (entity: Entity) =>
    settings.url && settings.token
      ? `${settings.url.replace(/\/+$/, '')}/api/entities/${encodeURIComponent(
          entity.id
        )}/snapshot?token=${encodeURIComponent(settings.token)}`
      : undefined;

  /** HLS-Wiedergabeliste einer Kamera – der Hub wandelt RTSP dafür um. */
  const streamUrl = (entity: Entity) =>
    settings.url && settings.token
      ? `${settings.url.replace(/\/+$/, '')}/api/entities/${encodeURIComponent(
          entity.id
        )}/stream.m3u8?token=${encodeURIComponent(settings.token)}`
      : undefined;

  const fullscreenCamera = fullscreen
    ? entities.find((entity) => entity.id === fullscreen)
    : undefined;

  // ── Kacheln direkt im Raster ziehen (Anpassen-Modus) ───────────────────
  const dragEnabled =
    editing && orderScope != null && !searching && !grouped && !categorized;
  const cellLayouts = useRef(new Map<string, CellLayout>()).current;
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const startDrag = useCallback((id: string) => setDrag({ id, dx: 0, dy: 0 }), []);
  const moveDrag = useCallback(
    (dx: number, dy: number) => setDrag((d) => (d ? { ...d, dx, dy } : d)),
    []
  );

  const renderCard = (entity: Entity) => (
    <EntityCard
      key={entity.id}
      entity={entity}
      width={cardWidth!}
      // Gehört dieser Spot zu einer zusammengefassten Leuchte? Unter
      // Geräte ist er sonst nicht von einer einzelnen Lampe zu
      // unterscheiden, und man wundert sich, warum er im Raum fehlt.
      partOf={
        entity.combined_into
          ? entities.find((item) => item.id === entity.combined_into)?.name ?? null
          : null
      }
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
      locked={locked.includes(entity.id)}
      onToggleLocked={() =>
        onSaveSettings({ ...settings, locked: toggleIn(locked, entity.id) })
      }
      rooms={editing ? roomOrder : undefined}
      onSetRoom={
        editing ? (room) => setEntityRoom(entity.id, room) : undefined
      }
      onRename={editing ? (name) => setEntityMeta(entity.id, { name }) : undefined}
      groups={editing ? groupNames : undefined}
      onSetGroup={
        editing ? (group) => setEntityMeta(entity.id, { group }) : undefined
      }
      onCommand={(command, data) => guardedCommand(entity.id, command, data)}
      sky={entity.kind === 'cover' ? sky : undefined}
      snapshotUri={
        // Kameras: Livebild. Sauger: die Karte – beides über denselben Endpunkt.
        entity.kind === 'camera' || entity.kind === 'vacuum'
          ? snapshotUrl(entity)
          : undefined
      }
      onPress={
        editing
          ? undefined
          : entity.kind === 'camera'
            ? () => setFullscreen(entity.id)
            : entity.kind === 'sensor'
              ? () => setExpanded((current) => (current === entity.id ? null : entity.id))
              : section === 'devices' && HISTORY_KINDS.has(entity.kind)
                ? // Unter Geräte öffnet ein Tipp auf die Kachel den Verlauf
                  // dieses Geräts - «warum ging das um drei Uhr an?».
                  () => setHistoryFor(entity.id)
                : undefined
      }
      chart={
        expanded === entity.id && cardWidth ? (
          <HistoryChart entity={entity} settings={settings} width={cardWidth - 32} />
        ) : undefined
      }
    />
  );

  const restIds = rest.map((entity) => entity.id);
  const endDrag = (id: string, dx: number, dy: number) => {
    setDrag(null);
    if (!orderScope) return;
    const next = reorderByDrop(restIds, cellLayouts, id, dx, dy);
    if (next) setOrder(orderScope, next);
  };
  const renderCell = (entity: Entity) =>
    dragEnabled && cardWidth ? (
      <DragCell
        key={entity.id}
        id={entity.id}
        width={cardWidth}
        dragging={drag?.id === entity.id}
        dx={drag?.id === entity.id ? drag.dx : 0}
        dy={drag?.id === entity.id ? drag.dy : 0}
        onStart={startDrag}
        onMove={moveDrag}
        onEnd={endDrag}
        onLayout={(cellId, layout) => cellLayouts.set(cellId, layout)}
      >
        {renderCard(entity)}
      </DragCell>
    ) : (
      renderCard(entity)
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
              countdowns={startCountdowns}
              snapshotUri={snapshotUrl}
              favoriteIds={favorites}
            />
          </View>
          <SidePanel
            entities={entities}
            width={hasSidePanel ? PANEL_WIDTH : undefined}
            onCommand={sendCommand}
          />
        </View>
      );
    }
    if (section === 'family') {
      return (
        <FamilyScreen
          settings={settings}
          entities={entities}
          currentUser={user}
          moduleOrder={prefs.order?.family}
          onReorderModules={(keys) => setOrder('family', keys)}
        />
      );
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
          key: 'alarm',
          icon: 'shield-checkmark-outline',
          label: 'Alarmanlage',
          detail: 'Sensoren, Modi und Verlauf',
          show: caps.includes('edit_config'),
        },
        {
          key: 'speakers',
          icon: 'volume-high-outline',
          label: 'Lautsprecher',
          detail: 'Boxen und Gruppen im Netz',
          show: caps.includes('edit_config'),
        },
        {
          key: 'energy',
          icon: 'flash-outline',
          label: 'Energie',
          detail: 'Verbrauch und Kosten je Gerät',
          show: caps.includes('view_system'),
        },
        {
          key: 'system',
          icon: 'pulse-outline',
          label: 'System',
          detail: 'Integrationen, Sicherung, Konfiguration',
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
          detail: 'Hub-Adresse, Token, Darstellung, Benachrichtigungen',
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
    if (section === 'alarm') {
      return (
        <View style={styles.stack}>
          {back}
          <AlarmScreen settings={settings} entities={entities} />
        </View>
      );
    }
    if (section === 'speakers') {
      return (
        <View style={styles.stack}>
          {back}
          <>
            <Broadcast settings={settings} entities={entities} />
            <SpeakersScreen settings={settings} />
          </>
        </View>
      );
    }
    if (section === 'energy') {
      return (
        <View style={styles.stack}>
          {back}
          <EnergyScreen settings={settings} entities={entities} />
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
          <UsersScreen settings={settings} currentUser={user} entities={entities} />
        </View>
      );
    }
    if (section === 'account') {
      return (
        <View style={styles.stack}>
          {back}
          <SettingsScreen initial={settings} onSave={onSaveSettings} user={user} embedded />
          <PushPrefs settings={settings} />
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
          <SystemScreen settings={settings} user={user} entities={entities} push={push} />
        </View>
      );
    }
    return (
      <View style={hasSidePanel ? styles.split : styles.stack}>
        <View style={hasSidePanel ? styles.main : undefined}>
          {section === 'devices' ? back : null}
          {section === 'devices' ? (
            <View style={styles.searchRow}>
              <Ionicons name="search" size={16} color={colors.inkFaint} />
              <TextInput
                style={styles.searchInput}
                value={query}
                onChangeText={setQuery}
                placeholder="Gerät, Raum oder Gruppe suchen …"
                placeholderTextColor={colors.inkFaint}
                autoCorrect={false}
                autoCapitalize="none"
                returnKeyType="search"
                clearButtonMode="never"
              />
              {query ? (
                <Pressable
                  onPress={() => setQuery('')}
                  hitSlop={10}
                  accessibilityRole="button"
                  accessibilityLabel="Suche löschen"
                >
                  <Ionicons name="close-circle" size={18} color={colors.inkFaint} />
                </Pressable>
              ) : null}
            </View>
          ) : null}
          {searching ? (
            <Text style={styles.searchCount}>
              {rest.length === 0
                ? 'Nichts gefunden.'
                : `${rest.length} ${rest.length === 1 ? 'Gerät' : 'Geräte'} gefunden`}
            </Text>
          ) : null}
          {orderScope && !searching && rest.length > 1 ? (
            <Pressable
              onPress={() => setReorderOpen(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.reorderButton, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="swap-vertical" size={16} color={colors.onGradient} />
              <Text style={styles.reorderText}>Reihenfolge ändern</Text>
            </Pressable>
          ) : null}
          <Modal
            visible={reorderOpen}
            animationType="slide"
            onRequestClose={() => setReorderOpen(false)}
          >
            <View style={styles.reorderSheet}>
              <View style={styles.reorderHead}>
                <Text style={styles.reorderTitle}>Reihenfolge</Text>
                <Pressable
                  onPress={() => setReorderOpen(false)}
                  accessibilityLabel="Fertig"
                >
                  <Ionicons name="checkmark" size={26} color={colors.ink} />
                </Pressable>
              </View>
              <Text style={styles.reorderHint}>
                Am Griff ☰ ziehen, um die Kacheln umzusortieren. Die Reihenfolge
                gilt für diese Ansicht und wird bei deinem Benutzer gespeichert –
                sie erscheint so auf allen deinen Geräten.
              </Text>
              <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                <DraggableList
                  // Bewusst die ungefilterte Liste: sortiert wird immer über
                  // alle Geräte der Ansicht, auch wenn gerade gesucht wurde.
                  items={[...shown]
                    .sort(byOrder)
                    .map((entity) => ({ id: entity.id, name: entity.name }))}
                  onReorder={(ids) => (orderScope ? setOrder(orderScope, ids) : undefined)}
                />
              </ScrollView>
            </View>
          </Modal>
          {/* Im „Alle“-Modus alle Szenen, im Raum nur dessen Szenen. */}
          {section === 'home' && room === ALL_ROOMS ? (
            <>
              {/* Einmal nach jedem Update: was sich geändert hat. */}
              <WhatsNew
                settings={settings}
                seen={prefs.seenChanges}
                onSeen={setSeenChanges}
              />
              <SceneRow scenes={scenes} onActivate={activateScene} />
              <View style={styles.allOffRow}>
                <AllOff
                  entities={entities}
                  locked={locked}
                  onCommand={sendCommand}
                />
                <GoodNight
                  settings={settings}
                  entities={entities}
                  mayEdit={!!user?.capabilities?.includes('edit_automations')}
                />
              </View>
            </>
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
          {section === 'home' ||
          section === 'devices' ||
          section === 'light' ||
          section === 'covers' ? (
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

          {section === 'devices' && !editing && !searching && groupNames.length > 0 ? (
            <GroupControls
              entities={entities}
              groups={groupNames}
              onCommand={sendCommand}
            />
          ) : null}

          {section === 'devices' && !editing && !searching ? (
            <LightGroups
              settings={settings}
              headers={{ Authorization: `Bearer ${settings.token}` }}
              entities={entities}
              rooms={roomOrder}
            />
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
                    ? [{ name: NO_ROOM, items: shown.filter((entity) => !entity.room) }]
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
                    onOpen={() => setRoom(tile.name)}
                    onCommand={(entityId, command) => guardedCommand(entityId, command)}
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
          {!grouped && !categorized && !roomTiles && dragEnabled && rest.length > 1 ? (
            <Text style={styles.sectionLabel}>
              Kacheln am Griff ✥ an die gewünschte Stelle ziehen
            </Text>
          ) : null}
          {!grouped && !categorized && !roomTiles ? (
            <View style={styles.grid}>{cardWidth ? rest.map(renderCell) : null}</View>
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
            width={hasSidePanel ? PANEL_WIDTH : undefined}
            onCommand={sendCommand}
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
            hidden={hiddenSections}
          />
        ) : null}

        <ScrollView
          style={styles.scroll}
          contentContainerStyle={styles.content}
          showsVerticalScrollIndicator={false}
          // Während eine Kachel am Finger hängt, darf die Seite nicht
          // mitscrollen: Sonst wandert der Inhalt unter der Kachel weg,
          // sie bleibt scheinbar an ihrem Platz kleben, und beim
          // Loslassen landet sie dort, wo sie war.
          scrollEnabled={!drag}
        >
          {status !== 'connected' && entities.length > 0 ? (
            // Getrennt, aber wir haben den letzten Stand: lieber alte Werte
            // mit deutlichem Hinweis als eine leere Seite. Geschaltet wird
            // trotzdem nicht - die Befehle liefen ins Leere.
            <View style={styles.offlineBanner}>
              <Ionicons name="cloud-offline-outline" size={16} color={colors.warn} />
              <Text style={styles.offlineText} numberOfLines={2}>
                {status === 'connecting' ? 'Verbinde …' : 'Keine Verbindung'} – gezeigt
                wird der letzte bekannte Stand
                {cachedAt
                  ? ` von ${new Date(cachedAt).toLocaleTimeString('de-CH', {
                      hour: '2-digit',
                      minute: '2-digit',
                    })}`
                  : ''}
                .
              </Text>
            </View>
          ) : null}
          <TopStrip
            entities={entities}
            status={status}
            now={now}
            hidden={hidden}
            onCommand={sendCommand}
          />

          <View style={styles.greetingRow}>
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
            <View style={styles.greetingNotes}>
              <Pressable
                onPress={() => setSearchOpen(true)}
                accessibilityRole="button"
                accessibilityLabel="Suchen"
                style={({ pressed }) => [styles.searchButton, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="search" size={18} color={colors.onGradientSoft} />
              </Pressable>
              <RunningAppliances entities={entities} />
              <OpenDoors entities={entities} />
            </View>
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
          onCommand={(entityId, command) => guardedCommand(entityId, command)}
          onDismiss={() => setDismissedRing(ringKey)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {fullscreenCamera ? (
        <CameraFullscreen
          camera={fullscreenCamera}
          uri={snapshotUrl(fullscreenCamera)}
          streamUri={streamUrl(fullscreenCamera)}
          settings={settings}
          onClose={() => setFullscreen(null)}
          colors={colors}
          styles={styles}
        />
      ) : null}

      {historyFor && entities.find((entity) => entity.id === historyFor) ? (
        <EntityHistory
          entity={entities.find((entity) => entity.id === historyFor)!}
          settings={settings}
          onClose={() => setHistoryFor(null)}
        />
      ) : null}

      {confirm ? (
        <LockConfirm
          entity={confirm.entity}
          command={confirm.command}
          onCancel={() => setConfirm(null)}
          onConfirm={() => {
            sendCommand(confirm.entity.id, confirm.command, confirm.data);
            setConfirm(null);
          }}
          colors={colors}
          styles={styles}
        />
      ) : null}

      <GlobalSearch
        visible={searchOpen}
        entities={entities}
        scenes={scenes}
        automations={automations}
        rooms={roomOrder}
        onClose={() => setSearchOpen(false)}
        onPick={(hit) => {
          setSearchOpen(false);
          if (hit.kind === 'room') {
            setSection('home');
            setRoom(hit.id);
          } else if (hit.kind === 'scene') {
            activateScene(hit.id);
          } else if (hit.kind === 'automation') {
            setSection('automations');
          } else {
            // Gerät: in die Geräteliste und dort danach filtern – so sieht
            // man es samt Bedienelementen, statt nur den Raum zu wechseln.
            setSection('devices');
            setQuery(hit.label);
          }
        }}
      />

      <Toast message={error} onDismiss={dismissError} bottomInset={insets.bottom} />
      {/* Nur wenn nichts schiefging – ein fehlgeschlagener Befehl hat nichts
          hinterlassen, was man zurücknehmen müsste. */}
      <UndoToast
        what={error ? null : undo}
        onUndo={undoLast}
        onDismiss={dismissUndo}
        bottomInset={insets.bottom}
      />
    </View>
  );
}

/**
 * Rückfrage vor dem Schalten eines gesperrten Geräts.
 *
 * Für alles, was man nicht im Vorbeigehen antippen will: Herd, Sauna, der
 * Serverschrank. Die Sperre verhindert nichts – sie fügt nur den einen
 * bewussten Schritt ein, der ein Versehen von einer Absicht trennt.
 */
function LockConfirm({
  entity,
  command,
  onCancel,
  onConfirm,
  colors,
  styles,
}: {
  entity: Entity;
  command: string;
  onCancel: () => void;
  onConfirm: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const was =
    command === 'turn_off' || command === 'close'
      ? 'ausschalten'
      : command === 'toggle'
        ? 'umschalten'
        : 'einschalten';
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.lockBackdrop}>
        <View style={styles.lockSheet}>
          <Ionicons name="lock-closed" size={26} color={colors.accent} />
          <Text style={styles.lockTitle}>{entity.name} ist gesperrt</Text>
          <Text style={styles.lockText}>
            Wirklich {was}? Die Sperre lässt sich im Anpassen-Modus wieder
            aufheben.
          </Text>
          <View style={styles.lockActions}>
            <Pressable onPress={onCancel} style={styles.lockCancel}>
              <Text style={styles.lockCancelText}>Abbrechen</Text>
            </Pressable>
            <Pressable onPress={onConfirm} style={styles.lockConfirm}>
              <Text style={styles.lockConfirmText}>Ja, {was}</Text>
            </Pressable>
          </View>
        </View>
      </View>
    </Modal>
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
/**
 * Kamera im Vollbild: ein Tipp auf eine Kamerakachel macht das Standbild
 * gross und holt es alle drei Sekunden neu – die Kachel selbst bleibt bei
 * einem Bild pro Minute, damit die Übersicht nicht ständig lädt.
 */
function CameraFullscreen({
  camera,
  uri,
  streamUri,
  settings,
  onClose,
  colors,
  styles,
}: {
  camera: Entity;
  uri?: string;
  streamUri?: string;
  settings: HubSettings;
  onClose: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [tick, setTick] = useState(0);
  // Klappt der Livestrom nicht, bleibt das Standbild – lieber ein Bild alle
  // drei Sekunden als ein schwarzes Rechteck. Der Grund wird angezeigt,
  // sonst lässt sich aus der Ferne nichts diagnostizieren.
  const [liveFailed, setLiveFailed] = useState<string | null>(null);
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 3000);
    return () => clearInterval(timer);
  }, []);
  const online = camera.state.state === 'online';
  const live = online && !liveFailed && !!streamUri && camera.state.stream === true;

  return (
    <Modal visible animationType="fade" onRequestClose={onClose}>
      <View style={styles.doorbellRoot}>
        <Text style={styles.doorbellTitle}>{camera.name}</Text>
        {live ? (
          <View style={styles.videoBox}>
            <CameraLive
              uri={streamUri!}
              style={styles.videoFrame}
              onFailed={(message) => setLiveFailed(message)}
            />
          </View>
        ) : uri && online ? (
          <Image
            source={{ uri: `${uri}&t=${tick}` }}
            style={styles.doorbellImage}
            resizeMode="contain"
          />
        ) : (
          <View
            style={[
              styles.doorbellImage,
              { alignItems: 'center', justifyContent: 'center' },
            ]}
          >
            <Ionicons name="videocam-off-outline" size={40} color="#FFFFFF" />
            <Text style={styles.doorbellCloseText}>
              {online ? 'Kein Bild verfügbar' : 'Kamera ist offline'}
            </Text>
          </View>
        )}
        <View style={styles.timelineBox}>
          <CameraTimeline
            entity={camera}
            settings={settings}
            refreshKey={String(camera.state.last_motion ?? '')}
          />
        </View>
        <View style={styles.doorbellButtons}>
          <Text
            style={[
              styles.doorbellCloseText,
              live ? { color: colors.danger } : null,
            ]}
          >
            {live
              ? '● Live'
              : liveFailed
                ? `Live-Bild nicht verfügbar (${liveFailed}) – Standbild alle 3 Sekunden`
                : 'Standbild alle 3 Sekunden'}
            {camera.state.motion === 'on' ? ' · Bewegung erkannt' : ''}
          </Text>
          <Pressable onPress={onClose} style={styles.doorbellClose}>
            <Text style={styles.doorbellCloseText}>Schliessen</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

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
  const [liveFailed, setLiveFailed] = useState<string | null>(null);
  // Alle 3 Sekunden ein frisches Bild, solange das Vollbild offen ist.
  useEffect(() => {
    const timer = setInterval(() => setTick((value) => value + 1), 3000);
    return () => clearInterval(timer);
  }, []);
  const base =
    settings.url && settings.token
      ? `${settings.url.replace(/\/+$/, '')}/api/entities/${encodeURIComponent(
          camera.id
        )}`
      : null;
  const token = encodeURIComponent(settings.token ?? '');
  const uri = base ? `${base}/snapshot?token=${token}&t=${tick}` : null;
  // Wer klingelt, will man in Bewegung sehen – wenn die Kamera es hergibt.
  const live = base && camera.state.stream === true && !liveFailed;

  return (
    <Modal visible animationType="fade" onRequestClose={onDismiss}>
      <View style={styles.doorbellRoot}>
        <Text style={styles.doorbellTitle}>🔔 Es klingelt</Text>
        {live ? (
          <View style={styles.videoBox}>
            <CameraLive
              uri={`${base}/stream.m3u8?token=${token}`}
              style={styles.videoFrame}
              onFailed={(message) => setLiveFailed(message)}
            />
          </View>
        ) : uri ? (
          <Image source={{ uri }} style={styles.doorbellImage} resizeMode="cover" />
        ) : (
          <View style={[styles.doorbellImage, { alignItems: 'center', justifyContent: 'center' }]}>
            <Ionicons name="videocam-off-outline" size={40} color="#FFFFFF" />
          </View>
        )}
        <View style={styles.doorbellButtons}>
          {/* Sprechen läuft über die Ring-App: Die Gegensprech-Verbindung
              ist WebRTC gegen Rings Server, und die gibt der Hersteller
              nicht heraus. Ein Tipp führt dorthin, statt einen Knopf zu
              zeigen, der nichts kann. */}
          <Pressable
            onPress={() => {
              Linking.openURL('ring://').catch(() =>
                Linking.openURL('https://account.ring.com/').catch(() => {})
              );
            }}
            accessibilityRole="button"
            style={styles.doorbellTalk}
          >
            <Ionicons name="mic-outline" size={20} color="#FFFFFF" />
            <Text style={styles.doorbellOpenText}>Sprechen (Ring-App)</Text>
          </Pressable>
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

/** Gruppen-Steuerung: schaltet alle Geräte einer Gruppe auf einmal.
 *  Storen-Gruppen bekommen einen gemeinsamen Prozent-Schieber. */
function GroupControls({
  entities,
  groups,
  onCommand,
}: {
  entities: Entity[];
  groups: string[];
  onCommand: (entityId: string, command: string, data?: Record<string, any>) => void;
}) {
  return (
    <View style={{ gap: space.gap }}>
      {groups.map((name) => (
        <GroupRow
          key={name}
          name={name}
          members={entities.filter((entity) => entity.group === name)}
          onCommand={onCommand}
        />
      ))}
    </View>
  );
}

function GroupRow({
  name,
  members,
  onCommand,
}: {
  name: string;
  members: Entity[];
  onCommand: (entityId: string, command: string, data?: Record<string, any>) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const covers = members.filter((entity) => entity.kind === 'cover');
  const positionable = covers.filter((entity) => entity.commands.includes('set_position'));
  const switches = members.filter((entity) => entity.commands.includes('turn_on'));
  const locks = members.filter((entity) => entity.kind === 'lock');

  // Startwert des Schiebers: Durchschnitt der aktuellen Storen-Positionen.
  const avg = positionable.length
    ? Math.round(
        positionable.reduce(
          (sum, entity) =>
            sum + (typeof entity.state.position === 'number' ? entity.state.position : 0),
          0
        ) / positionable.length
      )
    : 0;
  const [pos, setPos] = useState(avg);

  const fan = (
    list: Entity[],
    command: string,
    data?: Record<string, any>
  ) => list.forEach((entity) => onCommand(entity.id, command, data));

  return (
    <Card style={styles.groupCard}>
      <View style={styles.groupHead}>
        <Ionicons name="layers-outline" size={18} color={colors.inkSoft} />
        <Text style={styles.groupName}>{name}</Text>
        <Text style={styles.groupCount}>{members.length} Geräte</Text>
      </View>

      {switches.length > 0 ? (
        <View style={styles.groupButtons}>
          <GroupButton label="Alle ein" onPress={() => fan(switches, 'turn_on')} />
          <GroupButton label="Alle aus" onPress={() => fan(switches, 'turn_off')} />
        </View>
      ) : null}

      {covers.length > 0 ? (
        <View style={styles.groupButtons}>
          <GroupButton label="Hoch" onPress={() => fan(covers, 'open')} />
          <GroupButton label="Stopp" onPress={() => fan(covers, 'stop')} />
          <GroupButton label="Runter" onPress={() => fan(covers, 'close')} />
        </View>
      ) : null}

      {positionable.length > 0 ? (
        <View style={{ gap: 8 }}>
          <Bar value={pos} onChange={setPos} />
          <GroupButton
            label={`Auf ${pos}% setzen`}
            onPress={() => fan(positionable, 'set_position', { position: pos })}
            wide
          />
        </View>
      ) : null}

      {locks.length > 0 ? (
        <View style={styles.groupButtons}>
          <GroupButton label="Abschliessen" onPress={() => fan(locks, 'lock')} />
          <GroupButton label="Aufschliessen" onPress={() => fan(locks, 'unlock')} />
        </View>
      ) : null}
    </Card>
  );
}

function GroupButton({
  label,
  onPress,
  wide,
}: {
  label: string;
  onPress: () => void;
  wide?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.groupButton,
        wide && { flex: 0, alignSelf: 'stretch' },
        pressed && { opacity: 0.75 },
      ]}
    >
      <Text style={styles.groupButtonText}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  root: { flex: 1 },
  timelineBox: { paddingHorizontal: 16, paddingTop: 10 },
  offlineBanner: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingVertical: 9,
    paddingHorizontal: 12,
    borderRadius: radius.control,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.warn,
  },
  offlineText: { color: colors.onGradient, fontSize: 13, flex: 1 },
  allOffRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    flexWrap: 'wrap',
    gap: 8,
    marginTop: 4,
  },
  searchButton: {
    width: 34,
    height: 34,
    borderRadius: 17,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(255,255,255,0.14)',
  },
  lockBackdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  lockSheet: {
    width: '100%',
    maxWidth: 380,
    gap: 10,
    padding: 20,
    borderRadius: radius.card,
    backgroundColor: colors.gradient[1],
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    alignItems: 'center',
  },
  lockTitle: { color: colors.ink, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  lockText: {
    color: colors.inkSoft,
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
  },
  lockActions: { flexDirection: 'row', gap: 10, marginTop: 6, alignSelf: 'stretch' },
  lockCancel: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  lockCancelText: { color: colors.inkSoft, fontSize: 15, fontWeight: '700' },
  lockConfirm: {
    flex: 1,
    alignItems: 'center',
    paddingVertical: 12,
    borderRadius: radius.control,
    backgroundColor: colors.accent,
  },
  lockConfirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  frame: { flex: 1, flexDirection: 'row' },
  scroll: { flex: 1 },
  content: {
    paddingHorizontal: space.page,
    paddingTop: 14,
    paddingBottom: 28,
    gap: 16,
  },
  greetingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: space.gap,
  },
  greeting: { gap: 2, flexShrink: 1 },
  // Hinweise rechts der Begrüssung. Auf schmalen Geräten stapeln sie sich,
  // damit weder Türhinweis noch Haushalt abgeschnitten wird.
  greetingNotes: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'flex-end',
    alignItems: 'center',
    gap: 8,
    flexShrink: 1,
  },
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
  doorbellTalk: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: radius.control,
    backgroundColor: 'rgba(255,255,255,0.18)',
    borderWidth: 1,
    borderColor: 'rgba(255,255,255,0.35)',
  },
  // Live-Video: 16:9 einpassen statt es in die Bildschirmhöhe zu strecken –
  // gestreckt schneidet der Player links und rechts ab.
  videoBox: { flex: 1, justifyContent: 'center' },
  videoFrame: {
    width: '100%',
    aspectRatio: 16 / 9,
    borderRadius: radius.card,
    backgroundColor: '#000000',
  },
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
  searchRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceStrong,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  searchInput: { flex: 1, paddingVertical: 11, color: colors.ink, fontSize: 15 },
  searchCount: { color: colors.onGradientSoft, fontSize: 12, fontWeight: '600' },
  reorderButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    paddingVertical: 6,
  },
  reorderText: { color: colors.onGradient, fontSize: 13, fontWeight: '600' },
  reorderSheet: { flex: 1, backgroundColor: colors.panel, padding: 20, paddingTop: 60 },
  reorderHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  reorderTitle: { color: colors.ink, fontSize: 22, fontWeight: '700' },
  reorderHint: { color: colors.inkFaint, fontSize: 13, lineHeight: 18, marginBottom: 14 },
  groupCard: { gap: 12 },
  groupHead: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  groupName: { color: colors.ink, fontSize: 16, fontWeight: '700', flex: 1 },
  groupCount: { color: colors.inkFaint, fontSize: 12 },
  groupButtons: { flexDirection: 'row', gap: 8 },
  groupButton: {
    flex: 1,
    paddingVertical: 11,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    alignItems: 'center',
  },
  groupButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
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
