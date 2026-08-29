import { Ionicons } from '@expo/vector-icons';
import React, { useMemo } from 'react';
import { StyleSheet, Text, View } from 'react-native';

import { Entity } from '../api/types';
import { offenSeit, offenSortiert } from '../lib/offen';
import { Colors, useColors } from '../theme';

/**
 * Was offen steht – und seit wann.
 *
 * «Terrasse offen» beantwortet die Frage halb. Seit zehn Minuten heisst,
 * jemand ist gerade draussen; seit drei Stunden heisst, es hat es
 * niemand gemerkt. Genau danach fragt, wer auf den Hinweis tippt.
 *
 * Eine Liste für beide Stellen, an denen sie steht: das Blatt aus der
 * Kopfzeile und der Hinweis neben der Begrüssung. Zwei Fassungen
 * derselben Liste waren in dieser Datei schon einmal der Fehler (siehe
 * lib/offen.ts).
 */
export function OffenListe({ entities, jetzt }: { entities: Entity[]; jetzt: number }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <>
      {offenSortiert(entities, jetzt).map((entity) => {
        const seit = offenSeit(entity, jetzt);
        return (
          <View key={entity.id} style={styles.zeile}>
            <Ionicons name="alert-circle-outline" size={18} color={colors.warn} />
            <View style={{ flex: 1 }}>
              <Text style={styles.name}>{entity.name}</Text>
              {/* Nur der Raum: Die Dauer steht rechts, und zweimal
                  dasselbe in einer Zeile liest niemand zweimal. */}
              {entity.room ? <Text style={styles.unten}>{entity.room}</Text> : null}
            </View>
            {/* Die Dauer noch einmal rechts, gross genug zum Überfliegen:
                Wer drei Zeilen sieht, sucht die längste. */}
            {seit ? <Text style={styles.dauer}>{seit}</Text> : null}
          </View>
        );
      })}
    </>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 10,
    },
    name: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    unten: { color: colors.inkSoft, fontSize: 12 },
    dauer: { color: colors.warn, fontSize: 13, fontWeight: '600' },
  });
