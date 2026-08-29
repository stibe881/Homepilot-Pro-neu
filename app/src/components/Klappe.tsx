import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { Colors, useColors } from '../theme';

/**
 * Ein Abschnitt, der zugeklappt nur seine Überschrift zeigt.
 *
 * Stand vorher in `screens/automations/felder.tsx` und galt dort dem
 * Ablauf-Editor. Sie steht jetzt hier, weil die Benutzerverwaltung
 * dasselbe Problem hat und dieselbe Antwort verdient: Eine Seite, auf
 * der elf Blöcke samt Erklärung gleichzeitig ausgeklappt stehen, ist
 * keine Seite mehr, sondern eine Wand. Zugeklappt sagt der Kopf, was
 * eingestellt ist – das beantwortet die häufigste Frage, ohne dass
 * jemand hinsehen muss.
 *
 * `stand` entscheidet auch, ob sie von selbst aufgeht: Was gesetzt ist,
 * gehört gezeigt; was leer ist, kostet nur Platz.
 */
export function Klappe({
  label,
  /** Was eingestellt ist - steht im Kopf und entscheidet, ob offen. */
  stand,
  /** Auch mit `stand` zugeklappt beginnen. Für Abschnitte, die fast
   *  immer etwas stehen haben und trotzdem selten gebraucht werden. */
  zuBeginnZu,
  children,
}: {
  label: string;
  stand?: string;
  zuBeginnZu?: boolean;
  children: React.ReactNode;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offen, setOffen] = useState(!!stand && !zuBeginnZu);

  return (
    <View style={styles.field}>
      <Pressable
        onPress={() => setOffen((auf) => !auf)}
        accessibilityRole="button"
        accessibilityState={{ expanded: offen }}
        accessibilityLabel={stand ? `${label}: ${stand}` : label}
        style={({ pressed }) => [styles.klappeKopf, pressed && { opacity: 0.7 }]}
      >
        <Text style={styles.label} numberOfLines={1}>
          {label}
        </Text>
        {stand && !offen ? (
          <Text style={styles.klappeStand} numberOfLines={1}>
            {stand}
          </Text>
        ) : (
          <View style={{ flex: 1 }} />
        )}
        <Ionicons
          name={offen ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.inkSoft}
        />
      </Pressable>
      {offen ? children : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    field: { gap: 8 },
    klappeKopf: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    /** `flexShrink`, damit ein langer Titel sich selbst kürzt statt den
     *  Stand rechts daneben auf «kein …» zusammenzuquetschen. Der Stand
     *  ist die Auskunft, für die es die zugeklappte Zeile gibt. */
    label: { color: colors.inkSoft, fontSize: 15, fontWeight: '700', flexShrink: 1 },
    /** Was in der zugeklappten Klappe eingestellt ist – rechtsbündig,
     *  damit die Beschriftungen links eine Spalte bilden. */
    klappeStand: {
      color: colors.inkFaint,
      fontSize: 13,
      flex: 1,
      textAlign: 'right',
    },
  });
