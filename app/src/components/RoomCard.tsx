import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity, Scene } from '../api/types';
import { raumSymbol, raumZeile } from '../lib/raum';
import { Raumaktion, raumFarben, raumStand, raumaktionen } from '../lib/raumkarte';
import { Colors, radius, useColors } from '../theme';
import { Card } from './Card';

/**
 * Raumkachel mit Kopfbild – Vorschlag 5 aus dem Musterbogen.
 *
 * Oben ein Foto des Zimmers mit dem Namen darauf, darunter eine Zeile
 * Zustand und höchstens drei Knöpfe: Licht, Storen, Musik. Man erkennt
 * den Raum am Bild, bevor man den Namen liest.
 *
 * **Warum das die alte Liste ablöst.** Die zeigte jedes Gerät in einer
 * eigenen Zeile: Neun Geräte ergaben eine Kachel, die höher war als ihre
 * Nachbarn, und alle Zeilen wogen gleich viel – das brennende Deckenlicht
 * sah aus wie der Fernseher, der seit gestern still ist. Jetzt sind alle
 * Kacheln gleich hoch, und was man im Vorbeigehen tut, steht als Knopf da.
 * Alles Einzelne ist einen Tipp entfernt, in der vollen Raumansicht.
 *
 * **Ohne Foto ist die Kachel nicht kaputt.** Der Kopf bekommt dann eine
 * Farbe aus dem Namen des Zimmers und sein Symbol – dasselbe Zimmer immer
 * dieselbe Farbe. Ein graues Feld mit «kein Bild» wäre der Fehler, den
 * dieser Vorschlag gerade vermeiden will.
 *
 * **Was dabei verloren geht,** und das mit offenen Augen: Aus der
 * Übersicht lässt sich kein einzelnes Gerät mehr schalten – nur noch
 * «Licht», «Storen», «Musik» für den ganzen Raum. Wer die eine Lampe
 * meint, öffnet den Raum. Genau dieser Tausch war der Vorschlag.
 */
export function RoomCard({
  name,
  items,
  width,
  imageUri,
  onOpen,
  onLongPress,
  onAction,
  scenes = [],
  onScene,
}: {
  name: string;
  items: Entity[];
  width: number;
  /** Adresse des Fotos samt Token und Zeitstempel – fehlt es, trägt der
   *  Kopf die Farbe des Zimmers. */
  imageUri?: string | null;
  onOpen: () => void;
  /** Langer Druck: Bild wählen oder entfernen. Fehlt der Griff, darf
   *  dieser Mensch es nicht (Gäste) – dann passiert beim Halten nichts. */
  onLongPress?: () => void;
  onAction: (aktion: Raumaktion) => void;
  /** Die Szenen dieses Raums – höchstens zwei, vorausgewählt. */
  scenes?: Scene[];
  onScene?: (sceneId: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Ein Bild, das sich nicht laden lässt (Hub gerade weg, Datei kaputt),
  // darf keinen schwarzen Balken hinterlassen: Dann gilt die Farbe.
  const [bildKaputt, setBildKaputt] = useState(false);
  const aktionen = useMemo(() => raumaktionen(items), [items]);
  const stand = useMemo(() => raumStand(items, raumZeile(items)), [items]);
  const [oben, unten] = useMemo(() => raumFarben(name), [name]);
  const zeigtBild = !!imageUri && !bildKaputt;

  return (
    <Card style={{ ...styles.karte, width }} onPress={onOpen} onLongPress={onLongPress}>
      <View style={[styles.kopf, { backgroundColor: unten }]}>
        {zeigtBild ? (
          <Image
            source={{ uri: imageUri! }}
            style={StyleSheet.absoluteFill}
            resizeMode="cover"
            onError={() => setBildKaputt(true)}
          />
        ) : (
          // Kein Foto: die Farbe des Zimmers und sein Symbol, gross und
          // halbdurchsichtig. Das sieht nach Absicht aus statt nach Lücke.
          <View style={[StyleSheet.absoluteFill, { backgroundColor: oben }]}>
            <Ionicons
              name={raumSymbol(name)}
              size={78}
              color="rgba(255, 255, 255, 0.22)"
              style={styles.wasserzeichen}
            />
          </View>
        )}
        {/* Der Verlauf trägt den Namen: Auf einem hellen Foto (Fenster,
            weisse Wand) verschwände weisse Schrift sonst. */}
        <View style={styles.verlauf} />
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {onScene && scenes.length > 0 ? (
          <View style={styles.szenen}>
            {scenes.map((scene) => {
              const aktiv = !!scene.active;
              return (
                <Pressable
                  key={scene.id}
                  onPress={() => onScene(scene.id)}
                  hitSlop={6}
                  accessibilityRole="switch"
                  accessibilityState={{ checked: aktiv }}
                  accessibilityLabel={
                    aktiv
                      ? `Szene ${scene.name} in ${name} zurücknehmen`
                      : `Szene ${scene.name} in ${name}`
                  }
                  style={({ pressed }) => [
                    styles.szene,
                    aktiv && styles.szeneAn,
                    pressed && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons
                    name={(scene.icon as keyof typeof Ionicons.glyphMap) || 'sparkles'}
                    size={12}
                    color="#FFFFFF"
                  />
                  <Text style={styles.szeneText} numberOfLines={1}>
                    {scene.name}
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}
      </View>

      <View style={styles.unten}>
        <Text style={styles.stand} numberOfLines={1}>
          {stand}
        </Text>
        {aktionen.length > 0 ? (
          <View style={styles.knoepfe}>
            {aktionen.map((aktion) => (
              <Pressable
                key={aktion.art}
                onPress={() => onAction(aktion)}
                accessibilityRole="button"
                accessibilityLabel={`${aktion.label} in ${name}`}
                style={({ pressed }) => [
                  styles.knopf,
                  aktion.an && styles.knopfAn,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Ionicons
                  name={aktion.icon as keyof typeof Ionicons.glyphMap}
                  size={17}
                  color={aktion.an ? '#FFFFFF' : colors.inkSoft}
                />
                <Text style={[styles.knopfText, aktion.an && { color: '#FFFFFF' }]}>
                  {aktion.label}
                </Text>
              </Pressable>
            ))}
          </View>
        ) : (
          // Ein Zimmer, in dem es nichts zu schalten gibt (nur Fühler,
          // nur eine Kamera): kein leeres Knopfband, sondern ein Satz.
          <Text style={styles.leer}>Nichts zu schalten – antippen zeigt alles.</Text>
        )}
      </View>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    // Kein Innenrand und nichts, was übersteht: Das Bild geht bis an die
    // Kante der Karte.
    karte: { minHeight: 0, padding: 0, overflow: 'hidden', gap: 0 },
    kopf: {
      height: 116,
      // Nicht mitwachsen und nicht schrumpfen: In einer Reihe ist eine
      // Kachel so hoch wie die höchste, und der Kopf soll überall gleich
      // tief sitzen - sonst stehen die Raumnamen auf verschiedener Höhe.
      flexGrow: 0,
      flexShrink: 0,
      justifyContent: 'flex-end',
      paddingHorizontal: 16,
      paddingBottom: 12,
    },
    wasserzeichen: { position: 'absolute', right: 10, bottom: -12 },
    verlauf: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(12, 16, 24, 0.30)',
    },
    name: {
      color: '#FFFFFF',
      fontSize: 21,
      fontWeight: '700',
      letterSpacing: -0.3,
      textShadowColor: 'rgba(0, 0, 0, 0.45)',
      textShadowRadius: 12,
    },
    szenen: {
      position: 'absolute',
      top: 12,
      right: 14,
      flexDirection: 'row',
      gap: 6,
      maxWidth: '70%',
    },
    szene: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      maxWidth: 120,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(255, 255, 255, 0.24)',
    },
    szeneAn: { backgroundColor: colors.accent },
    szeneText: { color: '#FFFFFF', fontSize: 12, fontWeight: '600', flexShrink: 1 },
    // Nimmt den Rest der Kachel ein. Ohne das sammelte sich die
    // überzählige Höhe zwischen Kopf und Knöpfen: In einer Reihe mit
    // einer höheren Kachel klaffte dort ein Loch.
    unten: { flex: 1, padding: 14, gap: 10 },
    stand: { color: colors.inkSoft, fontSize: 13 },
    // Ans untere Ende: So stehen die Knöpfe zweier Kacheln nebeneinander
    // auf derselben Linie, auch wenn die eine mehr zu sagen hat.
    knoepfe: { flexDirection: 'row', gap: 8, marginTop: 'auto' },
    knopf: {
      flex: 1,
      alignItems: 'center',
      gap: 5,
      paddingVertical: 10,
      paddingHorizontal: 6,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      // Damit die Knöpfe einer Reihe gleich hoch bleiben, auch wenn einer
      // fehlt: Höhe aus Inhalt, aber mindestens Daumenmass.
      minHeight: 58,
      justifyContent: 'center',
    },
    knopfAn: { backgroundColor: colors.accent, borderColor: colors.accent },
    knopfText: { fontSize: 12, fontWeight: '600', color: colors.inkSoft },
    leer: { color: colors.inkFaint, fontSize: 12 },
  });
