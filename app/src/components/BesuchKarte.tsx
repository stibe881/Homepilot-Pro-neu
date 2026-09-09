import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { BabysitterStand, restText, seitText } from '../lib/babysitter';
import { Colors, radius, useColors } from '../theme';

import { Card } from './Card';

/**
 * «Ist jemand da?» – Zustand, Dauer, ein Knopf.
 *
 * Herausgelöst aus screens/BesuchScreen.tsx, weil dieselbe Karte an zwei
 * Orten gebraucht wird: als erste Karte der Besuchsseite und als Blatt
 * hinter dem Symbol in der Begrüssungskarte. Genau dafür ist sie
 * eigenständig – sie holt ihren Zustand selbst und schaltet selbst,
 * statt ihn von aussen gereicht zu bekommen. Ein zweiter Nachbau für das
 * Blatt wäre die Sorte Kopie, die ein halbes Jahr später anders
 * schaltet als das Original.
 *
 * Warum das Blatt: Der Besuchsmodus wird in dem Moment gebraucht, in dem
 * es klingelt – nicht drei Tipps und einen Bildschirm später. Die Seite
 * bleibt trotzdem, sie erklärt, was der Modus mit den Abläufen macht.
 *
 * Was der Modus nicht anfasst: die Alarmanlage. Ein Knopf, der sie
 * entschärft, wäre kein Komfort mehr, sondern ein Loch.
 */

/** `null` heisst «ohne Frist» – dann läuft er, bis jemand ausschaltet.
 *  Das ist der Babysitter-Abend, an dem man ans Ausschalten denkt. */
const DAUERN: (number | null)[] = [null, 2, 4, 6, 8];

export function BesuchKarte({
  settings,
  onStand,
}: {
  settings: HubSettings;
  /** Meldet jeden frischen Stand nach oben – die Zeile im
   *  Einstellungsmenü soll sagen, was hier gerade entschieden wurde. */
  onStand?: (stand: BabysitterStand | null) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [stand, setStand] = useState<BabysitterStand | null>(null);
  const [stunden, setStunden] = useState<number | null>(4);
  const [busy, setBusy] = useState(false);
  const [jetzt, setJetzt] = useState(() => Date.now());

  const uebernehmen = useCallback(
    (neu: BabysitterStand | null) => {
      setStand(neu);
      onStand?.(neu);
    },
    [onStand]
  );

  const laden = useCallback(() => {
    hub
      .get<{ babysitter?: BabysitterStand } | null>('/api/automations/babysitter', {
        fallback: null,
        still: true,
      })
      .then((data) => {
        if (!data?.babysitter) return;
        uebernehmen(data.babysitter);
        setJetzt(Date.now());
      });
  }, [hub, uebernehmen]);

  useEffect(laden, [laden]);

  // Die Restzeit tickt mit, solange die Karte steht. Das alte Blatt fror
  // sie beim Öffnen ein - eine Seite kann eine Viertelstunde offen
  // liegen, und «Läuft noch 2 Std» wäre dann eine alte Auskunft.
  useEffect(() => {
    if (!stand?.active || !stand.until) return;
    const uhr = setInterval(() => setJetzt(Date.now()), 30_000);
    return () => clearInterval(uhr);
  }, [stand?.active, stand?.until]);

  const schalten = async (aktiv: boolean) => {
    setBusy(true);
    try {
      const antwort = await hub.post<{ babysitter?: BabysitterStand } | null>(
        '/api/automations/babysitter',
        aktiv ? { active: true, hours: stunden } : { active: false },
        { fallback: null }
      );
      if (antwort?.babysitter) uebernehmen(antwort.babysitter);
      setJetzt(Date.now());
    } finally {
      setBusy(false);
    }
  };

  const laeuft = !!stand?.active;
  const rest = restText(stand, jetzt);

  return (
    <Card style={styles.card}>
      {/* Der Zustand zuoberst, mit dem einen Knopf, um den es geht.
          Wer nur ein- oder ausschalten will, ist hier schon fertig. */}
      <View style={styles.statusRow}>
        <View style={[styles.statusIcon, laeuft && { backgroundColor: colors.onSoft }]}>
          <Ionicons name="people" size={26} color={laeuft ? colors.on : colors.inkSoft} />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.statusTitel}>
            {laeuft ? 'Jemand ist da' : 'Niemand angemeldet'}
          </Text>
          <Text style={[styles.statusZeile, laeuft && { color: colors.on }]}>
            {laeuft
              ? rest
                ? `Läuft noch ${rest}`
                : `Läuft${seitText(stand?.since)} – bis jemand ausschaltet`
              : 'Der Modus ist aus – alles läuft wie gewohnt.'}
          </Text>
        </View>
      </View>

      {laeuft ? null : (
        <>
          <Text style={styles.label}>Wie lange</Text>
          <View style={styles.chips}>
            {DAUERN.map((wert) => (
              <Pressable
                key={String(wert)}
                onPress={() => setStunden(wert)}
                accessibilityRole="radio"
                accessibilityState={{ selected: stunden === wert }}
                // «2 Std» liest sich als «zwei S-t-d» vor - deshalb das
                // ausgeschriebene Wort (Punkt 247 der Werkbank).
                accessibilityLabel={
                  wert === null
                    ? 'Ohne Frist'
                    : `${wert} ${wert === 1 ? 'Stunde' : 'Stunden'}`
                }
                style={[styles.chip, stunden === wert && styles.chipActive]}
              >
                <Text
                  style={[styles.chipText, stunden === wert && styles.chipTextActive]}
                >
                  {wert === null ? 'ohne Frist' : `${wert} Std`}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.hint}>
            Mit Frist endet der Modus von selbst – für den Abend, an dem
            garantiert niemand ans Ausschalten denkt. «Ohne Frist» läuft er,
            bis hier jemand ausschaltet.
          </Text>
        </>
      )}

      <Pressable
        onPress={() => void schalten(!laeuft)}
        disabled={busy}
        accessibilityRole="button"
        accessibilityLabel={laeuft ? 'Besuchsmodus beenden' : 'Besuchsmodus starten'}
        accessibilityState={{ disabled: busy, busy }}
        style={({ pressed }) => [
          styles.button,
          laeuft && { backgroundColor: colors.danger },
          (pressed || busy) && { opacity: 0.7 },
        ]}
      >
        <Ionicons
          name={laeuft ? 'stop-outline' : 'people-outline'}
          size={16}
          color="#FFFFFF"
        />
        <Text style={styles.buttonText}>
          {laeuft ? 'Beenden – die Abläufe laufen wieder' : 'Starten'}
        </Text>
      </Pressable>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 12 },
    statusRow: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    statusIcon: {
      width: 52,
      height: 52,
      borderRadius: 26,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceStrong,
    },
    statusTitel: { color: colors.ink, fontSize: 18, fontWeight: '700' },
    statusZeile: { color: colors.inkSoft, fontSize: 13, marginTop: 2 },
    label: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingVertical: 8,
      paddingHorizontal: 14,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    chipTextActive: { color: '#FFFFFF' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });
