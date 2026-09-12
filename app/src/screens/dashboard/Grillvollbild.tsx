/**
 * Der Grill gross – die Seite aus der Hersteller-App.
 *
 * Gewünscht im Haus (Punkt 555, Form seit 557), mit einem Bild davon:
 * oben der Name, «GRILL TEMP», die Gartemperatur riesig mit der Einheit
 * gestapelt daneben, ein blauer Balken, «HEIZT AUF 110°», der Knopf
 * «Timer stellen», dann vier grosse Kreise für die Fühler, zwei mal
 * zwei, und unten der Ein/Aus-Knopf.
 *
 * Warum es ein eigenes Blatt ist und nicht die Kachel: Beim Grillen
 * steht man daneben und sieht alle paar Minuten hin. Die Kachel liegt
 * zwischen anderen und trägt kleine Schrift; hier steht die
 * Gartemperatur so gross, dass man sie vom Sofa aus liest. Und die
 * Kachel trägt seit Punkt 557 keine Griffe mehr - alles Bedienen
 * geschieht hier, wo Platz dafür ist. Auch der Timer (Punkt 561): Er
 * ist der Küchen-Timer des Hubs, aber gestellt und abgelesen wird er
 * hier - «und nicht auf die Küchen-Timer».
 *
 * **Vier Kreise, immer.** Auch die leeren: Man sieht auf einen Blick,
 * welcher Platz noch frei ist, statt zu zählen. Ein leerer Kreis sagt
 * «- - -°», nicht eine Zahl - eine geerbte Temperatur vom Nachbarplatz
 * nähme man als Antwort, und dann liegt rohes Fleisch auf dem Teller.
 *
 * **Was bewusst fehlt**, weil im Bild rot durchgestrichen: der
 * Umschalter zwischen °C und °F (die Einheit kommt vom Gerät) und das
 * Licht. **Was hinter einer Rückfrage steht:** Aus und Anzünden. Ein
 * Feuer löscht oder entfacht man nicht mit einem Fehlgriff - genau der
 * Fehlgriff, der auf der alten Kachel den Grill ausschaltete.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { hubClient } from '../../api/client';
import { Entity } from '../../api/types';
import { Grillverlauf } from '../../components/Grillverlauf';
import { remainingLabel } from '../../components/KitchenTimer';
import { useSettings } from '../../hooks/HubContext';
import { useTakt } from '../../hooks/useTakt';
import { GRILLTIMER_MINUTEN, Timer, grilltimer, grilltimerText } from '../../lib/grilltimer';
import {
  FUEHLERFARBEN,
  fuehlerAnteil,
  fuehlerplaetze,
  garstufen,
  grillFortschritt,
  grillstufen,
  ringStrich,
  zielSchritt,
} from '../../lib/grillziel';
import { Colors, radius, useColors } from '../../theme';

/** Die Farbe eines Fühlers - aus lib/grillziel.ts, damit Ring, Ziffer
 *  und Kurve im Diagramm dieselbe tragen. */
function fuehlerFarbe(nummer: string): string {
  return FUEHLERFARBEN[nummer] ?? '#9B6FD6';
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
  const { width } = useWindowDimensions();

  // Der Timer direkt hier (Punkt 561) - derselbe Küchen-Timer des Hubs,
  // nur gestellt und abgelesen, wo man beim Grillen hinsieht. Nicht
  // «alle Timer», sondern die dieses Grills (lib/grilltimer.ts).
  const settings = useSettings();
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [alleTimer, setAlleTimer] = useState<Timer[]>([]);
  const [timerWahl, setTimerWahl] = useState(false);
  const [jetzt, setJetzt] = useState(() => Date.now() / 1000);
  const timerLaden = useCallback(() => {
    hub
      .get<{ timers?: Timer[] } | null>('/api/timers', { fallback: null, still: true })
      .then((antwort) => {
        if (antwort) setAlleTimer(antwort.timers ?? []);
      });
  }, [hub]);
  useEffect(timerLaden, [timerLaden]);
  const timer = grilltimer(alleTimer, entity.name);
  // Die Uhr tickt nur, solange ein Timer läuft; ist er um, verschwindet
  // er beim Hub von selbst - einmal nachladen genügt.
  useTakt(
    () => {
      setJetzt(Date.now() / 1000);
      if (timer.some((t) => t.ends_at <= Date.now() / 1000)) timerLaden();
    },
    timer.length > 0 ? 1000 : null
  );
  const timerStellen = async (minuten: number) => {
    setTimerWahl(false);
    const antwort = await hub.post<{ timers?: Timer[] } | null>(
      '/api/timers',
      { minutes: minuten, text: grilltimerText(entity.name) },
      { fallback: null, still: true }
    );
    if (antwort) setAlleTimer(antwort.timers ?? []);
    else timerLaden();
  };
  const timerAbbrechen = async (id: string) => {
    const antwort = await hub.del<{ timers?: Timer[] } | null>(
      `/api/timers/${encodeURIComponent(id)}`,
      { fallback: null, still: true }
    );
    if (antwort) setAlleTimer(antwort.timers ?? []);
    else timerLaden();
  };
  // Welcher Fühler seine Garstufen offen hat - oder 'grill' für die
  // Gartemperatur selbst.
  const [waehlt, setWaehlt] = useState<string | null>(null);
  // Die Rückfrage vor Aus bzw. Anzünden: erster Tipp fragt, zweiter tut.
  const [fragt, setFragt] = useState(false);
  // Das Diagramm unten (Punkt 566) - zugeklappt, bis man es will: Es
  // holt seinen Verlauf beim Öffnen, und beim Blick auf die Temperatur
  // braucht es ihn nicht.
  const [verlaufOffen, setVerlaufOffen] = useState(false);

  const unit = String(entity.state.unit ?? '°C');
  const grad = '°';
  const buchstabe = unit.replace('°', '') || 'C';
  // Nur Zahlen sind Messwerte: Ein null vom Hub (Punkt 567) rundete
  // sonst zu «0°C» und «Hält 0°» - und das liest sich wie ein kalter
  // Grill, nicht wie eine Lücke.
  const ist =
    typeof entity.state.temperature === 'number' ? entity.state.temperature : undefined;
  const ziel = typeof entity.state.target === 'number' ? entity.state.target : undefined;
  const laeuft = entity.state.state === 'running';
  const probes = (entity.state.probes ?? {}) as Record<string, number>;
  const plaetze = fuehlerplaetze(probes, ziele);
  const anteil = grillFortschritt(ist, ziel);
  // Der gewünschte Sollwert, bis der Grill ihn bestätigt: Zwischen Tipp
  // und nächster Meldung liegen bis zu dreissig Sekunden, und ein Knopf,
  // der so lange nichts zeigt, wird dreimal gedrückt.
  const [wunsch, setWunsch] = useState<number | null>(null);
  useEffect(() => {
    setWunsch(null);
  }, [ziel]);
  const zielAnzeige = wunsch ?? ziel;
  const zielSetzen = (wert: number) => {
    setWunsch(wert);
    onCommand('set_temperature', { temperature: wert });
  };
  const satz =
    ziel === undefined
      ? 'Kein Ziel gesetzt'
      : ist !== undefined && ist >= ziel - 2
        ? `Hält ${Math.round(ziel)}°`
        : `Heizt auf ${Math.round(ziel)}°`;
  // Zwei Kreise nebeneinander, so gross wie das Blatt sie lässt - auf dem
  // Telefon füllen sie die Breite, auf dem iPad bleiben sie bei 150.
  const kreis = Math.min(150, Math.floor((Math.min(width, 440) - 2 * 16 - 16) / 2));

  const schalten = () => {
    if (!fragt) {
      setFragt(true);
      return;
    }
    setFragt(false);
    onCommand(laeuft ? 'turn_off' : 'turn_on');
  };
  const kannSchalten = laeuft
    ? entity.commands.includes('turn_off')
    : entity.commands.includes('turn_on');

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
            <Pressable
              accessibilityLabel="Schliessen"
              onPress={onSchliessen}
              hitSlop={8}
              style={styles.close}
            >
              <Ionicons name="chevron-back" size={24} color={colors.ink} />
            </Pressable>
            <Text style={styles.title} numberOfLines={1}>
              {entity.name}
            </Text>
            <View style={styles.close} />
          </View>

          <ScrollView contentContainerStyle={styles.inhalt}>
            <Text style={styles.label}>GRILL TEMP</Text>
            <View style={styles.grossZeile}>
              <Text style={styles.gross} numberOfLines={1} adjustsFontSizeToFit>
                {ist === undefined ? '- - -' : `${Math.round(ist)}`}
              </Text>
              {/* Die Einheit gestapelt: das Grad über dem Buchstaben,
                  wie auf dem Gerät. */}
              <View style={styles.einheit}>
                <Text style={styles.einheitGrad}>{grad}</Text>
                <Text style={styles.einheitBuchstabe}>{buchstabe}</Text>
              </View>
            </View>

            <View style={styles.balken}>
              <View
                style={[styles.balkenFuell, { width: `${(anteil ?? 0) * 100}%` }]}
                accessibilityRole="progressbar"
                accessibilityValue={{
                  min: 0,
                  max: 100,
                  now: Math.round((anteil ?? 0) * 100),
                }}
              />
            </View>
            <Text style={styles.satz}>{satz.toUpperCase()}</Text>

            {/* Die Zieltemperatur als sichtbarer Griff (Punkt 565): − und +
                springen von Raste zu Raste, ein Tipp auf die Zahl zeigt
                alle Rasten. Vorher war der Griff ein Tipp auf die grosse
                Zahl - den fand niemand. */}
            {entity.commands.includes('set_temperature') ? (
              <View style={styles.zielZeile}>
                <Pressable
                  onPress={() => zielSetzen(zielSchritt(zielAnzeige, -1, unit))}
                  accessibilityRole="button"
                  accessibilityLabel="Ziel senken"
                  hitSlop={6}
                  style={({ pressed }) => [styles.zielKnopf, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="remove" size={22} color={colors.ink} />
                </Pressable>
                <Pressable
                  onPress={() => setWaehlt((offen) => (offen === 'grill' ? null : 'grill'))}
                  accessibilityRole="button"
                  accessibilityLabel="Zieltemperatur wählen"
                  accessibilityState={{ expanded: waehlt === 'grill' }}
                  style={({ pressed }) => [styles.zielMitte, pressed && { opacity: 0.6 }]}
                >
                  <Text style={styles.zielText}>
                    {zielAnzeige === undefined ? 'ZIEL –' : `ZIEL ${Math.round(zielAnzeige)}°`}
                  </Text>
                </Pressable>
                <Pressable
                  onPress={() => zielSetzen(zielSchritt(zielAnzeige, 1, unit))}
                  accessibilityRole="button"
                  accessibilityLabel="Ziel erhöhen"
                  hitSlop={6}
                  style={({ pressed }) => [styles.zielKnopf, pressed && { opacity: 0.6 }]}
                >
                  <Ionicons name="add" size={22} color={colors.ink} />
                </Pressable>
              </View>
            ) : null}

            {waehlt === 'grill' && entity.commands.includes('set_temperature') ? (
              <View style={styles.stufenReihe}>
                {grillstufen(unit).map((stufe) => (
                  <Pressable
                    key={stufe}
                    onPress={() => {
                      zielSetzen(stufe);
                      setWaehlt(null);
                    }}
                    accessibilityRole="button"
                    style={({ pressed }) => [
                      styles.stufe,
                      zielAnzeige === stufe && styles.stufeAktiv,
                      pressed && { opacity: 0.6 },
                    ]}
                  >
                    <Text style={styles.stufeText}>{stufe}°</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {entity.state.problem ? (
              <Text style={styles.problem}>{String(entity.state.problem)}</Text>
            ) : null}

            {/* Läuft ein Timer, steht er hier mit seiner Restzeit -
                statt des Knopfs, denn beim Grillen läuft einer nach dem
                andern, nicht zwei nebeneinander. */}
            {timer.map((t) => (
              <View key={t.id} style={styles.timerLauf}>
                <Ionicons name="timer-outline" size={22} color={colors.ink} />
                <Text style={styles.timerText}>NOCH {remainingLabel(t.ends_at, jetzt)}</Text>
                <Pressable
                  onPress={() => timerAbbrechen(t.id)}
                  accessibilityRole="button"
                  accessibilityLabel="Timer abbrechen"
                  hitSlop={8}
                >
                  <Ionicons name="close-circle" size={22} color={colors.inkSoft} />
                </Pressable>
              </View>
            ))}
            {timer.length === 0 ? (
              <Pressable
                onPress={() => setTimerWahl((offen) => !offen)}
                accessibilityRole="button"
                accessibilityLabel="Timer stellen"
                accessibilityState={{ expanded: timerWahl }}
                style={({ pressed }) => [styles.timer, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="timer-outline" size={22} color={colors.ink} />
                <Text style={styles.timerText}>TIMER STELLEN</Text>
              </Pressable>
            ) : null}
            {timerWahl && timer.length === 0 ? (
              <View style={styles.stufenReihe}>
                {GRILLTIMER_MINUTEN.map((minuten) => (
                  <Pressable
                    key={minuten}
                    onPress={() => timerStellen(minuten)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.stufe, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.stufeText}>{minuten} Min.</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}

            {/* Die vier Fühler - zwei mal zwei, wie am Gerät. Der Ring
                wächst mit der Kerntemperatur auf das Ziel zu (Punkt
                566), und das Ziel steht unter dem Wert. Ein leerer Platz
                ist gedimmt und lässt sich nicht antippen: Ein Ziel für
                einen Fühler, der nicht steckt, wäre ein Versprechen ohne
                Messung. */}
            <View style={styles.kreise}>
              {plaetze.map((platz) => {
                const farbe = fuehlerFarbe(platz.nummer);
                const leer = platz.wert === null;
                const anteil = fuehlerAnteil(platz.wert, platz.ziel);
                const r = kreis / 2 - 4;
                const strich = ringStrich(r, anteil ?? 0);
                return (
                  <Pressable
                    key={platz.nummer}
                    disabled={leer}
                    onPress={() =>
                      setWaehlt((offen) => (offen === platz.nummer ? null : platz.nummer))
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      leer
                        ? `Fühler ${platz.nummer}, nicht eingesteckt`
                        : `Fühler ${platz.nummer}, ${platz.anzeige}${
                            platz.ziel === null ? ', Ziel setzen' : `, Ziel ${Math.round(platz.ziel)}°`
                          }`
                    }
                    accessibilityState={{ expanded: waehlt === platz.nummer, disabled: leer }}
                    style={({ pressed }) => [
                      styles.kreis,
                      { width: kreis, height: kreis },
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    {/* Der Ring: die Spur grau, darüber der gefüllte Teil
                        in der Farbe des Fühlers - von unten weg im
                        Uhrzeigersinn, wie am Gerät. */}
                    <Svg
                      width={kreis}
                      height={kreis}
                      style={StyleSheet.absoluteFill}
                      pointerEvents="none"
                    >
                      <Circle
                        cx={kreis / 2}
                        cy={kreis / 2}
                        r={r}
                        stroke={colors.surfaceBorder}
                        strokeWidth={4}
                        fill="none"
                        opacity={leer ? 0.5 : 1}
                      />
                      {anteil !== null ? (
                        <Circle
                          cx={kreis / 2}
                          cy={kreis / 2}
                          r={r}
                          stroke={farbe}
                          strokeWidth={4}
                          strokeLinecap="round"
                          fill="none"
                          strokeDasharray={`${strich.voll} ${strich.umfang}`}
                          rotation={90}
                          origin={`${kreis / 2}, ${kreis / 2}`}
                        />
                      ) : null}
                    </Svg>
                    <Text
                      style={[styles.kreisNummer, { color: farbe }, leer && { opacity: 0.4 }]}
                    >
                      P{platz.nummer}
                    </Text>
                    <Text style={[styles.kreisWert, leer && styles.kreisWertLeer]}>
                      {platz.anzeige}
                    </Text>
                    <Text style={styles.kreisZiel}>
                      {leer ? ' ' : platz.ziel === null ? 'SET' : `${Math.round(platz.ziel)}°`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>

            {waehlt && waehlt !== 'grill' ? (
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
            {/* «Cooking Analytics» der Hersteller-App: der Verlauf des
                Abends als Diagramm (Punkt 566). */}
            <Pressable
              onPress={() => setVerlaufOffen((offen) => !offen)}
              accessibilityRole="button"
              accessibilityLabel="Verlauf"
              accessibilityState={{ expanded: verlaufOffen }}
              style={({ pressed }) => [styles.verlaufKnopf, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.verlaufText}>VERLAUF {verlaufOffen ? '⌄' : '›'}</Text>
            </Pressable>
            {verlaufOffen ? (
              <Grillverlauf entity={entity} width={Math.min(width, 440) - 2 * 16} />
            ) : null}
          </ScrollView>

          {/* Unten der Schalter - grün, solange der Grill läuft. Der
              erste Tipp fragt, der zweite schaltet: Anzünden entfacht
              ein Feuer neben dem gerade niemand stehen muss, und Aus
              macht die Glut von zwei Stunden zunichte. */}
          {kannSchalten ? (
            <View style={styles.fuss}>
              <Pressable
                onPress={schalten}
                accessibilityRole="button"
                accessibilityLabel={
                  fragt
                    ? laeuft
                      ? 'Wirklich ausschalten?'
                      : 'Wirklich anzünden?'
                    : laeuft
                      ? 'Grill ausschalten'
                      : 'Grill anzünden'
                }
                style={({ pressed }) => [styles.schalter, pressed && { opacity: 0.7 }]}
              >
                <Ionicons
                  name="power"
                  size={26}
                  color={laeuft ? '#4CAF7D' : colors.inkSoft}
                />
              </Pressable>
              {fragt ? (
                <Text style={styles.frage}>
                  {laeuft ? 'Nochmals tippen zum Ausschalten' : 'Nochmals tippen zum Anzünden'}
                </Text>
              ) : null}
            </View>
          ) : null}
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
      maxWidth: 440,
      maxHeight: '94%',
      borderRadius: radius.card,
      backgroundColor: colors.surfaceStrong,
      overflow: 'hidden',
    },
    header: {
      flexDirection: 'row',
      alignItems: 'center',
      paddingHorizontal: 8,
      paddingTop: 10,
    },
    title: {
      flex: 1,
      textAlign: 'center',
      color: colors.inkSoft,
      fontSize: 17,
      fontWeight: '500',
    },
    close: { width: 40, padding: 6, alignItems: 'center' },
    inhalt: { padding: 16, gap: 10, alignItems: 'center' },
    label: {
      color: colors.accent,
      fontSize: 15,
      letterSpacing: 1,
      fontWeight: '600',
    },
    grossZeile: { flexDirection: 'row', alignItems: 'flex-start', justifyContent: 'center' },
    /** So gross, dass man sie vom Sofa aus liest - der ganze Grund für
     *  dieses Blatt. */
    gross: { color: colors.ink, fontSize: 96, fontWeight: '800', lineHeight: 104 },
    einheit: { paddingTop: 22, alignItems: 'center' },
    einheitGrad: { color: colors.ink, fontSize: 26, fontWeight: '800', lineHeight: 26 },
    einheitBuchstabe: { color: colors.ink, fontSize: 26, fontWeight: '800', lineHeight: 28 },
    balken: {
      width: '100%',
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.surfaceSoft,
      overflow: 'hidden',
    },
    balkenFuell: { height: '100%', backgroundColor: colors.accent },
    satz: { color: colors.ink, fontSize: 28, fontWeight: '300', letterSpacing: 0.5 },
    zielZeile: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 2 },
    zielKnopf: {
      width: 40,
      height: 40,
      borderRadius: 20,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1.5,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    zielMitte: { paddingHorizontal: 10, paddingVertical: 6 },
    zielText: { color: colors.inkSoft, fontSize: 18, fontWeight: '300', letterSpacing: 1 },
    problem: { color: colors.warnInk, fontSize: 13, fontWeight: '700' },
    timer: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 22,
      paddingVertical: 10,
      borderRadius: 8,
      borderWidth: 1.5,
      borderColor: colors.ink,
      marginTop: 4,
    },
    timerText: { color: colors.ink, fontSize: 20, fontWeight: '300', letterSpacing: 0.5 },
    timerLauf: { flexDirection: 'row', alignItems: 'center', gap: 10, marginTop: 4 },
    kreise: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 16,
      marginTop: 10,
    },
    kreis: {
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    kreisLeer: { opacity: 0.6 },
    kreisNummer: { fontSize: 22, fontWeight: '800' },
    kreisWert: { color: colors.ink, fontSize: 30, fontWeight: '400' },
    kreisWertLeer: { color: colors.inkFaint, letterSpacing: 2 },
    kreisZiel: { color: colors.ink, fontSize: 18, fontWeight: '300', letterSpacing: 1 },
    verlaufKnopf: { paddingVertical: 8, marginTop: 6 },
    verlaufText: { color: colors.ink, fontSize: 18, fontWeight: '300', letterSpacing: 0.5 },
    stufen: { width: '100%', gap: 8, marginTop: 4 },
    stufenKopf: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
    stufenReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, justifyContent: 'center' },
    stufe: {
      paddingHorizontal: 10,
      paddingVertical: 6,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    stufeAktiv: { backgroundColor: colors.accentSoft, borderColor: colors.accent },
    stufeText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
    fuss: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingHorizontal: 20,
      paddingVertical: 10,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.surfaceBorder,
    },
    schalter: { padding: 8 },
    frage: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  });
