import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, View } from 'react-native';

import { Entity, Scene } from '../api/types';
import { raumDunkel, raumSymbol, raumZeile } from '../lib/raum';
import { bewegungImRaum } from '../lib/bewegung';
import { Raumaktion, kachelKlima, kachelKnoepfe, raumFarben, raumStand } from '../lib/raumkarte';
import { useJetzt } from '../hooks/useRestzeit';
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
  knoepfeAuswahl,
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
  /** Welche Knöpfe die Kachel zeigt («licht», «storen», «musik») -
   *  undefined heisst alle, die leere Liste heisst bewusst keine.
   *  Gewählt im Blatt hinter dem langen Druck, gilt für alle im Haus. */
  knoepfeAuswahl?: string[];
  /** Die Szenen dieses Raums – höchstens zwei, vorausgewählt. */
  scenes?: Scene[];
  onScene?: (sceneId: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Ein Bild, das sich nicht laden lässt (Hub gerade weg, Datei kaputt),
  // darf keinen schwarzen Balken hinterlassen: Dann gilt die Farbe.
  const [bildKaputt, setBildKaputt] = useState(false);
  // Sammel- und Geräteknöpfe zusammen: Wer im Blatt hinter dem langen
  // Druck ein einzelnes Gerät gewählt hat, sieht es hier als Knopf.
  const aktionen = useMemo(
    () => kachelKnoepfe(items, knoepfeAuswahl),
    [items, knoepfeAuswahl]
  );
  // Die Restzeit tickt nur, wenn im Raum wirklich eine läuft.
  const jetzt = useJetzt(items.some((entity) => typeof entity.state.off_at === 'number'));
  const stand = useMemo(
    () => raumStand(items, raumZeile(items), jetzt),
    [items, jetzt]
  );
  const [oben, unten] = useMemo(() => raumFarben(name), [name]);
  const zeigtBild = !!imageUri && !bildKaputt;
  // Alles Licht aus: Der Kopf wird dunkel, wie das Zimmer selbst. So
  // liest sich die Übersicht wie ein Blick durch die Wohnung - hell ist,
  // wo Licht brennt. Räume ohne Lampen bleiben, wie sie sind
  // (lib/raum.ts: raumDunkel).
  const dunkel = useMemo(() => raumDunkel(items), [items]);
  // Bewegt sich etwas im Zimmer, steht ein Männchen hinter «alles
  // ruhig» - die Auskunft, für die der Melder früher eine eigene Kachel
  // im Raum hatte (lib/bewegung.ts). Auf der Übersicht ist sie am
  // meisten wert: Man sieht von aussen hin, ohne das Zimmer zu öffnen.
  const bewegung = useMemo(() => bewegungImRaum(items), [items]);
  // Temperatur und Feuchte des Zimmers - nur, wenn ihm wirklich ein
  // Fühler zugewiesen ist. Welcher gilt, rechnet lib/raumkarte.ts mit
  // derselben Regel wie der Raumkopf.
  const klima = useMemo(() => kachelKlima(items), [items]);

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
        {dunkel ? (
          // Über Bild und Farbe, unter Name und Szenen: Das Foto bleibt
          // erkennbar, wirkt aber wie bei gelöschtem Licht.
          <View style={styles.nacht} pointerEvents="none" />
        ) : null}
        {/* Der Verlauf trägt den Namen: Auf einem hellen Foto (Fenster,
            weisse Wand) verschwände weisse Schrift sonst. */}
        <View style={styles.verlauf} />
        <Text style={styles.name} numberOfLines={1}>
          {name}
        </Text>
        {/* Die obere Zeile des Bildes: links die Szenen, rechts das Klima.
            Beide standen sonst in derselben Ecke - und die Ecke gehört
            dem Klima, weil es *immer* dort steht, wenn es da ist. Die
            Szenen weichen nach links aus, statt sich zu überlagern. */}
        {(onScene && scenes.length > 0) || klima ? (
          <View style={styles.kopfZeile} pointerEvents="box-none">
            <View style={styles.szenen}>
              {onScene && scenes.length > 0
                ? scenes.map((scene) => szenenChip(scene))
                : null}
            </View>
            {klima ? (
              <View
                accessibilityRole="text"
                accessibilityLabel={`${name}: ${klima.label}`}
                style={styles.klima}
              >
                {klima.temp ? (
                  <>
                    <Ionicons name="thermometer-outline" size={12} color="#FFFFFF" />
                    <Text style={styles.klimaWert}>{klima.temp}</Text>
                  </>
                ) : null}
                {klima.temp && klima.feuchte ? <View style={styles.klimaStrich} /> : null}
                {klima.feuchte ? (
                  <>
                    <Ionicons name="water-outline" size={12} color="#FFFFFF" />
                    <Text style={styles.klimaWert}>{klima.feuchte}</Text>
                  </>
                ) : null}
              </View>
            ) : null}
          </View>
        ) : null}
      </View>

      <View style={styles.unten}>
        <View style={styles.standZeile}>
          <Text style={[styles.stand, { flexShrink: 1 }]} numberOfLines={1}>
            {stand}
          </Text>
          {bewegung ? (
            <View
              accessibilityRole="image"
              accessibilityLabel={`Bewegung in ${name}`}
              style={styles.bewegung}
            >
              <Ionicons name="walk" size={13} color={colors.on} />
            </View>
          ) : null}
        </View>
        {aktionen.length > 0 ? (
          <View style={styles.knoepfe}>
            {aktionen.map((aktion) => (
              <Pressable
                key={aktion.id ?? aktion.art}
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
                {/* Gerätenamen können lang sein («Sternenhimmel») - eine
                    Zeile, notfalls gekürzt, statt eines wachsenden Knopfs. */}
                <Text
                  style={[styles.knopfText, aktion.an && { color: '#FFFFFF' }]}
                  numberOfLines={1}
                >
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

  /** Ein Szenenknopf oben auf dem Bild. Nach dem return, damit oben
   *  zuerst steht, was die Kachel zeigt. */
  function szenenChip(scene: { id: string; name: string; icon?: string; active?: boolean }) {
    const aktiv = !!scene.active;
    return (
      <Pressable
        key={scene.id}
        onPress={() => onScene?.(scene.id)}
        hitSlop={6}
        accessibilityRole="switch"
        accessibilityState={{ checked: aktiv }}
        accessibilityLabel={
          aktiv ? `Szene ${scene.name} in ${name} zurücknehmen` : `Szene ${scene.name} in ${name}`
        }
        style={({ pressed }) => [styles.szene, aktiv && styles.szeneAn, pressed && { opacity: 0.6 }]}
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
  }
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
    // Zusammen mit dem Verlauf darüber wird das Bild deutlich dunkler,
    // bleibt aber lesbar - ein schwarzes Feld wäre keine Auskunft mehr,
    // sondern ein Loch in der Seite.
    nacht: {
      ...StyleSheet.absoluteFillObject,
      backgroundColor: 'rgba(6, 9, 15, 0.5)',
    },
    name: {
      color: '#FFFFFF',
      fontSize: 21,
      fontWeight: '700',
      letterSpacing: -0.3,
      textShadowColor: 'rgba(0, 0, 0, 0.45)',
      textShadowRadius: 12,
    },
    /** Die obere Zeile über dem Bild: Szenen links, Klima rechts.
     *
     *  Beide sassen in derselben Ecke oben rechts. Ohne Szenen fiel das
     *  nicht auf; mit zweien lag die Temperatur unter einem Szenennamen.
     *  `box-none` lässt Tipps durch die Zeile hindurch auf die Kachel -
     *  sonst wäre der halbe Bildkopf tot. */
    kopfZeile: {
      position: 'absolute',
      top: 12,
      left: 14,
      right: 14,
      flexDirection: 'row',
      alignItems: 'flex-start',
      gap: 8,
    },
    szenen: {
      flexDirection: 'row',
      flexShrink: 1,
      flexWrap: 'wrap',
      gap: 6,
    },
    /** Temperatur und Feuchte in der Ecke - eine Pille, keine zwei.
     *
     *  Zwei Pillen nebeneinander läsen sich als zwei Dinge, die man
     *  antippen kann (daneben stehen die Szenen, und die kann man). Das
     *  hier ist eine Auskunft: ein Feld, zwei Zahlen, ein Strich
     *  dazwischen. Nicht schrumpfend, damit die Zahl nicht auf «21…»
     *  abgeschnitten wird - die Szenen weichen zuerst. */
    klima: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      flexShrink: 0,
      marginLeft: 'auto',
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: 'rgba(12, 16, 24, 0.38)',
    },
    /** Der Strich zwischen Grad und Prozent. Ein Punkt wäre zu wenig,
     *  ein Abstand allein liesse «21,5° 48 %» als eine Zahl lesen. */
    klimaStrich: {
      width: 1,
      height: 11,
      marginHorizontal: 2,
      backgroundColor: 'rgba(255, 255, 255, 0.35)',
    },
    klimaWert: {
      color: '#FFFFFF',
      fontSize: 12,
      fontWeight: '600',
      textShadowColor: 'rgba(0, 0, 0, 0.45)',
      textShadowRadius: 8,
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
    standZeile: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    /** Das Männchen in der Farbe, die auf dieser Kachel «hier ist
     *  etwas» heisst - dieselbe wie ein eingeschalteter Knopf. Ein
     *  grauer Strich neben grauem Text läse sich als Verzierung. */
    bewegung: {
      width: 20,
      height: 20,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      // Derselbe grüne Hauch wie ein eingeschalteter Zustand
      // (`onSoft`): Er heisst auf jeder Kachel «hier ist gerade etwas».
      backgroundColor: colors.onSoft,
    },
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
