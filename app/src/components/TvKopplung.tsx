import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity } from '../api/types';
import { useSettings } from '../hooks/HubContext';
import { CODE_LAENGE, codeSauber, codeVollstaendig } from '../lib/fernsehkopplung';
import { Colors, radius, useColors } from '../theme';

/**
 * «Fernseher koppeln» auf der Fernseh- und der Timerkachel.
 *
 * Ein Android-TV-Gerät lässt nur fernbedienen, wer einmal eine Zahl von
 * seinem Bildschirm abgelesen hat. Das bleibt so – wer den Fernseher
 * bedient, soll ihn sehen können.
 *
 * Der Weg dorthin führte bisher über die Kommandozeile des Hub-Rechners:
 * Die Absage nannte das Hub-Protokoll, und dort stand ein
 * docker-exec-Aufruf. Gemeldet wurde es abends beim Einschlaf-Timer –
 * mit einem Fernseher im Wohnzimmer und einem Rechner im Keller. Jetzt
 * steht der Weg dort, wo die Absage steht: auf der Kachel.
 *
 * Zwei Schritte, weil dazwischen jemand aufsteht und hinschaut.
 */
export function TvKopplung({
  entity,
  dringend = true,
}: {
  entity: Entity;
  /** Der Hub meldet die Kopplung als abgelehnt: dann ein sichtbarer
   *  Kasten. Sonst nur eine ruhige Zeile, die man aufklappt - die
   *  Kopplung kappt die Verbindung für ein paar Minuten, das soll kein
   *  Danebentippen auslösen. */
  dringend?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settings = useSettings();
  const [schritt, setSchritt] = useState<'aus' | 'code'>('aus');
  const [aufgeklappt, setAufgeklappt] = useState(false);
  const [code, setCode] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);

  const pfad = `/api/androidtv/${encodeURIComponent(entity.id)}/pair`;

  // `still`, weil die Absage hier auf der Kachel steht und nicht als
  // Einblendung darüber: «Der Code stimmt nicht» gehört neben das Feld,
  // in das man ihn getippt hat.
  const starten = async (neu: boolean) => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try {
      await hubClient(settings.url, settings.token).post(pfad, { neu }, { still: true });
      setCode('');
      setSchritt('code');
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      setLaeuft(false);
    }
  };

  const bestaetigen = async () => {
    if (laeuft || !codeVollstaendig(code)) return;
    setLaeuft(true);
    setFehler(null);
    try {
      await hubClient(settings.url, settings.token).post(
        `${pfad}/code`,
        { code: codeSauber(code) },
        { still: true }
      );
      // Der Hub meldet den neuen Stand ohnehin gleich über den
      // WebSocket, und dann verschwindet die ganze Kachelzeile hier.
      // Bis dahin soll trotzdem etwas anderes dastehen als der Knopf,
      // den man gerade gedrückt hat.
      setFertig(true);
      setSchritt('aus');
    } catch (err) {
      // Ein falscher Code beendet den Versuch auch beim Fernseher: Er
      // zeigt beim nächsten Anlauf eine neue Zahl. Deshalb zurück auf
      // Anfang statt ein zweiter Versuch gegen einen Code, der gar
      // nicht mehr auf dem Bildschirm steht.
      setSchritt('aus');
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      setLaeuft(false);
    }
  };

  // Solange nichts klemmt, steht hier eine Zeile und kein Kasten: Der
  // Weg soll auffindbar sein, ohne sich vorzudrängen.
  if (!dringend && !aufgeklappt && !fertig) {
    return (
      <Pressable
        onPress={() => setAufgeklappt(true)}
        accessibilityRole="button"
        accessibilityLabel="Fernseher koppeln"
        style={({ pressed }) => [styles.zeile, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="link-outline" size={15} color={colors.inkSoft} />
        <Text style={styles.zeileText}>Fernseher koppeln</Text>
        <Ionicons name="chevron-down" size={16} color={colors.inkFaint} />
      </Pressable>
    );
  }

  return (
    <View style={[styles.box, !dringend && { borderColor: colors.surfaceBorder }]}>
      <View style={styles.kopf}>
        <Ionicons
          name="link-outline"
          size={15}
          color={dringend ? colors.warn : colors.inkSoft}
        />
        <Text style={[styles.kopfText, !dringend && { color: colors.ink }]}>
          {fertig
            ? 'Gekoppelt – der Fernseher meldet sich gleich.'
            : dringend
              ? 'Nicht gekoppelt'
              : 'Fernseher koppeln'}
        </Text>
        {!dringend ? (
          <Pressable
            onPress={() => {
              setAufgeklappt(false);
              setSchritt('aus');
              setFehler(null);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Zuklappen"
          >
            <Ionicons name="chevron-up" size={16} color={colors.inkFaint} />
          </Pressable>
        ) : null}
      </View>

      {schritt === 'aus' ? (
        <>
          <Text style={styles.hinweis}>
            Der Fernseher muss die Fernbedienung einmal erlauben. Er zeigt dazu
            eine Zahl auf dem Bildschirm – er muss also eingeschaltet sein.
            {dringend
              ? ''
              : ' Solange die Kopplung läuft, ist er kurz nicht erreichbar.'}
          </Text>
          <Pressable
            onPress={() => starten(false)}
            disabled={laeuft}
            accessibilityRole="button"
            accessibilityLabel="Fernseher koppeln"
            style={({ pressed }) => [
              styles.knopf,
              (pressed || laeuft) && { opacity: 0.6 },
            ]}
          >
            <Text style={styles.knopfText}>
              {laeuft ? 'Einen Moment …' : 'Fernseher koppeln'}
            </Text>
          </Pressable>
          {/* Der Fall, der einen Abend gekostet hat: Wer am Fernseher die
              Daten des Remote-Dienstes löscht, dessen Zertifikat verbindet
              weiter und wirkt nicht mehr. Ohne diesen Ausweg käme man aus
              dem Zustand nie heraus – nur eben verstecktermassen, damit
              niemand aus Versehen die gute Kopplung wegwirft. */}
          <Pressable
            onPress={() => starten(true)}
            disabled={laeuft}
            accessibilityRole="button"
            accessibilityLabel="Ganz neu koppeln"
            style={({ pressed }) => [styles.neuKnopf, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.neuText}>Klappt nicht? Ganz neu koppeln</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.hinweis}>
            Auf dem Fernseher steht jetzt eine Zahl. Sie gilt ein paar Minuten.
          </Text>
          <TextInput
            style={styles.feld}
            value={code}
            onChangeText={(text) => setCode(codeSauber(text))}
            onSubmitEditing={bestaetigen}
            placeholder={'0'.repeat(CODE_LAENGE)}
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="characters"
            autoCorrect={false}
            autoFocus
            maxLength={CODE_LAENGE}
            returnKeyType="go"
            accessibilityLabel="Code vom Fernseher"
          />
          <View style={styles.reihe}>
            <Pressable
              onPress={() => {
                setSchritt('aus');
                setFehler(null);
              }}
              accessibilityRole="button"
              accessibilityLabel="Kopplung abbrechen"
              style={({ pressed }) => [styles.abbruch, pressed && { opacity: 0.6 }]}
            >
              <Text style={styles.abbruchText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={bestaetigen}
              disabled={laeuft || !codeVollstaendig(code)}
              accessibilityRole="button"
              accessibilityLabel="Code bestätigen"
              accessibilityState={{ disabled: laeuft || !codeVollstaendig(code) }}
              style={({ pressed }) => [
                styles.knopf,
                styles.knopfHalb,
                (pressed || laeuft || !codeVollstaendig(code)) && { opacity: 0.5 },
              ]}
            >
              <Text style={styles.knopfText}>
                {laeuft ? 'Einen Moment …' : 'Bestätigen'}
              </Text>
            </Pressable>
          </View>
        </>
      )}

      {fehler ? <Text style={styles.fehler}>{fehler}</Text> : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    zeileText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', flex: 1 },
    box: {
      gap: 8,
      padding: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.warn,
      backgroundColor: colors.surfaceSoft,
    },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    kopfText: { color: colors.warn, fontSize: 13, fontWeight: '700', flex: 1 },
    hinweis: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
    feld: {
      backgroundColor: colors.panel,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 20,
      letterSpacing: 4,
      textAlign: 'center',
    },
    reihe: { flexDirection: 'row', gap: 8 },
    knopf: {
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    knopfHalb: { flex: 1 },
    knopfText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    abbruch: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    abbruchText: { color: colors.inkSoft, fontSize: 14, fontWeight: '700' },
    neuKnopf: { alignItems: 'center', paddingVertical: 4 },
    neuText: { color: colors.inkFaint, fontSize: 12, textDecorationLine: 'underline' },
    fehler: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  });
