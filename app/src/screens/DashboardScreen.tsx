import AsyncStorage from '@react-native-async-storage/async-storage';
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

import { CommandData, Entity, HubSettings } from '../api/types';
import { begruessung } from '../lib/begruessung';
import {
  Bereich,
  adminZeile,
  einstiegsSeite,
  gruppeVon,
  siehtBereich,
} from '../lib/einstellungsmenue';
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
import { SECTION_LABEL, Rail, Section } from '../components/Rail';
import { AllOff } from '../components/AllOff';
import { BesuchBlatt } from '../components/BesuchBlatt';
import { BabysitterStand, modusZeile } from '../lib/babysitter';
import { Leerzustand } from '../components/Leerzustand';
import { SorgenBlatt } from '../components/SorgenBlatt';
import { DeviceHealth } from '../components/DeviceHealth';
import { RoomTabs } from '../components/RoomTabs';
import { RoomTile } from '../components/RoomTile';
import { SceneRow } from '../components/SceneRow';
import { GlobalSearch } from '../components/GlobalSearch';
import { LiveTuerSchalter } from '../components/LiveTuerSchalter';
import { PushPrefs } from '../components/PushPrefs';
import { ActivityCard, SidePanel } from '../components/SidePanel';
import { Bestaetigung, Toast, UndoToast } from '../components/Toast';
import { TopStrip } from '../components/TopStrip';
import { useHub } from '../hooks/useHub';
import { Knopfdruck, Tap, useNotificationTap } from '../hooks/useNotificationTap';
import { usePrefs } from '../hooks/usePrefs';
import { useLiveAktivitaet } from '../hooks/useLiveAktivitaet';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { breakpoints, Colors, radius, space, type, useColors } from '../theme';
import { KAMERA_MINDEST, kachelBreite, spalten } from '../lib/raster';
import {
  EinkaufZeile,
  Shop,
  findeArtikel,
  mengeUndName,
  mitMenge,
  shopCategory,
} from '../lib/einkauf';
import { datumUhr, uhr } from '../lib/format';
import { Erinnerung, anzuzeigende, bestaetigung, naechsteAt, quittiertVon, vollbildTitel } from '../lib/erinnerungen';
import {
  AUTO_SCHLIESSEN_SEKUNDEN,
  KlingelAktion,
  klingelAktionen,
  klingelBild,
  klingeltGerade,
  neueFrist,
  restSekunden,
} from '../lib/klingel';
import { deviceKindLabel, musikboxenImRaum } from '../lib/geraeteart';
import { rueckangebot } from '../lib/rueckgriff';
import { gemerkteAktion, menuLabel } from '../lib/doppeltipp';
import { leerbild } from '../lib/leerzustand';
import { Nutzung, merken as merkeRaum, reihenfolge as nutzungsReihenfolge } from '../lib/raumnutzung';
import { sorgen, sorgenSatz } from '../lib/sorgen';
import { szenenFuerKachel, szenenFuerRaum } from '../lib/szenen';
import {
  GeraeteFilter,
  GeraeteSortierung,
  passtFilter,
  sortiereGeraete,
} from '../lib/geraetefilter';
import { verweisText, verweiseAuf } from '../lib/verweise';
import {
  alphabetisch,
  istKueche,
  raeumeSortiert,
  raumKategorien,
  raumMesswerte,
  raumZeile,
} from '../lib/raum';
import { Person } from '../lib/ortung';
import { FAVORITEN, raumGruppen } from '../lib/raumgruppen';
import { verlangtPin } from '../lib/alarmpin';
import { OffenesModul, istGesperrt, istPersoenlich, offeneModule } from '../lib/bereichsriegel';
import { schleier } from '../lib/nachtabsenkung';
import { Einrichtungshilfe } from '../components/Einrichtungshilfe';
import { Kamerawand } from '../components/Kamerawand';
import { HausRueckblick } from './HausRueckblick';
import { nachBewegung } from '../lib/kameraordnung';
import {
  hinweis as tageszeitHinweis,
  jetzigerAbschnitt,
  lohntSich,
  nachTageszeit,
} from '../lib/tageszeit';
import { hubClient, onHubFehler } from '../api/client';
import { Auffangnetz } from '../components/Auffangnetz';
import { AutomationsScreen } from './AutomationsScreen';
import { BereichRiegel } from '../components/BereichRiegel';
import { FamilyScreen } from './FamilyScreen';
import { OverviewScreen } from './OverviewScreen';
import { SettingsScreen } from './SettingsScreen';
import { AlarmScreen } from './AlarmScreen';
import { EnergyScreen } from './EnergyScreen';
import { SpeakersScreen } from './SpeakersScreen';
import { SystemScreen } from './SystemScreen';
import { EntityHistory } from '../components/EntityHistory';
import { Musikzentrale } from '../components/Musikzentrale';
import { ClimateOverview } from '../components/ClimateOverview';
import { KidsView } from '../components/KidsView';
import { KitchenTimer } from '../components/KitchenTimer';
import { WhatsNew } from '../components/WhatsNew';
import { LightGroups } from '../components/LightGroups';
import { DeviceTools } from '../components/DeviceTools';
import { SceneSuggestion } from '../components/SceneSuggestion';
import { PersonenScreen } from './PersonenScreen';
import { UsersScreen } from './UsersScreen';
import { confirm as confirmBiometrie, needsCheck } from '../lib/biometrie';
import { mayOpenDirectly } from '../lib/tuerbestaetigung';
import { BioLock } from '../components/BioLock';
import { TuerRueckfrage } from '../components/TuerRueckfrage';
import { Widgets } from '../components/Widgets';
import { Ablage, syncWidget } from '../lib/widget';
import { resolveKarten } from '../lib/widgetKarten';
import { favoritenVon, zuUebernehmen } from '../lib/favoriten';
import { altesUebernehmen } from '../lib/hausprefs';
import {
  mitDirekt,
  resolveButtons,
  standardDirekt,
  widgetCommand,
} from '../lib/widgetButtons';
import { HubProvider } from '../hooks/HubContext';
import { useTakt } from '../hooks/useTakt';

const ALL_ROOMS = 'Alle';
/** Befehle, die ein gesperrtes Gerät nur nach Rückfrage annimmt. Lesende
 *  Befehle und Lautstärke gehören nicht dazu – gesperrt ist der Herd, nicht
 *  die Fernbedienung. */
/**
 * Unter welchem Namen die Reihenfolge einer Gruppe gespeichert wird.
 *
 * Die Favoritengruppe teilt sich den Namen mit der Startseite: Wer sie
 * dort ordnet, hat sie hier genauso - es ist dieselbe Frage.
 */
function groupScope(key: string, bereich = 'room'): string {
  // Die Licht-Seite bekommt eigene Töpfe. Zieht dort jemand eine Lampe
  // nach vorn, darf das die Raumansicht nicht umsortieren: In der stehen
  // neben den Lampen noch Storen, Boxen und Fühler, und eine Liste, die
  // nur Lampen kennt, schöbe alle übrigen ans Ende.
  if (key === FAVORITEN)
    return bereich === 'room' ? 'favorites' : `${bereich}:${FAVORITEN}`;
  return `${bereich}:${key}`;
}

/** Nach gespeicherter Reihenfolge sortieren, Unbekanntes alphabetisch
 *  hinten anhängen (rein, testbar). */
export function sortByOrder(items: Entity[], order?: string[]): Entity[] {
  const rang = new Map((order ?? []).map((id, index) => [id, index]));
  return [...items].sort((a, b) => {
    const ai = rang.has(a.id) ? (rang.get(a.id) as number) : Infinity;
    const bi = rang.has(b.id) ? (rang.get(b.id) as number) : Infinity;
    return ai !== bi ? ai - bi : a.name.localeCompare(b.name);
  });
}

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
// Wofür der Hub überhaupt ein Protokoll führt (hub: core/eventlog.py).
// Messwerte stehen bewusst nicht dabei: Sie ändern sich im Minutentakt
// und beantworten die Warum-Frage nie - für sie gibt es die Kurve.
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
  'alarm',
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

/** Das Wenige, das die Startseiten-Suche von einem Ablauf braucht. */
interface SuchAblauf {
  id: string;
  alias: string;
  category?: string | null;
  triggers?: unknown[];
  conditions?: unknown[];
  actions?: unknown[];
  otherwise?: unknown[];
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
    benutzerNeuLaden,
    error,
    cachedAt,
    familyChangedAt,
    pending,
    queued,
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
  // Ein Weg zum Hub für alle Abfragen dieses Bildschirms – mit Zeitlimit
  // und mit einer Meldung, wenn etwas schiefgeht.
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  // Fehlgeschlagene Abrufe. Der Toast zeigte bisher nur Befehle, die der
  // Hub abgelehnt hat - eine Abfrage, die ins Leere lief, blieb stumm.
  const [abrufFehler, setAbrufFehler] = useState<string | null>(null);
  // Kurze Bestätigungen aus den Unterbildschirmen. Sie landen hier,
  // weil nur der Rahmen einen Platz hat, der nicht mitscrollt.
  const [note, setNote] = useState<string | null>(null);
  useEffect(() => onHubFehler((fehler) => setAbrufFehler(fehler.message)), []);
  const { width } = useWindowDimensions();
  const insets = useSafeAreaInsets();

  // Die Einrichtung hinter den Einstellungen gehört der Besitzerrolle -
  // erkennbar an manage_users, die sonst niemand hat. Auch die Suche hält
  // sich daran, sonst führte sie an der Menüführung vorbei hinein.
  const istBesitzer = (user?.capabilities ?? []).includes('manage_users');
  // Wer welchen Bereich hinter den Einstellungen sieht, entscheidet
  // lib/einstellungsmenue.ts - dort steht die Regel einmal und ist
  // prüfbar, statt elfmal als `show: istBesitzer` untereinander.
  //
  // Zwei Bereiche gehören auch Mitbewohnern: Abläufe (ruhen lassen darf
  // der Hub sie seit je - pause_automations), und die Geräteliste. Sie
  // verändert nichts, sie gibt Auskunft: was im Haus steht, wie die
  // Batterien stehen, wann etwas zuletzt gesehen wurde.
  const sieht = useCallback(
    (bereich: Bereich) => siehtBereich(user?.capabilities ?? [], bereich),
    [user?.capabilities]
  );
  // Ein Gerätename gilt fürs ganze Haus: Der Hub merkt ihn sich in der
  // homepilot-data.json, und danach heisst die Lampe für alle so. Genau
  // deshalb verlangt die Route `edit_config`, und genau danach fragt auch
  // die App - wer sie nicht hat, soll den Knopf gar nicht erst sehen,
  // statt beim Speichern ein «nicht erlaubt» einzufangen.
  // 'edit_config' als Rückfalltor: Läuft die App gegen einen Hub von
  // vor dieser Fähigkeit, kennt der nur die alte - der Besitzerin soll
  // der Knopf deshalb nicht verschwinden, bis der Hub nachgezogen ist.
  // Die Durchsage schaltet Lautsprecher - dieselbe Fähigkeit wie jedes
  // andere Schalten. Ein Gast sieht die Kachel gar nicht erst, statt
  // beim Antippen ein «nicht erlaubt» einzufangen.
  const darfSchalten = (user?.capabilities ?? []).includes('control');

  const darfAnpassen =
    (user?.capabilities ?? []).includes('edit_devices') ||
    (user?.capabilities ?? []).includes('edit_config');

  const [section, setSection] = useState<Section>('start');
  // Welche Einstellungsseite zuletzt offen war - damit «Einstellungen»
  // auf einem breiten Bildschirm dort weitermacht, wo man aufgehört hat.
  // Eine Ref und kein Zustand: Der Wert wird nirgends gezeichnet, nur
  // beim nächsten Öffnen gelesen. Als Zustand wäre jede Seite in den
  // Einstellungen eine zweite Zeichnung wert - für nichts.
  const zuletztEinstellung = useRef<Section | null>(null);
  // Aufgeklappt kommt man nur über die Batteriewarnung hierher; sonst
  // entscheidet die Karte selbst (siehe DeviceHealth).
  const [batterienOffen, setBatterienOffen] = useState(false);
  // Das Blatt «was ist gerade nicht in Ordnung» - offen oder zu.
  const [sorgenOffen, setSorgenOffen] = useState(false);
  // Das Blatt «Besuch oder Babysitter»: offen/zu, und was der Hub sagt.
  const [besuchOffen, setBesuchOffen] = useState(false);
  const [besuchStand, setBesuchStand] = useState<BabysitterStand | null>(null);
  // Bis wann die persönlichen Bereiche offen sind (0 = zu). Nur im
  // Arbeitsspeicher: Nach einem Neustart der App wird wieder gefragt.
  const [riegelBis, setRiegelBis] = useState(0);
  // Welches Modul die Abkürzung am Wandpanel aufmachen soll.
  const [riegelModul, setRiegelModul] = useState<OffenesModul | null>(null);
  const [room, setRoom] = useState(ALL_ROOMS);
  const [now, setNow] = useState(() => new Date());
  const [gridWidth, setGridWidth] = useState(0);
  const [editing, setEditing] = useState(false);
  const [reorderOpen, setReorderOpen] = useState(false);
  // «Räume ordnen»: Die Reihenfolge kam aus der config.yaml – wer sie
  // ändern wollte, brauchte den Rechner.
  const [roomsReorderOpen, setRoomsReorderOpen] = useState(false);
  // Suchbegriff der Geräteliste.
  const [query, setQuery] = useState('');
  // Filter und Sortierung der Geräteliste – die vier Fragen, mit denen
  // man diese Seite öffnet, plus die Reihenfolge dazu.
  const [deviceFilter, setDeviceFilter] = useState<GeraeteFilter>('');
  const [deviceSort, setDeviceSort] = useState<GeraeteSortierung>('selbst');
  const [expanded, setExpanded] = useState<string | null>(null);
  const [lastTouch, setLastTouch] = useState(() => Date.now());
  // Zählt hoch, wenn der Widget-Knopf «Alles aus» gedrückt wurde – die
  // Rückfrage öffnet sich dann von selbst, statt dass die App nur
  // aufgeht und nichts tut.
  const [allOffSignal, setAllOffSignal] = useState(0);
  // Türklingel-Vollbild: pro Klingel-Ereignis einmal zeigen, bis es
  // weggewischt wird (Schlüssel = Kamera + Zeitpunkt des Klingelns).
  const [dismissedRing, setDismissedRing] = useState<string | null>(null);
  // Angetippte Kamera im Vollbild (Entitäts-ID, damit Live-Updates ankommen).
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  // Alle Kameras nebeneinander - fürs Tablet im Flur die einzige
  // sinnvolle Ansicht (siehe components/Kamerawand.tsx).
  const [wandOffen, setWandOffen] = useState(false);
  // Gerät, dessen Verlauf gerade offen ist (Geräte-Ansicht, Tipp auf die Kachel).
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  // Auf der Startseite markierte Countdowns aus dem Familie-Modul.
  const [startCountdowns, setStartCountdowns] = useState<
    { text: string; date: string; on_start?: boolean }[]
  >([]);
  const [searchOpen, setSearchOpen] = useState(false);
  // Abläufe – nur für die Suche; die Liste selbst lebt im Ablauf-Screen.
  const [automations, setAutomations] = useState<SuchAblauf[]>([]);
  // Läuft der Babysitter-Modus? Nur dann hält der Riegel vor Familie und
  // Konto überhaupt zu (lib/bereichsriegel.ts). Bewusst gemerkt und nicht
  // bei jedem Fehlschlag zurückgesetzt: Ein Aussetzer im Netz soll die
  // Einkaufsliste nicht ausgerechnet an dem Abend aufsperren.
  const [babysitter, setBabysitter] = useState(false);
  // Steht hier gerade überhaupt ein Riegel zur Debatte? Nur dann lohnt
  // es, den Babysitter-Modus frisch zu holen.
  const riegelFrage = Boolean(settings.panel) && istPersoenlich(section);
  // Rückfrage vor dem Schalten eines gesperrten Geräts.
  const [confirm, setConfirm] = useState<{
    entity: Entity;
    command: string;
    data?: CommandData;
  } | null>(null);
  // PIN-Feld vor dem Entschärfen über die Kachel (siehe lib/alarmpin.ts).
  const [pinAsk, setPinAsk] = useState<{
    entity: Entity;
    command: string;
    data?: CommandData;
  } | null>(null);

  useTakt(() => setNow(new Date()), 30000);

  // Startseiten-Countdowns laden (und minütlich frisch halten, damit ein
  // frisch gesetzter Stern zeitnah erscheint).
  const ladeCountdowns = useCallback(() => {
    if (!settings.url || !settings.token) return;
    // Ohne Antwort einfach keine Countdown-Kärtchen.
    hub
      .get<{ text: string; date: string; on_start?: boolean }[]>('/api/family/countdowns', {
        fallback: [],
        still: true,
      })
      .then((rows) => setStartCountdowns(Array.isArray(rows) ? rows : []));
  }, [hub, settings.url, settings.token]);
  useEffect(ladeCountdowns, [ladeCountdowns]);
  useTakt(ladeCountdowns, 60000);

  // Einkaufsliste und Läden für die Kopfzeile. Dieselbe Quelle wie unter
  // Familie - nur die offenen Einträge, denn oben zählt, was noch fehlt.
  const [einkauf, setEinkauf] = useState<EinkaufZeile[]>([]);
  // Dieselbe Liste als Ref: Die Rückrufe unten hängen sonst an jeder
  // Änderung der Liste und bauen sich bei jedem Tippen neu auf – und die
  // Kopfzeile mit ihnen.
  const einkaufRef = useRef<EinkaufZeile[]>([]);
  einkaufRef.current = einkauf;
  // Was gerade abgehakt wurde, für einen Moment aufgehoben.
  const [einkaufUndo, setEinkaufUndo] = useState<{ id: string; text: string } | null>(null);
  // Der letzte grosse Griff («Alles aus»), solange er sich zurücknehmen
  // lässt. Die Kennung gehört dem Hub: Er hat den Stand von vorher
  // aufgenommen, die App kennt nur den Zettel dazu.
  const [griffUndo, setGriffUndo] = useState<{ id: string; count: number } | null>(null);
  const [laeden, setLaeden] = useState<Shop[]>([]);
  // Schon einmal eingekaufte Artikel – die Vervollständigung im Fenster
  // der Kopfzeile lebt davon. Kommt aus dem Hub, nicht vom Gerät: Was
  // Livia einträgt, soll Stefan vorgeschlagen bekommen.
  const [bekannt, setBekannt] = useState<string[]>([]);
  // Die Erinnerungen des Haushalts - fürs Vollbild zur eingestellten
  // Zeit. Geladen auf denselben Wegen wie die Einkaufsliste: sofortige
  // Meldung über den WebSocket, Viertelstunde als Rückfalltakt.
  const [erinnerungen, setErinnerungen] = useState<Erinnerung[]>([]);
  const ladeEinkauf = useCallback(() => {
    if (!settings.url || !settings.token) return;
    // «still»: Das hier läuft jede Minute. Eine Einblendung je Minute wäre
    // schlimmer als der Fehler – dass etwas klemmt, sieht man am
    // Verbindungspunkt in der Kopfzeile.
    const leise = { fallback: [] as EinkaufZeile[], still: true };
    hub
      .get<EinkaufZeile[]>('/api/family/shopping', leise)
      .then((rows) =>
        setEinkauf(Array.isArray(rows) ? rows.filter((row) => !row.done) : [])
      );
    hub
      .get<Shop[]>('/api/family/shops', leise as { fallback: Shop[]; still: true })
      .then((rows) => setLaeden(Array.isArray(rows) ? rows : []));
    hub
      .get<string[]>('/api/shopping/known', { fallback: [], still: true })
      .then((rows) => setBekannt(Array.isArray(rows) ? rows.map(String) : []));
    hub
      .get<Erinnerung[]>('/api/family/reminders', {
        fallback: [] as Erinnerung[],
        still: true,
      })
      .then((rows) => setErinnerungen(Array.isArray(rows) ? rows : []));
  }, [hub, settings.url, settings.token]);
  useEffect(ladeEinkauf, [ladeEinkauf]);
  // Nur noch als Rückfalltakt: Änderungen kommen über den WebSocket
  // (family_changed, unten). Die Viertelstunde fängt verpasste
  // Ereignisse ab - etwa wenn die Verbindung kurz weg war.
  useTakt(ladeEinkauf, 15 * 60000);
  // Der Hub meldet jede Änderung an den Familienlisten sofort - so steht
  // das Abgehakte des einen beim anderen ohne Minute Wartezeit.
  useEffect(() => {
    if (familyChangedAt) ladeEinkauf();
  }, [familyChangedAt, ladeEinkauf]);
  // Und immer dann, wenn die Startseite wieder erscheint: Wer gerade
  // unter Familie etwas eingetragen hat, will es oben sofort sehen und
  // nicht bis zur nächsten Minute warten.
  useEffect(() => {
    if (section === 'start') ladeEinkauf();
  }, [section, ladeEinkauf]);

  // Ob eine Erinnerung fällig ist, entscheidet die Uhr dieses Geräts -
  // der Halbminutentakt läuft nur, solange überhaupt eine offen ist.
  // So erscheint das Vollbild auch auf dem Wandpanel pünktlich, ohne
  // dass der Hub einen Wecker bräuchte.
  const [jetztErinnerung, setJetztErinnerung] = useState(() => Date.now());
  useTakt(
    () => setJetztErinnerung(Date.now()),
    naechsteAt(erinnerungen) !== null ? 30000 : null
  );
  // Frische Liste, frische Uhr: Kommt eine weitere Erinnerung an,
  // während das Vollbild schon steht, wurde ihre Fälligkeit sonst gegen
  // den letzten Takt gerechnet - und die neue Karte erschien erst bis
  // zu eine halbe Minute später, obwohl man vor dem Schirm steht.
  useEffect(() => {
    setJetztErinnerung(Date.now());
  }, [erinnerungen]);
  // «Erledigt» (nur für mich) auf diesem Gerät - zusätzlich zur Liste
  // beim Hub, damit das Vollbild auch dann sofort und dauerhaft weg ist,
  // wenn der Name des Benutzers gerade (noch) nicht bekannt ist.
  const [selbstQuittiert, setSelbstQuittiert] = useState<string[]>([]);
  // Der Rückhalt gilt der jetzigen Ausgabe, nicht der Erinnerung an
  // sich: Eine wiederkehrende behält ihre id, wenn sie auf den
  // nächsten Termin weitergestellt wird - bliebe die id hier stehen,
  // wäre die nächste Ausgabe auf diesem Gerät für immer stumm.
  useEffect(() => {
    setSelbstQuittiert((ids) =>
      ids.filter((id) => {
        const eintrag = erinnerungen.find((zeile) => zeile.id === id);
        if (!eintrag || eintrag.done) return false;
        const at = Number(eintrag.at);
        // Noch fällig: Rückhalt behalten - vielleicht hat der Hub das
        // Quittieren (noch) nicht gespeichert.
        return !(Number.isFinite(at) && at > Date.now());
      })
    );
  }, [erinnerungen]);
  const faelligeErinnerungen = useMemo(
    () =>
      anzuzeigende(erinnerungen, jetztErinnerung, user?.name).filter(
        (eintrag) => !selbstQuittiert.includes(eintrag.id)
      ),
    [erinnerungen, jetztErinnerung, user?.name, selbstQuittiert]
  );
  const bestaetigeErinnerung = useCallback(
    (id: string) => {
      // Sofort aus dem Bild, dann zum Hub: Wer bestätigt, will das
      // Vollbild los sein - nicht auf die Antwort warten. Scheitert der
      // Abruf, holt der Rückfalltakt die Erinnerung zurück, und man
      // sieht, dass sie noch offen ist. Wiederkehrende werden dabei
      // nicht erledigt, sondern auf den nächsten Termin weitergestellt.
      const eintrag = erinnerungen.find((zeile) => zeile.id === id);
      const patch = eintrag ? bestaetigung(eintrag, Date.now()) : { done: true };
      setErinnerungen((liste) =>
        liste.map((zeile) => (zeile.id === id ? { ...zeile, ...patch } : zeile))
      );
      hub
        .put(`/api/family/reminders/${encodeURIComponent(id)}`, patch, {
          fallback: null,
        })
        .catch(() => {});
    },
    [hub, erinnerungen]
  );
  const quittiereErinnerung = useCallback(
    (id: string) => {
      // «Erledigt» ohne «für alle»: nur bei mir weg, die anderen sehen
      // die Erinnerung weiter, bis jemand für alle bestätigt. Der Name
      // wandert in die geteilte Ablage - so bleibt es auch nach einem
      // Neustart der App bei «schon gesehen», und die eigenen anderen
      // Geräte ziehen mit.
      setSelbstQuittiert((ids) => (ids.includes(id) ? ids : [...ids, id]));
      const name = user?.name;
      if (!name) return;
      const eintrag = erinnerungen.find((zeile) => zeile.id === id);
      const bisher = eintrag ? quittiertVon(eintrag) : [];
      if (bisher.includes(name)) return;
      hub
        .put(
          `/api/family/reminders/${encodeURIComponent(id)}`,
          { quittiert: [...bisher, name] },
          { fallback: null }
        )
        .catch(() => {});
    },
    [hub, user?.name, erinnerungen]
  );

  /** Einen Eintrag im Laden abhaken - er verschwindet sofort aus der
   *  Kopfzeile, statt bis zum nächsten Abruf stehen zu bleiben. */
  const hakeAb = useCallback(
    (id: string) => {
      // Vor dem Wegnehmen merken, was da stand: Im Laden tippt man daneben,
      // und dann steht man vor dem Regal und weiss nicht mehr, was es war.
      const weg = einkaufRef.current.find((eintrag) => eintrag.id === id);
      if (weg) setEinkaufUndo({ id, text: String(weg.text ?? '') });
      setEinkauf((liste) => liste.filter((eintrag) => eintrag.id !== id));
      // Nicht still: Wer im Laden abhakt und dabei ins Leere greift, soll
      // es erfahren – sonst kauft er es nicht und denkt, er habe es.
      hub
        .put(
          `/api/family/shopping/${encodeURIComponent(id)}`,
          { done: true },
          {
            fallback: null,
          }
        )
        .finally(ladeEinkauf);
    },
    [hub, ladeEinkauf]
  );

  /**
   * Einen Posten wegnehmen, ohne ihn gekauft zu haben.
   *
   * Abhaken heisst «habe ich» – das ist etwas anderes als «war ein
   * Vertipper». Vorher ging Letzteres nur unter Familie, also genau dort
   * nicht, wo man steht, wenn es auffällt.
   */
  const entferneEinkauf = useCallback(
    (id: string) => {
      setEinkauf((liste) => liste.filter((eintrag) => eintrag.id !== id));
      hub
        .del(`/api/family/shopping/${encodeURIComponent(id)}`, { fallback: null })
        .finally(ladeEinkauf);
    },
    [hub, ladeEinkauf]
  );

  /**
   * Die Stückzahl eines Postens ändern.
   *
   * Die Menge steht im Text und nicht in einem eigenen Feld: «2× Milch»
   * ist auch für den lesbar, der die Liste unter Familie oder im
   * Rohzustand ansieht, und der Hub muss nichts davon wissen. Fällt sie
   * unter eins, ist der Posten weg – ein «0× Milch» will niemand sehen.
   */
  const setzeMenge = useCallback(
    (id: string, menge: number) => {
      const eintrag = einkaufRef.current.find((row) => row.id === id);
      if (!eintrag) return;
      const { name } = mengeUndName(String(eintrag.text ?? ''));
      if (menge < 1) {
        entferneEinkauf(id);
        return;
      }
      const text = mitMenge(name, Math.min(99, menge));
      setEinkauf((liste) => liste.map((row) => (row.id === id ? { ...row, text } : row)));
      hub
        .put(`/api/family/shopping/${encodeURIComponent(id)}`, { text }, { fallback: null })
        .finally(ladeEinkauf);
    },
    [hub, ladeEinkauf, entferneEinkauf]
  );

  /** Ein Abhaken zurücknehmen – der Posten steht wieder offen auf der Liste. */
  const nimmAbhakenZurueck = useCallback(() => {
    const zurueck = einkaufUndo;
    if (!zurueck) return;
    setEinkaufUndo(null);
    setEinkauf((liste) => [...liste, { id: zurueck.id, text: zurueck.text }]);
    hub
      .put(
        `/api/family/shopping/${encodeURIComponent(zurueck.id)}`,
        { done: false },
        {
          fallback: null,
        }
      )
      .finally(ladeEinkauf);
  }, [einkaufUndo, hub, ladeEinkauf]);

  /**
   * Den Rückweg zu einem grossen Griff beim Hub hinterlegen.
   *
   * Der einzelne Befehl hat sein Zurück in useHub; bei zwanzig Geräten
   * auf einmal hilft das nicht. Der Hub rechnet aus dem Stand von vorher
   * aus, was zurückzuschalten wäre – und lässt Geräte weg, an denen der
   * Griff nichts geändert hat (hub/core/rueckgriff.py).
   */
  const merkeGriff = useCallback(
    async (titel: string, entityIds: string[]) => {
      setGriffUndo(null);
      if (entityIds.length === 0) return;
      const antwort = await hub.post<{ undo: { id: string } | null }>(
        '/api/undo',
        { title: titel, entity_ids: entityIds },
        { fallback: { undo: null }, still: true }
      );
      // Gezählt wird, was der Griff schaltet, nicht was sich davon
      // zurückholen lässt: Der Satz auf der Einblendung berichtet, was
      // gerade passiert ist. Dass ein Saugroboter nicht mit zurückkommt,
      // steht in hub/core/szenenrueckweg.py (OHNE_RUECKWEG).
      if (antwort.undo) setGriffUndo({ id: antwort.undo.id, count: entityIds.length });
    },
    [hub]
  );

  /** Den letzten grossen Griff zurücknehmen. */
  const nimmGriffZurueck = useCallback(() => {
    const zurueck = griffUndo;
    if (!zurueck) return;
    setGriffUndo(null);
    hub
      .post<{ restored?: string[] }>(`/api/undo/${zurueck.id}/run`, undefined, {
        fallback: {},
      })
      .then((antwort) => {
        const zahl = antwort.restored?.length ?? 0;
        if (zahl > 0) setNote(`${zahl} Gerät${zahl === 1 ? '' : 'e'} zurückgeschaltet`);
      });
  }, [griffUndo, hub]);

  // Die Funkenlinien der Sensoren: ein Abruf für alle, alle fünf
  // Minuten - die Reihen ändern sich nicht schneller (Drosselung im
  // Hub, core/kurzverlauf.py).
  const [trends, setTrends] = useState<Record<string, [number, number][]>>({});
  useEffect(() => {
    if (status !== 'connected') return;
    let beendet = false;
    const laden = () =>
      hub
        .get<{ trends?: Record<string, [number, number][]> } | null>('/api/trends', {
          fallback: null,
          still: true,
        })
        .then((data) => {
          if (!beendet && data?.trends) setTrends(data.trends);
        });
    laden();
    const takt = setInterval(laden, 5 * 60 * 1000);
    return () => {
      beendet = true;
      clearInterval(takt);
    };
  }, [status, hub]);

  // Wie oft welcher Raum auf diesem Gerät bedient wurde - nur fürs
  // Sortieren, wenn der Schalter dazu an ist (lib/raumnutzung.ts).
  const [raumZaehler, setRaumZaehler] = useState<Nutzung>({});
  useEffect(() => {
    AsyncStorage.getItem('homepilot.raumnutzung')
      .then((roh) => {
        if (roh) setRaumZaehler(JSON.parse(roh));
      })
      .catch(() => {});
  }, []);
  const zaehleRaum = useCallback((raum: string | null | undefined) => {
    if (!raum) return;
    setRaumZaehler((zaehler) => {
      const neu = merkeRaum(zaehler, raum, Date.now());
      AsyncStorage.setItem('homepilot.raumnutzung', JSON.stringify(neu)).catch(() => {});
      return neu;
    });
  }, []);

  // Ist gerade jemand da? Beim Öffnen der Einstellungen fragen,
  // nicht dauernd: Die Zeile im Menü ist der einzige Ort, an dem die
  // Antwort gebraucht wird - und dort steht sie eine Sekunde später.
  useEffect(() => {
    if (section !== 'settings') return;
    hub
      .get<{ babysitter?: BabysitterStand } | null>('/api/automations/babysitter', {
        fallback: null,
        still: true,
      })
      .then((data) => setBesuchStand(data?.babysitter ?? null));
  }, [section, hub]);

  // Geräte, die nicht antworten oder verstummt sind – für die Zeile im
  // Menü. Batterien und Wartungen bleiben aussen vor: Ob eine Warnung
  // quittiert ist, weiss nur der Hub, und das Blatt fragt ihn selbst.
  const stummeGeraete = useMemo(
    () =>
      sorgen({ entities, jetzt: Date.now() }).filter(
        (sorge) => sorge.art === 'offline' || sorge.art === 'still'
      ),
    [entities]
  );

  // Was die Einblendung unten anbietet: Abhaken, Griff oder die letzte
  // Schaltung – in dieser Reihenfolge, aus einem Grund (lib/rueckgriff.ts).
  const rueckAngebot = useMemo(
    () =>
      rueckangebot({
        fehler: !!(error || abrufFehler),
        einkauf: einkaufUndo ? { name: mengeUndName(einkaufUndo.text).name } : null,
        griff: griffUndo,
        befehl: undo,
      }),
    [error, abrufFehler, einkaufUndo, griffUndo, undo]
  );

  /** Einen Artikel auf die Liste setzen – aus dem Fenster der Kopfzeile.
   *
   *  Der Eintrag erscheint sofort, mit einer vorläufigen Kennung: Wer
   *  drei Sachen hintereinander eintippt, soll nicht nach jeder auf den
   *  Hub warten. Der Abruf danach ersetzt ihn durch den echten. */
  const kaufeEin = useCallback(
    async (text: string) => {
      const name = text.trim();
      if (!name || !settings.url) return;
      // Schon drauf? Dann meint «Milch» den vorhandenen Posten und nicht
      // einen zweiten. Wer zwei Einträge «Milch» auf der Liste hat, kauft
      // im Zweifel beide.
      const schonDa = findeArtikel(einkaufRef.current, name);
      if (schonDa) {
        const jetzt = mengeUndName(String(schonDa.text ?? ''));
        setzeMenge(String(schonDa.id), jetzt.menge + mengeUndName(name).menge);
        return;
      }
      setEinkauf((liste) => [...liste, { id: `neu-${name}`, text: name }]);
      setBekannt((liste) => [name, ...liste.filter((entry) => entry !== name)]);
      // Der Gang wird hier bestimmt und nicht im Hub: Dieselbe Zuordnung
      // sortiert die Liste, und sie steht in lib/einkauf.ts.
      // Schlägt es fehl, sagt es die Einblendung, und der Abruf gleich
      // darauf räumt den vorläufigen Eintrag wieder weg.
      await hub.post(
        '/api/family/shopping',
        { text: name, category: shopCategory(name) },
        { fallback: null }
      );
      ladeEinkauf();
    },
    [hub, settings.url, ladeEinkauf, setzeMenge]
  );

  // Die Ablaufnamen holen, damit die Suche sie kennt – und den
  // Babysitter-Modus gleich mit.
  //
  // Und noch einmal, sobald am Panel ein persönlicher Bereich aufgeht:
  // Der Riegel davor hängt am Babysitter-Modus, und der wird vom Telefon
  // aus umgelegt, während das Panel im Flur längst offen dasteht. Der
  // Moment, in dem dort jemand «Familie» drückt, ist genau der, in dem
  // die Auskunft frisch sein muss. Nicht bei jedem Bereichswechsel: Am
  // Telefon steht der Riegel nie, und die Ablaufliste ist keine kleine
  // Antwort.
  useEffect(() => {
    if (!settings.url || !settings.token || status !== 'connected') return;
    let alive = true;
    hub
      .get<
        { automations?: SuchAblauf[]; babysitter?: { active?: boolean } } | SuchAblauf[]
      >('/api/automations', {
        fallback: [],
        still: true,
      })
      .then((rows) => {
        // Der Hub antwortet mit {automations: [...], paused_until} – der
        // alte Array-Check liess die Liste immer leer, und die Suche
        // fand nie einen Ablauf, ohne dass es jemandem auffiel.
        const liste = Array.isArray(rows) ? rows : rows?.automations;
        if (!alive) return;
        setAutomations(Array.isArray(liste) ? liste : []);
        // Derselbe Abruf trägt den Babysitter-Modus mit. Eine eigene
        // Anfrage dafür wäre eine mehr für dieselbe Antwort.
        if (!Array.isArray(rows)) setBabysitter(!!rows?.babysitter?.active);
      })
      // Ohne Antwort keine Vorschläge - die Startseite trägt das.
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [settings.url, settings.token, status, riegelFrage]);

  // Beim Verlassen der Geräteliste die Suche zurücksetzen – wer später
  // zurückkommt, will die volle Liste sehen, nicht den alten Suchbegriff.
  useEffect(() => {
    if (section !== 'devices') setQuery('');
  }, [section]);

  // Wandpanel: Bildschirm bleibt an, und nach drei Minuten ohne Berührung
  // kehrt die Ansicht zur Startseite zurück – ein fest montiertes iPad soll
  // nicht in den Einstellungen stehenbleiben.
  // Ein Gemeinschaftsgerät ist ein Wandpanel - dafür ist es da. Der
  // Schalter in den Einstellungen bleibt für alle anderen Geräte.
  usePanelMode(!!settings.panel || !!user?.shared);
  // Und nachts wird es dunkler. `now` tickt ohnehin jede halbe Minute
  // weiter; damit der Schleier nach einer Berührung nicht bis zum
  // nächsten Tick hell bleibt, hängt er auch an lastTouch.
  // Auch am Gemeinschaftsgerät: Es hängt an der Wand und leuchtet sonst
  // die ganze Nacht in den Flur - der Grund, aus dem es den Schleier
  // überhaupt gibt.
  const panelArtig = !!settings.panel || !!user?.shared;
  const nachtSchleier = useMemo(
    () => schleier(now, lastTouch, panelArtig),
    [now, lastTouch, panelArtig]
  );
  const push = usePushRegistration(settings, status === 'connected');
  // Wie das Haus aussieht: auf dem Hub, für alle gleich. Nur die
  // Lesemarke der «Was ist neu»-Karte bleibt persönlich.
  const {
    prefs,
    hausGeladen,
    setHausPrefs,
    eigenePrefs,
    setOrder,
    setHidden,
    setFamilyHidden,
    setLocked,
    setUngezaehlt,
    setSeenChanges,
    setKameraDynamisch,
    setTageszeit,
    setRaumNutzung,
    setDoppeltipp,
    setLiveTuer,
    setLiveAus,
    setFavorites,
    setFavoriteOrder,
    setDurchsage,
    setBioLock,
    setDoorConfirm,
    setWidgetData,
    setWidgetButtons,
    setWidgetDirect,
    setWidgetKarten,
  } = usePrefs(settings, status === 'connected');

  // Die Haustür-Karte für unterwegs - tut nur auf einem iPhone mit dem
  // passenden Build etwas (hooks/useLiveAktivitaet.ts). Hängt am
  // Profil-Schalter: aus heisst, dieses Gerät meldet gar keine Tokens an.
  useLiveAktivitaet(
    settings,
    status === 'connected' && eigenePrefs.liveTuer !== false
  );

  // Einmalige Übernahme dessen, was vorher im Gerät und beim Benutzer
  // lag. Erst nach der ersten Antwort des Hubs - sonst sähe die
  // Übernahme ein leeres Haus, wo nur die Antwort noch unterwegs ist.
  const uebernahmeLief = useRef(false);
  useEffect(() => {
    if (uebernahmeLief.current || !hausGeladen) return;
    const next = altesUebernehmen(prefs, settings, eigenePrefs as Record<string, unknown>);
    if (next === null) {
      uebernahmeLief.current = true;
      return;
    }
    uebernahmeLief.current = true;
    setHausPrefs(next);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hausGeladen]);

  // Das Widget lebt in einem eigenen Prozess und kennt die Einstellungen
  // nicht - Knöpfe, Adresse und Token wandern deshalb in die geteilte
  // App-Gruppe. Bei jeder Änderung neu, damit ein gewechseltes Token
  // nicht ein Widget zurücklässt, das ins Leere fragt, und eine
  // gelöschte Szene keinen Knopf, der nirgends hinführt.
  const widgetButtons = useMemo(
    () =>
      mitDirekt(
        resolveButtons(prefs.widgetButtons, scenes, entities),
        // Ohne eigene Wahl schalten die Knöpfe, die es dürfen. Vorher
        // war die Vorgabe «keiner»: Jedes frische Widget öffnete nur
        // die App - genau die Klage aus dem Haus.
        prefs.widgetDirect ?? standardDirekt(prefs.widgetButtons ?? [], entities),
        entities,
        !!prefs.widgetData
      ),
    [prefs.widgetButtons, prefs.widgetDirect, prefs.widgetData, scenes, entities]
  );
  // Die selbst zusammengestellten Karten - je eine für ein Gerät oder
  // eine Szene. Dieselbe Ablage, derselbe Takt wie die Knöpfe.
  const widgetKarten = useMemo(
    () => resolveKarten(prefs.widgetKarten, scenes, entities, !!prefs.widgetData),
    [prefs.widgetKarten, prefs.widgetData, scenes, entities]
  );
  const [widgetAblage, setWidgetAblage] = useState<Ablage>('kein-widget');
  useEffect(() => {
    // Erst, wenn etwas da ist: Vor der ersten Antwort des Hubs sind
    // Szenen und Geräte leer, und eine Szene, die es «noch nicht gibt»,
    // fiele aus der Knopfliste heraus - das Widget stünde kurz mit
    // weniger Knöpfen da, als jemand eingestellt hat.
    if (entities.length === 0 && scenes.length === 0) return;
    setWidgetAblage(
      syncWidget(settings, !!prefs.widgetData, widgetButtons, widgetKarten)
    );
  }, [
    settings.url,
    settings.token,
    prefs.widgetData,
    widgetButtons,
    widgetKarten,
    entities.length,
    scenes.length,
  ]);

  // Antippen einer Alarm-Nachricht führt direkt zur Kamera des betroffenen
  // Raums. Wer nachts geweckt wird, soll nicht erst durch die Räume suchen.
  // Dasselbe für die Batteriewarnung: Sie führt auf die Geräteseite mit
  // aufgeklappten Batterien – dort steht der Knopf zum Quittieren, und
  // ohne den Sprung sucht man ihn zwei Ebenen tief.
  const onNotificationTap = useCallback((tap: Tap) => {
    if (tap.camera) {
      setFullscreen(tap.camera);
      return;
    }
    if (tap.type === 'battery') {
      setSection('devices');
      setBatterienOffen(true);
      return;
    }
    if (tap.type === 'alarm') setSection('alarm');
  }, []);
  // «Später» und «Erledigt» aus der Mitteilung heraus. Beides läuft ohne
  // die App zu öffnen; sie erfährt davon, sobald sie das nächste Mal
  // läuft, und reicht es an den Hub weiter (lib/mitteilungsknoepfe.ts).
  const onKnopf = useCallback(
    (druck: Knopfdruck) => {
      if (druck.handlung === 'spaeter') {
        hub
          .post('/api/push/snooze', {
            title: druck.title,
            body: druck.body,
            category: druck.category,
            minutes: 30,
          }, { still: true })
          .then(() => setNote('Erinnerung in 30 Minuten'))
          .catch(() => {});
        return;
      }
      // «Erledigt» gibt es bisher für die Batteriewarnung: Sie quittiert
      // das Gerät, damit sie nicht jede Woche wiederkommt.
      if (druck.entityId) {
        hub
          .post(`/api/batteries/${encodeURIComponent(druck.entityId)}/ack`, {}, { still: true })
          .then(() => setNote('Quittiert'))
          .catch(() => {});
      }
    },
    [hub, setNote]
  );
  useNotificationTap(onNotificationTap, onKnopf);

  // Zurück zur Startseite, wenn drei Minuten niemand tippt. Am
  // Gemeinschaftsgerät genauso wie am Wandpanel - und dabei fällt der
  // Riegel wieder zu: Eine offene Einkaufsliste soll nicht im Flur
  // stehen bleiben, bloss weil vorhin jemand das Passwort kannte.
  useTakt(
    () => {
      if (Date.now() - lastTouch > 180000) {
        setSection('start');
        setEditing(false);
        setRoom(ALL_ROOMS);
        setRiegelBis(0);
        setRiegelModul(null);
      }
    },
    panelArtig ? 30000 : null
  );

  // Die Favoriten sind persönlich: Was Stefan jeden Abend braucht, ist
  // für Livia nur eine Kachel im Weg. Lange stand der Stern am Gerät auf
  // dem Hub und galt damit für alle – diese Sterne bleiben der
  // Startbestand für jeden, der noch keine eigene Liste hat. Der erste
  // eigene Stern (setzen oder lösen) schreibt die Liste beim Benutzer
  // fest; die alten Sterne am Gerät bleiben unangetastet stehen, damit
  // die Übernahme bei den anderen genauso funktioniert.
  const favorites = useMemo(
    () => eigenePrefs.favorites ?? favoritenVon(entities),
    [eigenePrefs.favorites, entities]
  );
  const hidden = prefs.hidden ?? [];
  const locked = prefs.locked ?? [];
  // Zählt in der «3 an» oben nicht mit – bleibt aber auf der Startseite
  // stehen. Zwei verschiedene Listen, siehe lib/zaehlung.ts.
  const ungezaehlt = prefs.ungezaehlt ?? [];

  // Einmalige Übernahme der alten, gerätelokalen Favoriten. Danach wird
  // die lokale Liste geleert, damit dieselben Sterne nicht bei jedem
  // Start erneut losgeschickt werden.
  const uebernommen = useRef(false);
  useEffect(() => {
    if (uebernommen.current) return;
    const alte = zuUebernehmen(settings.favorites, entities);
    if (alte.length === 0) {
      // Nichts zu tun - aber wenn lokal noch etwas steht, obwohl der Hub
      // schon Favoriten kennt, ist es Altlast und darf weg.
      if ((settings.favorites ?? []).length > 0 && entities.length > 0) {
        uebernommen.current = true;
        onSaveSettings({ ...settings, favorites: [] });
      }
      return;
    }
    uebernommen.current = true;
    alte.forEach((id) => setEntityMeta(id, { favorite: true }));
    onSaveSettings({ ...settings, favorites: [] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entities.length]);

  /**
   * Ein gesperrtes Gerät schaltet nur nach ausdrücklicher Rückfrage.
   *
   * Zentral hier und nicht in der Kachel: So greift die Sperre auf jedem
   * Weg – Kachel, Raumfliese, Schnellzugriff –, statt an der einen Stelle
   * zu fehlen, an die niemand gedacht hat.
   */
  const guardedCommand = useCallback(
    async (entityId: string, command: string, data?: CommandData) => {
      const entity = entities.find((item) => item.id === entityId);
      if (entity && locked.includes(entityId) && SWITCHING.has(command)) {
        setConfirm({ entity, command, data });
        return;
      }
      // Face ID vor dem Aufschliessen und Entschärfen, wenn eingeschaltet.
      // Das ist eine Hürde vor dem Absenden, kein Ersatz für Rechte oder
      // die Alarm-PIN - der Hub prüft beides weiterhin selbst.
      if (prefs.bioLock && needsCheck(command, entity?.kind)) {
        const erlaubt = await confirmBiometrie(command);
        if (!erlaubt) return;
      }
      // Entschärfen mit PIN: Der Alarm-Bildschirm hat ein eigenes Feld,
      // führt aber über «Einstellungen» und steht damit nur der
      // Besitzerin offen. Über die Kachel kam bisher eine Absage vom Hub
      // statt eines Feldes.
      if (entity && verlangtPin(entity, command, !!user?.shared, data?.pin)) {
        setPinAsk({ entity, command, data });
        return;
      }
      // Erst zählen, dann schalten: Die Zählung speist die Sortierung
      // «meistbenutzter Raum zuoberst» (lib/raumnutzung.ts).
      zaehleRaum(entity?.room);
      sendCommand(entityId, command, data);
    },
    [entities, locked, sendCommand, prefs.bioLock, user?.shared, zaehleRaum]
  );

  /**
   * Eine Durchsage von der Startseite aus – hinter der Favoritenkachel.
   *
   * Hier und nicht in der Übersicht: Die weiss vom Hub nichts, sie
   * bekommt Befehle als Funktionen gereicht. Wer nicht schalten darf,
   * bekommt gar keine Funktion und damit auch keine Kachel.
   */
  const sendeDurchsage = useCallback(
    async (text: string, speakers: string[]) =>
      hub.post<{ sent?: string[]; errors?: string[] }>(
        '/api/broadcast',
        { text, speakers },
        { still: true }
      ),
    [hub]
  );

  /**
   * Dasselbe mit der eigenen Stimme – die Aufnahme geht roh hinüber.
   *
   * Als JSON wäre sie base64-verpackt um ein Drittel grösser, und der
   * Umweg brächte nichts, was der Content-Type des Blobs nicht auch
   * sagt. Die Empfänger stehen darum in der Adresse.
   */
  const sendeSprachnotiz = useCallback(
    async (aufnahme: Blob, speakers: string[]) =>
      hub.roh<{ sent?: string[]; errors?: string[] }>(
        `/api/broadcast/voice?speakers=${encodeURIComponent(speakers.join(','))}`,
        aufnahme,
        { still: true }
      ),
    [hub]
  );

  // Abkürzungen aus dem Widget und von NFC-Aufklebern: homepilot://door
  // öffnet die Türe (mit Rückfrage), //alloff und //alarm springen an die
  // passende Stelle, //scene/<id> löst eine Szene aus und //entity/<id>
  // schaltet ein Gerät.
  //
  // Kein blindes Schalten aus dem Sperrbildschirm heraus: Schlösser
  // bekommen immer die Rückfrage, alles andere geht durch
  // guardedCommand - dieselbe Hürde wie beim Antippen einer Kachel,
  // samt Sperre und Face ID. Ein Widget-Knopf darf nicht mehr dürfen als
  // die App selbst.
  //
  // Steht hier unten und nicht weiter oben, weil er guardedCommand
  // braucht: Ein useEffect, dessen Abhängigkeit noch gar nicht angelegt
  // ist, wirft beim ersten Zeichnen.
  useEffect(() => {
    const handle = (url: string | null) => {
      if (!url || !url.startsWith('homepilot://')) return;
      const [what, ...rest] = url.replace('homepilot://', '').split(/[/?]/);
      const id = rest.length > 0 ? decodeURIComponent(rest.join('/')) : '';
      if (what === 'door') {
        const door =
          entities.find(
            (entity) => entity.kind === 'lock' && entity.commands.includes('open_door')
          ) ?? entities.find((entity) => entity.kind === 'lock');
        if (door) {
          setSection('home');
          setConfirm({
            entity: door,
            command: door.commands.includes('open_door') ? 'open_door' : 'unlatch',
          });
        }
      } else if (what === 'alloff') {
        setSection('home');
        setRoom(ALL_ROOMS);
        // Der Knopf hiess «Alles aus» – dann soll auch die Rückfrage
        // dazu aufgehen, nicht bloss die Raumübersicht. Vorher tippte
        // man, nichts passierte, und man tippte nochmal.
        setAllOffSignal((n) => n + 1);
      } else if (what === 'alarm') {
        setSection('alarm');
      } else if (what === 'scene' && id) {
        if (scenes.some((scene) => scene.id === id)) {
          setSection('start');
          activateScene(id);
        }
      } else if (what === 'entity' && id) {
        const entity = entities.find((item) => item.id === id);
        if (!entity) return;
        setSection('start');
        if (entity.kind === 'lock') {
          // Ein Schloss fragt immer nach - auch das eigene Wohnzimmer
          // hat eine Türe, und der Sperrbildschirm ist kein Ort für
          // einen einzigen Tipp.
          setConfirm({
            entity,
            command: entity.commands.includes('open_door') ? 'open_door' : 'unlatch',
          });
          return;
        }
        const command = widgetCommand(entity);
        if (command) guardedCommand(entity.id, command);
      }
    };
    // Kein Start-Link ist der Normalfall - dann startet die App normal.
    Linking.getInitialURL()
      .then(handle)
      .catch(() => {});
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, [entities, scenes, activateScene, guardedCommand]);

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

  // Nicht «eine Kamera, die klingelt», sondern «was gerade klingelt».
  // Die Haustüre ist hier eine Ring-Gegensprechanlage, und die legt der
  // Hub als Türe an – die alte Suche nach kind === 'camera' ging genau
  // an ihr vorbei, und das Vollbild kam nie.
  const klingelt = klingeltGerade(entities);
  const ringKey = klingelt ? `${klingelt.id}:${klingelt.state.last_ring ?? ''}` : null;
  const klingelKamera = useMemo(
    () => klingelBild(entities, klingelt),
    [entities, klingelt]
  );
  // Wer klingelt, muss durch zwei Türen: unten die Haustüre, oben die
  // Wohnungstüre – und die obere kann zweierlei, aufschliessen und
  // öffnen. Alle drei Handgriffe gehören auf diesen einen Bildschirm.
  const klingelWege = useMemo(
    () => klingelAktionen(entities, klingelt),
    [entities, klingelt]
  );

  const hasRail = width >= breakpoints.rail;
  const hasSidePanel = width >= breakpoints.sidePanel;
  // Auf dem knapperen Tablet etwas schmaler, damit dem Hauptbereich genug
  // bleibt: 1024 minus Navigationsleiste minus Spalte sind sonst keine
  // 600 Punkte für die Kacheln.
  const panelWidth = width >= 1100 ? PANEL_WIDTH : 300;
  // Aus der gemessenen Fläche, nicht aus der Fensterbreite: Bis hierher
  // entschied «ab 380 Punkten zwei Spalten» am Fenster, gerechnet wurde
  // aber mit `gridWidth`. Zwei Zahlen für dieselbe Frage – und die
  // Schwelle lag genau zwischen den Geräten: iPhone Max zweispaltig,
  // jedes kleinere einspaltig. Kameras brauchen mehr Fläche und
  // bekommen darum weniger Spalten (siehe lib/raster).
  const columns = spalten(
    gridWidth,
    section === 'cameras' ? { mindest: KAMERA_MINDEST, hoechstens: 2 } : { hoechstens: 3 }
  );
  const cardWidth = gridWidth > 0 ? kachelBreite(gridWidth, columns) : undefined;

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
    const named = raeumeSortiert([...ordered, ...extra], prefs.order?.raeume);
    // Wer es eingeschaltet hat, bekommt den meistbedienten Raum
    // zuoberst - «Alle» bleibt davor, es ist kein Raum.
    const sortiert = eigenePrefs.raumNutzung
      ? nutzungsReihenfolge(named, raumZaehler, now.getTime())
      : named;
    return sortiert.length > 0 ? [ALL_ROOMS, ...sortiert] : [];
  }, [entities, roomOrder, prefs.order?.raeume, eigenePrefs.raumNutzung, raumZaehler, now]);

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
    const grund = weather?.state?.state;
    return skyFromIcon(weather?.state?.icon, grund == null ? undefined : String(grund));
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

  // Welcher Raum steht offen? Nur dann bekommt die Spalte rechts die Box
  // dieses Raums. «Weitere» (alles ohne Raum) ist keiner: Eine Karte
  // «Weitere» über einer Box, die irgendwo steht, sagt nichts.
  const offenerRaum =
    section === 'home' && room !== ALL_ROOMS && room !== NO_ROOM ? room : null;
  // Die Musik des Raums liegt rechts in der Spalte, unter der grossen
  // Musikkarte - deshalb hier nicht noch einmal zwischen den Lampen.
  const raumBoxen = musikboxenImRaum(inRoom, offenerRaum);

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
          (entity) =>
            !hidden.includes(entity.id) &&
            !entity.combined_into &&
            // Beim Anpassen bleibt sie stehen: Wer Kacheln ordnet oder
            // ausblendet, muss sie greifen können.
            !raumBoxen.some((box) => box.id === entity.id)
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
  const orderIds = (orderScope ? prefs.order?.[orderScope] : undefined) ?? [];
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
  const vorgefiltert =
    section === 'devices' && deviceFilter
      ? shown.filter((entity) => passtFilter(entity, deviceFilter, hidden))
      : shown;
  const found = searching
    ? vorgefiltert.filter((entity) =>
        [
          entity.name,
          entity.room ?? '',
          entity.group ?? '',
          entity.integration,
          // Auch über die Art – dieselbe Regel wie in der Geräteauswahl
          // der Abläufe: «Saugroboter» findet ihn, ohne dass man wissen
          // muss, dass er «Rosa» heisst. Zwei gleich aussehende
          // Suchfelder, die verschieden können, sind schlimmer als eines,
          // das wenig kann.
          deviceKindLabel(entity),
        ]
          .join(' ')
          .toLowerCase()
          .includes(needle)
      )
    : vorgefiltert;

  // Hat ein Raum eine selbst gezogene Reihenfolge, gilt genau sie - dann
  // entfällt auch die Zweiteilung «Aktiv/Ruhend», die Kacheln stehen, wo
  // man sie hingezogen hat.
  const customOrdered =
    orderScope != null && (orderIds.length > 0 || (editing && !searching));
  const running =
    section === 'home' && !customOrdered ? shown.filter(isActive).sort(byFavorite) : [];
  // Nach Tageszeit sortieren - aber nur, wenn jemand das eingeschaltet
  // hat, und nur, wo es etwas zu sortieren gibt. Beim Anpassen und beim
  // Suchen bleibt die Reihenfolge, wie sie ist: Sonst zieht man eine
  // Kachel, und sie springt zur nächsten vollen Stunde weg.
  const tageszeitAn =
    !!eigenePrefs.tageszeit && !editing && !searching && lohntSich(shown);
  const abschnitt = tageszeitAn ? jetzigerAbschnitt(now.getTime()) : null;
  const nachZeit = <T extends { kind: string }>(liste: T[]): T[] =>
    abschnitt ? nachTageszeit(liste, abschnitt) : liste;

  const rest =
    section === 'home'
      ? customOrdered
        ? nachZeit([...shown].sort(byOrder))
        : nachZeit(shown.filter((entity) => !isActive(entity)).sort(byFavorite))
      : section === 'devices'
        ? sortiereGeraete([...found].sort(byOrder), deviceSort, deviceKindLabel)
        : section === 'cameras' && eigenePrefs.kameraDynamisch && !editing
          ? // Sobald etwas los ist, ist die feste Reihenfolge die
            // falsche: Dann will man die Kamera sehen, an der sich etwas
            // bewegt, und nicht sechs Kacheln absuchen. Beim Anpassen
            // bleibt sie stehen - sonst zieht man eine Kachel, und sie
            // springt beim nächsten Ereignis wieder weg.
            nachBewegung([...found].sort(byOrder), now.getTime())
          : [...found].sort(byOrder);

  // Bei vielen Räumen wird die Startseite im „Alle“-Modus nach Räumen
  // gruppiert (Überschrift je Zimmer), damit man das ganze Haus auf einen
  // Blick durchscrollt und alles schnell erreicht. Favoriten stehen als
  // eigene Gruppe ganz oben – der schnelle Griff ins andere Zimmer.
  // Die Licht-Seite zeigt immer das ganze Haus. Ohne Gliederung standen
  // dort zwanzig Lampen alphabetisch untereinander – «Lina» zwischen
  // «Küche» und «Vorratsraum». Gesucht wird aber nie ein Buchstabe,
  // sondern immer ein Zimmer. Bei nur einem Zimmer wäre die eine
  // Überschrift bloss eine Zeile mehr, deshalb erst ab zweien.
  const lichtNachRaum =
    section === 'light' && new Set(shown.map((entity) => entity.room ?? '')).size > 1;
  const grouped =
    (section === 'home' && room === ALL_ROOMS && rooms.length > 2 && editing) ||
    lichtNachRaum;
  // Wohin eine hier gezogene Reihenfolge gehört.
  const gruppenBereich = lichtNachRaum ? 'light' : 'room';
  // Raum-Kacheln: die «Räume»-Übersicht zeigt je Raum eine Kachel mit den
  // Geräten darin; Antippen öffnet die volle Raumansicht.
  const roomTiles =
    section === 'home' && room === ALL_ROOMS && !editing && rooms.length > 0;
  const groups = useMemo(() => {
    if (!grouped) return [];
    // Auf der Licht-Seite keine Favoritengruppe: Wer nach Zimmer sucht,
    // will die Lampe dort finden, wo sie hängt – nicht in einem Topf
    // darüber.
    const gruppen = raumGruppen(
      shown,
      rooms.filter((name) => name !== ALL_ROOMS),
      lichtNachRaum ? [] : favorites
    );
    // Jede Gruppe in ihrer eigenen Reihenfolge - sonst liesse sich zwar
    // ziehen, aber beim nächsten Öffnen stünde wieder alles alphabetisch.
    // Auf der Licht-Seite gilt die früher gezogene flache Reihenfolge als
    // Rückfall, damit sie beim Umstellen auf Zimmer nicht verlorengeht.
    // Die Favoritengruppe folgt der persönlichen Reihenfolge – dieselbe
    // wie auf der Startseite, denn es ist dieselbe Frage.
    return gruppen.map((gruppe) => ({
      ...gruppe,
      items: sortByOrder(
        gruppe.items,
        (groupScope(gruppe.key, gruppenBereich) === 'favorites'
          ? (eigenePrefs.favoriteOrder ?? prefs.order?.favorites)
          : prefs.order?.[groupScope(gruppe.key, gruppenBereich)]) ??
          (lichtNachRaum ? prefs.order?.light : undefined)
      ),
    }));
  }, [
    grouped,
    lichtNachRaum,
    gruppenBereich,
    rooms,
    shown,
    favorites,
    prefs.order,
    eigenePrefs.favoriteOrder,
  ]);

  // Ein einzelner Raum wird nach Kategorien gegliedert: Szenen des Raums
  // oben, dann Beleuchtung, Store, Medien, alles Übrige unter „Weitere“.
  // Leere Kategorien werden weggelassen. „Store“ (Storen/Rollläden)
  // erscheint so von selbst nur in Räumen mit solchen Geräten.
  const categorized =
    section === 'home' && room !== ALL_ROOMS && !editing && !customOrdered;
  // Nicht nur das room-Feld: Eine Szene erscheint in jedem Raum, dessen
  // Geräte sie schaltet. «Feierabend» stand vorher in höchstens einem.
  const roomScenes = useMemo(
    () => (categorized ? szenenFuerRaum(scenes, entities, room) : []),
    [categorized, scenes, entities, room]
  );
  // Jede Geräteart bekommt ihre Überschrift statt eines Topfs «Weitere» –
  // in einem Bad mit Thermostat, Feuchtefühler und Handtuchtrockner war
  // «Weitere» sonst die einzige. Messwerte stehen im Raumkopf, nicht als
  // Kacheln. Favoriten bleiben je Gruppe vorn.
  const categories = useMemo(() => {
    if (!categorized) return [];
    return raumKategorien(shown, deviceKindLabel).map((gruppe) => ({
      ...gruppe,
      items: [...gruppe.items].sort(byFavorite),
    }));
    // byFavorite ist eine je Rendern neue Funktion über favorites.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [categorized, shown, favorites]);
  // Kopfzeile und Messwert-Chips des Raums.
  const raumKopf = categorized ? raumZeile(inRoom) : '';
  const messwerte = useMemo(
    () => (categorized ? raumMesswerte(shown) : []),
    [categorized, shown]
  );

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
  //
  // Früher war Ziehen an eine einzige Reihenfolge gebunden und deshalb
  // ausgerechnet dort abgeschaltet, wo man «Anpassen» am ehesten drückt:
  // auf «Räume → Alle». Der Anpassen-Modus gruppiert dort nach Zimmern,
  // und gruppiert hiess: keine Griffe. Jetzt hat jede Gruppe ihre eigene
  // Reihenfolge - was innerhalb eines Zimmers oben steht, ist ohnehin die
  // Frage, die man sich stellt.
  const dragEnabled = editing && !searching && !categorized;
  const cellLayouts = useRef(new Map<string, CellLayout>()).current;
  const [drag, setDrag] = useState<{ id: string; dx: number; dy: number } | null>(null);
  const startDrag = useCallback((id: string) => setDrag({ id, dx: 0, dy: 0 }), []);
  const moveDrag = useCallback(
    (dx: number, dy: number) => setDrag((d) => (d ? { ...d, dx, dy } : d)),
    []
  );

  // Kinder-Ansicht: Wer nur seine Räume sehen soll, bekommt genau die -
  // als grosse Knöpfe, ohne Tabs, Einstellungen und den Rest der Wohnung.
  // Die Rechte prüft weiterhin der Hub; das hier ist die Vereinfachung.
  if (user?.simple_rooms && user.simple_rooms.length > 0) {
    return (
      <KidsView
        name={user.name}
        rooms={user.simple_rooms}
        entities={entities}
        scenes={scenes}
        onCommand={(entityId, command) => guardedCommand(entityId, command)}
        onActivateScene={activateScene}
      />
    );
  }

  const renderCard = (entity: Entity, imRaumblock = false) => (
    <EntityCard
      key={entity.id}
      entity={entity}
      trend={trends[entity.id]}
      // Zweimal tippen = die eigene Lieblingseinstellung
      // (lib/doppeltipp.ts). Gemerkt wird über das Kachelmenü, aus dem,
      // was gerade eingestellt ist.
      doppelAktion={gemerkteAktion(eigenePrefs.doppeltipp, entity.id)}
      doppelLabel={menuLabel(eigenePrefs.doppeltipp, entity)}
      onDoppeltipp={
        darfSchalten
          ? (aktion) => {
              setDoppeltipp(entity.id, aktion);
              setNote(
                aktion
                  ? `Doppeltipp gemerkt: ${aktion.wort}`
                  : 'Doppeltipp vergessen'
              );
            }
          : undefined
      }
      width={cardWidth!}
      imRaumblock={imRaumblock}
      // Gehört dieser Spot zu einer zusammengefassten Leuchte? Unter
      // Geräte ist er sonst nicht von einer einzelnen Lampe zu
      // unterscheiden, und man wundert sich, warum er im Raum fehlt.
      partOf={
        entity.combined_into
          ? (entities.find((item) => item.id === entity.combined_into)?.name ?? null)
          : null
      }
      pending={pending[entity.id]}
      // Die letzte Absage des Hubs. Sie geht nur in die Fernbedienung –
      // die ist ein Modal und deckt das Band am unteren Rand zu, in dem
      // sie sonst steht.
      fehler={error}
      onFehlerWeg={dismissError}
      // Nur unter «Geräte»: Wo kommt das Gerät überall vor? Antippen
      // führt zu den Abläufen.
      usedIn={
        section === 'devices'
          ? (() => {
              const { ablaeufe, szenen } = verweiseAuf(entity.id, automations, scenes);
              return verweisText(ablaeufe.length, szenen.length) || undefined;
            })()
          : undefined
      }
      onUsedIn={() => setSection('automations')}
      pricePerKwh={energy?.price_per_kwh}
      currency={energy?.currency ?? 'CHF'}
      editing={editing}
      favorite={favorites.includes(entity.id)}
      hidden={hidden.includes(entity.id)}
      onToggleFavorite={() =>
        // toggleIn auf der wirksamen Liste: Beim allerersten Stern wird so
        // der Startbestand (die alten Haushalts-Sterne) gleich mit
        // festgeschrieben – setzen wie lösen funktioniert vom ersten
        // Tipp an.
        setFavorites(toggleIn(favorites, entity.id))
      }
      onToggleHidden={() => setHidden(toggleIn(hidden, entity.id))}
      locked={locked.includes(entity.id)}
      onToggleLocked={() => setLocked(toggleIn(locked, entity.id))}
      ungezaehlt={ungezaehlt.includes(entity.id)}
      onToggleUngezaehlt={() => setUngezaehlt(toggleIn(ungezaehlt, entity.id))}
      rooms={editing ? roomOrder : undefined}
      onSetRoom={editing ? (room) => setEntityRoom(entity.id, room) : undefined}
      onRename={
        // Nicht mehr nur im Anpassen-Modus: Ausserhalb hängt daran der
        // lange Druck auf die Kachel.
        darfAnpassen ? (name) => setEntityMeta(entity.id, { name }) : undefined
      }
      doorConfirm={prefs.doorConfirm}
      groups={editing ? groupNames : undefined}
      onSetGroup={editing ? (group) => setEntityMeta(entity.id, { group }) : undefined}
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
      onLongPress={
        // Überall dasselbe: langes Drücken zeigt den Verlauf dieses
        // Geräts. Hier stand einmal eine Ausnahme für «Geräte», weil
        // dort schon ein Tipp den Verlauf öffnet - ein zweiter Weg sei
        // verwirrend. In Wahrheit war es das Gegenteil: Wer die Geste
        // überall gelernt hat, drückt auch dort lange, und dann passierte
        // nichts. Zwei Wege zum selben Ziel verwirren niemanden; ein Weg,
        // der an einer Stelle fehlt, schon.
        !editing && HISTORY_KINDS.has(entity.kind)
          ? () => setHistoryFor(entity.id)
          : undefined
      }
      chart={
        expanded === entity.id && cardWidth ? (
          <HistoryChart entity={entity} width={cardWidth - 32} />
        ) : undefined
      }
    />
  );

  /**
   * Kacheln einer Liste ziehbar machen.
   *
   * `scope` sagt, unter welchem Namen die neue Reihenfolge gespeichert
   * wird, `items` welche Kacheln miteinander tauschen. Beides gehört
   * zusammen: Innerhalb eines Zimmers soll sich die Reihenfolge dieses
   * Zimmers ändern, nicht die aller Geräte.
   */
  // imRaumblock reicht bis zur Kachel durch: Sie steht dann schon unter
  // der Überschrift ihres Zimmers und muss den Raumnamen nicht wiederholen.
  const zellen = (scope: string | null, items: Entity[], imRaumblock = false) => {
    const ids = items.map((entity) => entity.id);
    const onEnd = (id: string, dx: number, dy: number) => {
      setDrag(null);
      if (!scope) return;
      const next = reorderByDrop(ids, cellLayouts, id, dx, dy);
      if (!next) return;
      // Die Favoritengruppe ist persönlich – ihr Ziehen gehört zum
      // Benutzer, alles andere weiter zum Haus.
      if (scope === 'favorites') setFavoriteOrder(next);
      else setOrder(scope, next);
    };
    return (entity: Entity) =>
      dragEnabled && scope && cardWidth ? (
        <DragCell
          key={entity.id}
          id={entity.id}
          width={cardWidth}
          dragging={drag?.id === entity.id}
          dx={drag?.id === entity.id ? drag.dx : 0}
          dy={drag?.id === entity.id ? drag.dy : 0}
          onStart={startDrag}
          onMove={moveDrag}
          onEnd={onEnd}
          onLayout={(cellId, layout) => cellLayouts.set(cellId, layout)}
        >
          {renderCard(entity, imRaumblock)}
        </DragCell>
      ) : (
        renderCard(entity, imRaumblock)
      );
  };
  // Auch hier `imRaumblock`, sobald ein Zimmer offen ist: Über diesen
  // Weg läuft das Zimmer im Anpassen-Modus und bei eigener Reihenfolge -
  // dort stand der Raumname sonst weiter unter jeder Kachel.
  const renderCell = zellen(
    orderScope,
    rest,
    section === 'home' && room !== ALL_ROOMS
  );

  const einstellungsPunkte: {
    key: Section | 'search' | 'sorgen' | 'besuch';
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    detail: string;
    show: boolean;
    /** Statt zu einem Bereich zu wechseln: etwas öffnen. */
    onPress?: () => void;
  }[] = [
    {
      key: 'search',
      icon: 'search-outline',
      label: 'Suche',
      detail: 'Geräte, Räume, Szenen und Abläufe auf einmal',
      show: true,
      onPress: () => setSearchOpen(true),
    },
    {
      key: 'users',
      icon: 'people-circle-outline',
      label: 'Benutzerverwaltung',
      detail: 'Zugänge und Rollen: Besitzer, Mitbewohner, Gast',
      show: sieht('users'),
    },
    {
      key: 'personen',
      icon: 'people-outline',
      label: 'Familie und Freunde',
      detail: 'Wer ist wo, und was soll über wen gemeldet werden',
      // Auch für Mitbewohner: Wo die Familie gerade ist, geht alle
      // an, die hier wohnen - anders als die Frage, wer Zugang hat.
      show: true,
    },
    {
      key: 'automations',
      icon: 'git-branch-outline',
      label: 'Abläufe',
      detail: istBesitzer
        ? 'Automationen und Szenen'
        : 'Pausieren, Babysitter-Modus und was heute läuft',
      show: sieht('automations'),
    },
    {
      key: 'alarm',
      icon: 'shield-checkmark-outline',
      label: 'Alarmanlage',
      detail: 'Sensoren, Modi und Verlauf',
      show: sieht('alarm'),
    },
    {
      key: 'devices',
      icon: 'list-outline',
      label: 'Geräte',
      detail: istBesitzer
        ? 'Alle Geräte, auch ausgeblendete'
        : 'Alle Geräte mit Batterie und Verlauf',
      show: sieht('devices'),
    },
    {
      key: 'besuch',
      icon: 'people-outline',
      label: besuchStand?.active ? 'Jemand ist da' : 'Besuch oder Babysitter',
      detail: modusZeile(besuchStand, Date.now()),
      // Auch für Mitbewohner: Wer Gäste empfängt, soll ihnen das
      // WLAN geben können, ohne die Besitzerin zu fragen.
      show: true,
      onPress: () => setBesuchOffen(true),
    },
    {
      key: 'sorgen',
      icon: 'medkit-outline',
      label: 'Nicht in Ordnung',
      // Gezählt wird hier nur, was die Geräteliste allein weiss:
      // wer nicht antwortet und wer verstummt ist. Schwache
      // Batterien und Wartungen stehen im Blatt selbst - ob eine
      // Warnung quittiert ist, weiss nur der Hub, und eine Zahl,
      // die eine andere Liste ankündigt als die, die aufgeht, wäre
      // schlimmer als keine.
      detail: stummeGeraete.length
        ? sorgenSatz(stummeGeraete)
        : 'Batterien, Funkstille und Wartung auf einem Blatt',
      show: sieht('devices'),
      onPress: () => setSorgenOffen(true),
    },
    {
      key: 'speakers',
      icon: 'volume-high-outline',
      label: 'Lautsprecher',
      detail: 'Boxen und Gruppen im Netz',
      show: sieht('speakers'),
    },
    {
      key: 'energy',
      icon: 'flash-outline',
      label: 'Energie',
      detail: 'Verbrauch und Kosten je Gerät',
      show: sieht('energy'),
    },
    {
      key: 'system',
      icon: 'pulse-outline',
      label: 'System',
      detail: 'Integrationen, Sicherung, Konfiguration',
      show: sieht('system'),
    },
    {
      key: 'activity',
      icon: 'timer-outline',
      label: 'Was war los',
      detail: 'Der Rückblick über alle Geräte – Tage zurück',
      show: sieht('activity'),
    },
    {
      key: 'widgets',
      icon: 'apps-outline',
      label: 'Widgets',
      detail: 'Knöpfe auf Homescreen und Sperrbildschirm',
      // Für alle sichtbar, obwohl es die Ansicht des Hauses ändert:
      // Wer ein Widget auf seinem Telefon hat, muss nachsehen können,
      // was darauf liegt - und die Anleitung zum Hinzufügen braucht
      // ohnehin jeder selbst.
      show: true,
    },
    {
      key: 'account',
      icon: 'person-outline',
      label: 'Konto',
      detail: 'Profil, Darstellung, App-Symbol, Benachrichtigungen',
      show: true,
    },
    {
      key: 'connection',
      icon: 'link-outline',
      label: 'Verbindungen',
      detail: 'Hub-Adresse und Token dieses Geräts',
      show: true,
    },
  ];

  // Die Punkte, geteilt nach dem, was sie tun: bedienen oder einrichten
  // (lib/einstellungsmenue.ts). Gerechnet und nicht von Hand danebenge-
  // schrieben - sonst driften Liste und Zuordnung auseinander, sobald
  // jemand einen Punkt hinzufügt.
  const sichtbarePunkte = einstellungsPunkte.filter((item) => item.show);
  const hausPunkte = sichtbarePunkte.filter((item) => gruppeVon(item.key) === 'haus');
  const adminPunkte = sichtbarePunkte.filter((item) => gruppeVon(item.key) === 'admin');

  // Auf dem iPad bleiben die Einstellungen zweispaltig: Menü links,
  // Inhalt rechts. Der Wechsel Vollbild → Vollbild verlor auf grossen
  // Bildschirmen die Orientierung - man sah nie, wo man ist und was es
  // daneben noch gäbe. Die Startseite und die Geräteliste bleiben
  // aussen vor: Sie haben ihre eigene rechte Spalte.
  const einstellungsSeiten: Section[] = [
    'users', 'personen', 'automations', 'alarm', 'speakers',
    'energy', 'system', 'activity', 'widgets', 'account', 'connection',
  ];
  /** Ab hier ist Platz für Menü und Inhalt nebeneinander. */
  const ZWEISPALTIG_AB = 1000;
  const zweispaltig = width >= ZWEISPALTIG_AB && einstellungsSeiten.includes(section);
  if (einstellungsSeiten.includes(section)) zuletztEinstellung.current = section;

  // Welche dieser Seiten dieser Benutzer überhaupt sieht - in der
  // Reihenfolge des Menüs, damit «die erste» dieselbe ist, die auch oben
  // in der Spalte steht.
  const offeneSeiten = sichtbarePunkte
    .map((item) => item.key)
    .filter((key): key is Section => einstellungsSeiten.includes(key as Section));

  /**
   * Zu einem Bereich wechseln - mit einer Ausnahme.
   *
   * «Einstellungen» war auf einem breiten Bildschirm ein
   * Zwischenschritt für nichts: Man tippte darauf, bekam eine Liste von
   * Kacheln, tippte noch einmal, und erst dann stand die Ansicht da, die
   * man gemeint hatte - obwohl das Menü daneben ohnehin die ganze Zeit
   * sichtbar ist. Also geht dort gleich eine Seite auf; die vom letzten
   * Mal, sonst die erste (lib/einstellungsmenue.ts).
   *
   * Auf dem Telefon bleibt die Kachelliste: Dort ist kein Platz für ein
   * Menü daneben, und sie ist zugleich der Weg zurück.
   */
  // Womit die Leiste «Einstellungen» hervorhebt, solange man drin ist.
  // Vorher stand dort nichts hervorgehoben, sobald man eine Seite offen
  // hatte - und auf einem breiten Bildschirm ist man ab dem ersten Tipp
  // immer auf einer Seite. Man sah dann nirgends mehr, wo man ist.
  const railAktiv: Section = sichtbarePunkte.some((item) => item.key === section)
    ? 'settings'
    : section;

  const waehleBereich = (ziel: Section) => {
    if (ziel === 'settings' && width >= ZWEISPALTIG_AB) {
      const start = einstiegsSeite(offeneSeiten, zuletztEinstellung.current);
      if (start) {
        setSection(start);
        return;
      }
    }
    setSection(ziel);
  };

  const content = () => {
    // Der Riegel vor Familie und Konto - siehe lib/bereichsriegel.ts. Er
    // steht vor dem Verteiler, damit kein Bereich ihn vergessen kann.
    // `now` tickt ohnehin; damit läuft die offene Zeit von selbst ab.
    const gesperrt = istGesperrt(section, {
      areaLocked: user?.area_locked,
      panel: settings.panel,
      babysitter,
      offenBis: riegelBis,
      jetzt: now.getTime(),
    });
    // Die Abkürzungen zählen wie ein aufgeschlossener Riegel - solange
    // sie führen, ist der Bereich offen, aber nur für dieses eine Modul.
    if (gesperrt && riegelModul === null) {
      return (
        <BereichRiegel
          settings={settings}
          titel={SECTION_LABEL[section]}
          onOffen={setRiegelBis}
          offen={offeneModule(section, settings.panel, gesperrt)}
          onOeffneModul={setRiegelModul}
        />
      );
    }
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
              onCommand={guardedCommand}
              onActivateScene={activateScene}
              countdowns={startCountdowns}
              snapshotUri={snapshotUrl}
              favoriteIds={favorites}
              // Persönliche Reihenfolge; die alte haushaltsweite bleibt
              // als Startbestand, bis einmal selbst gezogen wurde –
              // sonst spränge beim Umstieg alles durcheinander.
              favoriteOrder={eigenePrefs.favoriteOrder ?? prefs.order?.favorites}
              onReorderFavorites={setFavoriteOrder}
              onDurchsage={darfSchalten ? sendeDurchsage : undefined}
              durchsage={eigenePrefs.durchsage}
              onDurchsagePrefs={setDurchsage}
              onSprachnotiz={darfSchalten ? sendeSprachnotiz : undefined}
              onRenameEntity={
                darfAnpassen
                  ? (entityId, name) => setEntityMeta(entityId, { name })
                  : undefined
              }
              doorConfirm={prefs.doorConfirm}
            />
          </View>
          <SidePanel
            entities={entities}
            width={hasSidePanel ? panelWidth : undefined}
            onCommand={guardedCommand}
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
          hiddenModules={prefs.familyHidden}
          onHiddenModules={setFamilyHidden}
          changedAt={familyChangedAt}
          startModul={riegelModul}
        />
      );
    }

    // Zurück-Zeile für alles, was über „Einstellungen“ erreicht wird.
    // Zweispaltig braucht sie niemand: Das Menü steht daneben.
    const back = zweispaltig ? null : (
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
      // Vorne steht, was man bedient; hinter «Administrator», was das
      // Haus einrichtet (lib/einstellungsmenue.ts). Wer was überhaupt
      // sieht, entscheidet `show` je Punkt - der Hub prüft die Rechte
      // ohnehin noch einmal selbst.
      //
      // Eine Ausnahme: «Abläufe». Ein Mitbewohner darf sie pausieren und
      // den Babysitter-Modus schalten - das ist Bedienung, keine
      // Einrichtung. Anlegen und Ändern bleibt ihm verwehrt, dafür sorgt
      // edit_automations in der Seite selbst (und der Hub noch einmal).
      return (
        <View style={styles.settingsList}>
          {hausPunkte.map((item) => (
            <Pressable
              key={item.key}
              onPress={() =>
                item.onPress ? item.onPress() : setSection(item.key as Section)
              }
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

          {/* Die Einrichtung des Hauses hinter einer eigenen Tür. Sie
              stand mitten zwischen den täglichen Wegen und verlängerte
              sie - geöffnet wird sie selten und nie beiläufig. */}
          {adminPunkte.length > 0 ? (
            <Pressable
              onPress={() => setSection('admin')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.settingsItem, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="construct-outline" size={22} color={colors.ink} />
              <View style={{ flex: 1 }}>
                <Text style={styles.settingsLabel}>Administrator</Text>
                <Text style={styles.settingsDetail}>
                  {adminZeile(adminPunkte.length)}
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={18} color={colors.inkFaint} />
            </Pressable>
          ) : null}
        </View>
      );
    }

    if (section === 'admin') {
      return (
        <View style={styles.settingsList}>
          {back}
          {adminPunkte.map((item) => (
            <Pressable
              key={item.key}
              onPress={() =>
                item.onPress ? item.onPress() : setSection(item.key as Section)
              }
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
          <AlarmScreen
            settings={settings}
            entities={entities}
            user={user}
            onEntity={(name) => {
              // Der Name aus der «noch offen»-Warnung führt in die
              // Geräteliste, vorgefiltert – statt tot dazustehen.
              setSection('devices');
              setQuery(name);
            }}
          />
        </View>
      );
    }
    if (section === 'speakers') {
      return (
        <View style={styles.stack}>
          {back}
          <>
            <Musikzentrale settings={settings} entities={entities} />
            {/* Die Durchsage stand hier als breite Karte: ein leeres
                Textfeld und darunter fünfzehn Boxennamen als Chips.
                Drei Ecken von dort entfernt, wo man sie braucht. Sie
                sitzt jetzt als Kachel bei den Favoriten auf der
                Startseite - siehe DurchsageFenster in
                OverviewScreen.tsx. */}
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
          {/* Zuerst der Rückblick über alle Geräte: Er hat ein
              Gedächtnis, das den Neustart übersteht. Die flüchtige
              Liste darunter zeigt, was seit dem Öffnen der App
              geschah - sie ist schneller, aber sie fängt bei jedem
              Start wieder von vorne an. */}
          <HausRueckblick settings={settings} />
          <ActivityCard activity={activity} />
        </View>
      );
    }
    if (section === 'personen') {
      return (
        <View style={styles.stack}>
          {back}
          <PersonenScreen settings={settings} />
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
          <SettingsScreen
            initial={settings}
            onSave={onSaveSettings}
            user={user}
            embedded
            nur="konto"
            onRenamed={benutzerNeuLaden}
          />
          <BioLock enabled={!!prefs.bioLock} onChange={setBioLock} />
          {/* Nur für die Besitzerin: Die Hürde vor der Haustüre gilt fürs
              ganze Haus, ihr Abräumen ist keine Ansichtssache. */}
          {istBesitzer ? (
            <TuerRueckfrage enabled={prefs.doorConfirm} onChange={setDoorConfirm} />
          ) : null}
          {/* Nur für Menschen mit eigenem iPhone - am Wandpanel und für
              Gäste hätte die Karte keinen Ort. */}
          {!user?.shared && user?.role !== 'gast' ? (
            <LiveTuerSchalter
              settings={settings}
              enabled={eigenePrefs.liveTuer !== false}
              onChange={setLiveTuer}
              aus={eigenePrefs.liveAus ?? []}
              onAus={setLiveAus}
            />
          ) : null}
          <PushPrefs settings={settings} />
        </View>
      );
    }
    if (section === 'connection') {
      return (
        <View style={styles.stack}>
          {back}
          <SettingsScreen
            initial={settings}
            onSave={onSaveSettings}
            user={user}
            embedded
            nur="verbindung"
          />
        </View>
      );
    }
    if (section === 'widgets') {
      return (
        <View style={styles.stack}>
          {back}
          <Widgets
            buttons={prefs.widgetButtons}
            onButtons={setWidgetButtons}
            direct={
              prefs.widgetDirect ?? standardDirekt(prefs.widgetButtons ?? [], entities)
            }
            onDirect={setWidgetDirect}
            karten={prefs.widgetKarten}
            onKarten={setWidgetKarten}
            dataEnabled={!!prefs.widgetData}
            onDataEnabled={setWidgetData}
            ablage={widgetAblage}
            scenes={scenes}
            entities={entities}
          />
        </View>
      );
    }
    if (section === 'automations') {
      return (
        <View style={styles.stack}>
          {back}
          {/* Was der Hub im Verlauf gesehen hat - als Angebot, nicht als
              Tat. Hier oben, weil man beim Öffnen der Abläufe ohnehin
              über Automatisieren nachdenkt. */}
          <SceneSuggestion settings={settings} onCreated={reloadScenes} />
          <AutomationsScreen
            settings={settings}
            user={user}
            entities={entities}
            scenes={scenes}
            onScenesChanged={reloadScenes}
            onNote={setNote}
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
          {section === 'devices' ? (
            <>
              {/* Die vier Fragen, mit denen man diese Seite öffnet – als
                  Knöpfe statt als Scrollarbeit. Die Zahl sagt gleich, ob
                  sich das Antippen lohnt. */}
              <View style={styles.filterRow}>
                {(
                  [
                    ['offline', 'Nicht erreichbar'],
                    ['batterie', 'Batterie'],
                    ['ohne-raum', 'Ohne Raum'],
                    ['ausgeblendet', 'Ausgeblendet'],
                  ] as const
                ).map(([key, label]) => {
                  const anzahl = shown.filter((entity) =>
                    passtFilter(entity, key, hidden)
                  ).length;
                  const an = deviceFilter === key;
                  if (anzahl === 0 && !an) return null;
                  return (
                    <Pressable
                      key={key}
                      onPress={() => setDeviceFilter(an ? '' : key)}
                      accessibilityRole="switch"
                      accessibilityState={{ checked: an }}
                      style={[styles.filterChip, an && styles.filterChipOn]}
                    >
                      <Text style={[styles.filterChipText, an && styles.filterChipTextOn]}>
                        {label} · {anzahl}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
              {/* Die Sortierung in eigener Zeile. Sie stand bisher in
                  derselben Reihe, nach hinten geschoben von einem
                  `flex: 1`-Abstandhalter - und die Reihe bricht um: Bei
                  vier Filtern lagen «Ausgeblendet · 7» und «eigene
                  Reihenfolge» in der zweiten Zeile an den beiden Enden,
                  mit einer Handbreit Leere dazwischen. Das sah nach
                  Fehler aus. Rechts und für sich ist sie ausserdem
                  ehrlicher: Sie filtert nichts, sie ordnet. */}
              <Pressable
                onPress={() =>
                  setDeviceSort(
                    deviceSort === 'selbst'
                      ? 'raum'
                      : deviceSort === 'raum'
                        ? 'art'
                        : deviceSort === 'art'
                          ? 'gesehen'
                          : 'selbst'
                  )
                }
                accessibilityRole="button"
                accessibilityLabel="Sortierung wechseln"
                style={[styles.filterChip, { alignSelf: 'flex-end' }]}
              >
                <Ionicons name="swap-vertical" size={12} color={colors.ink} />
                <Text style={styles.filterChipText}>
                  {deviceSort === 'selbst'
                    ? 'eigene Reihenfolge'
                    : deviceSort === 'raum'
                      ? 'nach Raum'
                      : deviceSort === 'art'
                        ? 'nach Art'
                        : 'lange nicht gesehen'}
                </Text>
              </Pressable>
              {/* Batterien und Stumme im Detail – vorher unter System,
                  also auf dem Bildschirm für den Hub statt dem für die
                  Geräte. */}
              <DeviceHealth
                entities={entities}
                offen={batterienOffen}
                onOffen={setBatterienOffen}
              />
            </>
          ) : null}
          {searching ? (
            <Text style={styles.searchCount}>
              {rest.length === 0
                ? 'Nichts gefunden.'
                : `${rest.length} ${rest.length === 1 ? 'Gerät' : 'Geräte'} gefunden`}
            </Text>
          ) : null}
          {/* Bei sechs Kameras ist die feste Reihenfolge die richtige,
              solange nichts los ist - man greift nach der Kamera, von
              der man weiss, wo sie steht. Sobald etwas los ist, ist sie
              die falsche. Deshalb umschaltbar, und zwar je Person: Am
              Wandpanel im Flur will man etwas anderes als auf dem
              Telefon. */}
          {section === 'cameras' && rest.length > 1 && !editing ? (
            <Pressable
              onPress={() => setWandOffen(true)}
              accessibilityRole="button"
              accessibilityLabel="Alle Kameras nebeneinander zeigen"
              style={({ pressed }) => [styles.kameraSort, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="grid-outline" size={18} color={colors.onGradientSoft} />
              <View style={{ flex: 1 }}>
                <Text style={styles.reorderText}>Alle nebeneinander</Text>
                <Text style={styles.kameraSortHint}>
                  Standbilder, die sich von selbst auffrischen – antippen zeigt
                  eine gross und live.
                </Text>
              </View>
              <Ionicons name="chevron-forward" size={22} color={colors.inkFaint} />
            </Pressable>
          ) : null}
          {section === 'cameras' && rest.length > 1 && !editing ? (
            <Pressable
              onPress={() => setKameraDynamisch(!eigenePrefs.kameraDynamisch)}
              accessibilityRole="switch"
              accessibilityState={{ checked: !!eigenePrefs.kameraDynamisch }}
              accessibilityLabel={
                eigenePrefs.kameraDynamisch
                  ? 'Kameras wieder in fester Reihenfolge zeigen'
                  : 'Kameras nach Bewegung sortieren'
              }
              style={({ pressed }) => [styles.kameraSort, pressed && { opacity: 0.8 }]}
            >
              <Ionicons
                name={eigenePrefs.kameraDynamisch ? 'walk' : 'list-outline'}
                size={18}
                color={eigenePrefs.kameraDynamisch ? colors.accent : colors.onGradientSoft}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.reorderText}>
                  {eigenePrefs.kameraDynamisch ? 'Bewegung zuerst' : 'Feste Reihenfolge'}
                </Text>
                <Text style={styles.kameraSortHint}>
                  {eigenePrefs.kameraDynamisch
                    ? 'Was gerade meldet, steht oben – danach das eben Gewesene. Gilt nur für dich.'
                    : 'Immer dieselbe Reihenfolge, egal was gerade passiert.'}
                </Text>
              </View>
              <Ionicons
                name={eigenePrefs.kameraDynamisch ? 'toggle' : 'toggle-outline'}
                size={30}
                color={eigenePrefs.kameraDynamisch ? colors.accent : colors.inkFaint}
              />
            </Pressable>
          ) : null}
          {/* Der Schalter für die Tageszeit steht dort, wo sie wirkt -
              auf der Startseite. Aus, bis jemand ihn einschaltet: Eine
              Wohnung, die sich von selbst umsortiert, ohne dass man es
              bestellt hat, ist keine eingerichtete Wohnung, sondern eine,
              in der man morgens sucht. Und je Person, weil es Gewohnheit
              ist: Wer um sechs aufsteht, meint mit «Morgen» etwas
              anderes als wer um neun anfängt. */}
          {section === 'home' && !editing && !searching && lohntSich(shown) ? (
            <Pressable
              onPress={() => setTageszeit(!eigenePrefs.tageszeit)}
              accessibilityRole="switch"
              accessibilityState={{ checked: !!eigenePrefs.tageszeit }}
              accessibilityLabel={
                eigenePrefs.tageszeit
                  ? 'Kacheln wieder in fester Reihenfolge zeigen'
                  : 'Kacheln nach Tageszeit sortieren'
              }
              style={({ pressed }) => [styles.kameraSort, pressed && { opacity: 0.8 }]}
            >
              <Ionicons
                name={eigenePrefs.tageszeit ? 'sunny' : 'list-outline'}
                size={18}
                color={eigenePrefs.tageszeit ? colors.accent : colors.onGradientSoft}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.reorderText}>
                  {abschnitt ? tageszeitHinweis(abschnitt) : 'Feste Reihenfolge'}
                </Text>
                <Text style={styles.kameraSortHint}>
                  {eigenePrefs.tageszeit
                    ? 'Morgens Storen, abends Licht – die Reihenfolge wandert mit dem Tag. Gilt nur für dich.'
                    : 'Immer dieselbe Reihenfolge, egal wie spät es ist.'}
                </Text>
              </View>
              <Ionicons
                name={eigenePrefs.tageszeit ? 'toggle' : 'toggle-outline'}
                size={30}
                color={eigenePrefs.tageszeit ? colors.accent : colors.inkFaint}
              />
            </Pressable>
          ) : null}
          {/* Und der Schalter für die Raum-Reihenfolge - dort, wo die
              Räume stehen. Dieselbe Regel wie bei der Tageszeit: aus,
              bis jemand ihn einschaltet, und je Gerät gezählt - am
              Wandpanel bedient man anderes als auf dem Telefon. */}
          {section === 'home' && room === ALL_ROOMS && !editing && rooms.length > 3 ? (
            <Pressable
              onPress={() => setRaumNutzung(!eigenePrefs.raumNutzung)}
              accessibilityRole="switch"
              accessibilityState={{ checked: !!eigenePrefs.raumNutzung }}
              accessibilityLabel={
                eigenePrefs.raumNutzung
                  ? 'Räume wieder in fester Reihenfolge zeigen'
                  : 'Meistbenutzte Räume zuerst zeigen'
              }
              style={({ pressed }) => [styles.kameraSort, pressed && { opacity: 0.8 }]}
            >
              <Ionicons
                name={eigenePrefs.raumNutzung ? 'trending-up' : 'list-outline'}
                size={18}
                color={eigenePrefs.raumNutzung ? colors.accent : colors.onGradientSoft}
              />
              <View style={{ flex: 1 }}>
                <Text style={styles.reorderText}>
                  {eigenePrefs.raumNutzung
                    ? 'Meistbenutzte Räume zuerst'
                    : 'Feste Raum-Reihenfolge'}
                </Text>
                <Text style={styles.kameraSortHint}>
                  {eigenePrefs.raumNutzung
                    ? 'Was du auf diesem Gerät oft bedienst, steht oben. Ältere Bedienungen verblassen.'
                    : 'Die Reihenfolge aus der Einrichtung – egal, was du oft anfasst.'}
                </Text>
              </View>
              <Ionicons
                name={eigenePrefs.raumNutzung ? 'toggle' : 'toggle-outline'}
                size={30}
                color={eigenePrefs.raumNutzung ? colors.accent : colors.inkFaint}
              />
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
                Am Griff ☰ ziehen, um die Kacheln umzusortieren. Die Reihenfolge gilt für
                diese Ansicht und wird bei deinem Benutzer gespeichert – sie erscheint so
                auf allen deinen Geräten.
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
              {/* Keine Kürzel mehr über der Raumliste: Szenen stehen in
                  ihrem Raum. Die Übersicht soll die Räume zeigen, nicht
                  mit Knöpfen beginnen, die man einmal am Tag braucht –
                  «Alles aus» steht deshalb unten, nach den Räumen, und
                  der Widget-Knopf öffnet seine Rückfrage direkt. */}
              <ClimateOverview settings={settings} entities={entities} />
              {/* Ohne Knopf: Auf der Startseite stand «Alles aus» im
                  Weg - dort will man Licht und Storen, nicht das Haus
                  abschalten. Für einen Raum bleibt er (Räume →
                  Filterzeile), und wer ihn sich aufs Widget gelegt hat,
                  drückt ihn dort: Dessen Rückfrage geht hier auf. */}
              <AllOff
                entities={entities}
                locked={locked}
                onCommand={guardedCommand}
                onRecordUndo={merkeGriff}
                openSignal={allOffSignal}
                ohneKnopf
              />
            </>
          ) : null}
          {section === 'home' && editing && rooms.length > 0 ? (
            <>
              <RoomTabs rooms={rooms} active={room} onSelect={setRoom} />
              <Pressable
                onPress={() => setRoomsReorderOpen(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.reorderButton, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="swap-vertical" size={16} color={colors.onGradient} />
                <Text style={styles.reorderText}>Räume ordnen</Text>
              </Pressable>
              <Modal
                visible={roomsReorderOpen}
                animationType="slide"
                onRequestClose={() => setRoomsReorderOpen(false)}
              >
                <View style={styles.reorderSheet}>
                  <View style={styles.reorderHead}>
                    <Text style={styles.reorderTitle}>Räume ordnen</Text>
                    <Pressable
                      onPress={() => setRoomsReorderOpen(false)}
                      accessibilityLabel="Fertig"
                    >
                      <Ionicons name="checkmark" size={26} color={colors.ink} />
                    </Pressable>
                  </View>
                  <Text style={styles.reorderHint}>
                    Am Griff ☰ ziehen – am besten in der Reihenfolge, in der man durch die
                    Wohnung geht. Gilt für alle im Haus; ohne eigene Reihenfolge zählt die
                    aus der config.yaml.
                  </Text>
                  {/* Wer siebzehn Räume von Hand sortiert hat und einen
                      sucht, will einmal Ordnung nach dem Alphabet - statt
                      siebzehnmal zu ziehen. Danach lässt sich weiter von
                      Hand schieben; es ist ein Anfang, kein Modus. */}
                  <Pressable
                    onPress={() =>
                      setOrder(
                        'raeume',
                        alphabetisch(rooms.filter((name) => name !== ALL_ROOMS))
                      )
                    }
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.alphabetKnopf,
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <Ionicons name="text-outline" size={15} color={colors.ink} />
                    <Text style={styles.alphabetText}>Nach Alphabet</Text>
                  </Pressable>
                  <ScrollView contentContainerStyle={{ paddingBottom: 40 }}>
                    <DraggableList
                      items={rooms
                        .filter((name) => name !== ALL_ROOMS)
                        .map((name) => ({ id: name, name }))}
                      onReorder={(names) => setOrder('raeume', names)}
                    />
                  </ScrollView>
                </View>
              </Modal>
            </>
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
          {/* Der Raumname als Überschrift.
              Im Zimmer stand er nirgends: oben «‹ Räume», darunter
              «Anpassen», dann «Beleuchtung» - und der einzige Hinweis
              auf das Zimmer war das kleingedruckte «Büro» unter jeder
              Kachel, das jetzt zu Recht weg ist. Wer über einen Umweg
              hierherkam, wusste nicht mehr, wo er steht.
              Auch im Anpassen-Modus: Gerade dort darf man sich nicht im
              Zimmer irren. */}
          {section === 'home' && room !== ALL_ROOMS ? (
            <Text style={styles.raumTitel} numberOfLines={1}>
              {room}
            </Text>
          ) : null}
          {/* Kacheln anpassen heisst: verschieben, ausblenden, sperren,
              Gruppen vergeben. Es prägt die Ansicht für alle im Haus -
              aber genau darum steht es auch Mitbewohnern zu: Wer hier
              wohnt, richtet mit ein. Der Hub verlangt für Name, Raum und
              Gruppe dieselbe Fähigkeit (edit_devices); nur Gäste bleiben
              beim Bedienen. */}
          {darfAnpassen &&
          (section === 'home' ||
            section === 'devices' ||
            section === 'light' ||
            section === 'covers') ? (
            <Pressable
              onPress={() => setEditing((value) => !value)}
              accessibilityRole="button"
              accessibilityLabel={editing ? 'Anpassen beenden' : 'Kacheln anpassen'}
              style={styles.editToggle}
            >
              <Text style={styles.editToggleText}>{editing ? 'Fertig' : 'Anpassen'}</Text>
            </Pressable>
          ) : null}

          {/* Hinter «Anpassen» statt davor. Es stand bisher noch vor dem
              Zurück-Link, also ganz oben - über der Zeile, mit der man
              die Seite überhaupt verlässt. Erst wohin man ist, dann was
              man hier tun kann. */}
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

          {section === 'devices' && !editing && !searching && groupNames.length > 0 ? (
            <GroupControls
              entities={entities}
              groups={groupNames}
              onCommand={guardedCommand}
            />
          ) : null}

          {/* Was der Hub selbst gefunden hat, steht danach als Kachel da:
              mit dem Namen aus der Verpackung und ohne Raum. Hier stehen
              genau diese Geräte zusammen, statt dass man sie einzeln in
              der Liste suchen muss. Ist nichts offen, zeigt die Karte
              sich gar nicht erst. */}
          {section === 'devices' && darfAnpassen ? (
            <Einrichtungshilfe
              entities={entities}
              raeume={rooms.filter((name) => name !== ALL_ROOMS)}
              onRaum={(entityId, raum) => setEntityRoom(entityId, raum)}
              onName={(entityId, name) => setEntityMeta(entityId, { name })}
            />
          ) : null}

          {/* Immer sichtbar, solange man unter Geräte steht. Vorher
              verschwand die Karte im Anpassen-Modus und beim Suchen -
              also in genau den beiden Lagen, aus denen heraus man sie
              braucht: Wer eine Kachel anpasst, richtet ein; wer sucht,
              hat das Gerät gerade gefunden, um das es geht. */}
          {section === 'devices' && istBesitzer ? (
            <DeviceTools
              settings={settings}
              headers={{ Authorization: `Bearer ${settings.token}` }}
              entities={shown}
              // Ersetzen braucht den ganzen Bestand: Das neue Gerät heisst
              // fast nie wie das alte, und wer nach «nuki» sucht, findet
              // ein «Smart Lock Pro» nicht - hätte es dann aber auch nicht
              // zur Auswahl.
              alle={entities}
              rooms={roomOrder}
              groups={groupNames}
              onDone={reloadScenes}
            />
          ) : null}

          {/* Leuchten zusammenfassen prägt die Ansicht für alle im Haus
              und ist damit Einrichtung, nicht Bedienung: Die Karte
              bleibt bei der Besitzerin. Ohne diese Bedingung stand sie
              auch vor Mitbewohnern - mit Knöpfen, die der Hub mit
              «keine Berechtigung» abweist. */}
          {section === 'devices' && istBesitzer && !editing && !searching ? (
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
            {!grouped && !categorized && !roomTiles && cardWidth
              ? running.map((entity) => renderCard(entity))
              : null}
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
                    favorites={favorites}
                    width={hasRail ? Math.floor((gridWidth - space.gap) / 2) : gridWidth}
                    onOpen={() => setRoom(tile.name)}
                    onCommand={(entityId, command) => guardedCommand(entityId, command)}
                    scenes={szenenFuerKachel(scenes, entities, tile.name)}
                    onScene={activateScene}
                  />
                ))}
            </View>
          ) : null}

          {/* Der Küchen-Timer gehört in die Küche - dort steht man, wenn
              die Nudeln aufgesetzt sind, und nicht in der Raumübersicht. */}
          {section === 'home' && room !== ALL_ROOMS && istKueche(room) ? (
            <KitchenTimer settings={settings} />
          ) : null}
          {/* Ein Raum: nach Kategorien (Szenen, Beleuchtung, Store, Medien). */}
          {categorized ? (
            <>
              {/* Der Raumkopf: wie warm, was offen, was läuft – die drei
                  Dinge, die man wissen will, bevor man Kacheln liest.
                  Daneben die Handgriffe für den ganzen Raum. */}
              {raumKopf || messwerte.length > 0 ? (
                <View style={styles.raumKopf}>
                  {raumKopf ? <Text style={styles.raumKopfText}>{raumKopf}</Text> : null}
                  {messwerte.length > 0 ? (
                    <View style={styles.filterRow}>
                      {messwerte.map((fuehler) => {
                        const auf = expanded === fuehler.id;
                        return (
                          <Pressable
                            key={fuehler.id}
                            onPress={() =>
                              setExpanded((current) =>
                                current === fuehler.id ? null : fuehler.id
                              )
                            }
                            accessibilityRole="button"
                            accessibilityState={{ expanded: auf }}
                            accessibilityLabel={`${fuehler.name}: ${fuehler.state.state}${fuehler.state.unit ?? ''}`}
                            style={[styles.filterChip, auf && styles.filterChipOn]}
                          >
                            <Text
                              style={[
                                styles.filterChipText,
                                auf && styles.filterChipTextOn,
                              ]}
                            >
                              {fuehler.name} {String(fuehler.state.state ?? '–')}
                              {fuehler.state.unit ?? ''}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>
                  ) : null}
                  {(() => {
                    const auf = messwerte.find((fuehler) => fuehler.id === expanded);
                    return auf && cardWidth ? renderCard(auf) : null;
                  })()}
                </View>
              ) : null}
              <View style={styles.filterRow}>
                <AllOff
                  entities={inRoom}
                  locked={locked}
                  onCommand={guardedCommand}
                  onRecordUndo={merkeGriff}
                  compact
                />
                {inRoom.some(
                  (entity) => entity.kind === 'cover' && entity.commands.includes('open')
                ) ? (
                  <>
                    <Pressable
                      onPress={() =>
                        inRoom
                          .filter((entity) => entity.kind === 'cover')
                          .forEach((entity) => guardedCommand(entity.id, 'open'))
                      }
                      accessibilityRole="button"
                      style={styles.filterChip}
                    >
                      <Ionicons name="arrow-up" size={13} color={colors.ink} />
                      <Text style={styles.filterChipText}>Storen hoch</Text>
                    </Pressable>
                    <Pressable
                      onPress={() =>
                        inRoom
                          .filter((entity) => entity.kind === 'cover')
                          .forEach((entity) => guardedCommand(entity.id, 'close'))
                      }
                      accessibilityRole="button"
                      style={styles.filterChip}
                    >
                      <Ionicons name="arrow-down" size={13} color={colors.ink} />
                      <Text style={styles.filterChipText}>Storen runter</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
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
                    {/* `imRaumblock`: Man steht in einem Zimmer, jede
                        Kachel darin gehört dazu. Ohne das stand unter
                        jedem der sechs Bürolichter noch einmal «Büro» -
                        sechsmal dieselbe Auskunft, und die einzige Stelle
                        im Bild, die den Raum überhaupt nannte. */}
                    {cardWidth
                      ? group.items.map((entity) => renderCard(entity, true))
                      : null}
                  </View>
                </View>
              ))}
            </>
          ) : null}

          {/* Der Hinweis gehört dorthin, wo gezogen werden kann - auch
              über die nach Zimmern gruppierte Ansicht, in der es bisher
              gar nicht ging. */}
          {grouped && dragEnabled && groups.some((group) => group.items.length > 1) ? (
            <Text style={styles.sectionLabel}>
              Kacheln am Griff ✥ an die gewünschte Stelle ziehen – innerhalb ihres Zimmers
            </Text>
          ) : null}

          {/* „Alle“ mit vielen Räumen: nach Zimmer gruppiert. */}
          {grouped
            ? groups.map((group) => (
                <View key={group.key} style={styles.group}>
                  <Text style={styles.groupLabel}>{group.label}</Text>
                  <View style={styles.grid}>
                    {cardWidth
                      ? group.items.map(
                          zellen(
                            groupScope(group.key, gruppenBereich),
                            group.items,
                            group.key !== FAVORITEN
                          )
                        )
                      : null}
                  </View>
                </View>
              ))
            : null}

          {!grouped &&
          !categorized &&
          !roomTiles &&
          running.length > 0 &&
          rest.length > 0 ? (
            <Text style={styles.sectionLabel}>Ruhend</Text>
          ) : null}
          {!grouped && !categorized && !roomTiles && dragEnabled && rest.length > 1 ? (
            <Text style={styles.sectionLabel}>
              Kacheln am Griff ✥ an die gewünschte Stelle ziehen
            </Text>
          ) : null}
          {/* Warum die Griffe fehlen, statt sie wortlos wegzulassen: In
              einer gefilterten Liste zu ordnen ergäbe eine Reihenfolge,
              die nur zu dieser Suche passt. */}
          {editing && searching ? (
            <Text style={styles.sectionLabel}>
              Zum Ordnen die Suche leeren – in einer gefilterten Liste zu ziehen ergäbe eine
              Reihenfolge, die nur dazu passt.
            </Text>
          ) : null}
          {!grouped && !categorized && !roomTiles ? (
            <View style={styles.grid}>{cardWidth ? rest.map(renderCell) : null}</View>
          ) : null}

          {inRoom.length === 0 ? (
            <Leerzustand
              bild={leerbild(
                section,
                section === 'home' && room !== ALL_ROOMS && room !== NO_ROOM
                  ? room
                  : null,
                status === 'connected'
              )}
              onAktion={() => setSection('devices')}
            />
          ) : null}
        </View>

        <SidePanel
          entities={entities}
          width={hasSidePanel ? panelWidth : undefined}
          room={offenerRaum}
          onCommand={guardedCommand}
        />
      </View>
    );
  };

  return (
    <HubProvider settings={settings} entities={entities} user={user}>
      <View style={styles.root} onTouchStart={() => setLastTouch(Date.now())}>
        <View style={[styles.frame, { paddingTop: insets.top }]}>
          {hasRail ? (
            <Rail
              active={railAktiv}
              onSelect={waehleBereich}
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
                  {cachedAt ? ` von ${uhr(cachedAt)}` : ''}.
                </Text>
              </View>
            ) : null}
            <Auffangnetz bereich="Die Kopfzeile">
              <TopStrip
                entities={entities}
                status={status}
                now={now}
                hidden={hidden}
                ungezaehlt={ungezaehlt}
                locked={locked}
                onCommand={guardedCommand}
                {...(hiddenSections.includes('family')
                  ? {}
                  : {
                      shopping: einkauf,
                      shops: laeden,
                      onShoppingDone: hakeAb,
                      onShoppingRemove: entferneEinkauf,
                      onShoppingCount: setzeMenge,
                      knownItems: bekannt,
                      onShoppingAdd: kaufeEin,
                    })}
                showClock={!!settings.panel}
                queued={queued}
                // Erst beim Antippen holen: Ein Dauerabruf für ein Fenster,
                // das selten jemand öffnet, wäre Verschwendung.
                onLoadPresence={async () => {
                  const antwort = await hub.get<{ people?: Person[] } | null>(
                    '/api/presence',
                    {
                      still: true,
                    }
                  );
                  return antwort?.people ?? [];
                }}
              />
            </Auffangnetz>

            <View style={styles.greetingRow}>
              <View style={styles.greeting}>
                {/* Eine Zeile, nicht zwei: «Hallo Stefan,» mit «Guten
                    Abend.» darunter begrüsste zweimal - so spricht
                    niemand. Beides steht jetzt in einem Satz
                    (lib/begruessung.ts). */}
                <Text
                  style={[
                    styles.greetingLine,
                    !hasRail && { fontSize: type.greetingSmall },
                  ]}
                >
                  {begruessung(settings, user, now)}
                </Text>
              </View>
              <View style={styles.greetingNotes}>
                {/* Die Suche sitzt in den Einstellungen. Auf der Startseite
                  stand sie neben Begrüssung und Hausstand - und nahm dort
                  Platz weg für etwas, das man selten braucht: Wer ein
                  Gerät sucht, geht ohnehin in die Geräteliste. */}
                <RunningAppliances entities={entities} />
                <OpenDoors entities={entities} />
              </View>
            </View>

            {/* Je Bereich ein eigenes Netz: Reisst die Kameraansicht, sollen
              Licht und Storen bedienbar bleiben. Ein Haus, das zu drei
              Vierteln geht, ist mehr wert als eines, das gar nicht mehr
              reagiert. Der Schlüssel wechselt mit dem Bereich, damit ein
              gefangener Fehler beim Weiterblättern nicht kleben bleibt. */}
            <Auffangnetz key={section} bereich={SECTION_LABEL[section] ?? 'Dieser Bereich'}>
              {zweispaltig ? (
                <View style={styles.settingsSplit}>
                  <View style={styles.settingsRail}>
                    {/* Auf dem iPad steht alles untereinander, Haus und
                        Einrichtung durch eine Überschrift getrennt. Hier
                        einen Zwischenschritt einzubauen wäre ein Tipp
                        für nichts: Die Spalte ist breit genug für beides,
                        und der Sinn der Trennung war, die täglichen Wege
                        auf dem Telefon kurz zu halten. */}
                    {[...hausPunkte, ...adminPunkte].map((item, index) => {
                      const aktiv = item.key === section;
                      // Die Überschrift steht vor dem ersten Punkt der
                      // Einrichtung - dort, wo das Haus aufhört.
                      const trennt =
                        adminPunkte.length > 0 && index === hausPunkte.length;
                      return (
                        <React.Fragment key={item.key}>
                          {trennt ? (
                            <Text style={styles.settingsRailGruppe}>Administrator</Text>
                          ) : null}
                          <Pressable
                            onPress={() =>
                              item.onPress
                                ? item.onPress()
                                : setSection(item.key as Section)
                            }
                            accessibilityRole="tab"
                            accessibilityState={{ selected: aktiv }}
                            style={({ pressed }) => [
                              styles.settingsRailItem,
                              aktiv && styles.settingsRailActive,
                              pressed && { opacity: 0.8 },
                            ]}
                          >
                            <Ionicons
                              name={item.icon}
                              size={18}
                              color={aktiv ? colors.ink : colors.inkSoft}
                            />
                            <Text
                              style={[
                                styles.settingsRailText,
                                aktiv && { color: colors.ink, fontWeight: '700' },
                              ]}
                              numberOfLines={1}
                            >
                              {item.label}
                            </Text>
                          </Pressable>
                        </React.Fragment>
                      );
                    })}
                  </View>
                  <View style={{ flex: 1, minWidth: 0 }}>{content()}</View>
                </View>
              ) : (
                content()
              )}
            </Auffangnetz>
          </ScrollView>
        </View>

        {!hasRail ? (
          <Rail
            active={railAktiv}
            onSelect={waehleBereich}
            vertical={false}
            bottomInset={insets.bottom}
            capabilities={user?.capabilities ?? []}
            hidden={hiddenSections}
          />
        ) : null}

        {faelligeErinnerungen.length > 0 ? (
          <ErinnerungOverlay
            erinnerungen={faelligeErinnerungen}
            onBestaetigen={bestaetigeErinnerung}
            onQuittieren={quittiereErinnerung}
            styles={styles}
          />
        ) : null}

        {klingelt && ringKey && dismissedRing !== ringKey ? (
          <DoorbellOverlay
            ausloeser={klingelt}
            camera={klingelKamera}
            aktionen={klingelWege}
            settings={settings}
            onCommand={(entityId, command) => guardedCommand(entityId, command)}
            doorConfirm={prefs.doorConfirm}
            onDismiss={() => setDismissedRing(ringKey)}
            colors={colors}
            styles={styles}
          />
        ) : null}

        {wandOffen ? (
          <Kamerawand
            kameras={rest}
            bildUrl={snapshotUrl}
            onOeffnen={(kamera) => {
              setWandOffen(false);
              setFullscreen(kamera.id);
            }}
            onClose={() => setWandOffen(false)}
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

        {pinAsk ? (
          <AlarmPinAsk
            entity={pinAsk.entity}
            onCancel={() => setPinAsk(null)}
            onConfirm={(pin) => {
              sendCommand(pinAsk.entity.id, pinAsk.command, { ...pinAsk.data, pin });
              setPinAsk(null);
            }}
            colors={colors}
            styles={styles}
          />
        ) : null}

        {/* Einmal nach jedem Update: was sich geändert hat. Hier oben und
          nicht in der Raumübersicht, damit es beim Öffnen der App kommt -
          egal, auf welcher Seite man zuletzt war. */}
        <WhatsNew
          settings={settings}
          seen={eigenePrefs.seenChanges}
          onSeen={setSeenChanges}
        />

        <GlobalSearch
          visible={searchOpen}
          entities={entities}
          scenes={scenes}
          automations={automations}
          rooms={roomOrder}
          onClose={() => setSearchOpen(false)}
          // Schalten aus der Suche geht denselben Weg wie jeder
          // Tastendruck - durch die Sperre, mit Face ID und PIN, wo sie
          // verlangt sind.
          onCommand={darfSchalten ? guardedCommand : undefined}
          onPick={(hit) => {
            setSearchOpen(false);
            if (hit.kind === 'room') {
              setSection('home');
              setRoom(hit.id);
            } else if (hit.kind === 'scene') {
              activateScene(hit.id);
            } else if (hit.kind === 'automation') {
              // Für alle anderen bleibt der Treffer folgenlos - die Abläufe
              // sind kein Bereich, den die Suche aufsperren soll.
              if (istBesitzer) setSection('automations');
            } else {
              // Gerät: in die Geräteliste und dort danach filtern – so sieht
              // man es samt Bedienelementen, statt nur den Raum zu wechseln.
              setSection('devices');
              setQuery(hit.label);
            }
          }}
        />

        {/* Ein abgelehnter Befehl hat Vorrang: Er ist die Antwort auf etwas,
          das man gerade angetippt hat. Ein fehlgeschlagener Abruf kommt,
          wenn sonst nichts ansteht. */}
        <Toast
          message={error ?? abrufFehler}
          onDismiss={error ? dismissError : () => setAbrufFehler(null)}
          bottomInset={insets.bottom}
        />
        <BesuchBlatt
          settings={settings}
          entities={entities}
          offen={besuchOffen}
          onClose={() => {
            setBesuchOffen(false);
            // Den Stand nachziehen: Die Zeile im Menü soll sagen, was
            // im Blatt gerade entschieden wurde.
            hub
              .get<{ babysitter?: BabysitterStand } | null>('/api/automations/babysitter', {
                fallback: null,
                still: true,
              })
              .then((data) => setBesuchStand(data?.babysitter ?? null));
          }}
        />

        <SorgenBlatt
          settings={settings}
          entities={entities}
          offen={sorgenOffen}
          onClose={() => setSorgenOffen(false)}
        />

        {/* Welches der drei möglichen «Zurück» gemeint ist, entscheidet
          lib/rueckgriff.ts – dort steht auch, warum in dieser Reihenfolge. */}
        <UndoToast
          what={rueckAngebot.what}
          onUndo={
            rueckAngebot.quelle === 'einkauf'
              ? nimmAbhakenZurueck
              : rueckAngebot.quelle === 'griff'
                ? nimmGriffZurueck
                : undoLast
          }
          onDismiss={
            rueckAngebot.quelle === 'einkauf'
              ? () => setEinkaufUndo(null)
              : rueckAngebot.quelle === 'griff'
                ? () => setGriffUndo(null)
                : dismissUndo
          }
          bottomInset={insets.bottom}
        />
        {/* Gelungenes tritt hinter beides zurück: Wer gerade einen Fehler
          liest, braucht nicht noch ein Häkchen daneben. */}
        <Bestaetigung
          text={error || abrufFehler || rueckAngebot.what ? null : note}
          onDismiss={() => setNote(null)}
          bottomInset={insets.bottom}
        />

        {/* Nachtabsenkung fürs Wandpanel. Der Schleier lässt Berührungen
          durch: Ein Panel, bei dem der erste Tipp nur das Aufwecken ist,
          ärgert genau die Person, die schnell das Licht ausmachen wollte.
          Warum es dunkler und nicht dunkel wird, steht in
          lib/nachtabsenkung.ts. */}
        {nachtSchleier > 0 ? (
          <View
            pointerEvents="none"
            accessibilityElementsHidden
            importantForAccessibility="no-hide-descendants"
            style={[
              StyleSheet.absoluteFillObject,
              { backgroundColor: `rgba(0,0,0,${nachtSchleier.toFixed(2)})` },
            ]}
          />
        ) : null}
      </View>
    </HubProvider>
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
            Wirklich {was}? Die Sperre lässt sich im Anpassen-Modus wieder aufheben.
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

/** PIN-Feld vor dem Entschärfen - siehe lib/alarmpin.ts, warum es das
 *  neben dem Feld im Alarm-Bildschirm noch einmal gibt. */
function AlarmPinAsk({
  entity,
  onCancel,
  onConfirm,
  colors,
  styles,
}: {
  entity: Entity;
  onCancel: () => void;
  onConfirm: (pin: string) => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  const [pin, setPin] = useState('');
  const gesetzt = !!entity.state.pin_required;
  return (
    <Modal visible transparent animationType="fade" onRequestClose={onCancel}>
      <View style={styles.lockBackdrop}>
        <View style={styles.lockSheet}>
          <Ionicons name="keypad-outline" size={26} color={colors.accent} />
          <Text style={styles.lockTitle}>Anlage entschärfen</Text>
          <Text style={styles.lockText}>
            {gesetzt
              ? 'Zum Ausschalten die PIN eingeben.'
              : 'An diesem Gerät geht das nur mit PIN – es ist aber keine gesetzt. Wer die Alarmanlage verwaltet, kann sie dort setzen.'}
          </Text>
          {gesetzt ? (
            <TextInput
              style={styles.pinField}
              value={pin}
              onChangeText={(text) => setPin(text.replace(/[^0-9]/g, ''))}
              onSubmitEditing={() => pin.length >= 4 && onConfirm(pin)}
              placeholder="PIN"
              placeholderTextColor={colors.inkFaint}
              keyboardType="number-pad"
              secureTextEntry
              maxLength={8}
              autoFocus
              accessibilityLabel="PIN zum Entschärfen"
            />
          ) : null}
          <View style={styles.lockActions}>
            <Pressable onPress={onCancel} style={styles.lockCancel}>
              <Text style={styles.lockCancelText}>Abbrechen</Text>
            </Pressable>
            {gesetzt ? (
              <Pressable
                onPress={() => onConfirm(pin)}
                disabled={pin.length < 4}
                style={[styles.lockConfirm, pin.length < 4 && { opacity: 0.6 }]}
              >
                <Text style={styles.lockConfirmText}>Entschärfen</Text>
              </Pressable>
            ) : null}
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
    // Wachhalten ist eine Zugabe - wo es fehlt (Web), sperrt der
    // Bildschirm wie immer.
    activateKeepAwakeAsync(PANEL_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(PANEL_TAG).catch(() => {});
    };
  }, [active]);
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
  useTakt(() => setTick((value) => value + 1), 3000);
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
              label={`Live-Bild ${camera.name}`}
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
          <Text style={[styles.doorbellCloseText, live ? { color: colors.danger } : null]}>
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

/**
 * Die fällige Erinnerung, gross und unübersehbar.
 *
 * Kein Kreuz und kein Wegwischen: Sie verschwindet nur über
 * «Erledigt» - das ist ihr ganzer Sinn. Wer sie nur wegdrücken könnte,
 * hätte einen hübschen Wecker ohne Gedächtnis. Bestätigt wird beim Hub,
 * und damit auf allen Bildschirmen zugleich.
 */
function ErinnerungOverlay({
  erinnerungen,
  onBestaetigen,
  onQuittieren,
  styles,
}: {
  erinnerungen: Erinnerung[];
  /** «Für alle erledigt» - räumt die Erinnerung überall ab. */
  onBestaetigen: (id: string) => void;
  /** «Erledigt» - nur bei mir weg, die anderen sehen sie weiter. */
  onQuittieren: (id: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <Modal visible animationType="fade" onRequestClose={() => {}}>
      <View style={styles.doorbellRoot}>
        {/* Bei mehreren steht die Zahl oben: Wer von der zweiten
            Push-Nachricht kommt, soll sehen, dass hier zwei Karten
            warten - jede mit eigenen Knöpfen, jede einzeln
            bestätigbar. */}
        <Text style={styles.doorbellTitle}>{vollbildTitel(erinnerungen.length)}</Text>
        <ScrollView contentContainerStyle={styles.erinnerungListe}>
          {erinnerungen.map((erinnerung) => (
            <View key={erinnerung.id} style={styles.erinnerungKarte}>
              <Text style={styles.erinnerungText}>
                {String(erinnerung.text ?? '')}
              </Text>
              <Text style={styles.erinnerungZeit}>
                {datumUhr(Number(erinnerung.at))}
              </Text>
              <View style={styles.erinnerungKnoepfe}>
                <Pressable
                  onPress={() => onQuittieren(erinnerung.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Erinnerung «${String(erinnerung.text ?? '')}» nur bei mir erledigt`}
                  style={({ pressed }) => [
                    styles.erinnerungKnopfLeise,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={styles.erinnerungKnopfLeiseText}>Erledigt</Text>
                </Pressable>
                <Pressable
                  onPress={() => onBestaetigen(erinnerung.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Erinnerung «${String(erinnerung.text ?? '')}» für alle erledigt`}
                  style={({ pressed }) => [
                    styles.erinnerungKnopf,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Ionicons name="checkmark" size={22} color="#FFFFFF" />
                  <Text style={styles.erinnerungKnopfText}>Für alle erledigt</Text>
                </Pressable>
              </View>
              <Text style={styles.erinnerungHinweis}>
                «Erledigt» blendet sie nur hier aus - bei den anderen bleibt sie
                stehen.
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}

function DoorbellOverlay({
  ausloeser,
  camera,
  aktionen,
  settings,
  onCommand,
  doorConfirm,
  onDismiss,
  colors,
  styles,
}: {
  /** Was geklingelt hat – Türklingel, Kamera oder Gegensprechanlage. */
  ausloeser: Entity;
  /** Das Bild dazu, sofern es eines gibt. Eine Anlage hat keines. */
  camera?: Entity;
  aktionen: KlingelAktion[];
  settings: HubSettings;
  onCommand: (entityId: string, command: string) => void;
  /** Fragt die Türe vor dem Öffnen nach? Auch hier, wo man ohnehin
   *  hinschaut: Wer die Rückfrage abgestellt hat, meint sie überall. */
  doorConfirm?: boolean;
  onDismiss: () => void;
  colors: Colors;
  styles: ReturnType<typeof makeStyles>;
}) {
  // Welche Türe gerade auf die Rückfrage wartet - eine zur Zeit.
  const [confirm, setConfirm] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [liveFailed, setLiveFailed] = useState<string | null>(null);
  // Alle 3 Sekunden ein frisches Bild, solange das Vollbild offen ist.
  useTakt(() => setTick((value) => value + 1), 3000);

  // Rücklauf: Am Wandpanel bliebe sonst ein Bild der Strasse stehen, bis
  // es jemand bemerkt. Jede Berührung setzt ihn zurück - während man
  // hinschaut und überlegt, soll nichts zuklappen.
  const [frist, setFrist] = useState(() => neueFrist(Date.now()));
  const [rest, setRest] = useState(AUTO_SCHLIESSEN_SEKUNDEN);
  const verlaengern = () => {
    const neu = neueFrist(Date.now());
    setFrist(neu);
    setRest(restSekunden(neu, Date.now()));
  };
  useTakt(() => setRest(restSekunden(frist, Date.now())), 1000);
  useEffect(() => {
    if (rest <= 0) onDismiss();
  }, [rest, onDismiss]);
  // Ein neues Klingeln ist ein neuer Anlass, auch wenn das Bild noch steht.
  useEffect(() => {
    const neu = neueFrist(Date.now());
    setFrist(neu);
    setRest(restSekunden(neu, Date.now()));
    setConfirm(null);
  }, [ausloeser.state.last_ring]);
  // Die Rückfrage verfällt von selbst. Sonst stünde «Wirklich öffnen?»
  // eine Minute lang da, und der nächste beiläufige Tipp macht auf.
  useEffect(() => {
    if (!confirm) return undefined;
    const timer = setTimeout(() => setConfirm(null), 8000);
    return () => clearTimeout(timer);
  }, [confirm]);
  const base =
    camera && settings.url && settings.token
      ? `${settings.url.replace(/\/+$/, '')}/api/entities/${encodeURIComponent(camera.id)}`
      : null;
  const token = encodeURIComponent(settings.token ?? '');
  const uri = base ? `${base}/snapshot?token=${token}&t=${tick}` : null;
  // Wer klingelt, will man in Bewegung sehen – wenn die Kamera es hergibt.
  const live = base && camera?.state.stream === true && !liveFailed;

  return (
    <Modal visible animationType="fade" onRequestClose={onDismiss}>
      <Pressable
        style={styles.doorbellRoot}
        onPress={verlaengern}
        accessibilityLabel="Offen halten"
      >
        {/* Welche Klingel es war, gehört dazu: Bei zwei Türen ist «Es
            klingelt» die halbe Auskunft, und man drückt den falschen
            Knopf. */}
        <Text style={styles.doorbellTitle}>🔔 Es klingelt · {ausloeser.name}</Text>
        {live ? (
          <View style={styles.videoBox}>
            <CameraLive
              uri={`${base}/stream.m3u8?token=${token}`}
              label="Live-Bild der Türklingel"
              style={styles.videoFrame}
              onFailed={(message) => setLiveFailed(message)}
            />
          </View>
        ) : uri ? (
          <Image source={{ uri }} style={styles.doorbellImage} resizeMode="cover" />
        ) : (
          // Kein Bild, also auch kein halber Bildschirm dafür: Eine
          // Gegensprechanlage hat keine Kamera, und die schwarze Fläche
          // schob die Knöpfe nach unten, um die es hier eigentlich geht.
          <View style={styles.doorbellOhneBild}>
            <Ionicons name="videocam-off-outline" size={26} color="#8A94A6" />
            <Text style={styles.doorbellCloseText}>Kein Kamerabild an dieser Türe</Text>
          </View>
        )}
        <View style={styles.doorbellButtons}>
          {/* Sprechen läuft über die Ring-App: Die Gegensprech-Verbindung
              ist WebRTC gegen Rings Server, und die gibt der Hersteller
              nicht heraus. Ein Tipp führt dorthin, statt einen Knopf zu
              zeigen, der nichts kann. */}
          <Pressable
            onPress={() => {
              // Erst die App, dann der Browser - klappt beides nicht,
              // gibt es schlicht kein Ring-Konto auf diesem Gerät.
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
          {/* Beide Türen nebeneinander: Wer im Treppenhaus wartet, soll
              nicht darauf warten, dass jemand die App durchsucht. Die
              Rückfrage bleibt je Türe - ein Fehlgriff öffnet sonst die
              falsche. */}
          {aktionen.map((aktion) => {
            const gefragt = confirm === aktion.id;
            // «Wirklich?» statt «Wirklich öffnen?»: Der Knopf sagt
            // darüber schon, worum es geht, und aufschliessen ist nicht
            // öffnen - die Rückfrage darf das nicht durcheinanderbringen.
            const rueckfrage = `Wirklich? ${aktion.label}`;
            return (
              <Pressable
                key={aktion.id}
                onPress={() => {
                  verlaengern();
                  if (gefragt || mayOpenDirectly(aktion.befehl, doorConfirm)) {
                    onCommand(aktion.entity.id, aktion.befehl);
                    onDismiss();
                  } else {
                    setConfirm(aktion.id);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={gefragt ? rueckfrage : aktion.label}
                style={[styles.doorbellOpen, gefragt && { backgroundColor: colors.danger }]}
              >
                <Ionicons
                  name={aktion.oeffnet ? 'log-in-outline' : 'key'}
                  size={22}
                  color="#FFFFFF"
                />
                <Text style={styles.doorbellOpenText}>
                  {gefragt ? rueckfrage : aktion.label}
                </Text>
              </Pressable>
            );
          })}
          <Pressable onPress={onDismiss} style={styles.doorbellClose}>
            <Text style={styles.doorbellCloseText}>
              Schliessen{rest > 0 ? ` (${rest})` : ''}
            </Text>
          </Pressable>
        </View>
      </Pressable>
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
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
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
  onCommand: (entityId: string, command: string, data?: CommandData) => void;
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

  const fan = (list: Entity[], command: string, data?: CommandData) =>
    list.forEach((entity) => onCommand(entity.id, command, data));

  return (
    <Card style={styles.groupCard}>
      <View style={styles.groupHead}>
        <Ionicons name="layers-outline" size={18} color={colors.inkSoft} />
        <Text style={styles.groupName}>{name}</Text>
        <Text style={styles.groupCount}>
          {members.length} {members.length === 1 ? 'Gerät' : 'Geräte'}
        </Text>
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
      backgroundColor: colors.panel,
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
    pinField: {
      alignSelf: 'stretch',
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      fontSize: 18,
      letterSpacing: 4,
      paddingHorizontal: 14,
      paddingVertical: 10,
      textAlign: 'center',
    },
    lockConfirm: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    lockConfirmText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
    frame: { flex: 1, flexDirection: 'row' },
    scroll: { flex: 1, minWidth: 0 },
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
    split: {
      flexDirection: 'row',
      gap: space.gap * 1.4,
      alignItems: 'flex-start',
    },
    stack: { gap: space.gap * 1.4 },
    // minWidth: 0 ist hier kein Zierrat. Ohne das kann eine Flex-Spalte
    // nicht unter die Breite ihres Inhalts schrumpfen: Ein zu breites Kind
    // macht die Spalte breiter, und die Nachbarspalte wandert aus dem Bild.
    // Genau so sieht der abgeschnittene rechte Rand auf dem iPad aus. Im
    // Browser bei 1180 Punkten liess er sich nicht nachstellen - die Zeile
    // kostet nichts und nimmt die wahrscheinlichste Ursache weg.
    main: { flex: 1, minWidth: 0 },
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
    doorbellTitle: {
      color: '#FFFFFF',
      fontSize: 28,
      fontWeight: '700',
      textAlign: 'center',
    },
    // Das Erinnerungs-Vollbild teilt den Grund mit der Klingel - beides
    // sind die zwei Momente, in denen die App von sich aus laut wird.
    erinnerungListe: { gap: 16, paddingVertical: 12, justifyContent: 'center', flexGrow: 1 },
    erinnerungKarte: {
      backgroundColor: '#1B2230',
      borderRadius: radius.card,
      padding: 26,
      gap: 10,
      alignItems: 'center',
    },
    erinnerungText: {
      color: '#FFFFFF',
      fontSize: 34,
      fontWeight: '700',
      textAlign: 'center',
      lineHeight: 42,
    },
    erinnerungZeit: { color: '#8A94A6', fontSize: 17 },
    erinnerungKnoepfe: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 12,
      marginTop: 8,
    },
    erinnerungKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      backgroundColor: colors.on,
      borderRadius: radius.control,
      paddingVertical: 14,
      paddingHorizontal: 34,
    },
    erinnerungKnopfText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
    // Der leise Bruder von erinnerungKnopf: nur Rahmen statt Fläche -
    // «für alle» soll der Knopf sein, zu dem die Hand zuerst will.
    erinnerungKnopfLeise: {
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: '#3A4358',
      borderRadius: radius.control,
      paddingVertical: 14,
      paddingHorizontal: 34,
    },
    erinnerungKnopfLeiseText: { color: '#C6CDDB', fontSize: 18, fontWeight: '600' },
    erinnerungHinweis: { color: '#8A94A6', fontSize: 13, textAlign: 'center' },
    doorbellImage: {
      flex: 1,
      borderRadius: radius.card,
      backgroundColor: '#1C2430',
      width: '100%',
    },
    doorbellOhneBild: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 10,
      paddingVertical: 26,
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
    filterRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, alignItems: 'center' },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    filterChipOn: { backgroundColor: colors.surfaceStrong },
    // Dunkle Tinte auch im ausgeschalteten Zustand. Der Chip hat in
    // beiden Themen einen hellen, durchscheinenden Grund; `onGradientSoft`
    // darauf misst sich zu 1.86:1 - «Ohne Raum · 91» stand als heller
    // Schatten da, während der eingeschaltete Chip daneben scharf war.
    // Mit `ink` sind es 6.4:1 hell und 9.9:1 dunkel. Ein und aus
    // unterscheidet weiterhin der Grund, und der tut es deutlich
    // genug: durchscheinend gegen fast deckend.
    filterChipText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
    filterChipTextOn: { color: colors.ink, fontWeight: '700' },
    /** Der Raumname über den Kacheln – so gross wie eine Seitenüberschrift,
     *  denn genau das ist er. */
    raumTitel: {
      color: colors.onGradient,
      fontSize: 24,
      fontWeight: '700',
      marginTop: 2,
    },
    raumKopf: { gap: 8 },
    raumKopfText: { color: colors.onGradient, fontSize: 15, fontWeight: '600' },
    reorderButton: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingVertical: 6,
    },
    reorderText: { color: colors.onGradient, fontSize: 13, fontWeight: '600' },
    // Der Kamera-Schalter: Symbol, zwei Zeilen Text, Schieber - breit
    // genug, dass die Erklärung darunter passt.
    kameraSort: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
    },
    kameraSortHint: { color: colors.onGradientSoft, fontSize: 12, lineHeight: 17 },
    reorderSheet: { flex: 1, backgroundColor: colors.panel, padding: 20, paddingTop: 60 },
    alphabetKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      marginBottom: 12,
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    alphabetText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    reorderHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 8,
    },
    reorderTitle: { color: colors.ink, fontSize: 22, fontWeight: '700' },
    reorderHint: { color: colors.inkFaint, fontSize: 13, lineHeight: 18, marginBottom: 14 },
    // Ohne die beiden Überschreibungen bleibt die Karte auf der
    // Mindesthöhe einer Gerätekachel stehen und schiebt ihre Knöpfe mit
    // `space-between` an den unteren Rand - bei einer Gruppe mit einem
    // Namen und zwei Knöpfen war die halbe Karte leer.
    groupCard: { gap: 12, minHeight: 0, justifyContent: 'flex-start' },
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
    // Einstellungen auf dem iPad: schmales Menü links, Inhalt rechts.
    settingsSplit: { flexDirection: 'row', gap: 18, alignItems: 'flex-start' },
    settingsRail: { width: 230, gap: 2 },
    settingsRailItem: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
      paddingHorizontal: 12,
      borderRadius: radius.control,
    },
    settingsRailActive: { backgroundColor: colors.surface },
    settingsRailText: { color: colors.inkSoft, fontSize: 14, fontWeight: '600', flex: 1 },
    /** Die Überschrift über der Einrichtung in der iPad-Spalte. Klein und
     *  gedeckt: Sie trennt, sie ist kein Knopf. */
    settingsRailGruppe: {
      color: colors.inkFaint,
      fontSize: 12,
      fontWeight: '700',
      letterSpacing: 0.4,
      textTransform: 'uppercase',
      paddingHorizontal: 12,
      paddingTop: 14,
      paddingBottom: 4,
    },
    empty: {
      color: colors.onGradientSoft,
      fontSize: 14,
      lineHeight: 21,
      marginTop: 24,
      maxWidth: 460,
    },
  });
