import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { BabysitterStand, modusSatz, restText, seitText } from '../lib/babysitter';
import { Colors, radius, space, type, useColors } from '../theme';

/**
 * «Es ist jemand da» – Besuch oder Babysitter, als eigene Seite.
 *
 * Sonst tut man jedes Mal dasselbe an mehreren Orten: WLAN weitergeben,
 * die Abläufe anhalten – und am Ende alles wieder zurück. Den letzten
 * Schritt vergisst man, deshalb kann der Modus eine Frist tragen und
 * endet dann von selbst.
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

/** `null` heisst «ohne Frist» – dann läuft er, bis jemand ausschaltet.
 *  Das ist der Babysitter-Abend, an dem man ans Ausschalten denkt. */
const DAUERN: (number | null)[] = [null, 2, 4, 6, 8];

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
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [stand, setStand] = useState<BabysitterStand | null>(null);
  const [stunden, setStunden] = useState<number | null>(4);
  const [wlan, setWlan] = useState<{ ssid: string; payload: string } | null>(null);
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
      .get<{ babysitter?: BabysitterStand } | null>(
        '/api/automations/babysitter',
        { fallback: null, still: true }
      )
      .then((data) => {
        if (!data?.babysitter) return;
        uebernehmen(data.babysitter);
        setJetzt(Date.now());
      });
    // Kein Gäste-WLAN eingerichtet sieht gleich aus wie keine Antwort -
    // dann zeigt die Seite eben keinen Code.
    hub
      .get<{ ssid: string; payload: string } | null>('/api/wifi', {
        fallback: null,
        still: true,
      })
      .then(setWlan);
  }, [hub, uebernehmen]);

  useEffect(laden, [laden]);

  // Die Restzeit tickt mit, solange die Seite offen ist. Das Blatt
  // vorher fror sie beim Öffnen ein - eine Seite kann eine Viertelstunde
  // offen liegen, und «Läuft noch 2 Std» wäre dann eine alte Auskunft.
  useEffect(() => {
    if (!stand?.active || !stand.until) return;
    const uhr = setInterval(() => setJetzt(Date.now()), 30_000);
    return () => clearInterval(uhr);
  }, [stand?.active, stand?.until]);

  const starten = async () => {
    setBusy(true);
    try {
      const antwort = await hub.post<{ babysitter?: BabysitterStand } | null>(
        '/api/automations/babysitter',
        { active: true, hours: stunden },
        { fallback: null }
      );
      if (antwort?.babysitter) uebernehmen(antwort.babysitter);
      setJetzt(Date.now());
    } finally {
      setBusy(false);
    }
  };

  const beenden = async () => {
    setBusy(true);
    try {
      const antwort = await hub.post<{ babysitter?: BabysitterStand } | null>(
        '/api/automations/babysitter',
        { active: false },
        { fallback: null }
      );
      if (antwort?.babysitter) uebernehmen(antwort.babysitter);
    } finally {
      setBusy(false);
    }
  };

  const laeuft = !!stand?.active;
  const rest = restText(stand, jetzt);
  const gesamt = (stand?.running ?? 0) + (stand?.paused ?? 0);

  return (
    <View style={styles.list}>
      {/* Der Zustand zuoberst, mit dem einen Knopf, um den es geht.
          Alles darunter sind die Einzelheiten - wer nur ein- oder
          ausschalten will, ist hier schon fertig. */}
      <Card style={styles.card}>
        <View style={styles.statusRow}>
          <View
            style={[
              styles.statusIcon,
              laeuft && { backgroundColor: colors.onSoft },
            ]}
          >
            <Ionicons
              name="people"
              size={26}
              color={laeuft ? colors.on : colors.inkSoft}
            />
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
                  style={[styles.chip, stunden === wert && styles.chipActive]}
                >
                  <Text
                    style={[
                      styles.chipText,
                      stunden === wert && styles.chipTextActive,
                    ]}
                  >
                    {wert === null ? 'ohne Frist' : `${wert} Std`}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>
              Mit Frist endet der Modus von selbst – für den Abend, an dem
              garantiert niemand ans Ausschalten denkt. «Ohne Frist» läuft
              er, bis hier jemand ausschaltet.
            </Text>
          </>
        )}

        <Pressable
          onPress={() => void (laeuft ? beenden() : starten())}
          disabled={busy}
          accessibilityRole="button"
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

      {/* Der QR-Code auch vor dem Start: Oft ist er der eigentliche
          Grund, warum jemand diese Seite öffnet. */}
      {wlan ? (
        <Card style={styles.card}>
          <Text style={styles.heading}>Gäste-WLAN</Text>
          <View style={styles.wlan}>
            <View style={styles.qr}>
              <QRCode value={wlan.payload} size={170} backgroundColor="#FFFFFF" />
            </View>
            <Text style={styles.hint}>
              «{wlan.ssid}» – mit der Kamera scannen, dann verbindet sich
              das Telefon von selbst.
            </Text>
          </View>
        </Card>
      ) : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: space.gap },
    card: { minHeight: 0, gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
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
    stand: { color: colors.ink, fontSize: 13, lineHeight: 19, fontWeight: '600' },
    link: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      paddingVertical: 6,
    },
    linkText: { color: colors.accent, fontSize: 14, fontWeight: '600' },
    wlan: { alignItems: 'center', gap: 10 },
    qr: { padding: 12, borderRadius: radius.control, backgroundColor: '#FFFFFF' },
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
