import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import React, { useMemo, useRef, useState } from 'react';
import { Modal, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';

import { CommandData, Entity } from '../api/types';
import {
  aktiverWeisston,
  ausY,
  kannFarbe,
  kannWeiss,
  zeigtFarbe,
} from '../lib/lichtwahl';
import { Colors, radius, useColors } from '../theme';
import { gewaehlteFarbe } from './ColorRow';
import { Farbraster } from './Farbraster';

/**
 * Das Blatt hinter einer Lichtkachel (Punkt 649 der Werkbank).
 *
 * Aus dem Haus, mit Bild der Lichtseite einer fremden App: «Es soll es
 * in dieser Art anzeigen.» Gemeint ist die grosse Fläche: ein
 * senkrechter Balken, den man über die halbe Seite zieht, darunter die
 * Punkte für Farbe und Weisston.
 *
 * Warum nicht auf der Kachel selbst: Dort liegen vier bis acht Geräte
 * nebeneinander, und ein Balken über die halbe Seite hat da keinen
 * Platz. Die Kachel behält also ihren Wischdimmer und die schmale
 * Punktreihe; wer mehr will, öffnet das Blatt - über den langen Druck,
 * dort, wo auch Verlauf und Umbenennen stehen.
 *
 * Der Balken ist senkrecht und nicht waagrecht wie der auf der Kachel.
 * Das ist kein Geschmack: Eine Lampe wird «heller» und «dunkler», und
 * oben/unten liest sich das von selbst - eine waagrechte Strecke muss
 * man erst übersetzen. Auf der Kachel bleibt er waagrecht, weil dort
 * die Kachel breiter als hoch ist.
 */

/** So hoch ist der Balken im Blatt. Fest und nicht gemessen: Er soll
 *  auf jedem Telefon dieselbe Geste sein, und mehr als das passt auf
 *  ein kleines Gerät ohnehin nicht. */
const BALKEN = 260;

export function Lichtblatt({
  entity,
  visible,
  onClose,
  onCommand,
}: {
  entity: Entity;
  visible: boolean;
  onClose: () => void;
  onCommand: (command: string, data?: CommandData) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const an = entity.state.state === 'on';
  const dimmbar = entity.commands.includes('set_brightness');
  const gemeldet = Math.round(Number(entity.state.brightness ?? 100));
  // Während des Ziehens gilt der Wert unter dem Finger - sonst zieht man
  // ins Blinde, bis der Hub geantwortet hat.
  const [gezogen, setGezogen] = useState<number | null>(null);
  const helligkeit = gezogen ?? (an ? gemeldet : 0);

  const hoehe = useRef(BALKEN);
  const start = useRef(0);
  const letzter = useRef(0);
  const regler = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          start.current = event.nativeEvent.locationY;
          letzter.current = ausY(start.current, hoehe.current);
          setGezogen(letzter.current);
        },
        onPanResponderMove: (_event, geste) => {
          letzter.current = ausY(start.current + geste.dy, hoehe.current);
          setGezogen(letzter.current);
        },
        onPanResponderRelease: () => {
          const ziel = letzter.current;
          setGezogen(null);
          // Null heisst aus - eine Lampe auf 0 % ist keine Lampe, die
          // ganz dunkel leuchtet.
          if (ziel === 0) onCommand('turn_off');
          else onCommand('set_brightness', { brightness: ziel });
        },
        onPanResponderTerminate: () => setGezogen(null),
      }),
    [onCommand]
  );

  const wert = {
    color: zeigtFarbe(entity)
      ? (gewaehlteFarbe(entity.state.color) ?? undefined)
      : undefined,
    colorTemp: aktiverWeisston(entity) ?? undefined,
  };

  return (
    <Modal
      visible={visible}
      animationType="slide"
      transparent
      onRequestClose={onClose}
    >
      <View style={styles.hinter}>
        <View style={styles.blatt}>
          <View style={styles.kopf}>
            <Pressable
              onPress={onClose}
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="Schliessen"
            >
              <Ionicons name="close" size={22} color={colors.ink} />
            </Pressable>
            <Text style={styles.titel} numberOfLines={1}>
              {entity.name}
            </Text>
            {/* Platzhalter, damit der Name in der Mitte steht. */}
            <View style={{ width: 22 }} />
          </View>

          <Text style={styles.wert}>
            {!entity.available ? '–' : an || gezogen ? `${helligkeit} %` : 'Aus'}
          </Text>

          {dimmbar ? (
            <View
              {...regler.panHandlers}
              onLayout={(event) => {
                hoehe.current = event.nativeEvent.layout.height;
              }}
              style={styles.spur}
              accessibilityRole="adjustable"
              accessibilityLabel={`Helligkeit ${helligkeit} Prozent`}
            >
              {/* Gefüllt wird von unten - so herum, wie man es erwartet. */}
              <View style={[styles.fuellung, { height: `${helligkeit}%` }]}>
                <LinearGradient
                  colors={colors.warmCool}
                  start={{ x: 0, y: 1 }}
                  end={{ x: 0, y: 0 }}
                  style={StyleSheet.absoluteFill}
                />
              </View>
              {/* Der Strich oben im Balken wie im Vorbild: Er zeigt, dass
                  man hier zieht und nicht bloss tippt. */}
              <View style={styles.griff} />
            </View>
          ) : null}

          <View style={styles.knopfreihe}>
            <Pressable
              onPress={() => onCommand(an ? 'turn_off' : 'turn_on')}
              accessibilityRole="switch"
              accessibilityState={{ checked: an }}
              accessibilityLabel={an ? `${entity.name} ausschalten` : `${entity.name} einschalten`}
              style={({ pressed }) => [
                styles.knopf,
                an && { backgroundColor: colors.accentSoft },
                pressed && { opacity: 0.8 },
              ]}
            >
              <Ionicons
                name="power"
                size={20}
                color={an ? colors.accent : colors.inkSoft}
              />
            </Pressable>
          </View>

          {/* Farbe und Weisston - dieselben Punkte wie im Ablauf und in
              der Szene, nur grösser. Ohne «unverändert»: Hier leuchtet
              die Lampe ja schon in etwas. */}
          <Farbraster
            gross
            farben={kannFarbe(entity)}
            weiss={kannWeiss(entity)}
            wert={wert}
            onWahl={(wahl) => {
              if (wahl.color) onCommand('set_color', { color: wahl.color });
              else if (wahl.colorTemp) {
                onCommand('set_color_temp', { color_temp: wahl.colorTemp });
              }
            }}
          />
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    hinter: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.35)',
      justifyContent: 'flex-end',
    },
    blatt: {
      backgroundColor: colors.surface,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      padding: 20,
      gap: 16,
      alignItems: 'center',
    },
    kopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      alignSelf: 'stretch',
    },
    titel: { color: colors.ink, fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
    wert: { color: colors.ink, fontSize: 34, fontWeight: '800' },
    spur: {
      width: 96,
      height: BALKEN,
      borderRadius: 28,
      backgroundColor: colors.track,
      overflow: 'hidden',
      justifyContent: 'flex-end',
    },
    fuellung: { width: '100%' },
    griff: {
      position: 'absolute',
      top: 12,
      alignSelf: 'center',
      width: 34,
      height: 4,
      borderRadius: 2,
      backgroundColor: 'rgba(255,255,255,0.8)',
    },
    knopfreihe: { flexDirection: 'row', gap: 10 },
    knopf: {
      width: 46,
      height: 46,
      borderRadius: 23,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.track,
    },
  });
