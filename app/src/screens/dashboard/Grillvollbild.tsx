/**
 * Der Grill gross – wie in der Hersteller-App.
 *
 * Gewünscht im Haus (Punkt 555), mit einem Bild davon: «So eine
 * Popup-Karte will ich auch im Raum Grill. Wenn man auf die Live-
 * Aktivität klickt, oder auf eine Push vom Grill, soll man auf die
 * Seite Grill kommen und das Popup soll sich öffnen.»
 *
 * Warum es ein eigenes Blatt ist und nicht die Kachel: Beim Grillen
 * steht man daneben und sieht alle paar Minuten hin. Die Kachel liegt
 * zwischen anderen und trägt kleine Schrift; hier steht die
 * Gartemperatur so gross, dass man sie vom Sofa aus liest, und die vier
 * Fühler als Kreise darunter - in derselben Anordnung wie am Gerät.
 *
 * **Vier Kreise, immer.** Auch die leeren: Man sieht auf einen Blick,
 * welcher Platz noch frei ist, statt zu zählen. Ein Kreis, der erst mit
 * dem Fühler erscheint, liesse einen suchen, ob man den richtigen
 * Anschluss erwischt hat.
 *
 * **Was bewusst fehlt**, weil im Bild durchgestrichen: der Umschalter
 * zwischen °C und °F (die Einheit kommt vom Gerät, und sie hier zu
 * ändern hiesse, dem Grill etwas anderes zu sagen als der Kachel) und
 * das Licht. Ausschalten bleibt - das ist die sichere Richtung, und sie
 * gehört dorthin, wo man ohnehin hinsieht.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { Entity } from '../../api/types';
import {
  fuehlerplaetze,
  garstufen,
  grillFortschritt,
} from '../../lib/grillziel';
import { Colors, radius, useColors } from '../../theme';

/** Die Farben der Fühler - dieselbe Zuteilung wie auf der Live-Karte
 *  (hub: core/livekarten.py, FUEHLERFARBEN) und am Gerät selbst. */
const FARBEN: Record<string, keyof Colors | 'gelb' | 'rot' | 'blau' | 'gruen'> = {
  '1': 'blau',
  '2': 'gelb',
  '3': 'rot',
  '4': 'gruen',
};

function fuehlerFarbe(nummer: string, colors: Colors): string {
  switch (FARBEN[nummer]) {
    case 'gelb':
      return '#E8C23A';
    case 'rot':
      return colors.danger;
    case 'gruen':
      return '#4CAF7D';
    default:
      return colors.accent;
  }
}

export function Grillvollbild({
  entity,
  ziele,
  onZiel,
  onCommand,
  onSchliessen,
}: {
  entity: Entity;
  /** Die gesetzten Kerntemperatur-Ziele, je Fühlernummer. */
  ziele: Record<string, number>;
  onZiel: (nummer: string, wert: number | null) => void;
  onCommand: (command: string, data?: Record<string, unknown>) => void;
  onSchliessen: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [waehlt, setWaehlt] = useState<string | null>(null);

  const unit = String(entity.state.unit ?? '°C');
  const ist = entity.state.temperature as number | undefined;
  const ziel = entity.state.target as number | undefined;
  const laeuft = entity.state.state === 'running';
  const probes = (entity.state.probes ?? {}) as Record<string, number>;
  const plaetze = fuehlerplaetze(probes, ziele);
  const anteil = grillFortschritt(ist, ziel);
  // Derselbe Satz wie auf der Live-Karte, damit beide dasselbe sagen.
  const satz =
    ziel === undefined
      ? 'Kein Ziel gesetzt'
      : ist !== undefined && ist >= ziel - 2
        ? `Hält ${Math.round(ziel)}${unit}`
        : `Heizt auf ${Math.round(ziel)}${unit}`;

  return (
    <Modal visible transparent animationType="fade" onRequestClose={onSchliessen}>
      {/* Der Hintergrund als Geschwister, nicht als Eltern-Pressable:
          Verschachtelte Pressables verhalten sich im Web und nativ
          nicht gleich (siehe components/TvRemote.tsx). */}
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFill}
          onPress={onSchliessen}
          accessibilityLabel="Grill schliessen"
        />
        <View style={styles.sheet}>
          <View style={styles.header}>
            <Text style={styles.title} numberOfLines={1}>
              {entity.name}
            </Text>
            <Pressable
              accessibilityLabel="Schliessen"
              onPress={onSchliessen}
              style={styles.close}
            >
              <Ionicons name="close" size={20} color={colors.inkSoft} />
            </Pressable>
          </View>

          <ScrollView contentContainerStyle={styles.inhalt}>
            <Text style={styles.label}>GARRAUM</Text>
            <Text style={styles.gross} numberOfLines={1} adjustsFontSizeToFit>
              {ist === undefined ? '—' : `${Math.round(ist)}`}
              <Text style={styles.einheit}>{unit}</Text>
            </Text>

            {anteil !== null ? (
              <View
                style={styles.balken}
                accessibilityRole="progressbar"
                accessibilityValue={{ min: 0, max: 100, now: Math.round(anteil * 100) }}
              >
                <View style={[styles.balkenFuell, { width: `${anteil * 100}%` }]} />
              </View>
            ) : null}
            <Text style={styles.satz}>{satz}</Text>

            {entity.state.problem ? (
              <Text style={styles.problem}>{String(entity.state.problem)}</Text>
            ) : null}

            {/* Die vier Fühler - zwei nebeneinander, wie am Gerät. */}
            <View style={styles.kreise}>
              {plaetze.map((platz) => (
                <Pressable
                  key={platz.nummer}
                  onPress={() =>
                    setWaehlt((offen) => (offen === platz.nummer ? null : platz.nummer))
                  }
                  accessibilityRole="button"
                  accessibilityLabel={`Fühler ${platz.nummer}, Ziel setzen`}
                  accessibilityState={{ expanded: waehlt === platz.nummer }}
                  style={({ pressed }) => [
                    styles.kreis,
                    { borderColor: fuehlerFarbe(platz.nummer, colors) },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.kreisNummer,
                      { color: fuehlerFarbe(platz.nummer, colors) },
                    ]}
                  >
                    P{platz.nummer}
                  </Text>
                  <Text style={styles.kreisWert}>{platz.anzeige}</Text>
                  <Text style={styles.kreisZiel}>
                    {platz.ziel === null ? 'Ziel setzen' : `Ziel ${Math.round(platz.ziel)}°`}
                  </Text>
                </Pressable>
              ))}
            </View>

            {waehlt ? (
              <View style={styles.stufen}>
                <Text style={styles.stufenKopf}>Ziel für Fühler {waehlt}</Text>
                <View style={styles.stufenReihe}>
                  {garstufen(unit).map((stufe) => (
                    <Pressable
                      key={stufe.wert}
                      onPress={() => {
                        onZiel(waehlt, stufe.wert);
                        setWaehlt(null);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.stufe,
                        ziele[waehlt] === stufe.wert && styles.stufeAktiv,
                        pressed && { opacity: 0.6 },
                      ]}
                    >
                      <Text style={styles.stufeText}>{stufe.label}</Text>
                    </Pressable>
                  ))}
                  {ziele[waehlt] !== undefined ? (
                    <Pressable
                      onPress={() => {
                        onZiel(waehlt, null);
                        setWaehlt(null);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.stufe, pressed && { opacity: 0.6 }]}
                    >
                      <Text style={styles.stufeText}>kein Ziel</Text>
                    </Pressable>
                  ) : null}
                </View>
              </View>
            ) : null}

            {/* Ausschalten bleibt - die sichere Richtung. Anzünden
                steht bewusst nicht hier: Es entfacht ein Feuer in einem
                Gerät, neben dem gerade niemand stehen muss, und diese
                Entscheidung gehört an die Kachel mit ihrer Rückfrage
                (components/entity/koerper.tsx). */}
            {laeuft && entity.commands.includes('turn_off') ? (
              <Pressable
                onPress={() => onCommand('turn_off')}
                accessibilityRole="button"
                style={({ pressed }) => [styles.aus, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="power" size={18} color={colors.ink} />
                <Text style={styles.ausText}>Ausschalten</Text>
              </Pressable>
            ) : null}
          </ScrollView>
        </View>
      </View>
    </Modal>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0, 0, 0, 0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 16,
    },
    sheet: {
      width: '100%',
      maxWidth: 420,
      maxHeight: '90%',
      borderRadius: radius.card,
      backgroundColor: colors.surfaceStrong,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingTop: 14,
    },
    title: { flex: 1, color: colors.ink, fontSize: 17, fontWeight: '700' },
    close: { padding: 6 },
    inhalt: { padding: 16, gap: 10, alignItems: 'center' },
    label: { color: colors.inkFaint, fontSize: 12, letterSpacing: 1.2, fontWeight: '700' },
    /** So gross, dass man sie vom Sofa aus liest - der ganze Grund für
     *  dieses Blatt. */
    gross: { color: colors.ink, fontSize: 68, fontWeight: '800', lineHeight: 76 },
    einheit: { fontSize: 24, fontWeight: '700' },
    balken: {
      width: '100%',
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceSoft,
      overflow: 'hidden',
    },
    balkenFuell: { height: '100%', backgroundColor: colors.accent },
    satz: { color: colors.ink, fontSize: 16, fontWeight: '600' },
    problem: { color: colors.warnInk, fontSize: 13, fontWeight: '700' },
    kreise: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 12,
      marginTop: 6,
    },
    kreis: {
      width: 130,
      height: 130,
      borderRadius: 65,
      borderWidth: 2,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 2,
    },
    kreisNummer: { fontSize: 14, fontWeight: '800' },
    kreisWert: { color: colors.ink, fontSize: 26, fontWeight: '700' },
    kreisZiel: { color: colors.inkFaint, fontSize: 11 },
    stufen: { width: '100%', gap: 8, marginTop: 4 },
    stufenKopf: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
    stufenReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    stufe: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    stufeAktiv: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    stufeText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
    aus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginTop: 6,
    },
    ausText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  });
