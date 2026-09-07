import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Modal, Pressable, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings, User } from '../api/types';
import { Card } from './Card';
import {
  BEREICHE,
  EINFUEHRUNG_STAND,
  EinfuehrungSchritt,
  schritteFuer,
  zeigtEinfuehrung,
} from '../lib/einfuehrung';
import { persoenlichSetzen } from '../lib/persoenlich';
import { giltAlsNeuGeoeffnet } from '../lib/wiederkehr';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Die Einführung beim ersten Öffnen - ein blätterbares Blatt, keine Tour.
 *
 * Kein Overlay, das mit Pfeilen auf echte Bedienelemente zeigt: Die
 * Leiste liegt auf dem Telefon unten, auf dem iPad links, im Browser je
 * nach Fenster - ein Pfeil, der überall die richtige Stelle träfe,
 * müsste jedes Layout kennen und bräche beim nächsten Umbau still,
 * mitten auf dem Bildschirm des einen Geräts, das niemand prüft.
 *
 * Gezeigt wird trotzdem: Jeder Schritt trägt ein Schaubild IM Blatt
 * (lib/einfuehrung.ts, `schaubild`). Das wichtigste ist die Leiste mit
 * ihren echten Symbolen - antippbar, und die App wechselt dahinter live
 * mit (`onBereich`): Wer «Licht» einmal selbst gedrückt hat, muss sich
 * die Aufzählung nicht merken. Vorher stand hier «Start, Räume, Licht,
 * Storen, Familie» als Prosa, und jeder übersetzte sie im Kopf erst
 * wieder in Symbole.
 *
 * Der «einmal pro Person»-Mechanismus ist derselbe wie bei «Was ist neu»
 * (WhatsNew.tsx, lib/wiederkehr.ts): Das Gesehen-Sein liegt als
 * Schlüssel `einfuehrungGesehen` in den persönlichen Hub-Prefs
 * (lib/persoenlich.ts) - einmal gesehen heisst überall gesehen, und die
 * Neuinstallation fängt nicht von vorne an. Gelesen wird der Stand
 * direkt vom Hub statt über usePrefs: Das Blatt hängt am obersten
 * Bildschirm, und ein weiteres Prop-Paar durch den Dashboard wäre genau
 * die Schleppe, für die lib/persoenlich.ts der kurze Weg ist.
 *
 * Für Gäste und Babysitter zeigt dasselbe Blatt die kurze «So
 * funktioniert das hier»-Fassung - wer entscheidet, steht in
 * lib/einfuehrung.ts (fassungFuer).
 */
export function Einfuehrung({
  settings,
  user,
  erzwungen = false,
  onErzwungenZu,
  onBereich,
}: {
  settings: HubSettings;
  /** Der angemeldete Benutzer - entscheidet über die Fassung. */
  user: User | null;
  /** Aus der Hilfe heraus: «Einführung erneut zeigen». */
  erzwungen?: boolean;
  onErzwungenZu?: () => void;
  /** Ein Bereich im Schaubild wurde angetippt - die App soll dahinter
   *  live dorthin wechseln (Ausprobieren statt Merken). */
  onBereich?: (key: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);

  // Welche Fassung schon weggeklickt wurde - undefined heisst «nie»,
  // aber erst, wenn `geladen` das bestätigt. Ohne Antwort vom Hub gibt
  // es keine Aussage und darum kein Blatt: Lieber gar nicht zeigen als
  // jemandem, der sie längst kennt, die Begrüssung noch einmal.
  const [gesehen, setGesehen] = useState<number | undefined>(undefined);
  const [geladen, setGeladen] = useState(false);
  const [zurueckgestellt, setZurueckgestellt] = useState(false);
  const [schritt, setSchritt] = useState(0);
  // Welcher Bereich im Schaubild zuletzt ausprobiert wurde - nur fürs
  // Aufleuchten des Knopfs; den Wechsel dahinter macht `onBereich`.
  const [getippt, setGetippt] = useState('start');

  const laden = useCallback(() => {
    hubClient(settings.url, settings.token)
      .get<{ prefs?: { einfuehrungGesehen?: unknown } } | null>('/api/prefs', {
        fallback: null,
        still: true,
      })
      .then((data) => {
        if (!data) return;
        const wert = data.prefs?.einfuehrungGesehen;
        setGesehen(typeof wert === 'number' ? wert : undefined);
        setGeladen(true);
      });
  }, [settings.url, settings.token]);

  useEffect(laden, [laden]);

  // Zurück aus dem Hintergrund ist ein Öffnen (lib/wiederkehr.ts) - dann
  // ist auch das Weggetippt-Sein von vorhin verbraucht. Neu geladen wird
  // ebenfalls: Vielleicht wurde die Einführung inzwischen auf dem
  // anderen Gerät zu Ende gelesen.
  const wegSeit = useRef<number | null>(null);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (naechster) => {
      if (naechster !== 'active') {
        wegSeit.current = wegSeit.current ?? Date.now();
        return;
      }
      const weg = wegSeit.current;
      wegSeit.current = null;
      if (!giltAlsNeuGeoeffnet(weg, Date.now())) return;
      setZurueckgestellt(false);
      laden();
    });
    return () => sub.remove();
  }, [laden]);

  const schritte = schritteFuer(user);
  const zeigen =
    erzwungen || zeigtEinfuehrung({ geladen, gesehen, zurueckgestellt });

  // Beim Aufgehen wieder vorne anfangen - auch beim «erneut zeigen».
  useEffect(() => {
    if (zeigen) {
      setSchritt(0);
      setGetippt('start');
    }
  }, [zeigen]);

  if (!zeigen) return null;

  const aktuell = schritte[Math.min(schritt, schritte.length - 1)];
  const letzter = schritt >= schritte.length - 1;

  const fertig = () => {
    // Fertig gelesen heisst gesehen - für diese Person, überall.
    persoenlichSetzen(settings, 'einfuehrungGesehen', EINFUEHRUNG_STAND);
    setGesehen(EINFUEHRUNG_STAND);
    onErzwungenZu?.();
  };

  const wegtippen = () => {
    // Nur für diesen Besuch weg: Wegtippen ist kein Gelesen-Haben -
    // beim nächsten Öffnen ist das Blatt wieder da (wie bei WhatsNew).
    setZurueckgestellt(true);
    onErzwungenZu?.();
  };

  return (
    <Modal visible transparent animationType="fade" onRequestClose={wegtippen}>
      {/* Der Tipp neben das Blatt schliesst es - «jederzeit wegtippbar»
          heisst: kein Zwang, erst vier Seiten durchzublättern. */}
      <Pressable style={styles.backdrop} onPress={wegtippen}>
        <Pressable onPress={() => {}}>
          <Card style={styles.card}>
            <View style={styles.head}>
              <Ionicons name={aktuell.icon} size={22} color={colors.accent} />
              <Text style={styles.title}>{aktuell.titel}</Text>
            </View>
            <Schaubild
              art={aktuell.schaubild}
              getippt={getippt}
              onBereich={(key) => {
                setGetippt(key);
                onBereich?.(key);
              }}
              styles={styles}
              colors={colors}
            />
            {/* Direkt statt in einer ScrollView: Neben dem Schaubild
                kollabierte die auf eine Zeile und schnitt den Satz ab.
                Die Texte sind bewusst kurz - scrollen muss hier nichts. */}
            <Text style={styles.text}>{aktuell.text}</Text>

            {schritte.length > 1 ? (
              <View style={styles.dots} accessibilityLabel={`Schritt ${schritt + 1} von ${schritte.length}`}>
                {schritte.map((_, index) => (
                  <View
                    key={index}
                    style={[styles.dot, index === schritt && styles.dotAktiv]}
                  />
                ))}
              </View>
            ) : null}

            <View style={styles.buttons}>
              {schritt > 0 ? (
                <Pressable
                  onPress={() => setSchritt((n) => Math.max(0, n - 1))}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.buttonText}>Zurück</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={wegtippen}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.button, pressed && { opacity: 0.7 }]}
                >
                  <Text style={styles.buttonText}>Später</Text>
                </Pressable>
              )}
              <View style={{ flex: 1 }} />
              <Pressable
                onPress={letzter ? fertig : () => setSchritt((n) => n + 1)}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.button,
                  styles.buttonPrimary,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text style={[styles.buttonText, { color: '#FFFFFF' }]}>
                  {letzter ? 'Alles klar' : 'Weiter'}
                </Text>
              </Pressable>
            </View>
          </Card>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

/**
 * Das Schaubild eines Schritts - zeigen statt beschreiben.
 *
 * Die Leiste besteht aus den echten Symbolen und ist antippbar: Die App
 * wechselt dahinter live mit, und der gedrückte Knopf leuchtet - wer
 * «Licht» einmal selbst getroffen hat, muss sich nichts merken. Der
 * «Alles aus»-Knopf und das Suchfeld sind Abbilder zum Wiedererkennen,
 * keine Bedienelemente: Ein Knopf, der aus der Einführung heraus die
 * halbe Wohnung abschaltet, wäre eine Falle.
 */
function Schaubild({
  art,
  getippt,
  onBereich,
  styles,
  colors,
}: {
  art: EinfuehrungSchritt['schaubild'];
  getippt: string;
  onBereich: (key: string) => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  if (art === 'leiste') {
    return (
      <View style={styles.leiste}>
        {BEREICHE.map((bereich) => {
          const an = getippt === bereich.key;
          return (
            <Pressable
              key={bereich.key}
              onPress={() => onBereich(bereich.key)}
              accessibilityRole="button"
              accessibilityLabel={`Bereich ${bereich.label} ausprobieren`}
              style={({ pressed }) => [
                styles.leisteKnopf,
                an && styles.leisteKnopfAn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons
                name={bereich.icon}
                size={22}
                color={an ? colors.accent : colors.inkSoft}
              />
              <Text style={[styles.leisteLabel, an && { color: colors.accent }]}>
                {bereich.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
    );
  }
  if (art === 'allesaus') {
    // Genau so, wie der Chip in den Räumen aussieht (AllOff.tsx,
    // compact) - ein rotes Abbild sähe zwar dringlicher aus, aber wer
    // danach sucht, sucht dann das Falsche.
    return (
      <View style={styles.schaubild}>
        <View style={styles.allesAus}>
          <Ionicons name="power-outline" size={15} color={colors.ink} />
          <Text style={styles.allesAusText}>Alles aus (3)</Text>
        </View>
      </View>
    );
  }
  if (art === 'suche') {
    return (
      <View style={styles.schaubild}>
        <View style={styles.suchfeld}>
          <Ionicons name="search-outline" size={16} color={colors.inkFaint} />
          <Text style={styles.suchfeldText}>«ess» findet die Esstisch-Lampe</Text>
        </View>
      </View>
    );
  }
  return null;
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    backdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'center',
      padding: 20,
    },
    // Deckend wie bei WhatsNew: colors.surface ist durchscheinend, und
    // über dem abgedunkelten Hintergrund würde der Text unlesbar.
    card: {
      minHeight: 0,
      gap: 12,
      // Kein maxHeight mehr: Gegen den Wickel-Pressable ohne feste Höhe
      // kollabierte das Prozentmass, und die Knöpfe ragten unter die
      // Kartenkante. Der Inhalt ist kurz und fix - die Karte darf so
      // hoch sein, wie er braucht.
      backgroundColor: colors.panel,
      alignSelf: 'center',
      width: '100%',
      maxWidth: 440,
    },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    title: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700', flex: 1 },
    text: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
    dots: { flexDirection: 'row', gap: 6, justifyContent: 'center' },
    dot: {
      width: 7,
      height: 7,
      borderRadius: 4,
      backgroundColor: colors.surfaceBorder,
    },
    dotAktiv: { backgroundColor: colors.accent },
    buttons: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 2 },
    button: {
      paddingVertical: 8,
      paddingHorizontal: 16,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    buttonPrimary: { backgroundColor: colors.accent, borderColor: colors.accent },
    buttonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    // Die Schaubilder: eine ruhige Fläche über dem Text, auf der etwas
    // zum Wiedererkennen steht - die Leiste, der Knopf, das Suchfeld.
    leiste: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      gap: 4,
      padding: 8,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    leisteKnopf: {
      flex: 1,
      alignItems: 'center',
      gap: 4,
      paddingVertical: 8,
      borderRadius: radius.control,
    },
    leisteKnopfAn: { backgroundColor: colors.surfaceStrong },
    leisteLabel: { color: colors.inkSoft, fontSize: 11, fontWeight: '600' },
    schaubild: {
      alignItems: 'center',
      padding: 14,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    // Dieselbe Form wie der echte Chip in den Räumen (AllOff.tsx).
    allesAus: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    allesAusText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    suchfeld: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'stretch',
      paddingHorizontal: 12,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    suchfeldText: { color: colors.inkFaint, fontSize: 13 },
  });
