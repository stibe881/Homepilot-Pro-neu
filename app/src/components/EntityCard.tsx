import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import { Image, Pressable, Text, View } from 'react-native';

import Svg, { Polyline } from 'react-native-svg';

import { CommandData, Entity, KalenderEintrag } from '../api/types';
import { Doppelaktion, FENSTER_MS, merkbar } from '../lib/doppeltipp';
import { Reihe, linienPunkte } from '../lib/funkenlinie';
import { offlineSatz } from '../lib/funkstille';
import { uebernahmeZeile, zustandsText } from '../lib/haushalt';
import { KachelEintrag, kachelAktionen } from '../lib/kachelmenue';
import { zustandName } from '../lib/hausmusik';
import { hatWarteschlange } from '../lib/musikliste';
import { lichtkachel } from '../lib/lichtfarbe';
import { szenenfarbe } from '../lib/szenenfarbe';
import { ketteSatz, ursacheSatz } from '../lib/ursache';
import { zaehlbar } from '../lib/zaehlung';
import { useColors } from '../theme';
import { Bar } from './Bar';
import { Card, CardFooter } from './Card';
import { faelltAuf, standZeile } from '../lib/kachelstand';
import { Musikliste } from './Musikliste';
import { ColorRow } from './ColorRow';
import { Sky } from './CoverVisual';
import { isTelevision, zeigtStopp } from '../lib/geraeteart';
import { medienSchalter } from '../lib/medienschalter';
import { musiklisteMoeglich } from '../lib/blattgrund';
import { fernbedienungMoeglich, tvKopf, tvTeile } from '../lib/fernsehkachel';
import { TvApps, appsOf } from './TvApps';
import { TvVolume } from './TvVolume';
import { TvSleep } from './TvSleep';
import { TvRemote } from './TvRemote';
import { TvSteuerkreuz } from './TvSteuerkreuz';
import {
  AnpassenBlatt,
  GroupPicker,
  KachelMenue,
  RenameDialog,
  RoomPicker,
} from './entity/anpassen';
import {
  CameraSnapshot,
  CoverBody,
  KameraKachel,
  GrillBody,
  LockBody,
  VacuumBody,
} from './entity/koerper';
import { Fortschritt } from './entity/Fortschritt';
import { KachelDruck } from './entity/kacheldruck';
import { Wischdimmer } from './entity/wischdimmer';
import { MediaButton, RadioPanel, ShuffleRepeat, SpotifyPanel } from './entity/medien';
import { MedienExtras } from './entity/medienextras';
import { makeStyles } from './entity/stil';
import {
  BigValue,
  Pill,
  clock,
  eventTime,
  format,
  integrationLabel,
  severityColor,
  sinceLabel,
} from './entity/teile';

/** Die kleine Linie unter dem Messwert – Richtung, keine Achsen. */
function Funkenlinie({ reihe, breite }: { reihe: Reihe | undefined; breite: number }) {
  const colors = useColors();
  const punkte = linienPunkte(reihe, Math.max(40, breite), 18);
  if (!punkte) return null;
  return (
    <Svg
      width={Math.max(40, breite)}
      height={18}
      style={{ marginTop: 4 }}
      accessibilityLabel="Verlauf der letzten Stunden"
    >
      <Polyline
        points={punkte}
        fill="none"
        stroke={colors.accent}
        strokeWidth={2}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </Svg>
  );
}

interface Props {
  entity: Entity;
  /** Die letzten Stunden des Messwerts – [Unix-Sekunden, Wert]. */
  trend?: Reihe;
  /** Die gemerkte Doppeltipp-Aktion dieses Geräts (lib/doppeltipp.ts). */
  doppelAktion?: Doppelaktion | null;
  /** Beschriftung fürs Kachelmenü («Doppeltipp merken: 40 %»). */
  doppelLabel?: string | null;
  /** Merken bzw. vergessen - null heisst vergessen. */
  onDoppeltipp?: (aktion: Doppelaktion | null) => void;
  /** «Sag mir später Bescheid» – ohne diesen Griff gibt es den Eintrag
   *  im Kachelmenü nicht. */
  onErinnern?: () => void;
  width: number;
  onCommand: (command: string, data?: CommandData) => void;
  /** Kommando unterwegs – die Kachel zeigt das, statt still zu wirken. */
  pending?: boolean;
  /** Die letzte Absage des Hubs. Nur die Fernbedienung braucht sie: Sie
   *  ist ein Modal und deckt das Fehlerband am unteren Rand zu. */
  fehler?: string | null;
  onFehlerWeg?: () => void;
  /** Strompreis für die Kostenanzeige, z.B. 0.32 */
  pricePerKwh?: number;
  currency?: string;
  /** Anpassen-Modus: zeigt Knöpfe für Favorit und Ausblenden. */
  editing?: boolean;
  favorite?: boolean;
  hidden?: boolean;
  onToggleFavorite?: () => void;
  onToggleHidden?: () => void;
  /** Anpassen-Modus: Gerät sperren – schaltet nur nach Rückfrage. */
  locked?: boolean;
  onToggleLocked?: () => void;
  /** Zählt dieses Gerät in der «3 an» der Kopfzeile nicht mit? Umlegen
   *  geht über den langen Druck (siehe lib/zaehlung.ts). */
  ungezaehlt?: boolean;
  onToggleUngezaehlt?: () => void;
  /** Steht die Kachel schon unter der Überschrift ihres Zimmers, ist der
   *  Raumname auf ihr eine Wiederholung. Dann tritt die Integration an
   *  seine Stelle – die sagt wenigstens etwas Neues. */
  imRaumblock?: boolean;
  /** Anpassen-Modus: Raum dieser Kachel setzen. */
  rooms?: string[];
  onSetRoom?: (room: string | null) => void;
  /** Gerät umbenennen – im Anpassen-Modus über den Stift, sonst über
   *  einen langen Druck auf die Kachel.
   *
   *  Gesetzt nur, wo es auch erlaubt ist: Der Name gilt fürs ganze Haus,
   *  der Hub verlangt dafür `edit_config`. Wer die Fähigkeit nicht hat,
   *  bekommt hier nichts – besser als ein Knopf, der ein «nicht erlaubt»
   *  einträgt. */
  onRename?: (name: string) => void;
  /** Anpassen-Modus: Gerät einer Gruppe zuordnen (oder lösen). */
  groups?: string[];
  onSetGroup?: (group: string | null) => void;
  /** Fragt die Türe vor dem Öffnen nach? Haushaltsweite Einstellung;
   *  fehlt sie, wird gefragt (siehe lib/tuerbestaetigung.ts). */
  doorConfirm?: boolean;
  /** Sensorkacheln lassen sich antippen und zeigen dann ihren Verlauf. */
  onPress?: () => void;
  /** Langes Drücken: Vorschau mit Verlauf – überall, nicht nur unter
   *  Geräte. «Warum ging das um drei Uhr an?» stellt sich dort, wo man
   *  die Kachel sieht. */
  onLongPress?: () => void;
  chart?: React.ReactNode;
  /** Kamerakacheln: URL des Schnappschuss-Endpunkts (inkl. Token). */
  snapshotUri?: string;
  /** Storen-Kacheln: aktuelle Wetterlage für den Himmel hinter dem Fenster. */
  sky?: Sky;
  /** Name der zusammengefassten Leuchte, in der dieses Licht aufgeht.
   *
   *  Unter Geräte ist ein solcher Spot sonst nicht von einer einzelnen
   *  Lampe zu unterscheiden – und man wundert sich, warum er im Raum
   *  fehlt und beim Schalten der Leuchte mitgeht. */
  partOf?: string | null;
  /** «in 2 Abläufen und 1 Szene» – antippbar, führt zu den Abläufen.
   *  Nur auf der Geräteseite gesetzt: Wer vor einer Lampe steht, die von
   *  selbst angeht, soll den Urheber finden, ohne alles durchzulesen. */
  usedIn?: string;
  onUsedIn?: () => void;
}

/** Warnstufen brauchen je nach Palette andere Farben. */
export function EntityCard({
  entity,
  trend,
  doppelAktion,
  doppelLabel,
  onDoppeltipp,
  width,
  onCommand,
  pending,
  fehler,
  onFehlerWeg,
  pricePerKwh,
  currency = 'CHF',
  editing,
  favorite,
  hidden,
  onToggleFavorite,
  onToggleHidden,
  locked,
  onToggleLocked,
  ungezaehlt,
  onToggleUngezaehlt,
  imRaumblock,
  rooms,
  onSetRoom,
  onRename,
  groups,
  onSetGroup,
  doorConfirm,
  onPress,
  onLongPress,
  chart,
  snapshotUri,
  sky,
  partOf,
  usedIn,
  onUsedIn,
  onErinnern,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [remoteOpen, setRemoteOpen] = useState(false);
  // Helligkeit unter dem Finger, solange über die Kachel gestrichen wird
  // (components/entity/wischdimmer.tsx). null heisst: der Hub führt.
  const [wischWert, setWischWert] = useState<number | null>(null);
  // Nach einem Streichen kommt trotzdem noch ein Druck an: Die Geste
  // wurde dem Schalter darunter zwar weggenommen, aber er meldet beim
  // Loslassen dennoch einen Tipp - im Browser gemessen, die Lampe ging
  // nach dem Dimmen sofort wieder aus. Diese Fahne verschluckt genau
  // diesen einen Druck.
  const gewischt = useRef(false);
  // Was als Nächstes läuft – hinter Cover und Titel der Musikkachel.
  const [listeOffen, setListeOffen] = useState(false);
  const [roomPickerOpen, setRoomPickerOpen] = useState(false);
  const [blattOffen, setBlattOffen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [menueOffen, setMenueOffen] = useState(false);
  const [groupPickerOpen, setGroupPickerOpen] = useState(false);
  const isOn = entity.state.state === 'on';


  // Was ein langer Druck anbietet. Im Anpassen-Modus nichts: Dort hält
  // dieselbe Geste die Kachel zum Verschieben fest, und die Knöpfe für
  // Name, Raum und Gruppe stehen ohnehin offen auf der Kachel.
  const aktionen = editing
    ? []
    : kachelAktionen({
        umbenennen: Boolean(onRename),
        // Dieselbe Berechtigung wie beim Umbenennen: Die Sperre gilt fürs
        // ganze Haus, und der Hub führt sie in den Haus-Einstellungen.
        sperren: Boolean(onRename && onToggleLocked),
        gesperrt: Boolean(locked),
        // Nur Licht und Schalter: Etwas anderes zählt die Kopfzeile nicht.
        zaehlung: Boolean(onToggleUngezaehlt) && zaehlbar(entity),
        ungezaehlt: Boolean(ungezaehlt),
        verlauf: Boolean(onLongPress),
        erinnern: Boolean(onErinnern),
        // Nur wo es etwas zu merken gibt und wer schalten darf.
        doppeltipp: onDoppeltipp ? doppelLabel : null,
      });
  const fuehreAus = (eintrag: KachelEintrag) => {
    setMenueOffen(false);
    if (eintrag.id === 'umbenennen') setRenameOpen(true);
    if (eintrag.id === 'sperren') onToggleLocked?.();
    if (eintrag.id === 'zaehlung') onToggleUngezaehlt?.();
    if (eintrag.id === 'verlauf') onLongPress?.();
    if (eintrag.id === 'erinnern') onErinnern?.();
    if (eintrag.id === 'doppeltipp') {
      // Steht schon dasselbe gemerkt, ist der Eintrag das Vergessen -
      // die Beschriftung sagt es, und lib/doppeltipp entscheidet es.
      onDoppeltipp?.(
        doppelLabel?.startsWith('Doppeltipp (') ? null : merkbar(entity)
      );
    }
  };

  // Ein Eintrag braucht keine Auswahl - eine Liste mit einer Zeile wäre
  // ein Klick mehr für nichts. Für alle, die nicht umbenennen dürfen,
  // bleibt der lange Druck damit genau das, was er war.
  const langerDruck =
    aktionen.length === 0
      ? undefined
      : aktionen.length === 1
        ? () => fuehreAus(aktionen[0])
        : () => setMenueOffen(true);

  // Was auf der Kachel steht und was das Blatt anbietet, kommt aus
  // derselben Quelle - sonst sagt die Zeile «Favorit» und im Blatt ist
  // der Stern leer.
  const stand = {
    room: entity.room,
    group: entity.group,
    favorite,
    hidden,
    locked,
    ungezaehlt,
  };

  const subtitle =
    (imRaumblock ? undefined : entity.room) || integrationLabel(entity.integration);
  // Offline-Geräte: mit «zuletzt vor …», damit man sieht, ob das Gerät
  // gerade eben oder seit Tagen weg ist. Bei einer Store am Funk steht
  // dort zusätzlich, dass Drücken trotzdem etwas bewirkt - siehe
  // lib/funkstille.ts.
  const offlineText = offlineSatz(
    entity,
    entity.last_seen ? sinceLabel(entity.last_seen) : null
  );
  /**
   * Kacheln, die selbst der Knopf sind und ihren Namen selbst tragen.
   *
   * Bei ihnen ist die Fläche die Bedienung, und eine Fusszeile mit
   * demselben Namen darunter wäre ein zweiter Ort für dieselbe Auskunft.
   * Im Anpassen-Modus gilt das nicht: Dort geht es nicht ums Bedienen,
   * und der Name muss neben den Einstellungen stehen bleiben.
   */
  const szeneKachel =
    entity.kind === 'scene' && !editing ? szenenfarbe(entity.name) : null;
  const lichtKachel =
    entity.kind === 'light' && !editing
      ? lichtkachel(entity.state as Record<string, unknown>)
      : null;
  // Die Kamera trägt Namen und Zeit im Bild - aber nur, solange sie
  // eines liefert. Ohne Bild (offline, Privatsphäre) bleibt der alte
  // Aufbau samt Fusszeile.
  const kameraVoll =
    entity.kind === 'camera' &&
    !editing &&
    !!snapshotUri &&
    entity.state.state === 'online' &&
    entity.state.privacy !== 'on';
  const eigenerName =
    !!szeneKachel || (entity.kind === 'light' && !editing) || kameraVoll;
  /**
   * Der Knopf unten rechts bedeutet auf jeder Kachel «ein/aus» - nur
   * auf der Musikbox tat er bisher etwas anderes.
   *
   * Bei einer Box ist `toggle` nämlich Play/Pause. Der Knopf stand
   * damit immer auf «aus» (eine Box meldet nie `state: on`) und hielt
   * beim Drücken die Sitzung bloss an: Der Empfänger blieb besetzt, und
   * vom Telefon aus weckte ihn jeder Handgriff wieder auf. Also bekommt
   * die Box hier ihren eigenen Schalter (lib/medienschalter.ts).
   *
   * Der Fernseher behält `toggle` - bei ihm ist das wirklich der
   * Netzschalter (siehe lib/fernsehkachel.ts).
   */
  const istBox = entity.kind === 'media_player' && !isTelevision(entity);
  const boxSchalter = istBox
    ? medienSchalter(entity.state.state, entity.commands)
    : null;
  const toggle = istBox
    ? boxSchalter
      ? () => onCommand(boxSchalter.command)
      : undefined
    : entity.commands.includes('toggle')
      ? () => onCommand('toggle')
      : undefined;

  /**
   * Der zweite Tipp auf den Ein/Aus-Knopf legt die gemerkte
   * Einstellung darüber (lib/doppeltipp.ts).
   *
   * Der erste Tipp schaltet dabei sofort - er wartet nicht darauf, ob
   * noch ein zweiter kommt. Eine Kachel, die 350 ms zögert, fühlt sich
   * im ganzen Haus träge an, und das wäre ein hoher Preis für eine
   * Abkürzung.
   */
  const letzterTipp = useRef(0);
  const toggleMitDoppeltipp = toggle
    ? () => {
        const jetzt = Date.now();
        const doppelt = jetzt - letzterTipp.current < FENSTER_MS;
        letzterTipp.current = jetzt;
        if (doppelt && doppelAktion) {
          onCommand(doppelAktion.command, doppelAktion.data);
          return;
        }
        toggle();
      }
    : undefined;

  /** Leistung und, wenn ein Preis hinterlegt ist, die Tageskosten. */
  const powerNote = (): string | undefined => {
    const parts: string[] = [];
    if (entity.state.power != null) {
      parts.push(`${entity.state.power} W`);
    }
    if (entity.state.energy_today != null && pricePerKwh) {
      const cost = Number(entity.state.energy_today) * pricePerKwh;
      parts.push(`heute ${cost.toFixed(2)} ${currency}`);
    }
    return parts.length ? parts.join(' · ') : undefined;
  };

  const body = () => {
    switch (entity.kind) {
      case 'light': {
        // Die Kachel IST der Schalter: ein Tipp irgendwo darauf schaltet,
        // und solange Licht brennt, trägt sie dessen Farbe
        // (lib/lichtfarbe.ts). Vorher stand hier eine Vorschaufläche, die
        // ausgerechnet dann leer war, wenn das Licht aus ist - 78 Punkte
        // Höhe für nichts -, und der Schaltknopf saas 34 Punkte gross in
        // der Ecke, obwohl er die Hauptsache ist.
        //
        // Die Farbreihe steht auch bei ausgeschaltetem Licht da: Ein Tipp
        // darauf schaltet ein und stellt die Farbe in einem Zug – so
        // gedacht ist es beim Sternenprojektor am Abend.
        const farben = entity.commands.includes('set_color') ? (
          <ColorRow entity={entity} onCommand={onCommand} />
        ) : null;
        const dimmbar = entity.commands.includes('set_brightness');
        // Während des Streichens gilt der Wert unter dem Finger: Sonst
        // zieht man ins Blinde, bis der Hub geantwortet hat.
        const helligkeit =
          wischWert ?? Math.round(Number(entity.state.brightness ?? 100));
        const tinte = lichtKachel ? lichtKachel.tinte : colors.ink;
        return (
          <View style={styles.stack}>
            {/* Quer über die Kachel streichen dimmt - auch von «aus»
                aus. Der Regler darunter erscheint erst, wenn Licht
                brennt; eine ausgeschaltete Lampe auf 30 % zu bringen
                kostete vorher drei Griffe, und der erste blendet. */}
            <Wischdimmer
              aktiv={dimmbar && entity.available}
              // Aus heisst: bei null anfangen. Sonst hätte eine
              // ausgeschaltete Lampe, die sich 100 % gemerkt hat, nach
              // oben keinen Weg mehr - und genau «aus auf 30 %» ist der
              // Griff, für den es die Geste gibt.
              wert={isOn ? Math.round(Number(entity.state.brightness ?? 100)) : 0}
              onDimmen={(ziel) => {
                gewischt.current = true;
                setWischWert(ziel);
              }}
              onFertig={(ziel) => {
                setWischWert(null);
                onCommand('set_brightness', { brightness: ziel });
                // Sicherheitsnetz: Bleibt der Druck aus (so verhält es
                // sich nativ), soll die Fahne nicht den nächsten
                // echten Tipp verschlucken.
                setTimeout(() => {
                  gewischt.current = false;
                }, 350);
              }}
            >
            <Pressable
              onPress={() => {
                if (gewischt.current) {
                  gewischt.current = false;
                  return;
                }
                toggleMitDoppeltipp?.();
              }}
              accessibilityRole="switch"
              accessibilityState={{ checked: isOn, busy: !!pending }}
              accessibilityLabel={`${entity.name} ${isOn ? 'ausschalten' : 'einschalten'}`}
              style={({ pressed }) => [styles.lichtFlaeche, pressed && { opacity: 0.7 }]}
            >
              <View style={styles.lichtKopf}>
                <Ionicons
                  name={isOn ? 'bulb' : 'bulb-outline'}
                  size={22}
                  color={isOn ? tinte : colors.inkSoft}
                />
                <View
                  style={[
                    styles.lichtPunkt,
                    { backgroundColor: isOn ? colors.on : colors.off },
                  ]}
                />
              </View>
              <View>
                <Text
                  style={[
                    styles.lichtWert,
                    { color: isOn ? tinte : colors.inkSoft },
                  ]}
                >
                  {!entity.available
                    ? '–'
                    : // Während des Streichens steht dort, wohin es geht -
                      // auch wenn die Lampe noch aus ist.
                      wischWert !== null
                      ? `${wischWert} %`
                      : isOn
                        ? dimmbar
                          ? `${helligkeit} %`
                          : 'An'
                        : 'Aus'}
                </Text>
                <Text
                  numberOfLines={2}
                  style={[styles.lichtName, { color: isOn ? tinte : colors.ink }]}
                >
                  {entity.name}
                </Text>
                <Text
                  numberOfLines={1}
                  style={[styles.lichtUnter, { color: isOn ? tinte : colors.inkSoft }]}
                >
                  {pending
                    ? 'wird geschaltet …'
                    : entity.available
                      ? subtitle
                      : offlineText}
                </Text>
              </View>
            </Pressable>
            </Wischdimmer>
            {/* Dimmen bleibt auf der Kachel, solange Licht brennt: Es ist
                der zweithäufigste Griff am Licht, und ihn in die
                Detailansicht zu schieben wäre ein schlechter Tausch. Aus
                braucht es den Balken nicht - dann ist die Kachel kurz. */}
            {dimmbar && isOn ? (
              <Bar
                value={helligkeit}
                height={26}
                // Weiss auf der Lichtfarbe: Der Balken lag vorher in
                // genau dem Ton der Kachel und war damit unsichtbar -
                // mehr Weiss heisst heller, das liest sich von selbst.
                gradient={
                  lichtKachel
                    ? ['rgba(255,255,255,0.95)', 'rgba(255,255,255,0.7)']
                    : undefined
                }
                onChange={(value) => onCommand('set_brightness', { brightness: value })}
              />
            ) : null}
            {farben}
          </View>
        );
      }

      case 'switch':
        return <BigValue value={isOn ? 'An' : 'Aus'} on={isOn} note={powerNote()} />;

      // Der Einschlaf-Timer des Fernsehers als eigene Kachel: dieselbe
      // Bedienung wie in der Fernsehkachel, nur ohne den Fernseher drum
      // herum. Der Hub spiegelt den Timer auf beide.
      case 'timer':
        return <TvSleep entity={entity} onCommand={onCommand} />;

      case 'binary_sensor': {
        // Tür-/Fensterkontakte sagen offen/geschlossen, Bewegungsmelder
        // aktiv/ruhig – „aktiv" an einer Tür würde niemand verstehen.
        const contact = entity.state.device_class === 'contact';
        const battery = entity.state.battery;
        return (
          <View style={styles.stack}>
            <Pill
              label={contact ? (isOn ? 'Offen' : 'Geschlossen') : isOn ? 'Aktiv' : 'Ruhig'}
              tone={isOn ? (contact ? colors.warn : colors.on) : undefined}
              solid={contact && isOn}
            />
            {typeof battery === 'number' ? (
              <Text style={styles.detail}>
                Batterie {Math.round(battery)} %{battery <= 15 ? ' – schwach!' : ''}
              </Text>
            ) : null}
          </View>
        );
      }

      case 'sensor':
        return (
          <View>
            <BigValue
              value={`${format(entity.state.state)}${
                entity.state.unit ? ' ' + entity.state.unit : ''
              }`}
            />
            {/* Die letzten Stunden als Linie: Die Zahl sagt «21.5», die
                Linie sagt, wohin es geht (lib/funkenlinie.ts). Ohne
                Reihe fehlt sie einfach - nach einem Neustart des Hubs
                füllt sie sich wieder. */}
            <Funkenlinie reihe={trend} breite={width - 36} />
          </View>
        );

      case 'media_player': {
        const playing = entity.state.state === 'playing';
        const fernseher = isTelevision(entity);
        // Beim Fernseher entscheidet der gemeldete Zustand, was überhaupt
        // dasteht - siehe lib/fernsehkachel.ts. Für eine Musikbox bleibt
        // alles, wie es war.
        const teile = tvTeile(entity);
        const kopf = fernseher ? tvKopf(entity) : null;
        const hasRemote = fernseher ? teile.fernbedienung : entity.commands.includes('dpad_up');
        const cover = entity.state.image ? String(entity.state.image) : null;
        return (
          <View style={styles.stack}>
            {/* Das Cover als Grund der Kachel - blass, damit der Text
                lesbar bleibt. Eine Musikkachel, die aussieht wie das
                Album, findet man mit einem Blick; eine, die aussieht wie
                jede andere, muss man lesen. */}
            {cover && playing ? (
              <Image
                source={{ uri: cover }}
                style={styles.coverGrund}
                blurRadius={18}
                accessibilityIgnoresInvertColors
              />
            ) : null}
            {/* Cover und Titel öffnen, was als Nächstes kommt – wie in
                der grossen Karte in der Seitenspalte. */}
            <Pressable
              onPress={
                hatWarteschlange(entity.state) ? () => setListeOffen(true) : undefined
              }
              accessibilityRole={hatWarteschlange(entity.state) ? 'button' : undefined}
              accessibilityLabel={
                hatWarteschlange(entity.state) ? 'Was als Nächstes läuft' : undefined
              }
              style={({ pressed }) => [styles.nowPlayingRow, pressed && { opacity: 0.75 }]}
            >
              {entity.state.image ? (
                <Image
                  source={{ uri: String(entity.state.image) }}
                  style={styles.coverArt}
                  accessibilityIgnoresInvertColors
                />
              ) : null}
              <View style={{ flex: 1 }}>
                <Text style={styles.value} numberOfLines={2}>
                  {/* Ohne Titel den Zustand nennen: «Pausiert» und
                      «Nichts an» sind zwei verschiedene Auskünfte, und
                      «Nichts läuft» war für beide dieselbe. */}
                  {kopf
                    ? kopf.text
                    : (entity.state.track ??
                      zustandName(String(entity.state.state ?? '')))}
                </Text>
                {kopf?.unter ? (
                  <Text style={styles.hint} numberOfLines={1}>
                    {kopf.unter}
                  </Text>
                ) : null}
                {!kopf && entity.state.artist ? (
                  <Text style={styles.hint} numberOfLines={1}>
                    {entity.state.artist}
                    {entity.state.device ? ` · ${entity.state.device}` : ''}
                  </Text>
                ) : null}
              </View>
              {hatWarteschlange(entity.state) ? (
                <Ionicons name="list-outline" size={16} color={colors.inkFaint} />
              ) : null}
            </Pressable>
            <Fortschritt entity={entity} onCommand={onCommand} />
            <MedienExtras entity={entity} onCommand={onCommand} />
            {fernseher ? teile.lautstaerke && <TvVolume entity={entity} onCommand={onCommand} /> : null}
            {/* Beim Fernseher steht statt der drei Transportknöpfe das
                Steuerkreuz: «weiter» springt je nach App irgendwohin, und
                ob etwas läuft, meldet ein Android TV ohnehin nie -
                navigieren ist, was man tut. Bei einer Musikbox bleibt
                alles, wie es war: Dort heisst «weiter» nächster Titel,
                und das ist genau richtig. */}
            {fernseher && teile.fernbedienung ? (
              <TvSteuerkreuz
                onCommand={onCommand}
                onMehr={hasRemote ? () => setRemoteOpen(true) : undefined}
                // Wo schon ein Schieber steht, wären zwei Tasten daneben
                // ein zweiter Weg zum selben Ziel.
                lautstaerke={!teile.lautstaerke && !entity.commands.includes('set_volume')}
              />
            ) : (fernseher ? teile.transport : entity.commands.includes('next')) ? (
              <View style={styles.mediaRow}>
                <MediaButton
                  icon="play-skip-back"
                  label="Zurück"
                  onPress={() => onCommand('previous')}
                />
                <MediaButton
                  icon={playing ? 'pause' : 'play'}
                  // Der Fernseher meldet nie, ob gerade etwas läuft - die
                  // Taste schickt in beiden Fällen dasselbe an ihn
                  // (KEYCODE_MEDIA_PLAY_PAUSE). Also heisst sie auch so,
                  // statt «Abspielen» zu behaupten.
                  label={fernseher ? 'Wiedergabe/Pause' : playing ? 'Pause' : 'Abspielen'}
                  onPress={() => onCommand(playing ? 'pause' : 'play')}
                />
                {/* Stopp, wo eine Sitzung auf der Box steht: Pause hält
                    nur an und lässt die Box besetzt (lib/geraeteart,
                    zeigtStopp). Der Fernseher hat dafür schon seinen
                    An/Aus-Knopf auf der Kachel. */}
                {!fernseher && zeigtStopp(entity) ? (
                  <MediaButton
                    icon="stop"
                    label="Stopp – Wiedergabe beenden"
                    onPress={() => onCommand('turn_off')}
                  />
                ) : null}
                <MediaButton
                  icon="play-skip-forward"
                  label="Weiter"
                  onPress={() => onCommand('next')}
                />
                {hasRemote ? (
                  <MediaButton
                    icon="game-controller-outline"
                    label="Fernbedienung"
                    onPress={() => setRemoteOpen(true)}
                  />
                ) : null}
              </View>
            ) : null}
            <ShuffleRepeat entity={entity} onCommand={onCommand} />
            {/* Vor der Fernbedienung: «Zattoo oder Plex» ist die Frage,
                die man einer Fernsehkachel stellt - das Steuerkreuz
                braucht man erst danach. */}
            {entity.commands.includes('launch_app') ? (
              <TvApps entity={entity} onCommand={onCommand} />
            ) : null}
            {(fernseher ? teile.timer : entity.commands.includes('sleep_timer')) ? (
              <TvSleep entity={entity} onCommand={onCommand} />
            ) : null}
            {entity.commands.includes('set_volume') ? (
              <View style={styles.volumeRow}>
                <Pressable
                  onPress={() => onCommand('mute')}
                  hitSlop={8}
                  accessibilityLabel="Stumm schalten"
                >
                  <Ionicons
                    name={
                      entity.state.muted || entity.state.volume === 0
                        ? 'volume-mute'
                        : 'volume-low'
                    }
                    size={20}
                    color={entity.state.muted ? colors.accent : colors.inkSoft}
                  />
                </Pressable>
                <View style={styles.volumeBar}>
                  <Bar
                    height={28}
                    value={
                      typeof entity.state.volume === 'number' ? entity.state.volume : 0
                    }
                    onChange={(value) => onCommand('set_volume', { volume: value })}
                  />
                </View>
                <Ionicons name="volume-high" size={20} color={colors.inkSoft} />
              </View>
            ) : null}
            {entity.commands.includes('play_playlist') ? (
              <SpotifyPanel entity={entity} onCommand={onCommand} />
            ) : null}
            {entity.commands.includes('play_radio') ? (
              <RadioPanel entity={entity} onCommand={onCommand} />
            ) : null}
            {/* Die schlichte Boxenzeile nur, wo keines der beiden Panels
                steht – die bringen ihre eigene mit, und zwei Reihen
                derselben Boxen untereinander sind eine zu viel. */}
            {!entity.commands.includes('play_playlist') &&
            !entity.commands.includes('play_radio') &&
            entity.commands.includes('play_on') &&
            Array.isArray(entity.state.devices) &&
            entity.state.devices.length > 0 ? (
              <View style={styles.deviceRow}>
                {entity.state.devices.map((name: string) => {
                  const active = name === entity.state.device;
                  return (
                    <Pressable
                      key={name}
                      onPress={() =>
                        active ? undefined : onCommand('play_on', { device: name })
                      }
                      style={[styles.deviceChip, active && styles.deviceChipActive]}
                    >
                      <Ionicons
                        name={active ? 'volume-high' : 'volume-medium-outline'}
                        size={12}
                        color={active ? '#FFFFFF' : colors.inkSoft}
                      />
                      <Text
                        style={[
                          styles.deviceChipText,
                          active && styles.deviceChipTextActive,
                        ]}
                        numberOfLines={1}
                      >
                        {name}
                      </Text>
                    </Pressable>
                  );
                })}
              </View>
            ) : null}
          </View>
        );
      }

      case 'camera': {
        const online = entity.state.state === 'online';
        const privacyOn = entity.state.privacy === 'on';
        // Mit Bild füllt es die Kachel und trägt Namen und letzte
        // Bewegung darauf; ohne Bild bleibt der bisherige Aufbau
        // (entity/koerper.tsx, KameraKachel).
        const klassisch = (
          <View style={styles.stack}>
            {snapshotUri && online ? (
              <CameraSnapshot
                uri={snapshotUri}
                // Neue Bewegung oder Klingeln holt sofort ein frisches Bild.
                refreshKey={`${entity.state.last_motion ?? ''}|${entity.state.last_ring ?? ''}`}
                // Kacheln zeigen Standbilder: ein Livestrom je Kamera
                // gleichzeitig wäre für den Hub zu viel. Dafür öfter als
                // sonst – Bewegtbild gibt es beim Antippen.
                refreshMs={15_000}
              />
            ) : null}
            <Pill
              label={online ? 'Online' : 'Offline'}
              tone={online ? colors.on : colors.danger}
            />
            {privacyOn ? (
              <Pill label="Privatsphäre aktiv" tone={colors.accent} solid />
            ) : null}
            {entity.state.ring === 'on' ? (
              <Pill label="Klingelt" tone={colors.danger} solid />
            ) : null}
            {entity.state.motion === 'on' ? (
              <Pill label="Bewegung" tone={colors.warn} solid />
            ) : null}
            {entity.state.last_motion ? (
              <Text style={styles.detail}>
                Letzte Bewegung {clock(entity.state.last_motion)}
              </Text>
            ) : null}
            {entity.state.last_ring ? (
              <Text style={styles.detail}>
                Zuletzt geklingelt {clock(entity.state.last_ring)}
              </Text>
            ) : null}
            {entity.state.stream && online ? (
              <Text style={styles.detail}>Tippen für Live-Bild</Text>
            ) : null}
            {entity.commands.includes('set_privacy') ? (
              // Bild schwarz, Mikrofon stumm, Aufnahme aus – und alles
              // zurück, wie es war, beim zweiten Tipp.
              <Pressable
                // Web kennt stopPropagation, nativ nicht - deshalb offen
                // getippt und optional aufgerufen.
                // eslint-disable-next-line @typescript-eslint/no-explicit-any
                onPress={(event: any) => {
                  // Nicht die Kachel «Live-Bild öffnen» auslösen.
                  event?.stopPropagation?.();
                  onCommand('set_privacy', { enabled: !privacyOn });
                }}
                accessibilityRole="switch"
                accessibilityState={{ checked: privacyOn }}
                accessibilityLabel="Privatsphäre"
                style={({ pressed }) => [
                  styles.privacyButton,
                  privacyOn && styles.privacyButtonActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons
                  name={privacyOn ? 'eye-off' : 'eye-off-outline'}
                  size={15}
                  color={privacyOn ? '#FFFFFF' : colors.inkSoft}
                />
                <Text style={[styles.privacyText, privacyOn && { color: '#FFFFFF' }]}>
                  {privacyOn ? 'Privatsphäre beenden' : 'Privatsphäre'}
                </Text>
              </Pressable>
            ) : null}
          </View>
        );
        return (
          <KameraKachel
            entity={entity}
            snapshotUri={snapshotUri}
            unterzeile={
              !entity.available
                ? offlineText
                : entity.state.last_motion
                  ? `Bewegung ${clock(entity.state.last_motion)}`
                  : subtitle
            }
            onCommand={onCommand}
            klassisch={klassisch}
          />
        );
      }

      case 'vacuum': {
        const cleaning = entity.state.state === 'cleaning';
        const rooms: { id: number; name: string; box?: number[] }[] = Array.isArray(
          entity.state.rooms
        )
          ? entity.state.rooms
          : [];
        const canCleanRooms = entity.commands.includes('clean_rooms') && rooms.length > 0;
        // Räume mit Kartenkoordinaten → direkt auf der Karte antippbar.
        const mappable = canCleanRooms && rooms.some((room) => Array.isArray(room.box));
        return (
          <VacuumBody
            entity={entity}
            snapshotUri={snapshotUri}
            rooms={rooms}
            mappable={mappable}
            canCleanRooms={canCleanRooms}
            cleaning={cleaning}
            onCommand={onCommand}
          />
        );
      }

      case 'lock':
        return (
          <LockBody
            entity={entity}
            onCommand={onCommand}
            pending={pending}
            doorConfirm={doorConfirm}
          />
        );

      case 'cover':
        return <CoverBody entity={entity} sky={sky} onCommand={onCommand} />;

      case 'calendar': {
        const events: KalenderEintrag[] = entity.state.events ?? [];
        return (
          <View style={styles.stack}>
            <Text style={styles.value} numberOfLines={1}>
              {entity.state.state === 'frei' ? 'Keine Termine' : entity.state.state}
            </Text>
            {entity.state.next_start ? (
              <Text style={styles.hint}>
                {entity.state.next_all_day
                  ? 'ganztägig'
                  : eventTime(entity.state.next_start)}
              </Text>
            ) : null}
            {events.slice(1, 3).map((event, index) => (
              <Text key={index} numberOfLines={1} style={styles.detail}>
                {event.all_day ? '· ' : `${eventTime(event.start)} `}
                {event.summary}
              </Text>
            ))}
          </View>
        );
      }

      case 'appliance':
        // Der Grill ist zwar auch ein Gerät, aber beim Grillen zählt etwas
        // anderes als bei der Spülmaschine: Temperatur, Fühler, Pellets.
        if (entity.integration === 'pitboss') {
          return <GrillBody entity={entity} onCommand={onCommand} />;
        }
        {
          const laeuft = entity.state.state === 'running';
          return (
            <View style={styles.stack}>
              <Pill
                label={zustandsText(entity.state.state)}
                tone={laeuft ? colors.accent : undefined}
              />
              {/* Programm und Restzeit gehören zu einer laufenden
                  Maschine. Eine stillstehende meldet je nach Firmware
                  weiter irgendetwas, und das stand dann unter «Bereit»
                  wie ein Programm, das keines ist. Dieselbe Regel gilt
                  auf der Startseite (lib/haushalt). */}
              {laeuft && entity.state.program ? (
                <Text style={styles.detail}>
                  {entity.state.program}
                  {entity.state.program_end ? ` · noch ${entity.state.program_end}` : ''}
                </Text>
              ) : null}
              {/* «Bine räumt aus» – damit niemand ein zweites Mal
                  hinuntergeht und niemand annimmt, es tue schon ein
                  anderer (hub/core/waschkueche.py). */}
              {uebernahmeZeile(entity) ? (
                <Text style={styles.detail}>{uebernahmeZeile(entity)}</Text>
              ) : null}
            </View>
          );
        }

      case 'alert': {
        const count = entity.state.count ?? 0;
        const severity = entity.state.max_severity;
        const alerts: Record<string, string | undefined>[] = entity.state.alerts ?? [];
        return (
          <View style={styles.stack}>
            <Pill
              label={count > 0 ? `${count} Warnungen` : 'Keine Warnungen'}
              tone={count > 0 ? severityColor(colors, severity) : colors.on}
              solid
            />
            {alerts.slice(0, 2).map((alert, index) => (
              <Text key={index} numberOfLines={1} style={styles.detail}>
                {alert.event ?? alert.title} · {alert.area}
              </Text>
            ))}
          </View>
        );
      }

      case 'scene': {
        // Eine Lichtszene hat nichts zum Ablesen und nichts zum Stellen –
        // sie hat einen Knopf. Also ist die ganze Kachel der Knopf, und
        // sie trägt die Farbe der Szene (lib/szenenfarbe.ts): Man
        // erkennt sie am Bild, nicht am Text.
        //
        // Vorher stand hier ein «Bereit»-Chip (eine Szene ist immer
        // bereit), darunter ein blauer Knopf und ganz unten der Name -
        // unter dem Knopf, den man drückt. Alle drei Zeilen sagten
        // dasselbe oder nichts.
        //
        // Ob sie gerade gilt, weiss die Bridge: Sie meldet «inactive»,
        // sobald jemand eine der Lampen von Hand verstellt hat. Deshalb
        // steht «gilt gerade» und nicht «zuletzt gedrückt» – Letzteres
        // wäre nach einer Handbewegung eine Lüge.
        const gilt = entity.state.state === 'active';
        const farbe = szenenfarbe(entity.name);
        return (
          <View style={styles.szeneInhalt}>
            <View style={styles.szeneKopf}>
              <Ionicons name="sparkles" size={20} color={farbe.tinte} />
              {gilt ? (
                <Text style={[styles.szeneStand, { color: farbe.tinte }]}>
                  Gilt gerade
                </Text>
              ) : null}
            </View>
            <View>
              <Text
                numberOfLines={2}
                style={[styles.szeneName, { color: farbe.tinte }]}
              >
                {entity.name}
              </Text>
              <Text style={[styles.szeneStand, { color: farbe.tinte }]}>
                {entity.available ? 'Tippen zum Aufrufen' : offlineText}
              </Text>
            </View>
          </View>
        );
      }

      case 'button': {
        // Ein Taster hat keinen Zustand zum Ablesen – er meldet einen
        // Druck. Anzuzeigen ist deshalb der letzte.
        const press = entity.state.last_press;
        const pressed = entity.state.state === 'short' || entity.state.state === 'long';
        return (
          <View style={styles.stack}>
            <Pill
              label={
                !pressed
                  ? 'Bereit'
                  : entity.state.state === 'long'
                    ? 'Lang gedrückt'
                    : 'Kurz gedrückt'
              }
            />
            <Text style={styles.detail}>
              {typeof press === 'number' ? sinceLabel(press) : 'Noch kein Druck'}
            </Text>
            {/* «Bereit, noch kein Druck» stimmt und führt trotzdem in die
                Irre, wenn der Kanal gar nichts sendet - etwa der
                Schaltausgang eines Aktors statt seiner Wippe. Der Hub
                merkt das beim Start und legt den Grund hierher. */}
            {entity.state.error ? (
              <Text style={[styles.detail, { color: colors.danger }]}>
                {String(entity.state.error)}
              </Text>
            ) : null}
          </View>
        );
      }

      default:
        return <BigValue value={String(entity.state.state ?? '–')} />;
    }
  };

  return (
    <Card
      style={kameraVoll ? { width, padding: 0, overflow: 'hidden', gap: 0 } : { width }}
      // Eine offene Türe ist keine Nebensache: Die Kachel färbt sich, statt
      // es nur danebenzuschreiben. Beim Aufsperren dreht das Schloss noch
      // (unlocking) - erst wenn es wirklich offen ist, färbt es sich.
      tint={
        entity.kind === 'lock' &&
        ['unlocked', 'unlatched'].includes(String(entity.state.state))
          ? colors.dangerSoft
          : undefined
      }
      verlauf={
        szeneKachel
          ? [szeneKachel.von, szeneKachel.bis]
          : lichtKachel
            ? [lichtKachel.von, lichtKachel.bis]
            : undefined
      }
      label={szeneKachel ? `Szene ${entity.name} aufrufen` : undefined}
      dimmed={!entity.available || (hidden && !editing)}
      // Die Szenenkachel IST der Knopf - überall sonst bleibt der Tipp,
      // den der Bildschirm vorgibt (Vollbild, Verlauf, nichts).
      onPress={onPress ?? (szeneKachel ? () => onCommand('activate') : undefined)}
      onLongPress={langerDruck}
    >
      {editing ? (
        // Eine Zeile statt einer Knopfwand.
        // Vorher standen hier zwei Chips und bis zu fünf beschriftete
        // Symbole. Auf einer halbbreiten Telefonkachel brauchen vier
        // davon rund 320 Punkte und bekommen 180 – sie brachen um, die
        // Chips ebenso, und der Griff zum Verschieben lag über dem
        // Raum-Chip. Der Inhalt der Kachel rutschte so weit nach unten,
        // dass zwei Stück einen Bildschirm füllten.
        //
        // Jetzt sagt eine Zeile, was eingestellt ist, und ein Tipp
        // öffnet das Blatt, in dem alles Platz hat.
        <View style={styles.editBox}>
          {partOf ? (
            <View style={styles.partOfRow}>
              <Ionicons name="git-merge-outline" size={12} color={colors.inkFaint} />
              <Text style={styles.partOfText} numberOfLines={1}>
                gehört zu «{partOf}»
              </Text>
            </View>
          ) : null}
          <Pressable
            onPress={() => setBlattOffen(true)}
            accessibilityRole="button"
            accessibilityLabel={`${entity.name} anpassen – ${standZeile(stand)}`}
            style={({ pressed }) => [styles.editZeile, pressed && { opacity: 0.6 }]}
          >
            {/* Zwei bewusste Zeilen statt eines umbrechenden Satzes.
                Vorher stand hier nur der Stand, und der beginnt mit dem
                Raum: «Kein Raum ›». Das las sich wie ein Raumwähler -
                dahinter liegt aber das ganze Blatt mit Umbenennen,
                Raum, Gruppe, Favorit, Ausblenden und Rückfrage. Gemeldet
                aus dem Haus, und zu Recht.

                «Anpassen · Kein Raum» in einer Zeile wäre die
                naheliegende Antwort und passt nicht: Auf einer
                halbbreiten Telefonkachel bleiben 89 Punkte, gemessen,
                und der Satz bricht mitten entzwei. Also die Überschrift
                oben, klein und gedeckt, der Stand darunter - dieselbe
                Höhe wie ein Umbruch, nur vorhersehbar. */}
            <View style={{ flex: 1 }}>
              <Text style={styles.editTitel}>Anpassen</Text>
              <Text
                style={[styles.editStand, faelltAuf(stand) && { color: colors.accent }]}
                numberOfLines={1}
              >
                {standZeile(stand)}
              </Text>
            </View>
            {/* Schieberegler statt Pfeil: Der Pfeil hiess «weiter zu dem,
                was links steht» - und links stand der Raum. */}
            <Ionicons name="options-outline" size={13} color={colors.inkSoft} />
          </Pressable>
        </View>
      ) : null}
      {editing ? (
        <AnpassenBlatt
          visible={blattOffen}
          titel={entity.name}
          onClose={() => setBlattOffen(false)}
          zeilen={[
            ...(onRename
              ? [
                  {
                    key: 'name',
                    icon: 'pencil' as const,
                    label: 'Umbenennen',
                    onPress: () => {
                      setBlattOffen(false);
                      setRenameOpen(true);
                    },
                  },
                ]
              : []),
            ...(onSetRoom && rooms
              ? [
                  {
                    key: 'raum',
                    icon: 'home-outline' as const,
                    label: 'Raum',
                    wert: entity.room ?? 'Kein Raum',
                    onPress: () => {
                      setBlattOffen(false);
                      setRoomPickerOpen(true);
                    },
                  },
                ]
              : []),
            ...(onSetGroup && groups
              ? [
                  {
                    key: 'gruppe',
                    icon: 'layers-outline' as const,
                    label: 'Gruppe',
                    wert: entity.group ?? 'Keine Gruppe',
                    onPress: () => {
                      setBlattOffen(false);
                      setGroupPickerOpen(true);
                    },
                  },
                ]
              : []),
            {
              key: 'favorit',
              icon: (favorite
                ? 'star'
                : 'star-outline') as keyof typeof Ionicons.glyphMap,
              label: 'Favorit',
              wert: favorite ? 'ja' : 'nein',
              aktiv: !!favorite,
              // Das Blatt bleibt offen: Wer eine Kachel anpasst, legt
              // meist mehrere Schalter um. Nach jedem Tipp zu schliessen
              // hiesse, es viermal zu öffnen.
              onPress: () => onToggleFavorite?.(),
            },
            {
              key: 'sichtbar',
              icon: (hidden
                ? 'eye-off'
                : 'eye-outline') as keyof typeof Ionicons.glyphMap,
              label: 'Ausblenden',
              wert: hidden ? 'versteckt' : 'sichtbar',
              aktiv: !!hidden,
              onPress: () => onToggleHidden?.(),
            },
            ...(onToggleLocked
              ? [
                  {
                    key: 'rueckfrage',
                    icon: (locked
                      ? 'lock-closed'
                      : 'lock-open-outline') as keyof typeof Ionicons.glyphMap,
                    // «Rückfrage» statt «Sperren»: Das Wort sagt, was
                    // passiert. Gesperrt klingt nach «geht nicht mehr» -
                    // es geht weiter, nur mit einem Ja dazwischen.
                    label: 'Rückfrage vor dem Schalten',
                    wert: locked ? 'ja' : 'nein',
                    aktiv: !!locked,
                    onPress: () => onToggleLocked(),
                  },
                ]
              : []),
            ...(onToggleUngezaehlt && zaehlbar(entity)
              ? [
                  {
                    key: 'zaehlung',
                    icon: (ungezaehlt
                      ? 'remove-circle-outline'
                      : 'bulb-outline') as keyof typeof Ionicons.glyphMap,
                    // Gemeint ist die «3 an» in der Kopfzeile. «Zählt»
                    // allein wäre zweideutig; «oben» sagt, wo.
                    label: 'Zählt oben mit',
                    wert: ungezaehlt ? 'nein' : 'ja',
                    aktiv: !!ungezaehlt,
                    onPress: () => onToggleUngezaehlt(),
                  },
                ]
              : []),
          ]}
        />
      ) : null}
      {/* ── Die Blätter dieser Kachel ────────────────────────────────
          Alle an einer Stelle, und keines mehr im Kachelkörper: Dort
          standen sie zwischen Knöpfen, deren Bedingungen sich im Betrieb
          ändern - und ein Blatt verschwindet in dem Moment, in dem die
          Bedingung darüber falsch wird. Die Fernbedienung hing so an
          «der Fernseher meldet an», und ein Android TV meldet nach jedem
          Tastendruck kurz «aus»: Bei jedem Druck flog das offene Blatt
          aus dem Baum und baute sich neu auf. Auf dem iPhone sah man ein
          Wegblinken, sonst nichts.

          Was ein Blatt hier am Leben hält, steht im Betrieb fest:
          Geräteart und Befehlsliste, beide vom Hub beim Anlegen. Die
          Regel und ihre Begründung: lib/blattgrund.ts. Gemessen wird sie
          in scripts/probe.sh. */}
      {musiklisteMoeglich(entity) ? (
        <Musikliste
          state={entity.state}
          offen={listeOffen}
          onClose={() => setListeOffen(false)}
          onPlay={
            entity.commands.includes('play_queue')
              ? (uri) => onCommand('play_queue', { uri })
              : undefined
          }
        />
      ) : null}
      {fernbedienungMoeglich(entity) ? (
        <TvRemote
          visible={remoteOpen}
          name={entity.name}
          onClose={() => setRemoteOpen(false)}
          onCommand={onCommand}
          // Dieselben Apps wie in der Auswahl der Kachel - das Blatt
          // deckt die Kachel zu, also muss der Wechsel auch hier gehen.
          apps={entity.commands.includes('launch_app') ? appsOf(entity) : []}
          fehler={remoteOpen ? fehler : null}
          onFehlerWeg={onFehlerWeg}
        />
      ) : null}
      {onSetRoom && rooms ? (
        <RoomPicker
          visible={roomPickerOpen}
          current={entity.room ?? null}
          rooms={rooms}
          onClose={() => setRoomPickerOpen(false)}
          onSelect={(room) => {
            setRoomPickerOpen(false);
            onSetRoom(room);
          }}
        />
      ) : null}
      {aktionen.length > 1 ? (
        <KachelMenue
          visible={menueOffen}
          titel={entity.name}
          // «Warum ist das an?» - die Frage, die man nachts im Flur
          // stellt, beantwortet hier eine Zeile (siehe lib/ursache.ts).
          ursache={ursacheSatz(entity, Date.now())}
          // Und die Kette dahinter, wo der Hub sie kennt: Melder →
          // Ablauf → Gerät. «Ablauf «Licht bei Bewegung»» allein zog
          // sonst die nächste Frage nach sich - welche Bewegung?
          kette={ketteSatz(entity, entity.name)}
          eintraege={aktionen}
          onClose={() => setMenueOffen(false)}
          onSelect={fuehreAus}
        />
      ) : null}
      {onRename ? (
        <RenameDialog
          visible={renameOpen}
          current={entity.name}
          onClose={() => setRenameOpen(false)}
          onSubmit={(name) => {
            setRenameOpen(false);
            onRename(name);
          }}
        />
      ) : null}
      {onSetGroup && groups ? (
        <GroupPicker
          visible={groupPickerOpen}
          current={entity.group ?? null}
          groups={groups}
          onClose={() => setGroupPickerOpen(false)}
          onSelect={(group) => {
            setGroupPickerOpen(false);
            onSetGroup(group);
          }}
        />
      ) : null}
      {/* Solange der Befehl unterwegs ist, sitzt die Kachel noch auf dem
          alten Stand – die Schieber und Pfeile darin zeigen also etwas,
          das gleich nicht mehr stimmt. Blass gestellt sagt das jeder
          Kachelart auf einmal, ohne dass jede es einzeln wissen muss. */}
      {/* Der lange Druck steht den Knöpfen darin zur Verfügung: Auf
          einer Kachel voller Bedienelemente - Schloss, Sauger, Musik -
          erreicht die Geste die Kachel darunter sonst nie, weil React
          Native sie an das innerste Element gibt, das sie annimmt.
          Siehe entity/kacheldruck.tsx. */}
      <KachelDruck wert={langerDruck}>
        <View style={[styles.body, pending && { opacity: 0.55 }]}>{body()}</View>
      </KachelDruck>
      {chart}
      {eigenerName ? null : (
        <CardFooter
          title={entity.name}
          subtitle={
            pending ? 'wird geschaltet …' : entity.available ? subtitle : offlineText
          }
          on={isOn || !!boxSchalter?.an}
          onToggle={toggleMitDoppeltipp}
          toggleLabel={boxSchalter?.label}
          pending={pending}
          onLongPress={langerDruck}
        />
      )}
      {usedIn ? (
        <Pressable
          onPress={onUsedIn}
          accessibilityRole="button"
          accessibilityLabel={`${entity.name}: ${usedIn} – Abläufe öffnen`}
          hitSlop={6}
          style={styles.partOfRow}
        >
          <Ionicons name="git-branch-outline" size={12} color={colors.inkFaint} />
          <Text style={styles.partOfText}>{usedIn}</Text>
        </Pressable>
      ) : null}
    </Card>
  );
}

/** Raumauswahl im Anpassen-Modus: „Kein Raum“ plus alle bekannten Räume. */

// Weiterhin von hier beziehbar - SidePanel u.a. importieren sie so.
export { RadioPanel, ShuffleRepeat, SpotifyPanel } from './entity/medien';
