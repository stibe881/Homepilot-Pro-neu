import { Ionicons } from '@expo/vector-icons';
import React, { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from './Card';
import { offenBis } from '../lib/bereichsriegel';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Das Passwortfeld vor den persönlichen Bereichen.
 *
 * Steht anstelle des Bereichs, nicht als Fenster darüber: Ein Popup lädt
 * dazu ein, danebenzutippen und trotzdem etwas zu sehen. Hier ist die
 * Seite eben noch nicht da.
 *
 * Warum es das gibt, steht in lib/bereichsriegel.ts.
 */
export function BereichRiegel({
  settings,
  titel,
  onOffen,
}: {
  settings: HubSettings;
  /** Wie der Bereich heisst, den jemand öffnen wollte. */
  titel: string;
  /** Zeitpunkt, bis zu dem jetzt offen ist. */
  onOffen: (bis: number) => void;
}) {
  const colors = useColors();
  const styles = React.useMemo(() => makeStyles(colors), [colors]);
  const [passwort, setPasswort] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  const [laeuft, setLaeuft] = useState(false);

  const pruefen = async () => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const antwort = await hubClient(settings.url, settings.token).post<{
        ok: boolean;
        seconds?: number;
      }>('/api/areas/unlock', { password: passwort }, { still: true });
      setPasswort('');
      onOffen(offenBis(Date.now(), antwort?.seconds));
    } catch {
      // Absichtlich ohne Unterschied zwischen «falsch» und «gesperrt»:
      // Der Hub bremst nach zu vielen Versuchen ohnehin, und wer hier
      // steht, hat es schlicht falsch getippt.
      setFehler('Das war es nicht. Nochmal?');
      setPasswort('');
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Card style={styles.card}>
      <Ionicons name="lock-closed-outline" size={26} color={colors.inkSoft} />
      <Text style={styles.titel}>{titel} ist abgeriegelt</Text>
      <Text style={styles.hinweis}>
        Dieses Gerät steht offen herum, darum liegt vor den persönlichen
        Bereichen ein Passwort. Es kommt von der Hausverwaltung – dieselbe
        Person, die den Zugang eingerichtet hat.
      </Text>
      <TextInput
        style={styles.feld}
        value={passwort}
        onChangeText={setPasswort}
        onSubmitEditing={pruefen}
        placeholder="Passwort"
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        autoFocus
        returnKeyType="go"
        accessibilityLabel={`Passwort für ${titel}`}
      />
      {fehler ? <Text style={styles.fehler}>{fehler}</Text> : null}
      <Pressable
        onPress={pruefen}
        disabled={laeuft || !passwort}
        accessibilityRole="button"
        style={({ pressed }) => [
          styles.knopf,
          (pressed || laeuft || !passwort) && { opacity: 0.6 },
        ]}
      >
        <Text style={styles.knopfText}>{laeuft ? 'Einen Moment …' : 'Öffnen'}</Text>
      </Pressable>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { alignItems: 'center', gap: 10, padding: 24, maxWidth: 420, alignSelf: 'center' },
    titel: { fontSize: type.cardTitle + 3, fontWeight: '600', color: colors.ink },
    hinweis: {
      color: colors.inkSoft,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
    },
    feld: {
      alignSelf: 'stretch',
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 16,
      textAlign: 'center',
    },
    fehler: { color: colors.danger, fontSize: 13 },
    knopf: {
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingHorizontal: 22,
      paddingVertical: 10,
    },
    knopfText: { color: '#FFFFFF', fontSize: 15, fontWeight: '600' },
  });
