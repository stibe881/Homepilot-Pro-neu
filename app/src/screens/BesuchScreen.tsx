import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HubSettings } from '../api/types';
import { BesuchKarte } from '../components/BesuchKarte';
import { Card } from '../components/Card';
import { BabysitterStand, modusSatz } from '../lib/babysitter';
import { Colors, space, type, useColors } from '../theme';

/**
 * «Es ist jemand da» – Besuch oder Babysitter, als eigene Seite.
 *
 * Sonst tut man jedes Mal dasselbe an mehreren Orten: die Abläufe
 * anhalten – und am Ende alles wieder zurück. Den letzten Schritt
 * vergisst man, deshalb kann der Modus eine Frist tragen und endet dann
 * von selbst.
 *
 * Das Gäste-WLAN stand hier einmal als dritte Karte mit QR-Code. Es
 * wohnt jetzt dort, wo es hingehört und wo es auch ohne Besuch zu
 * finden ist: in der Gäste-WLAN-Karte (components/GaesteWlan.tsx) und
 * hinter dem WLAN-Zeichen der Begrüssungskarte. Zweimal derselbe Code
 * an zwei Orten heisst, dass einer davon irgendwann der veraltete ist.
 *
 * Die erste Karte - Zustand, Dauer, Knopf - wohnt in
 * components/BesuchKarte.tsx: Sie steht auch als Blatt hinter dem
 * Symbol in der Begrüssungskarte, und zwei Nachbauten desselben
 * Schalters schalten ein halbes Jahr später verschieden.
 *
 * **War vorher ein Blatt** (components/BesuchBlatt.tsx): ein Popup mit
 * innerem Scrollbereich, in dem Dauer, Lichter und der WLAN-Code
 * übereinandergestapelt lagen. Als einziger Menüpunkt neben Suche und
 * Sorgen führte «Besuch» nicht zu einer Seite – und das Blatt musste
 * knapp bleiben, wo die Seite erklären kann. Jetzt derselbe Weg wie bei
 * Lautsprechern oder der Alarmanlage: ein Bereich, Karten, Platz.
 *
 * Was der Modus nicht anfasst: die Alarmanlage. Ein Knopf, der sie
 * entschärft, wäre kein Komfort mehr, sondern ein Loch.
 */

export function BesuchScreen({
  settings,
  onStand,
  onAblaeufe,
}: {
  settings: HubSettings;
  /** Meldet jeden frischen Stand nach oben – die Zeile im
   *  Einstellungsmenü soll sagen, was hier gerade entschieden wurde. */
  onStand?: (stand: BabysitterStand | null) => void;
  /** Führt zu den Abläufen, wo je Ablauf freigegeben wird – nur gesetzt,
   *  wenn dieser Benutzer den Bereich überhaupt sieht. */
  onAblaeufe?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [stand, setStand] = useState<BabysitterStand | null>(null);

  // Fest verdrahtet und nicht als Lambda im JSX: Die Karte hängt ihr
  // Laden an diese Funktion, und eine, die sich bei jedem Rendern
  // erneuert, liesse sie in einer Schleife nachfragen.
  const uebernehmen = useCallback(
    (neu: BabysitterStand | null) => {
      setStand(neu);
      onStand?.(neu);
    },
    [onStand]
  );

  const gesamt = (stand?.running ?? 0) + (stand?.paused ?? 0);

  return (
    <View style={styles.list}>
      <BesuchKarte settings={settings} onStand={uebernehmen} />

      <Card style={styles.card}>
        <Text style={styles.heading}>Ruhe für die Abläufe</Text>
        <Text style={styles.hint}>
          Solange der Modus läuft, ruhen die Abläufe – damit nicht mitten
          im Abend die Storen fahren, weil kein Telefon mehr zuhause
          gemeldet ist. Wasser- und Rauchmelder und die Alarmanlage laufen
          unabhängig davon weiter.
        </Text>
        {gesamt > 0 ? (
          <Text style={styles.stand}>{modusSatz(stand ?? { active: false, allow: [] }, gesamt)}</Text>
        ) : null}
        {onAblaeufe ? (
          <Pressable
            onPress={onAblaeufe}
            accessibilityRole="button"
            accessibilityLabel="Einzelne Abläufe freigeben – öffnet die Abläufe"
            style={({ pressed }) => [styles.link, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.linkText}>
              Einzelne Abläufe freigeben – unter Abläufe
            </Text>
            <Ionicons name="chevron-forward" size={16} color={colors.accent} />
          </Pressable>
        ) : (
          <Text style={styles.hint}>
            Welche trotzdem laufen sollen, wird unter Abläufe angehakt; die
            Auswahl bleibt stehen.
          </Text>
        )}
      </Card>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: space.gap },
    card: { minHeight: 0, gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    stand: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: '600' },
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    linkText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
  });
