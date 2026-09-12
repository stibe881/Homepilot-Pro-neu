import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity } from '../api/types';
import { useSettings } from '../hooks/HubContext';
import { Card } from './Card';
import {
  BATTERY_SOON,
  BatterieVermerk,
  HealthRow,
  batteryRows,
  quittungSatz,
  stummBis,
} from '../lib/batterien';
import { FunkZeile, funkRows, funkStufe, funkWort } from '../lib/funkqualitaet';
import { epochAgo } from '../lib/zeit';
import { Colors, radius, type, useColors } from '../theme';

export type { BatterieVermerk, HealthRow };
export { batteryRows, stummBis };

/**
 * Geräte-Gesundheit: alle Batteriegeräte auf einen Blick.
 *
 * Der Wächter meldet erst, wenn eine Batterie schwach ist – die Übersicht
 * davor fehlte: Wer vor den Ferien wissen will, welche Melder demnächst
 * dran sind, musste jedes Gerät einzeln antippen. Sortiert nach
 * Dringlichkeit: leere zuerst, volle zuletzt.
 *
 * Dazu der Abschnitt «Funk» (Punkt 230): Zigbee-Geräte mit schwachem
 * oder fallendem Funk, mit Wert und Entwicklung. Die andere Hälfte
 * derselben Frage – ein Gerät, dessen Funk abreisst, verstummt genauso
 * wie eines mit leerer Batterie, nur sucht man den Fehler dann am
 * falschen Ort.
 */

export function DeviceHealth({
  entities,
  offen,
  onOffen,
}: {
  entities: Entity[];
  /** Von aussen aufgeklappt – so kommt die Batteriewarnung aus der
   *  Push-Nachricht direkt hierher. Ohne die Angabe entscheidet die
   *  Karte selbst. */
  offen?: boolean;
  onOffen?: (offen: boolean) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settings = useSettings();
  const hub = useMemo(() => hubClient(settings.url, settings.token), [settings]);
  const [eigenOffen, setEigenOffen] = useState(false);
  const open = offen ?? eigenOffen;
  const setOpen = useCallback(
    (wert: boolean) => {
      setEigenOffen(wert);
      onOffen?.(wert);
    },
    [onOffen]
  );

  const [vermerke, setVermerke] = useState<BatterieVermerk[]>([]);
  // «reicht noch ~3 Monate» je Gerät - der Hub rechnet es aus dem
  // eigenen Tempo der Batterie (core/batterieprognose.py).
  const [prognose, setPrognose] = useState<Record<string, string>>({});
  // Funkqualität der Zigbee-Geräte (Punkt 230): Der Hub sammelt
  // Wochenmittel und rechnet den Trend (core/funkqualitaet.py) - ein
  // Gerät, dessen Wert seit Wochen fällt, verstummt irgendwann.
  const [funk, setFunk] = useState<FunkZeile[]>([]);
  const [jetzt, setJetzt] = useState(() => Date.now());
  const laden = useCallback(() => {
    hub
      .get<{ batteries?: BatterieVermerk[]; forecast?: Record<string, string> } | null>(
        '/api/batteries',
        { fallback: null, still: true }
      )
      .then((data) => {
        if (data) {
          setVermerke(data.batteries ?? []);
          setPrognose(data.forecast ?? {});
        }
        setJetzt(Date.now());
      });
    hub
      .get<{ radios?: FunkZeile[] } | null>('/api/funk', {
        fallback: null,
        still: true,
      })
      .then((data) => {
        if (data) setFunk(data.radios ?? []);
      });
  }, [hub]);
  // Nur wenn die Liste offen ist: Zugeklappt braucht niemand die
  // Vermerke, und die Karte steht auf einer Seite, die man oft öffnet.
  useEffect(() => {
    if (open) laden();
  }, [open, laden]);

  const quittieren = async (entityId: string, stumm: boolean) => {
    try {
      if (stumm) {
        await hub.del(`/api/batteries/${encodeURIComponent(entityId)}/ack`, {
          still: true,
        });
      } else {
        await hub.post(
          `/api/batteries/${encodeURIComponent(entityId)}/ack`,
          undefined,
          { still: true }
        );
      }
    } finally {
      // Auch nach einem Fehlschlag nachladen: Dann steht da, was der Hub
      // wirklich weiss, statt was die App gerade hoffte.
      laden();
    }
  };

  const rows = batteryRows(entities);
  const funkAuffaellig = funkRows(funk);
  if (rows.length === 0) return null;

  const urgent = rows.filter(
    (row) => row.low || (row.percent !== null && row.percent <= BATTERY_SOON)
  );

  const tone = (row: HealthRow) =>
    row.low || (row.percent !== null && row.percent <= 10)
      ? colors.danger
      : row.percent !== null && row.percent <= BATTERY_SOON
        ? colors.warn
        : colors.on;

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOpen(!open)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={styles.head}
      >
        <Ionicons
          name="battery-half-outline"
          size={18}
          color={urgent.length > 0 ? colors.warn : colors.inkSoft}
        />
        <Text style={[styles.heading, { flex: 1 }]}>Batterien</Text>
        <Text style={styles.count}>
          {urgent.length > 0 ? `${urgent.length} bald leer · ` : ''}
          {rows.length} Geräte
        </Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.inkSoft}
        />
      </Pressable>

      {open ? (
        <>
          {rows.map((row) => {
            const stumm = stummBis(vermerke, row.entity.id, jetzt) !== null;
            // Quittieren gibt es nur, wo es auch eine Warnung gibt. Bei
            // einer vollen Batterie wäre der Knopf eine Attrappe.
            const warnt =
              row.low || (row.percent !== null && row.percent <= BATTERY_SOON);
            return (
              <View key={row.entity.id} style={styles.row}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.name}>{row.entity.name}</Text>
                  <Text style={styles.detail}>
                    {row.entity.room ?? 'Ohne Raum'}
                    {epochAgo(row.entity.last_seen)
                      ? ` · zuletzt gesehen ${epochAgo(row.entity.last_seen)}`
                      : ''}
                  </Text>
                  {/* Die Antwort auf die eigentliche Frage: wann kaufen?
                      Erscheint erst, wenn genug Wochen Verlauf da sind -
                      eine Frist, die jede Woche um Monate springt, wäre
                      schlimmer als keine. */}
                  {prognose[row.entity.id] ? (
                    <Text style={styles.detail}>{prognose[row.entity.id]}</Text>
                  ) : null}
                  {/* Wer sie stillgestellt hat (Punkt 478 der Werkbank).
                      Die Quittung gilt fürs ganze Haus - richtig so,
                      sonst laufen zwei wegen derselben Batterie in den
                      Keller. Falsch war, dass sie unsichtbar galt: Wer
                      nachts wegdrückte, drückte sie auch dem anderen
                      weg, und der suchte am Morgen eine Meldung, die es
                      nie mehr gab. Zurücknehmen darf sie jeder - der
                      Knopf daneben tut genau das. */}
                  {quittungSatz(vermerke, row.entity.id, jetzt) ? (
                    <Text style={styles.detail}>
                      {quittungSatz(vermerke, row.entity.id, jetzt)}
                    </Text>
                  ) : null}
                </View>
                {warnt ? (
                  <Pressable
                    onPress={() => quittieren(row.entity.id, stumm)}
                    accessibilityRole="button"
                    accessibilityState={{ checked: stumm }}
                    accessibilityLabel={
                      stumm
                        ? `${row.entity.name}: doch wieder melden`
                        : `${row.entity.name}: bis morgen stumm`
                    }
                    style={({ pressed }) => [
                      styles.quittieren,
                      stumm && styles.quittiertAktiv,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Ionicons
                      name={stumm ? 'notifications-off' : 'notifications-off-outline'}
                      size={13}
                      color={stumm ? '#FFFFFF' : colors.inkSoft}
                    />
                    <Text
                      style={[styles.quittierenText, stumm && { color: '#FFFFFF' }]}
                    >
                      {stumm ? 'bis morgen still' : 'bis morgen'}
                    </Text>
                  </Pressable>
                ) : null}
                <Text style={[styles.value, { color: tone(row) }]}>
                  {row.percent !== null ? `${row.percent} %` : 'schwach'}
                </Text>
              </View>
            );
          })}
          <Text style={styles.hint}>
            Dringendste zuerst. «Schwach» ohne Prozentzahl heisst: Das Gerät
            meldet nur noch, dass es bald leer ist – danach ist es still,
            ohne sich abzumelden.
          </Text>
          <Text style={styles.hint}>
            «Bis morgen» nimmt die Push-Meldung zur Kenntnis und schaltet sie
            bis morgen früh stumm. Es ist ein Aufschub, kein Ausschalten:
            Ist die Batterie dann noch schwach, erinnert der Hub noch einmal.
          </Text>
          {/* Funk (Punkt 230): nur die Auffälligen - schwach oder seit
              Wochen fallend. Ein Gerät, dessen Funk abreisst, verstummt
              irgendwann, und dann sucht man den Fehler bei der Batterie. */}
          {funkAuffaellig.length > 0 ? (
            <>
              <View style={styles.funkHead}>
                <Ionicons name="wifi-outline" size={16} color={colors.warn} />
                <Text style={styles.funkHeading}>Funk</Text>
              </View>
              {funkAuffaellig.map((funker) => (
                <View key={funker.entity_id} style={styles.row}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.name}>{funker.name}</Text>
                    <Text style={styles.detail}>
                      {funker.room ?? 'Ohne Raum'} · Funkqualität{' '}
                      {funkWort(funker)}
                    </Text>
                  </View>
                  <Text
                    style={[
                      styles.value,
                      {
                        color:
                          funkStufe(funker) === 'kritisch'
                            ? colors.danger
                            : colors.warn,
                      },
                    ]}
                  >
                    {Math.round(funker.value)}
                  </Text>
                </View>
              ))}
              <Text style={styles.hint}>
                Funkqualität in Punkten von 255. Meist hilft ein anderer
                Standort oder ein Repeater dazwischen – an der Batterie
                liegt es selten.
              </Text>
            </>
          ) : null}
        </>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    count: { color: colors.inkFaint, fontSize: 12 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    quittieren: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    quittiertAktiv: { backgroundColor: colors.accent, borderColor: colors.accent },
    quittierenText: { fontSize: 11, fontWeight: '700', color: colors.inkSoft },
    funkHead: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      marginTop: 4,
    },
    funkHeading: { color: colors.ink, fontSize: 13, fontWeight: '700' },
    name: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    detail: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    value: { fontSize: 14, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
  });
