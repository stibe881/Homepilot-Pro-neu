import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
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
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { LinearGradient } from 'expo-linear-gradient';

import { CommandData, Entity, HubSettings } from '../api/types';
import { begruessung } from '../lib/begruessung';
import {
  Bereich,
  einstiegsSeite,
  gruppeVon,
  siehtBereich,
} from '../lib/einstellungsmenue';
import { alarmPlakette } from '../lib/einstellungsgruppen';
import { DraggableList } from '../components/DraggableList';
import { CellLayout, DragCell, reorderByDrop } from '../components/DragGrid';
import { EntityCard } from '../components/EntityCard';
import { skyFromIcon } from '../components/CoverVisual';
import { HistoryChart } from '../components/HistoryChart';
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
import { RoomCard } from '../components/RoomCard';
import { Raumbild } from '../components/Raumbild';
import { raumSchleier, raumaktionen, waehlbareGeraete } from '../lib/raumkarte';
import { SceneRow } from '../components/SceneRow';
import { GlobalSearch } from '../components/GlobalSearch';
import { Grundriss } from '../components/Grundriss';
import { LiveTuerSchalter } from '../components/LiveTuerSchalter';
import { PushPrefs } from '../components/PushPrefs';
import { ActivityCard, SidePanel } from '../components/SidePanel';
import { Bestaetigung, Toast, UndoToast } from '../components/Toast';
import { TopStrip } from '../components/TopStrip';
import { useHub } from '../hooks/useHub';
import { Knopfdruck, Tap, useNotificationTap } from '../hooks/useNotificationTap';
import { usePrefs } from '../hooks/usePrefs';
import { useLiveAktivitaet } from '../hooks/useLiveAktivitaet';
import { useWatchSync } from '../hooks/useWatchSync';
import { useTuerKnopf } from '../hooks/useTuerKnopf';
import { usePushRegistration } from '../hooks/usePushRegistration';
import { breakpoints, space, type, useColors } from '../theme';
import {
  KAMERA_MINDEST,
  breiteFuer,
  doppeltBreit,
  kachelBreite,
  spalten,
} from '../lib/raster';
import { mengeUndName } from '../lib/einkauf';
import { uhr } from '../lib/format';
import {
  klingelAktionen,
  klingelBild,
  klingeltGerade,
  vollbildZeigen,
} from '../lib/klingel';
import { deviceKindLabel, musikboxenImRaum } from '../lib/geraeteart';
import { rueckangebot } from '../lib/rueckgriff';
import { gemerkteAktion, menuLabel } from '../lib/doppeltipp';
import { leerbild } from '../lib/leerzustand';
import { reihenfolge as nutzungsReihenfolge } from '../lib/raumnutzung';
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
  raumFakten,
  raumKategorien,
  raumKlima,
  raumLeuchtet,
  raumMesswerte,
  raumSymbol,
} from '../lib/raum';
import { Person } from '../lib/ortung';
import { FAVORITEN, raumGruppen } from '../lib/raumgruppen';
import { verlangtPin } from '../lib/alarmpin';
import {
  OffenesModul,
  istGesperrt,
  istPersoenlich,
  offeneModule,
} from '../lib/bereichsriegel';
import { schleier } from '../lib/nachtabsenkung';
import { Einrichtungshilfe } from '../components/Einrichtungshilfe';
import { EinstellungsKopf } from '../components/einstellungen/Kopf';
import { EinstellungsUebersicht } from '../components/einstellungen/Uebersicht';
import { Wechselblatt } from '../components/einstellungen/Wechselblatt';
import { Kamerawand } from '../components/Kamerawand';
import { HausRueckblick } from './HausRueckblick';
import { nachBewegung } from '../lib/kameraordnung';
import {
  hinweis as tageszeitHinweis,
  jetzigerAbschnitt,
  lohntSich,
} from '../lib/tageszeit';
import { hubClient, onHubFehler } from '../api/client';
import { Auffangnetz } from '../components/Auffangnetz';
import { Auftritt } from '../components/Auftritt';
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
import { MusikBlatt } from '../components/MusikBlatt';
import { TvRemote } from '../components/TvRemote';
import { appsOf } from '../components/TvApps';
import { Musikzentrale } from '../components/Musikzentrale';
import { ClimateOverview } from '../components/ClimateOverview';
import { KidsView } from '../components/KidsView';
import { KitchenTimer } from '../components/KitchenTimer';
import { WhatsNew } from '../components/WhatsNew';
import { LightGroups } from '../components/LightGroups';
import { DeviceTools } from '../components/DeviceTools';
import { SceneSuggestion } from '../components/SceneSuggestion';
import { SzeneAufnehmen } from '../components/SzeneAufnehmen';
import { PersonenScreen } from './PersonenScreen';
import { UsersScreen } from './UsersScreen';
import { confirm as confirmBiometrie, needsCheck } from '../lib/biometrie';
import { mayOpenDirectly } from '../lib/tuerbestaetigung';
import { BioLock } from '../components/BioLock';
import { TuerRueckfrage } from '../components/TuerRueckfrage';
import { Widgets } from '../components/Widgets';
import { Ablage, syncWidget } from '../lib/widget';
import { resolveKarten } from '../lib/widgetKarten';
import { hoereAufSchnellaktionen, setzeSchnellaktionen } from '../lib/schnellaktionen';
import { PushKnopf, Ziel, knoepfeAus, zielAus } from '../lib/pushziel';
import { PushBlatt } from '../components/PushBlatt';
import { Erinnerungsblatt } from '../components/Erinnerungsblatt';
import { fristSatz } from '../lib/erinnerungsfrist';
import { favoritenVon, zuUebernehmen } from '../lib/favoriten';
import { altesUebernehmen } from '../lib/hausprefs';
import {
  mitDirekt,
  resolveButtons,
  standardDirekt,
  widgetCommand,
} from '../lib/widgetButtons';
import { HubProvider } from '../hooks/HubContext';
import { useFamilienlisten } from '../hooks/useFamilienlisten';
import { useKachelnutzung } from '../hooks/useKachelnutzung';
import { useRaumnutzung } from '../hooks/useRaumnutzung';
import { gelernt, hinweisGelernt, nachGewohnheit } from '../lib/kachellernen';
import { useSensorlinien } from '../hooks/useSensorlinien';
import { useAusfall } from '../hooks/useAusfall';
import { useZurueckWischen } from '../hooks/useZurueckWischen';
import { useTakt } from '../hooks/useTakt';
import { ErinnerungOverlay } from './dashboard/Erinnerungsvollbild';
import { GroupControls } from './dashboard/Gruppensteuerung';
import { CameraFullscreen } from './dashboard/Kameravollbild';
import { DoorbellOverlay } from './dashboard/Klingelvollbild';
import { usePanelMode } from './dashboard/panelmodus';
import { AlarmPinAsk, LockConfirm } from './dashboard/Rueckfragen';
import { makeStyles } from './dashboard/stile';

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

  // Szenen anlegen ist Ablauf-Arbeit: Der Hub verlangt dafür
  // edit_automations, und ein Knopf, der danach am Hub scheitert, ist
  // schlimmer als keiner.
  const darfSzenen = (user?.capabilities ?? []).includes('edit_automations');
  const darfAnpassen =
    (user?.capabilities ?? []).includes('edit_devices') ||
    (user?.capabilities ?? []).includes('edit_config');

  const [section, setSection] = useState<Section>('start');
  // Solange eine Zeile in einem Ordnen-Blatt am Finger hängt, darf das
  // Blatt nicht scrollen: Der Capture-Anspruch der Zeile hält zwar die
  // Geste, aber ein ScrollView, der daneben weiter scrollen darf,
  // schiebt den Inhalt unter der Zeile weg. Die Startseite macht es mit
  // den Kacheln genauso (scrollEnabled={!drag}).
  const [ordnenZieht, setOrdnenZieht] = useState(false);
  // Die grosse Liste, damit ein Wechsel oben anfängt (siehe unten).
  const blatt = useRef<ScrollView>(null);
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

  // Ein neuer Bereich, ein neuer Raum: oben anfangen.
  //
  // Die Räume stehen weit unten auf der Startseite. Wer dorthin scrollte
  // und einen antippte, bekam die Kacheln des Raums - blieb aber auf
  // derselben Höhe stehen und sah sie deshalb erst nach dem
  // Hochscrollen. Der Inhalt war neu, die Blickhöhe die alte, und es sah
  // aus, als stünde der Raum am Ende der Seite.
  //
  // Ohne Bewegung: Ein Sprung nach oben ist die Antwort auf einen Tipp,
  // kein Weg, den man mitverfolgen soll.
  useEffect(() => {
    blatt.current?.scrollTo({ y: 0, animated: false });
  }, [section, room]);

  // Der Wunsch aus einer Nachricht gilt für diesen einen Besuch. Wer die
  // Familie verlässt und später wiederkommt, soll nicht erneut im
  // Einkauf landen, bloss weil er vor einer Stunde darauf getippt hat.
  useEffect(() => {
    if (section !== 'family') setFamilienModul(null);
  }, [section]);

  const [now, setNow] = useState(() => new Date());
  // Ob die Trennung Bestand hat - erst dann kommt der Ausfall-Balken.
  const ausfall = useAusfall(status);
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
  // Das ···-Menü im Raumkopf: klappt «Anpassen» und «Reihenfolge» auf.
  // Je Raum frisch zu - was man im Büro aufgeklappt hat, soll im
  // Schlafzimmer nicht offen stehen.
  const [raumMenue, setRaumMenue] = useState(false);
  // «Szene aufnehmen» steht hinter dem ···-Menü und klappt darunter auf.
  const [szeneAufnehmen, setSzeneAufnehmen] = useState(false);
  useEffect(() => {
    setRaumMenue(false);
    setSzeneAufnehmen(false);
  }, [room, section]);
  const [lastTouch, setLastTouch] = useState(() => Date.now());
  // Zählt hoch, wenn der Widget-Knopf «Alles aus» gedrückt wurde – die
  // Rückfrage öffnet sich dann von selbst, statt dass die App nur
  // aufgeht und nichts tut.
  const [allOffSignal, setAllOffSignal] = useState(0);
  // Der Tipp auf Termin oder Geburtstag in der Startkarte öffnet die
  // Kalender-Fenster des OverviewScreens - dasselbe Muster wie beim
  // «Alles aus»-Signal: Der Zähler stösst an, die Art sagt welches.
  const [kalenderSignal, setKalenderSignal] = useState<{
    art: 'termine' | 'geburtstage';
    n: number;
  }>({ art: 'termine', n: 0 });
  // Türklingel-Vollbild: pro Klingel-Ereignis einmal zeigen, bis es
  // weggewischt wird (Schlüssel = Kamera + Zeitpunkt des Klingelns).
  const [dismissedRing, setDismissedRing] = useState<string | null>(null);
  // Wer auf die Klingel-Nachricht getippt hat, will genau dieses Bild
  // sehen - auch auf dem Telefon, wo es von selbst nicht aufginge, und
  // auch dann, wenn das Läuten inzwischen vorbei ist. Ein Tipp auf die
  // Nachricht ist eine Bitte, keine Störung.
  const [klingelTap, setKlingelTap] = useState<string | null>(null);
  // Welche Kachel der Familie eine Nachricht gemeint hat («Milch steht
  // auf der Einkaufsliste» → Einkauf). Getrennt vom Riegel-Modul: Das
  // eine ist ein Weg um eine Sperre herum, das andere ein Ziel.
  const [familienModul, setFamilienModul] = useState<string | null>(null);
  // Welches Gerät gerade nach einer Frist gefragt wird («sag mir in zwei
  // Stunden Bescheid»).
  const [erinnernAn, setErinnernAn] = useState<Entity | null>(null);
  // Das Blatt hinter dem Titel einer Einstellungsseite (components/einstellungen).
  const [wechselOffen, setWechselOffen] = useState(false);
  // Der Weg zu einem Ziel aus einer Nachricht. Über eine Ref, weil der
  // Tipp-Haken früh gebraucht wird und der Weg selbst erst weiter unten
  // steht - dort, wo die Räume bekannt sind.
  const zumZiel = useRef<(ziel: Ziel) => void>(() => {});
  // Die Handgriffe, die ein Ablauf seiner Nachricht mitgegeben hat -
  // «Trockner an» unter «Waschmaschine fertig». Sie stehen erst hier zur
  // Wahl, hinter der Anmeldung.
  const [pushBlatt, setPushBlatt] = useState<{
    titel?: string;
    text?: string;
    knoepfe: PushKnopf[];
  } | null>(null);
  // Angetippte Kamera im Vollbild (Entitäts-ID, damit Live-Updates ankommen).
  const [fullscreen, setFullscreen] = useState<string | null>(null);
  // Alle Kameras nebeneinander - fürs Tablet im Flur die einzige
  // sinnvolle Ansicht (siehe components/Kamerawand.tsx).
  const [wandOffen, setWandOffen] = useState(false);
  // Gerät, dessen Verlauf gerade offen ist (Geräte-Ansicht, Tipp auf die Kachel).
  const [historyFor, setHistoryFor] = useState<string | null>(null);
  // Welcher Raum ein Foto auf seiner Kachel hat, und von wann. Der
  // Zeitstempel hängt an der Bildadresse: Ohne ihn zeigte ein Telefon
  // nach dem Wechseln wochenlang das alte Foto aus seinem Speicher.
  const [raumbilder, setRaumbilder] = useState<Record<string, number>>({});
  // Für welchen Raum das Blatt «Bild wählen» offen steht.
  const [bildFuer, setBildFuer] = useState<string | null>(null);
  // Für welchen Raum der Player offen steht (Musik-Knopf der Raumkachel).
  const [musikBlattRaum, setMusikBlattRaum] = useState<string | null>(null);
  // Welcher Fernseher seine Fernbedienung offen hat. Sie hängt nicht an
  // der Gerätekachel, sondern hier: Der Knopf «Fernseher» auf einer
  // Raumkachel soll sie aufmachen, ohne dass man erst in den Raum geht.
  const [remoteFuer, setRemoteFuer] = useState<string | null>(null);
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
  // Einkaufsliste, Läden und Erinnerungen des Haushalts - Zustand und
  // Handgriffe stehen in hooks/useFamilienlisten.ts.
  const {
    lernRef,
    einkauf,
    laeden,
    bekannt,
    einkaufUndo,
    setEinkaufUndo,
    griffUndo,
    setGriffUndo,
    kaufeEin,
    hakeAb,
    entferneEinkauf,
    setzeMenge,
    nimmAbhakenZurueck,
    merkeGriff,
    nimmGriffZurueck,
    faelligeErinnerungen,
    bestaetigeErinnerung,
    quittiereErinnerung,
  } = useFamilienlisten({
    hub,
    settings,
    familyChangedAt,
    aufStartseite: section === 'start',
    benutzer: user,
    melde: setNote,
  });

  // Die Funkenlinien der Sensoren (hooks/useSensorlinien.ts).
  const trends = useSensorlinien(hub, status);
  // Wie oft welcher Raum bedient wurde (hooks/useRaumnutzung.ts).
  const { raumZaehler, zaehleRaum } = useRaumnutzung();
  // Und wie oft welches Gerät zu welcher Tageszeit
  // (hooks/useKachelnutzung.ts) - daraus wird die gelernte Reihenfolge.
  const { kachelZaehler, zaehleKachel } = useKachelnutzung();
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

  // Die Anlage für die Plakette an ihrer Zeile in den Einstellungen. Ein
  // per Namen erkannter Schalter ist der Notnagel für Aufbauten ohne
  // echte Alarm-Entität - dieselbe Reihenfolge wie im Überblick.
  const alarmGeraet = useMemo(
    () =>
      entities.find((entity) => entity.kind === 'alarm') ??
      entities.find((entity) => /alarm/i.test(entity.name) && entity.kind === 'switch'),
    [entities]
  );

  // Der Fernseher, dessen Fernbedienung gerade offen ist. Über die
  // Kennung und nicht über die Entität gemerkt: Der Hub schickt bei
  // jedem Tastendruck einen neuen Zustand, und ein festgehaltenes Objekt
  // wäre nach dem ersten Druck von gestern.
  const remoteTv = useMemo(
    () => entities.find((entity) => entity.id === remoteFuer) ?? null,
    [entities, remoteFuer]
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
    setTuerKnopf,
    eigenGeladen,
    setFavorites,
    setFavoriteOrder,
    setSchnellOrder,
    setDurchsage,
    setBioLock,
    setDoorConfirm,
    setWidgetData,
    setWidgetButtons,
    setRaumKnoepfe,
    setWidgetDirect,
    setWidgetKarten,
    setEinkaufLernen,
  } = usePrefs(settings, status === 'connected');

  // Jetzt, wo die Haus-Einstellungen da sind, bekommt das Abhaken in der
  // Kopfzeile sein Protokoll (die Ref kommt aus useFamilienlisten).
  lernRef.current = {
    log: prefs.einkaufLernen ?? [],
    schreiben: setEinkaufLernen,
  };

  // Die Haustür-Karte für unterwegs - tut nur auf einem iPhone mit dem
  // passenden Build etwas (hooks/useLiveAktivitaet.ts). Hängt am
  // Profil-Schalter: aus heisst, dieses Gerät meldet gar keine Tokens an.
  useLiveAktivitaet(settings, status === 'connected' && eigenePrefs.liveTuer !== false);

  // Der Apple Watch die Zugangsdaten hinüberreichen - tut nur auf einem
  // iPhone mit dem passenden Build etwas (hooks/useWatchSync.ts).
  useWatchSync(settings, entities, status === 'connected');

  // Der Öffnen-Knopf auf der Haustür-Karte (ohne Entsperren) - erst
  // handeln, wenn die persönlichen Einstellungen da sind: Beim Start
  // kurz zu löschen und gleich wieder zu schreiben würde den Knopf auf
  // einer gerade liegenden Karte für einen Moment töten.
  useTuerKnopf(
    settings,
    entities,
    eigenGeladen ? eigenePrefs.tuerKnopf === true : null
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
  // Die Kurzbefehle am App-Symbol tragen dieselben Knöpfe wie das
  // Widget - eine zweite Liste für dieselbe Frage wäre eine zweite
  // Stelle, an der man sucht (lib/schnellaktionen.ts).
  useEffect(() => {
    if (widgetButtons.length === 0) return;
    setzeSchnellaktionen(widgetButtons);
  }, [widgetButtons]);
  useEffect(() => hoereAufSchnellaktionen((url) => adresseAusfuehren.current(url)), []);

  // Welcher Raum ein Foto hat. Einmal beim Verbinden und nicht im Takt:
  // Ein Bild ändert sich, wenn jemand es wechselt - und dann sagt es die
  // Antwort auf genau diese Änderung (siehe onChanged unten).
  useEffect(() => {
    if (status !== 'connected') return;
    let abgebrochen = false;
    hub
      .get<{ images?: Record<string, number> }>('/api/rooms/images', {
        fallback: { images: {} },
        still: true,
      })
      .then((antwort) => {
        if (!abgebrochen) setRaumbilder(antwort.images ?? {});
      });
    return () => {
      abgebrochen = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, settings.url, settings.token]);

  /**
   * Die Adresse des Raumfotos – oder nichts, wenn es keines gibt.
   *
   * Der Zeitstempel hängt mit dran: Der Hub lässt das Bild ein Jahr lang
   * zwischenspeichern (es ändert sich fast nie), und ein neues Foto ist
   * damit eine neue Adresse statt eines alten Bildes im Speicher.
   */
  const raumbildUrl = useCallback(
    (name: string): string | null => {
      const stand = raumbilder[name];
      if (!stand) return null;
      const token = settings.token ? `token=${encodeURIComponent(settings.token)}&` : '';
      return `${settings.url}/api/rooms/${encodeURIComponent(name)}/image?${token}v=${stand}`;
    },
    [raumbilder, settings.url, settings.token]
  );

  const [widgetAblage, setWidgetAblage] = useState<Ablage>('kein-widget');
  useEffect(() => {
    // Erst, wenn etwas da ist: Vor der ersten Antwort des Hubs sind
    // Szenen und Geräte leer, und eine Szene, die es «noch nicht gibt»,
    // fiele aus der Knopfliste heraus - das Widget stünde kurz mit
    // weniger Knöpfen da, als jemand eingestellt hat.
    if (entities.length === 0 && scenes.length === 0) return;
    setWidgetAblage(syncWidget(settings, !!prefs.widgetData, widgetButtons, widgetKarten));
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
    const ziel = zielAus(tap);
    if (ziel) zumZiel.current(ziel);
    // Erst hingehen, dann fragen: Das Blatt legt sich über den Ort, an
    // den der Tipp geführt hat - wer es wegwischt, steht dort, statt
    // wieder auf der Startseite.
    const knoepfe = knoepfeAus(tap);
    if (knoepfe.length > 0) {
      setPushBlatt({ titel: tap.title, text: tap.body, knoepfe });
    }
  }, []);
  // «Später» und «Erledigt» aus der Mitteilung heraus. Beides läuft ohne
  // die App zu öffnen; sie erfährt davon, sobald sie das nächste Mal
  // läuft, und reicht es an den Hub weiter (lib/mitteilungsknoepfe.ts).
  const onKnopf = useCallback(
    (druck: Knopfdruck) => {
      if (druck.handlung === 'spaeter') {
        hub
          .post(
            '/api/push/snooze',
            {
              title: druck.title,
              body: druck.body,
              category: druck.category,
              minutes: 30,
            },
            { still: true }
          )
          .then(() => setNote('Erinnerung in 30 Minuten'))
          .catch(() => {});
        return;
      }
      // «Ich mach's»: Der Programmlauf ist übernommen. Danach hört das
      // Nachhaken auf, und bei den anderen steht am Gerät, wer sich
      // kümmert (hub/core/waschkueche.py).
      if (druck.handlung === 'ichmachs') {
        if (druck.entityId) {
          hub
            .post<{ claimed?: boolean }>(
              `/api/appliances/${encodeURIComponent(druck.entityId)}/claim`,
              {},
              { still: true }
            )
            // Der Hub sagt, ob es noch etwas zu übernehmen gab. Ein
            // später Druck auf eine überholte Nachricht ist keine
            // Panne, aber auch kein «erledigt» - das soll dastehen.
            .then((antwort) =>
              setNote(
                antwort?.claimed
                  ? 'Du räumst aus – die anderen sehen es'
                  : 'Da ist nichts mehr offen'
              )
            )
            .catch(() => {});
        }
        return;
      }
      // «Erledigt» gibt es bisher für die Batteriewarnung: Sie quittiert
      // das Gerät, damit sie nicht jede Woche wiederkommt.
      if (druck.entityId) {
        hub
          .post(
            `/api/batteries/${encodeURIComponent(druck.entityId)}/ack`,
            {},
            { still: true }
          )
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
      // «meistbenutzter Raum zuoberst» (lib/raumnutzung.ts) - und je
      // Gerät und Tageszeit die gelernte Kachel-Reihenfolge
      // (lib/kachellernen.ts).
      zaehleRaum(entity?.room);
      zaehleKachel(entityId);
      sendCommand(entityId, command, data);
    },
    [
      entities,
      locked,
      sendCommand,
      prefs.bioLock,
      user?.shared,
      zaehleRaum,
      zaehleKachel,
    ]
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
  // Der Start-Link wird genau einmal *ausgeführt* - nicht einmal
  // *angefasst*. Der Unterschied ist der ganze Fehler, der hier stand:
  // Beim Kaltstart über den Widget-Knopf läuft der Handler, bevor die
  // Geräte geladen sind - die Türe war «nicht gefunden», und es blieb
  // beim blossen Öffnen der App. Und weil der Effekt bei jeder
  // Geräteänderung neu lief, holte er den Start-Link danach immer
  // wieder hervor: Wer die Rückfrage wegtippte, bekam sie beim nächsten
  // Zustands-Update erneut. Jetzt gilt: erledigt erst, wenn wirklich
  // gehandelt wurde - bis dahin wird mit jedem Laden neu probiert.
  const startLinkErledigt = useRef(false);
  // Derselbe Weg für die Kurzbefehle am App-Symbol: Sie tragen dieselben
  // homepilot://-Adressen, und was für den Widget-Knopf gilt, gilt für
  // sie - ein Kurzbefehl darf nicht mehr dürfen als die App.
  const adresseAusfuehren = useRef<(url: string) => void>(() => {});
  useEffect(() => {
    /** Führt den Link aus. `true` heisst: erledigt (auch «kenne ich
     *  nicht» ist erledigt) - `false`: die Daten fehlen noch, später
     *  noch einmal. */
    const handle = (url: string | null): boolean => {
      if (!url || !url.startsWith('homepilot://')) return true;
      const [what, ...rest] = url.replace('homepilot://', '').split(/[/?]/);
      const id = rest.length > 0 ? decodeURIComponent(rest.join('/')) : '';
      if (what === 'door') {
        const door =
          entities.find(
            (entity) => entity.kind === 'lock' && entity.commands.includes('open_door')
          ) ?? entities.find((entity) => entity.kind === 'lock');
        if (!door) return entities.length > 0;
        setSection('home');
        const befehl = door.commands.includes('open_door') ? 'open_door' : 'unlatch';
        // Wer die Nachfrage abgestellt hat, meint sie überall - auch auf
        // dem Weg vom Sperrbildschirm hierher. Vorher fragte dieser Pfad
        // immer, und die Einstellung «Fragt die Türe vor dem Öffnen
        // nach» galt nur für die Kachel. Gerätesperre und Face ID
        // bleiben: guardedCommand prüft beide, wie bei jedem Tipp.
        if (mayOpenDirectly(befehl, prefs.doorConfirm)) {
          guardedCommand(door.id, befehl);
        } else {
          setConfirm({ entity: door, command: befehl });
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
        if (!scenes.some((scene) => scene.id === id)) return scenes.length > 0;
        setSection('start');
        activateScene(id);
      } else if (what === 'entity' && id) {
        const entity = entities.find((item) => item.id === id);
        if (!entity) return entities.length > 0;
        setSection('start');
        if (entity.kind === 'lock') {
          // Ein Schloss fragt nach - ausser die Nachfrage ist
          // ausdrücklich abgestellt (dieselbe Regel wie oben bei
          // «door»; Gerätesperre und Face ID prüft guardedCommand).
          const befehl = entity.commands.includes('open_door') ? 'open_door' : 'unlatch';
          if (mayOpenDirectly(befehl, prefs.doorConfirm)) {
            guardedCommand(entity.id, befehl);
          } else {
            setConfirm({ entity, command: befehl });
          }
          return true;
        }
        const command = widgetCommand(entity);
        if (command) guardedCommand(entity.id, command);
      }
      return true;
    };
    adresseAusfuehren.current = (url: string) => {
      handle(url);
    };
    // Kein Start-Link ist der Normalfall - dann startet die App normal.
    if (!startLinkErledigt.current) {
      Linking.getInitialURL()
        .then((url) => {
          if (!startLinkErledigt.current && handle(url)) {
            startLinkErledigt.current = true;
          }
        })
        .catch(() => {});
    }
    // Ereignisse (App lief schon) kommen genau einmal - jedes zählt.
    const subscription = Linking.addEventListener('url', (event) => handle(event.url));
    return () => subscription.remove();
  }, [entities, scenes, activateScene, guardedCommand, prefs.doorConfirm]);

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
  const klingeltJetzt = klingeltGerade(entities);
  const ringKey = klingeltJetzt
    ? `${klingeltJetzt.id}:${klingeltJetzt.state.last_ring ?? ''}`
    : null;
  // Wer auf die Nachricht getippt hat, meint das Gerät aus der
  // Nachricht - auch wenn das Läuten inzwischen vorbei ist und
  // `klingeltGerade` deshalb nichts mehr findet. Ohne Kennung (ältere
  // Nachricht) die zuletzt klingelnde Türe, sonst gar keine.
  const getippteKlingel = useMemo(() => {
    if (klingelTap === null) return undefined;
    return (
      entities.find((entity) => entity.id === klingelTap) ??
      entities.find((entity) => entity.state?.last_ring)
    );
  }, [klingelTap, entities]);
  const klingelt = klingeltJetzt ?? getippteKlingel;
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

  /**
   * Der Weg zu dem, was eine Nachricht meint.
   *
   * Eine Stelle für alle fünfundzwanzig Meldungen, statt einer Regel je
   * Meldung: Was wohin gehört, sagt der Hub in der Nachricht selbst
   * (lib/pushziel.ts). Die App muss dafür nichts über Wassermelder
   * wissen - nur, wie man zu einem Raum kommt.
   *
   * Beim Zeichnen zugewiesen und nicht als Callback: Der Weg braucht
   * Räume und Geräte, die weiter oben noch nicht stehen, und der
   * Tipp-Haken bekommt so immer den frischen Stand.
   */
  zumZiel.current = (ziel: Ziel) => {
    switch (ziel.art) {
      // Was offen steht, zeigt die Karte auf der Startseite - eine
      // eigene Seite dafür gibt es nicht.
      case 'start':
      // falls through
      case 'offen':
        setSection('start');
        return;
      case 'bereich':
        setSection(ziel.bereich);
        return;
      case 'raum':
        setSection('home');
        setRoom(ziel.raum);
        return;
      case 'kamera':
        setFullscreen(ziel.entityId);
        return;
      case 'geraet': {
        const geraet = entities.find((entity) => entity.id === ziel.entityId);
        // Eine Kamera zeigt man gross; alles andere steht in seinem
        // Raum, und dort sieht man es im Zusammenhang.
        if (geraet?.kind === 'camera') {
          setFullscreen(geraet.id);
          return;
        }
        if (geraet?.room) {
          setSection('home');
          setRoom(geraet.room);
          return;
        }
        setSection('devices');
        return;
      }
      case 'familie':
        setSection('family');
        setFamilienModul(ziel.modul);
        return;
      case 'batterien':
        setSection('devices');
        setBatterienOffen(true);
        return;
      case 'sorgen':
        setSorgenOffen(true);
        return;
      case 'timer': {
        // Der Timer steht in der Küche - dort, wo die Nudeln aufgesetzt
        // sind, nicht in einer Liste.
        const kueche = rooms.find((name) => istKueche(name));
        if (kueche) {
          setSection('home');
          setRoom(kueche);
        } else {
          setSection('start');
        }
        return;
      }
      case 'klingel':
        setKlingelTap(ziel.entityId ?? '');
        return;
    }
  };

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
  const tageszeitAn = !!eigenePrefs.tageszeit && !editing && !searching && lohntSich(shown);
  const abschnitt = tageszeitAn ? jetzigerAbschnitt(now.getTime()) : null;
  // Die feste Arten-Liste ist der Boden; wo genug gelernt ist, zieht die
  // Gewohnheit einzelne Kacheln davor (lib/kachellernen.ts). Erst nach
  // drei Griffen in derselben Tageszeit, und die Werte verblassen -
  // sonst hielte die Seite jeden Zufall für die Regel.
  const nachZeit = <T extends { id: string; kind: string }>(liste: T[]): T[] =>
    abschnitt ? nachGewohnheit(liste, abschnitt, kachelZaehler, now.getTime()) : liste;
  // Ob die Gewohnheit gerade wirklich mitredet - der Hinweis oben soll
  // den Unterschied sagen, sonst hält man die umsortierte Seite für
  // einen Fehler.
  const gewohnheitWirkt =
    abschnitt != null && gelernt(kachelZaehler, abschnitt.key, now.getTime()).length > 0;

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
  // Der Raumkopf nach der Stiltafel «Bühne + Raumlicht»: Name links,
  // Klima gross rechts, darunter eine Faktenzeile - und ein warmer
  // Schein, solange im Raum Licht brennt.
  const klima = useMemo(
    () => (categorized ? raumKlima(shown) : null),
    [categorized, shown]
  );
  const raumKopf = categorized ? raumFakten(inRoom) : '';
  // Von der linken Kante nach rechts: zurück zur Raumliste. Derselbe
  // Weg wie «‹ Räume» oben links - nur erreichbar, ohne umzugreifen
  // (lib/zurueckwischen.ts). Beim Anpassen bleibt sie aus: Dort zieht
  // man Kacheln, und ein Wischen wäre zweideutig.
  const zurueckWischen = useZurueckWischen(
    section === 'home' && room !== ALL_ROOMS && !editing,
    () => setRoom(ALL_ROOMS)
  );
  const raumSchein = categorized && raumLeuchtet(inRoom);
  // Der Klimafühler steht gross im Kopf - als Chip daneben stünde er
  // doppelt, wie früher die Temperatur.
  const messwerte = useMemo(
    () =>
      (categorized ? raumMesswerte(shown) : []).filter(
        (fuehler) => fuehler.id !== klima?.fuehler.id
      ),
    [categorized, shown, klima]
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
                aktion ? `Doppeltipp gemerkt: ${aktion.wort}` : 'Doppeltipp vergessen'
              );
            }
          : undefined
      }
      // Kamera und Thermostat bekommen zwei Spalten (lib/raster.ts).
      // Beim Anpassen nicht: Dort zieht man Kacheln an ihren Platz, und
      // ein Raster mit Lücken wäre dabei nicht zu treffen.
      width={breiteFuer(
        cardWidth!,
        !editing && doppeltBreit(entity.kind, entity.commands),
        columns
      )}
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
      onErinnern={() => setErinnernAn(entity)}
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
  const renderCell = zellen(orderScope, rest, section === 'home' && room !== ALL_ROOMS);

  const einstellungsPunkte: {
    key: Section | 'search' | 'sorgen' | 'besuch';
    icon: keyof typeof Ionicons.glyphMap;
    label: string;
    detail: string;
    show: boolean;
    /** Die kleine Meldung an der Zeile - siehe lib/einstellungsgruppen.ts. */
    plakette?: { text: string; ton: 'gut' | 'warnung' | 'ruhig' };
    /** Statt zu einem Bereich zu wechseln: etwas öffnen. */
    onPress?: () => void;
  }[] = [
    {
      key: 'search',
      icon: 'search-outline',
      label: 'Suche',
      detail: 'Geräte, Räume, Szenen und Abläufe',
      show: true,
      onPress: () => setSearchOpen(true),
    },
    {
      key: 'users',
      icon: 'people-circle-outline',
      label: 'Benutzerverwaltung',
      detail: 'Zugänge und Rollen',
      show: sieht('users'),
    },
    {
      key: 'personen',
      icon: 'people-outline',
      label: 'Familie und Freunde',
      detail: 'Wer ist wo – und was gemeldet wird',
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
        : 'Pausieren, Babysitter, was heute läuft',
      show: sieht('automations'),
    },
    {
      key: 'alarm',
      icon: 'shield-checkmark-outline',
      label: 'Alarmanlage',
      detail: 'Sensoren, Modi und Verlauf',
      // «Ist sie scharf?» ist die häufigste Frage an diesen Punkt - die
      // Liste beantwortet sie selbst, statt sie hinter einem Tipp zu
      // verstecken (lib/einstellungsgruppen.ts).
      plakette: alarmGeraet
        ? alarmPlakette(alarmGeraet.kind, String(alarmGeraet.state.state ?? ''))
        : undefined,
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
      plakette: besuchStand?.active
        ? ({ text: 'läuft', ton: 'gut' } as const)
        : undefined,
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
        : 'Batterien, Funkstille und Wartung',
      plakette: stummeGeraete.length
        ? ({ text: String(stummeGeraete.length), ton: 'warnung' } as const)
        : undefined,
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
      detail: 'Der Rückblick über alle Geräte',
      show: sieht('activity'),
    },
    {
      key: 'widgets',
      icon: 'apps-outline',
      label: 'Widgets',
      detail: 'Knöpfe für Homescreen und Sperre',
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
      detail: 'Profil, Darstellung, Benachrichtigungen',
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
    'users',
    'personen',
    'automations',
    'alarm',
    'speakers',
    'energy',
    'system',
    'activity',
    'widgets',
    'account',
    'connection',
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
   * «Einstellungen» war ein Zwischenschritt für nichts: Man tippte
   * darauf, bekam eine Liste von Kacheln, tippte noch einmal, und erst
   * dann stand die Ansicht da, die man gemeint hatte. Zweimal derselbe
   * Weg, einmal davon vergeblich.
   *
   * Also geht gleich eine Seite auf; die vom letzten Mal, sonst die
   * erste (lib/einstellungsmenue.ts). Das Menü steht dabei immer
   * daneben: auf dem breiten Bildschirm als Spalte links, auf dem
   * Telefon als Kopfzeile mit Wechselblatt (components/einstellungen).
   *
   * Sieht jemand überhaupt keine solche Seite - ein Gast etwa -, bleibt
   * es bei der Kachelliste: Ein leerer Bereich wäre schlimmer als eine
   * kurze Liste.
   */
  // Womit die Leiste «Einstellungen» hervorhebt, solange man drin ist.
  // Vorher stand dort nichts hervorgehoben, sobald man eine Seite offen
  // hatte - und auf einem breiten Bildschirm ist man ab dem ersten Tipp
  // immer auf einer Seite. Man sah dann nirgends mehr, wo man ist.
  const railAktiv: Section = sichtbarePunkte.some((item) => item.key === section)
    ? 'settings'
    : section;

  /**
   * Einen Menüpunkt öffnen.
   *
   * Die meisten führen zu einem Bereich; drei öffnen stattdessen ein
   * Blatt (Suche, Besuch, Sorgen). Der Unterschied stand vorher an vier
   * Stellen abgeschrieben - jetzt einmal hier, und Übersicht,
   * Wechselblatt und die iPad-Spalte rufen dasselbe auf.
   */
  const geheZuPunkt = (key: string) => {
    const punkt = sichtbarePunkte.find((item) => item.key === key);
    if (punkt?.onPress) punkt.onPress();
    else setSection(key as Section);
  };

  /**
   * Die Kopfzeile einer Einstellungsseite - oder nichts.
   *
   * `null` heisst: Es ist keine Einstellungsseite, oder es ist
   * zweispaltig. Dann bleibt oben die Begrüssung stehen, wo sie
   * hingehört.
   */
  // «Geräte» steht nicht in `einstellungsSeiten` - die Liste hat ihr
  // eigenes Raster und ihre eigene rechte Spalte -, ist aber ein Punkt
  // der Einstellungen und bekommt darum denselben Kopf.
  const aufEinstellungsseite =
    section === 'settings' || section === 'devices' || einstellungsSeiten.includes(section);
  const einstellungsKopf =
    zweispaltig || !aufEinstellungsseite ? null : (
      <EinstellungsKopf
        titel={
          section === 'settings'
            ? 'Einstellungen'
            : (sichtbarePunkte.find((item) => item.key === section)?.label ??
              SECTION_LABEL[section])
        }
        onZurueck={section === 'settings' ? undefined : () => setSection('settings')}
        onWechseln={section === 'settings' ? undefined : () => setWechselOffen(true)}
      />
    );

  const waehleBereich = (ziel: Section) => {
    if (ziel === 'settings') {
      const start = einstiegsSeite(offeneSeiten, zuletztEinstellung.current, !hasRail);
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
              // Uhr und Warnung stehen jetzt in der Startkarte oben -
              // derselbe Inhalt zweimal untereinander wäre keiner.
              ohneKopf
              kalenderSignal={kalenderSignal}
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
              schnellOrder={eigenePrefs.schnellOrder}
              onReorderSchnell={setSchnellOrder}
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
          startModul={riegelModul ?? familienModul}
        />
      );
    }


    if (section === 'settings') {
      // Die Übersicht: gruppiert, durchsuchbar, mit Plaketten - und ohne
      // die Tür «Administrator». Sie sparte einen Bildschirm und kostete
      // zwei Tipps; ein Stück Weiterscrollen ist billiger
      // (components/einstellungen, lib/einstellungsgruppen.ts).
      //
      // Wer was überhaupt sieht, entscheidet `show` je Punkt - der Hub
      // prüft die Rechte ohnehin noch einmal selbst.
      return (
        <EinstellungsUebersicht
          punkte={sichtbarePunkte}
          onWahl={geheZuPunkt}
          onHausSuche={() => setSearchOpen(true)}
        />
      );
    }

    if (section === 'alarm') {
      return (
        <View style={styles.stack}>
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
          <EnergyScreen settings={settings} entities={entities} />
        </View>
      );
    }
    if (section === 'activity') {
      return (
        <View style={styles.stack}>
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
          <PersonenScreen settings={settings} />
        </View>
      );
    }
    if (section === 'users') {
      return (
        <View style={styles.stack}>
          <UsersScreen settings={settings} currentUser={user} entities={entities} />
        </View>
      );
    }
    if (section === 'account') {
      return (
        <View style={styles.stack}>
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
              tuerKnopf={eigenePrefs.tuerKnopf === true}
              onTuerKnopf={setTuerKnopf}
            />
          ) : null}
          <PushPrefs settings={settings} />
        </View>
      );
    }
    if (section === 'connection') {
      return (
        <View style={styles.stack}>
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
          <SystemScreen settings={settings} user={user} entities={entities} push={push} />
        </View>
      );
    }
    return (
      <View style={hasSidePanel ? styles.split : styles.stack}>
        <View style={hasSidePanel ? styles.main : undefined}>
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
                  Standbilder, die sich von selbst auffrischen – antippen zeigt eine gross
                  und live.
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
                  {abschnitt
                    ? gewohnheitWirkt
                      ? hinweisGelernt(abschnitt)
                      : tageszeitHinweis(abschnitt)
                    : 'Feste Reihenfolge'}
                </Text>
                <Text style={styles.kameraSortHint}>
                  {!eigenePrefs.tageszeit
                    ? 'Immer dieselbe Reihenfolge, egal wie spät es ist.'
                    : gewohnheitWirkt
                      ? 'Was du um diese Zeit oft anfasst, steht vorn – gezählt auf diesem Gerät, und es verblasst wieder.'
                      : 'Morgens Storen, abends Licht – die Reihenfolge wandert mit dem Tag. Gilt nur für dich.'}
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
              <ScrollView
                contentContainerStyle={{ paddingBottom: 40 }}
                scrollEnabled={!ordnenZieht}
              >
                <DraggableList
                  onDragging={setOrdnenZieht}
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
                  <ScrollView
                    contentContainerStyle={{ paddingBottom: 40 }}
                    scrollEnabled={!ordnenZieht}
                  >
                    <DraggableList
                      onDragging={setOrdnenZieht}
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
          {/* Der Raumkopf als Bühne (nach der gewählten Stiltafel):
              «‹ Räume» und ···-Menü in einer schmalen Zeile, darunter der
              Raumname gross mit dem Klima rechts daneben, darunter eine
              Faktenzeile. Dazu das Raumlicht: ein warmer Schein, solange
              im Raum Licht brennt, und das Raumsymbol als Wasserzeichen -
              beides nur Anblick, nie im Weg (pointerEvents none).
              Der Titel bleibt auch im Anpassen-Modus stehen: Gerade dort
              darf man sich nicht im Zimmer irren. */}
          {section === 'home' && room !== ALL_ROOMS ? (
            <View style={styles.raumBuehne}>
              {/* Der Farbton des Zimmers, derselbe wie auf seiner Kachel
                  in der Übersicht (lib/raumkarte.ts). Er zieht sich damit
                  durch: Man weiss beim Hinsehen, wo man ist, bevor man
                  den Namen liest. Ganz blass, denn darüber steht weisse
                  Schrift. */}
              <LinearGradient
                colors={raumSchleier(room)}
                style={styles.raumSchein}
                pointerEvents="none"
              />
              {raumSchein ? (
                <LinearGradient
                  colors={['rgba(255, 192, 97, 0.20)', 'rgba(255, 192, 97, 0)']}
                  style={styles.raumSchein}
                  pointerEvents="none"
                />
              ) : null}
              <Ionicons
                name={raumSymbol(room)}
                size={150}
                color={colors.onGradient}
                style={styles.raumWasserzeichen}
                pointerEvents="none"
              />
              {!editing ? (
                <View style={styles.raumKopfzeile}>
                  <Pressable
                    onPress={() => setRoom(ALL_ROOMS)}
                    accessibilityRole="button"
                    accessibilityLabel="Zurück zu Räume"
                    style={styles.backRow}
                  >
                    <Ionicons name="chevron-back" size={18} color={colors.onGradient} />
                    <Text style={styles.backText}>Räume</Text>
                  </Pressable>
                  {/* «Anpassen» und «Reihenfolge» braucht man einmal im
                      Jahr - sie stehen hinter dem ···, nicht vor den
                      Kacheln. */}
                  {darfAnpassen || (orderScope && !searching && rest.length > 1) ? (
                    <Pressable
                      onPress={() => setRaumMenue((value) => !value)}
                      accessibilityRole="button"
                      accessibilityLabel="Raum einrichten"
                      accessibilityState={{ expanded: raumMenue }}
                      style={styles.raumMenueKnopf}
                    >
                      <Ionicons
                        name="ellipsis-horizontal"
                        size={18}
                        color={colors.onGradientSoft}
                      />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
              <View style={styles.raumHeld}>
                <Text
                  style={[styles.raumTitel, { flexShrink: 1 }]}
                  numberOfLines={1}
                >
                  {room}
                </Text>
                {klima ? (
                  <Pressable
                    onPress={() =>
                      setExpanded((current) =>
                        current === klima.fuehler.id ? null : klima.fuehler.id
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Temperatur ${klima.temp}`}
                    style={styles.raumKlimaBlock}
                  >
                    <Text style={styles.raumKlimaTemp}>{klima.temp}</Text>
                    {klima.feuchte ? (
                      <Text style={styles.raumKlimaSub}>{klima.feuchte}</Text>
                    ) : null}
                  </Pressable>
                ) : null}
              </View>
              {raumKopf ? <Text style={styles.raumFakten}>{raumKopf}</Text> : null}
            </View>
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
            section === 'covers') &&
          // Im Raum steht der Knopf hinter dem ···-Menü; nur während des
          // Anpassens bleibt «Fertig» immer sichtbar.
          (section !== 'home' || room === ALL_ROOMS || raumMenue || editing) ? (
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
          {orderScope &&
          !searching &&
          rest.length > 1 &&
          (section !== 'home' || room === ALL_ROOMS || raumMenue) ? (
            <Pressable
              onPress={() => setReorderOpen(true)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.reorderButton, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="swap-vertical" size={16} color={colors.onGradient} />
              <Text style={styles.reorderText}>Reihenfolge ändern</Text>
            </Pressable>
          ) : null}

          {/* «So wie jetzt» – aus dem Zimmer heraus. Der Weg über die
              Abläufe war der Grund, warum das kaum jemand tat: Bis man
              dort ist, hat jemand die Küche umgeschaltet. Nur im Raum,
              denn nur dort ist «jetzt» eine Stimmung und nicht der
              Zustand des ganzen Hauses. */}
          {darfSzenen && categorized && !searching && raumMenue ? (
            <Pressable
              onPress={() => setSzeneAufnehmen((offen) => !offen)}
              accessibilityRole="button"
              accessibilityState={{ expanded: szeneAufnehmen }}
              style={({ pressed }) => [styles.reorderButton, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="camera-outline" size={16} color={colors.onGradient} />
              <Text style={styles.reorderText}>Szene aufnehmen</Text>
            </Pressable>
          ) : null}
          {darfSzenen && categorized && szeneAufnehmen ? (
            <SzeneAufnehmen
              room={room}
              items={inRoom}
              onSpeichern={async (name, aktionen) => {
                await hub.post(
                  '/api/scenes',
                  { name, actions: aktionen, room, icon: raumSymbol(room) },
                  { still: true }
                );
                reloadScenes();
                setNote(`Szene «${name}» angelegt`);
              }}
              onSchliessen={() => setSzeneAufnehmen(false)}
            />
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

          {/* Der Grundriss über den Raumkacheln - nur wenn dieses Gerät
              ihn eingeschaltet hat (Einstellungen, beim App-Symbol).
              Zusätzlich statt anstelle der Kacheln: Der Plan beantwortet
              «was brennt da hinten?», die Kacheln bleiben der Weg in
              die volle Raumansicht. */}
          {roomTiles && gridWidth > 0 && settings.grundriss ? (
            <Grundriss
              settings={settings}
              entities={shown}
              darfAnpassen={darfAnpassen}
              onCommand={(entityId, command) => guardedCommand(entityId, command)}
              width={gridWidth}
            />
          ) : null}

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
                  <RoomCard
                    key={tile.name}
                    name={tile.name}
                    items={tile.items}
                    width={hasRail ? Math.floor((gridWidth - space.gap) / 2) : gridWidth}
                    imageUri={raumbildUrl(tile.name)}
                    onOpen={() => setRoom(tile.name)}
                    // Wer hier wohnt, darf das Bild setzen - dieselbe
                    // Fähigkeit wie beim Namen eines Geräts. «Weitere»
                    // ist kein Zimmer und bekommt darum keines.
                    onLongPress={
                      darfAnpassen && tile.name !== NO_ROOM
                        ? () => setBildFuer(tile.name)
                        : undefined
                    }
                    onAction={(aktion) => {
                      // Musik schaltet nicht mehr blind Play/Pause: Der
                      // Knopf öffnet den Player der Startseite, mit der
                      // Box dieses Raums vorgewählt (MusikBlatt.tsx).
                      if (aktion.art === 'musik') {
                        setMusikBlattRaum(tile.name);
                        return;
                      }
                      // Und der Fernseher öffnet die Fernbedienung -
                      // aus demselben Grund: Wer ihn antippt, will
                      // umschalten, nicht bloss einschalten.
                      if (aktion.oeffnet === 'fernbedienung' && aktion.id) {
                        setRemoteFuer(aktion.id);
                        return;
                      }
                      aktion.befehle.forEach((befehl) =>
                        guardedCommand(befehl.entityId, befehl.command)
                      );
                    }}
                    scenes={szenenFuerKachel(scenes, entities, tile.name)}
                    onScene={activateScene}
                    knoepfeAuswahl={prefs.raumKnoepfe?.[tile.name]}
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
              {/* Temperatur und Faktenzeile stehen jetzt oben im
                  Raumkopf (raumBuehne) - hier bleiben die übrigen
                  Messwerte als Chips und die aufgeklappte Fühlerkarte. */}
              {messwerte.length > 0 || klima ? (
                <View style={styles.raumKopf}>
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
                    // Auch der Klimafühler klappt hier auf - er steht
                    // zwar gross im Kopf, seine Karte (Verlauf) gehört
                    // aber zu den anderen Fühlern.
                    const auf = [
                      ...messwerte,
                      ...(klima ? [klima.fuehler] : []),
                    ].find((fuehler) => fuehler.id === expanded);
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
                section === 'home' && room !== ALL_ROOMS && room !== NO_ROOM ? room : null,
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
      <View
        style={styles.root}
        onTouchStart={() => setLastTouch(Date.now())}
        {...zurueckWischen}
      >
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

          {/* Der Ortswechsel als Bewegung: Beim Sprung von «Räume» zu
              «Licht» oder in ein Zimmer blendet die Seite kurz auf und
              kommt ein Stück von unten. Aus dem Umschalten wird ein
              Gehen - und wer weniger Bewegung eingestellt hat, bekommt
              keine (components/Auftritt.tsx). */}
          <Auftritt schluessel={`${section}:${room}`} style={styles.scroll}>
          <ScrollView
            ref={blatt}
            style={styles.scroll}
            contentContainerStyle={styles.content}
            showsVerticalScrollIndicator={false}
            // Während eine Kachel am Finger hängt, darf die Seite nicht
            // mitscrollen: Sonst wandert der Inhalt unter der Kachel weg,
            // sie bleibt scheinbar an ihrem Platz kleben, und beim
            // Loslassen landet sie dort, wo sie war.
            scrollEnabled={!drag}
          >
            {ausfall && entities.length > 0 ? (
              // Getrennt, aber wir haben den letzten Stand: lieber alte Werte
              // mit deutlichem Hinweis als eine leere Seite. Geschaltet wird
              // trotzdem nicht - die Befehle liefen ins Leere.
              //
              // Erst nach der Gnadenfrist (hooks/useAusfall.ts): Beim
              // Aufwachen verbindet die App grundsätzlich neu, und der
              // Balken schob dabei jedes Mal die Seite nach unten und
              // beim Verschwinden wieder hoch - der erste Tipp traf den
              // Inhalt im Sprung. Den Verbindungsstand selbst zeigt
              // derweil die Kopfzeile.
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
                      lernLog: prefs.einkaufLernen,
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
                // Auf der Startseite wird die Kopfzeile zur gerahmten
                // Begrüssungskarte - gleiche Angaben, gleiche Fenster,
                // nur als Karte. Begrüssung und Randnotizen ziehen mit
                // hinein.
                karte={section === 'start'}
                gruss={begruessung(settings, user, now)}
                // Nur die laufenden Geräte - der Türhinweis stünde
                // doppelt da, der Chip «offen» in der Karte sagt es schon.
                zusatz={
                  section === 'start' ? (
                    <RunningAppliances entities={entities} />
                  ) : undefined
                }
                onKalender={
                  section === 'start'
                    ? (art) => setKalenderSignal((s) => ({ art, n: s.n + 1 }))
                    : undefined
                }
              />
            </Auffangnetz>

            {/* Auf einer Einstellungsseite steht statt der Begrüssung ihr
                Name - und der Name ist der Wechsler
                (components/einstellungen/Kopf.tsx). «Guten Abend, Stefan»
                über den Integrationen war siebzig Punkte Höhe für etwas,
                das beim Einrichten niemand braucht. Zweispaltig bleibt
                alles wie es war: Dort steht das Menü ohnehin daneben. */}
            {/* Im Zimmer keine Begrüssung: «Guten Abend, Stefan» über dem
                Raumnamen war siebzig Punkte Höhe für etwas, das man beim
                Betreten der Startseite schon gelesen hat. */}
            {einstellungsKopf ??
              (section === 'start' || (section === 'home' && room !== ALL_ROOMS) ? null : (
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
              ))}

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
                      const trennt = adminPunkte.length > 0 && index === hausPunkte.length;
                      return (
                        <React.Fragment key={item.key}>
                          {trennt ? (
                            <Text style={styles.settingsRailGruppe}>Administrator</Text>
                          ) : null}
                          <Pressable
                            onPress={() => geheZuPunkt(item.key)}
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
          </Auftritt>
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

        {/* Nur am Wandpanel (lib/klingel.ts: vollbildZeigen). Auf dem
            Telefon reisst dasselbe Vollbild einem die App unter der Hand
            weg - dort tut es die Nachricht. */}
        {klingelt &&
        (vollbildZeigen({
          panel: settings.panel,
          ringKey,
          weggewischt: dismissedRing,
        }) ||
          getippteKlingel !== undefined) ? (
          <DoorbellOverlay
            ausloeser={klingelt}
            camera={klingelKamera}
            aktionen={klingelWege}
            settings={settings}
            onCommand={(entityId, command) => guardedCommand(entityId, command)}
            doorConfirm={prefs.doorConfirm}
            onDismiss={() => {
              setDismissedRing(ringKey);
              setKlingelTap(null);
            }}
            colors={colors}
            styles={styles}
          />
        ) : null}

        {/* Das Blatt hinter dem Titel einer Einstellungsseite: alles
            untereinander, gruppiert, der offene mit Haken - statt einer
            Pillenzeile, in der zwölf von fünfzehn Punkten hinter dem
            rechten Rand lagen. */}
        {wechselOffen ? (
          <Wechselblatt
            punkte={sichtbarePunkte}
            aktiv={section}
            onWahl={(key) => {
              setWechselOffen(false);
              geheZuPunkt(key);
            }}
            onSchliessen={() => setWechselOffen(false)}
          />
        ) : null}

        {erinnernAn ? (
          <Erinnerungsblatt
            entity={erinnernAn}
            onWahl={(minuten) => {
              hub
                .post(
                  `/api/entities/${encodeURIComponent(erinnernAn.id)}/erinnern`,
                  { minutes: minuten },
                  { fallback: null }
                )
                .then(() => setNote(fristSatz(minuten)))
                .catch(() => {});
              setErinnernAn(null);
            }}
            onSchliessen={() => setErinnernAn(null)}
          />
        ) : null}

        {pushBlatt ? (
          <PushBlatt
            titel={pushBlatt.titel}
            text={pushBlatt.text}
            knoepfe={pushBlatt.knoepfe}
            onDruck={(knopf) => {
              if (knopf.scene) activateScene(knopf.scene);
              else if (knopf.entity && knopf.command) {
                guardedCommand(knopf.entity, knopf.command);
              }
            }}
            onSchliessen={() => setPushBlatt(null)}
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

        {/* Das Foto eines Zimmers – hinter dem langen Druck auf die
            Raumkachel. Der Hub schickt den neuen Bildstand gleich mit
            zurück; ein zweiter Abruf wäre nur eine zweite Gelegenheit,
            veraltet zu sein. */}
        <Raumbild
          room={bildFuer}
          settings={settings}
          hatBild={!!bildFuer && !!raumbilder[bildFuer]}
          onClose={() => setBildFuer(null)}
          onChanged={setRaumbilder}
          // Nur anbieten, was der Raum hergibt: Ein Chip «Storen» in
          // einem Raum ohne Storen wäre ein Schalter ohne Draht.
          knoepfe={
            bildFuer
              ? raumaktionen(entities.filter((entity) => entity.room === bildFuer)).map(
                  (aktion) => ({ art: aktion.art, label: aktion.label })
                )
              : []
          }
          // Und daneben jedes schaltbare Gerät des Raums einzeln - so
          // kommt auch ein Knopf auf die Kachel, den es als Sammelknopf
          // nicht gibt («Sternenhimmel» in Levins Zimmer).
          geraete={
            bildFuer
              ? waehlbareGeraete(
                  entities.filter((entity) => entity.room === bildFuer)
                ).map((aktion) => ({ art: aktion.id ?? aktion.art, label: aktion.label }))
              : []
          }
          auswahl={bildFuer ? prefs.raumKnoepfe?.[bildFuer] : undefined}
          onAuswahl={(arts) => {
            if (bildFuer) setRaumKnoepfe(bildFuer, arts);
          }}
        />

        {confirm ? (
          <LockConfirm
            entity={confirm.entity}
            command={confirm.command}
            gesperrt={locked.includes(confirm.entity.id)}
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
        {/* Die Fernbedienung zum Knopf «Fernseher» auf einer Raumkachel.
            Dieselbe wie auf der Gerätekachel - eine zweite Fassung
            liefe früher oder später auseinander. */}
        {remoteTv ? (
          <TvRemote
            visible
            name={remoteTv.name}
            onClose={() => setRemoteFuer(null)}
            onCommand={(command, data) => guardedCommand(remoteTv.id, command, data)}
            apps={remoteTv.commands.includes('launch_app') ? appsOf(remoteTv) : []}
            fehler={error}
            onFehlerWeg={dismissError}
          />
        ) : null}
        {musikBlattRaum ? (
          <MusikBlatt
            raum={musikBlattRaum}
            entities={entities}
            onCommand={(entityId, command, data) =>
              guardedCommand(entityId, command, data)
            }
            onSchliessen={() => setMusikBlattRaum(null)}
          />
        ) : null}
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
