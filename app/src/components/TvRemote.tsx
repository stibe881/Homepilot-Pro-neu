import { Ionicons } from '@expo/vector-icons';
import Constants from 'expo-constants';
import * as Updates from 'expo-updates';
import React, { useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { fusszeile } from '../lib/fernbedienungsstand';
import { tapped, triggered } from '../lib/haptics';
import { kann } from '../lib/plattform';
import { tastenStaerke } from '../lib/tastenhaptik';
import { Colors, useColors } from '../theme';

interface Props {
  visible: boolean;
  name: string;
  onClose: () => void;
  onCommand: (command: string) => void;
  /** Was der Hub zur letzten Taste sagte – oder ``null``.
   *
   *  Muss hier hinein und nicht ins Band unten am Bildschirm: Die
   *  Fernbedienung ist ein Modal und liegt darüber. Die Absage stand
   *  also da, verdeckt von genau der Fläche, auf der man gerade tippt –
   *  gemessen mit `elementFromPoint`, nicht geraten. Wer drückte, sah
   *  nichts passieren und erfuhr auch nicht, warum. */
  fehler?: string | null;
  onFehlerWeg?: () => void;
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
  onBeruehrt,
  onDruck,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  command: string;
  label: string;
  big?: boolean;
  aussehen: { styles: ReturnType<typeof makeStyles>; colors: Colors };
  onBeruehrt: () => void;
  onDruck: (command: string, label: string) => void;
}) {
  const { styles, colors } = aussehen;
  return (
    <Pressable
      accessibilityLabel={label}
      onPressIn={onBeruehrt}
      onPress={() => onDruck(command, label)}
      style={({ pressed }) => [styles.key, big && styles.keyBig, pressed && styles.keyPressed]}>
      <Ionicons name={icon} size={big ? 26 : 20} color={colors.ink} />
    </Pressable>
  );
}

/** Vollwertige Fernbedienung für Android-TV-Kacheln: Steuerkreuz,
 *  Lautstärke, Medientasten. Öffnet sich als Modal über dem Dashboard. */
export function TvRemote({
  visible,
  name,
  onClose,
  onCommand,
  fehler,
  onFehlerWeg,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Welche Taste zuletzt rausging.
  //
  // Ohne das heisst «nichts passiert» dreierlei, und alle drei sehen
  // gleich aus: Der Tipp kam gar nicht an, der Hub hat ihn angenommen
  // und der Fernseher ignoriert ihn, oder der Hub hat abgelehnt. Genau
  // daran liess sich der Fehler im Haus nicht einkreisen. Jetzt sagt die
  // Zeile unten, was die App getan hat – und die Absage darüber, was der
  // Hub davon hielt.
  const [letzte, setLetzte] = useState<string | null>(null);

  // Wie oft ein Finger eine Taste berührt hat - gezählt beim Auflegen
  // (onPressIn), also vor Haptik, Statuszeile und Senden. Auf dem iPhone
  // blieb die Fernbedienung stumm, und von aussen war nicht zu sehen, WO
  // der Druck stirbt: Erreicht die Berührung die Taste überhaupt, oder
  // scheitert erst der fertige Druck? Der Zähler trennt die beiden
  // Fälle - zusammen mit der App-Version in der Fusszeile, die sagt, ob
  // die Korrektur überhaupt auf dem Gerät läuft (lib/fernbedienungsstand.ts).
  const [beruehrungen, setBeruehrungen] = useState(0);
  useEffect(() => {
    // Beim Öffnen mit leerer Zeile und Zähler null beginnen: Was beim
    // letzten Mal gedrückt wurde, sagt über dieses Mal nichts.
    if (visible) {
      setLetzte(null);
      setBeruehrungen(0);
    }
  }, [visible]);

  // Was ein fertiger Druck tut. Die Taste selbst (Key) steht BEWUSST
  // ausserhalb dieser Funktion - siehe den Kommentar dort.
  const druck = (command: string, label: string) => {
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
    if (fehler) onFehlerWeg?.();
    setLetzte(label);
    onCommand(command);
  };

  // Nur zählen, nichts weiter: Das Auflegen ist der früheste Moment,
  // in dem die Taste von der Berührung erfährt. Alles Weitere bleibt
  // beim fertigen Druck - ein Druck ist erst mit dem Loslassen einer.
  const taste = {
    aussehen: { styles, colors },
    onBeruehrt: () => setBeruehrungen((n) => n + 1),
    onDruck: druck,
  };

  return (
    <Modal visible={visible} transparent animationType="fade" onRequestClose={onClose}>
      {/* Der Hintergrund liegt als Geschwister HINTER dem Blatt, nicht
          als Eltern-Pressable darum herum. Verschachtelte Pressables
          verhalten sich im Web und nativ nicht gleich; mit Geschwistern
          gibt es nichts zu verhandeln: Was über dem Blatt liegt, gehört
          dem Blatt. (Die stumme Fernbedienung auf dem iPhone war
          übrigens NICHT das - sie war der Neuaufbau der Tasten bei
          jedem Rendern, siehe den Kommentar an `Key`.) */}
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onClose}
          accessibilityLabel="Fernbedienung schliessen"
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {name}
            </Text>
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
              <Key icon="ellipse-outline" command="ok" label="OK" big {...taste} />
              <Key icon="chevron-forward" command="dpad_right" label="Rechts" {...taste} />
            </View>
            <View style={styles.dpadRow}>
              <Key icon="chevron-down" command="dpad_down" label="Runter" {...taste} />
            </View>
          </View>

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

          {fehler ? (
            <View style={styles.absage}>
              <Ionicons name="alert-circle" size={16} color={colors.danger} />
              <Text style={styles.absageText}>{fehler}</Text>
            </View>
          ) : letzte ? (
            <View style={styles.absage}>
              <Ionicons name="checkmark-circle" size={16} color={colors.inkFaint} />
              <Text style={styles.gesendetText}>
                «{letzte}» ging an den Hub. Tut der Fernseher nichts, liegt es an ihm.
              </Text>
            </View>
          ) : null}

          {/* Immer da, auch ohne jeden Druck: Fehlt diese Zeile auf einem
              Gerät ganz, läuft dort noch ein Stand ohne sie - dann ist
              nicht die Fernbedienung kaputt, sondern das Update nicht
              angekommen. Warum sie sich das Erklären leisten muss:
              lib/fernbedienungsstand.ts. */}
          <Text style={styles.fusszeile}>
            {fusszeile(
              Constants.expoConfig?.version ?? null,
              kann.ausOtaGeladen ? Updates.isEmbeddedLaunch === false : null,
              beruehrungen
            )}
          </Text>
        </View>
      </View>
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
      width: 300,
      maxWidth: '100%',
      borderRadius: 24,
      padding: 20,
      gap: 14,
      // Opaker Grund: das Modal schwebt frei, Glas-Transparenz hätte hier
      // nichts, wodurch sie durchscheinen könnte.
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    header: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    title: { flex: 1, fontSize: 17, fontWeight: '600', color: colors.ink },
    close: { padding: 4 },
    dpad: { alignItems: 'center', gap: 8 },
    dpadRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    row: { flexDirection: 'row', justifyContent: 'space-evenly' },
    key: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    keyBig: { width: 68, height: 68, borderRadius: 34 },
    absage: {
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
      paddingTop: 4,
    },
    absageText: { flex: 1, fontSize: 13, lineHeight: 18, color: colors.inkSoft },
    gesendetText: { flex: 1, fontSize: 12, lineHeight: 17, color: colors.inkFaint },
    keyPressed: { backgroundColor: colors.surfaceStrong },
    fusszeile: { fontSize: 11, color: colors.inkFaint, textAlign: 'center' },
  });
