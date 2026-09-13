import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { CommandData, Entity } from '../api/types';
import { useMeldung } from '../hooks/HubContext';
import { Blatt } from './Blatt';
import { TvApp } from './TvApps';
import { TvAppLogo } from './TvAppLogo';
import { tapped, triggered } from '../lib/haptics';
import { PS_REIHE, PS_SYMBOLTASTEN, istPlaystation, psKopf } from '../lib/playstation';
import { tvLogo } from '../lib/tvlogo';
import { tastenStaerke } from '../lib/tastenhaptik';
import { Colors, radius, useColors } from '../theme';

interface Props {
  visible: boolean;
  name: string;
  onClose: () => void;
  onCommand: (command: string, data?: CommandData) => void;
  /** Apps, die sich vom Blatt aus starten lassen (Plex, YouTube, …).
   *
   *  Dieselbe Liste wie in der App-Auswahl der Kachel - aber die Kachel
   *  liegt unter genau diesem Blatt. Wer die Fernbedienung offen hat und
   *  zu Zattoo will, musste sie erst schliessen. */
  apps?: TvApp[];
  /** Die Szene «Kino», wenn es genau eine gibt (lib/kinoszene.ts).
   *  Der Film beginnt, das Licht ist noch hell - der Griff gehört
   *  neben die Fernbedienung, nicht vier Tipps tief in die App. */
  kino?: { id: string; name: string } | null;
  onKino?: (sceneId: string) => void;
  /** Das Gerät selbst - entscheidet, ob hier ein Fernseher oder eine
   *  PlayStation bedient wird (Punkt 634). Optional, damit die
   *  bestehenden Aufrufe unverändert bleiben: ohne Gerät ein Fernseher. */
  entity?: Entity;
}

/** Eine einzelne Taste der Fernbedienung.
 *
 *  Steht auf Modulebene, und das ist KEINE Stilfrage: Vorher war `Key`
 *  eine Funktion IM Rumpf von TvRemote - für React bei jedem Rendern
 *  ein neuer Komponententyp, also wird jede Taste bei jedem Rendern
 *  weggeworfen und neu aufgebaut. Der Hub schickt über den WebSocket
 *  laufend Zustände, jeder davon rendert das Dashboard samt offener
 *  Fernbedienung - und ein Neuaufbau MITTEN in einer Berührung bricht
 *  die Geste ab: onPressIn kam noch an, onPress nie mehr. Auf dem
 *  iPhone hiess das monatelang «die Fernbedienung reagiert nicht» -
 *  keine Haptik, keine Statuszeile, nichts am Hub -, während dieselben
 *  Tasten im Browser gingen, weil ein Mausklick zwischen zwei
 *  Zustandsmeldungen durchpasst. Die Nachbarknöpfe (MediaButton usw.)
 *  waren nie betroffen: Sie standen schon immer auf Modulebene und
 *  überleben ein Rendern als blosse Prop-Änderung, ohne Neuaufbau. */
function Key({
  icon,
  command,
  label,
  big,
  aussehen,
  onDruck,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  command: string;
  label: string;
  big?: boolean;
  aussehen: { styles: ReturnType<typeof makeStyles>; colors: Colors };
  onDruck: (command: string) => void;
}) {
  const { styles, colors } = aussehen;
  return (
    <Pressable
      accessibilityLabel={label}
      onPress={() => onDruck(command)}
      style={({ pressed }) => [styles.key, big && styles.keyBig, pressed && styles.keyPressed]}>
      <Ionicons name={icon} size={big ? 30 : 23} color={colors.ink} />
    </Pressable>
  );
}

/** Vollwertige Fernbedienung für Android-TV-Kacheln: Steuerkreuz,
 *  Lautstärke, Medientasten. Öffnet sich als Modal über dem Dashboard.
 *
 *  Für die PlayStation (Punkt 634) dasselbe Blatt mit anderen Tasten:
 *  Unter dem Steuerkreuz die vier Symboltasten in der Anordnung des
 *  Controllers, darunter Share · PS · Options. Keine Lautstärke, kein
 *  Transport, keine Apps - die Konsole kann über das Protokoll nichts
 *  davon, und ein Knopf, der nichts tut, ist schlimmer als keiner. Das
 *  OK in der Mitte des Kreuzes entfällt: Auf dem Controller bestätigt
 *  das Kreuz, und zweimal dieselbe Taste verwirrt. */
export function TvRemote({
  visible,
  name,
  onClose,
  onCommand,
  apps,
  kino,
  onKino,
  entity,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Was der Hub zur letzten Taste sagte. Lange kam es als Prop hinein,
  // weil die Fernbedienung ein Modal ist und das Band unten am
  // Bildschirm zudeckt - die Absage stand da, verdeckt von genau der
  // Fläche, auf der man gerade tippte (gemessen mit `elementFromPoint`).
  // Seit Punkt 581 zeichnet das oberste Blatt das Band selbst
  // (components/Blatt.tsx); hier bleibt nur das Wegräumen.
  const meldung = useMeldung();

  // Was ein fertiger Druck tut. Die Taste selbst (Key) steht BEWUSST
  // ausserhalb dieser Funktion - siehe den Kommentar dort.
  const druck = (command: string, data?: CommandData) => {
    // Zuerst das Spüren, dann der Rest: Eine Fernbedienung bedient
    // man, ohne hinzusehen. Der Impuls muss zum Druck gehören und
    // nicht zur Antwort des Hubs - sonst bleibt er aus, wenn die
    // Verbindung gerade hakt, und man drückt zweimal. Beim
    // Steuerkreuz springt die Auswahl dann zwei Felder weiter.
    // Welche Taste wie stark: lib/tastenhaptik.ts.
    //
    // Im try, und zwar nur die Haptik: Sie ist eine Zugabe. Stünde
    // sie ungeschützt vor dem Senden, würde ein Fehler in ihr den
    // ganzen Druck verschlucken - keine Zeile, kein Befehl, und auf
    // genau einer Plattform. Der Rest des Drucks darf an ihr nie
    // hängen.
    try {
      if (tastenStaerke(command) === 'kraeftig') triggered();
      else tapped();
    } catch {
      // Kein Motor, kein Modul, ein wirres Gerät - egal: weiter.
    }
    // Die alte Absage gehört zur alten Taste. Bliebe sie stehen,
    // liesse sich nicht mehr erkennen, ob die neue ankam.
    if (meldung?.fehler) meldung.fehlerWeg();
    onCommand(command, data);
  };

  const taste = {
    aussehen: { styles, colors },
    onDruck: druck,
  };

  const konsole = istPlaystation(entity);
  const kopf = konsole && entity ? psKopf(entity) : null;

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Der Hintergrund liegt als Geschwister HINTER dem Blatt, nicht
          als Eltern-Pressable darum herum. Verschachtelte Pressables
          verhalten sich im Web und nativ nicht gleich; mit Geschwistern
          gibt es nichts zu verhandeln: Was über dem Blatt liegt, gehört
          dem Blatt. (Die stumme Fernbedienung auf dem iPhone war
          übrigens NICHT das - sie war der Neuaufbau der Tasten bei
          jedem Rendern, siehe den Kommentar an `Key`.) */}
      <Blatt style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Fernbedienung schliessen"
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <View style={{ flex: 1 }}>
              <Text style={styles.title} numberOfLines={1}>
                {kopf ? kopf.titel : name}
              </Text>
              {/* Das laufende Spiel unter dem Namen der Konsole - man
                  sieht, was man fernbedient, ohne auf den Fernseher zu
                  schauen. */}
              {kopf ? (
                <Text style={styles.untertitel} numberOfLines={1}>
                  {kopf.unter}
                </Text>
              ) : null}
            </View>
            <Pressable accessibilityLabel="Schliessen" onPress={onClose} style={styles.close}>
              <Ionicons name="close" size={20} color={colors.inkSoft} />
            </Pressable>
          </View>

          {/* Steuerkreuz */}
          <View style={styles.dpad}>
            <View style={styles.dpadRow}>
              <Key icon="chevron-up" command="dpad_up" label="Hoch" {...taste} />
            </View>
            <View style={styles.dpadRow}>
              <Key icon="chevron-back" command="dpad_left" label="Links" {...taste} />
              {konsole ? (
                <View style={[styles.keyBig, styles.keyLeer]} />
              ) : (
                <Key icon="ellipse-outline" command="ok" label="OK" big {...taste} />
              )}
              <Key icon="chevron-forward" command="dpad_right" label="Rechts" {...taste} />
            </View>
            <View style={styles.dpadRow}>
              <Key icon="chevron-down" command="dpad_down" label="Runter" {...taste} />
            </View>
          </View>

          {konsole ? (
            <>
              {/* Die vier Symboltasten wie auf dem Controller: Dreieck
                  oben, Viereck links, Kreis rechts, Kreuz unten - so
                  liegen sie unter dem rechten Daumen, und so sucht man
                  sie auch hier. Die Belegung steht in lib/playstation.ts. */}
              <View style={styles.dpad}>
                <View style={styles.dpadRow}>
                  <Key {...PS_SYMBOLTASTEN.oben} {...taste} />
                </View>
                <View style={styles.dpadRow}>
                  <Key {...PS_SYMBOLTASTEN.links} {...taste} />
                  <View style={[styles.key, styles.keyLeer]} />
                  <Key {...PS_SYMBOLTASTEN.rechts} {...taste} />
                </View>
                <View style={styles.dpadRow}>
                  <Key {...PS_SYMBOLTASTEN.unten} {...taste} />
                </View>
              </View>

              <View style={styles.row}>
                {PS_REIHE.map((ps) => (
                  <Key key={ps.command} {...ps} {...taste} />
                ))}
              </View>

              <View style={styles.row}>
                <Key icon="power" command="toggle" label="An/Aus" {...taste} />
              </View>
            </>
          ) : (
            <>
              <View style={styles.row}>
                <Key icon="arrow-undo" command="back" label="Zurück" {...taste} />
                <Key icon="home-outline" command="home" label="Home" {...taste} />
                <Key icon="power" command="toggle" label="An/Aus" {...taste} />
              </View>

              <View style={styles.row}>
                <Key icon="volume-low" command="volume_down" label="Leiser" {...taste} />
                <Key icon="volume-mute" command="mute" label="Stumm" {...taste} />
                <Key icon="volume-high" command="volume_up" label="Lauter" {...taste} />
              </View>

              <View style={styles.row}>
                <Key icon="play-skip-back" command="previous" label="Zurück" {...taste} />
                <Key icon="play" command="play" label="Play/Pause" {...taste} />
                <Key icon="play-skip-forward" command="next" label="Weiter" {...taste} />
              </View>
            </>
          )}

          {/* Die Apps zum Schluss: erst steuern, dann wechseln. Die
              gleiche Liste bietet auch die Kachel an - aber die liegt
              unter diesem Blatt. Als Logos, nicht ausgeschrieben: Sechs
              Wörter nebeneinander musste man lesen, sechs Logos erkennt
              man vom Sofa aus - wie auf jeder echten Fernbedienung. Nur
              Unbekanntes (lib/tvlogo.ts) bleibt ein Wort-Chip. */}
          {apps && apps.length > 0 ? (
            <View style={styles.appReihe}>
              {apps.map((app) => {
                const logo = tvLogo(app.name);
                return (
                  <Pressable
                    key={app.app}
                    accessibilityRole="button"
                    accessibilityLabel={`${app.name} auf dem Fernseher starten`}
                    onPress={() => druck('launch_app', { app: app.app })}
                    style={({ pressed }) => [
                      !logo && styles.appChip,
                      pressed && (logo ? { opacity: 0.7 } : styles.keyPressed),
                    ]}
                  >
                    {logo ? (
                      <TvAppLogo logo={logo} size={52} />
                    ) : (
                      <Text style={styles.appChipText}>{app.name}</Text>
                    )}
                  </Pressable>
                );
              })}
            </View>
          ) : null}

          {/* Die Szene «Kino», wenn es genau eine gibt: Der Film
              beginnt, das Licht ist noch hell - der Griff gehört
              hierher, nicht vier Tipps tief in die App. Dieselbe Regel
              wie auf der Live-Karte des Fernsehers (hub kino_knopf). */}
          {kino && onKino ? (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={`Szene ${kino.name} starten`}
              onPress={() => {
                try {
                  tapped();
                } catch {
                  // Haptik ist Zugabe - der Druck darf nie an ihr hängen.
                }
                if (meldung?.fehler) meldung.fehlerWeg();
                onKino(kino.id);
              }}
              style={({ pressed }) => [styles.kinoKnopf, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="film-outline" size={17} color={colors.ink} />
              <Text style={styles.kinoText}>{kino.name}</Text>
            </Pressable>
          ) : null}

          {/* Keine Erfolgsmeldung: Dass der Druck ankommt, sagen Haptik
              und Fernseher. Die Absage des Hubs steht im Band des Blatts
              (Punkt 581). Die Diagnosezeilen von einst (welche Taste
              rausging, App-Version, Berührungszähler) haben ihren Fall
              gelöst und standen danach nur noch im Weg. */}
        </View>
      </Blatt>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    sheet: {
      // 340 statt 300: Die Fernbedienung ist die Fläche, auf der man
      // ohne Hinsehen trifft - auf ihr ist Grosszügigkeit Bedienbarkeit,
      // kein Schmuck. maxWidth fängt schmale Telefone ab.
      width: 340,
      maxWidth: '100%',
      borderRadius: 24,
      padding: 22,
      gap: 16,
      // Opaker Grund: das Modal schwebt frei, Glas-Transparenz hätte hier
      // nichts, wodurch sie durchscheinen könnte.
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { fontSize: 17, fontWeight: '600', color: colors.ink },
    untertitel: { fontSize: 13, color: colors.inkSoft, marginTop: 2 },
    close: { padding: 4 },
    dpad: { alignItems: 'center', gap: 8 },
    dpadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    row: { flexDirection: 'row', justifyContent: 'space-evenly' },
    key: {
      width: 58,
      height: 58,
      borderRadius: 29,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    keyBig: { width: 76, height: 76, borderRadius: 38 },
    keyPressed: { backgroundColor: colors.surfaceStrong },
    // Ein Platzhalter, wo auf dem Controller keine Taste ist: die Mitte
    // des Steuerkreuzes und die Mitte der Symboltasten. Unsichtbar,
    // aber so gross wie eine Taste - sonst rücken die Nachbarn zusammen
    // und das Kreuz verliert seine Form.
    keyLeer: { backgroundColor: 'transparent', borderColor: 'transparent' },
    appReihe: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      // Logos und Wort-Chips sind verschieden hoch - mittig statt
      // gestreckt, sonst wird aus einem Chip eine Kreis-hohe Pille.
      alignItems: 'center',
      gap: 8,
      paddingTop: 2,
    },
    // Der Kino-Griff: eine Pille unter den App-Logos, bewusst anders
    // geformt als die runden Apps - er startet keine App, er stellt
    // das Zimmer.
    kinoKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      alignSelf: 'center',
      gap: 8,
      paddingHorizontal: 18,
      paddingVertical: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginTop: 4,
    },
    kinoText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
    appChip: {
      paddingVertical: 7,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    appChipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  });
