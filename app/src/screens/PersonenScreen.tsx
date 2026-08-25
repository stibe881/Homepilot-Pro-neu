import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Fehlschlag, Laedt, Leer } from '../components/Zustand';
import { useTakt } from '../hooks/useTakt';
import {
  Person,
  anzahlAn,
  herkunft,
  nebenZeile,
  ortZeile,
  sortiert,
} from '../lib/personen';
import { Colors, radius, space, useColors } from '../theme';

/**
 * Familie und Freunde: alle Menschen, die der Hub kennt.
 *
 * Bis hierher waren sie über drei Listen verteilt, die einander nicht
 * kannten: die Benutzer (wer darf hinein), die Ortung (wessen Telefon
 * meldet sich) und Life360 (wen sieht der Hub, ohne dass er ihm gehört).
 * Wer wissen wollte, wo Maja gerade ist, fand sie in keiner davon – sie
 * hat keinen Zugang zum Hub, nur ein Telefon.
 *
 * Zwei Dinge stehen hier: wo jemand ist, und was über ihn gemeldet wird.
 * Beides gehört zusammen, weil das eine die Antwort auf das andere ist –
 * wer sehen will, ob jemand angekommen ist, stellt genau hier den
 * Schalter dafür.
 */

interface Antwort {
  people: Person[];
  /** Beschriftungen der Schalter – sie kommen vom Hub, siehe dort. */
  meldungen: Record<string, string>;
}

export function PersonenScreen({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [daten, setDaten] = useState<Antwort | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const [jetzt, setJetzt] = useState(() => new Date());

  const hub = useMemo(
    () => hubClient(settings.url ?? '', settings.token ?? ''),
    [settings.url, settings.token]
  );

  const laden = useCallback(async () => {
    setFehler(null);
    try {
      setDaten(await hub.get<Antwort>('/api/personen', { still: true }));
    } catch {
      setFehler('Die Liste liess sich nicht laden.');
    }
  }, [hub]);

  useEffect(() => {
    laden();
  }, [laden]);

  // Wo jemand ist, ändert sich, während man hinsieht – und «seit 3 min»
  // wird sonst nie zu «seit 4 min». Eine Minute genügt: Die Ortung
  // meldet ohnehin nicht schneller.
  useTakt(() => {
    setJetzt(new Date());
    laden();
  }, 60000);

  const umlegen = async (person: Person, key: string, wert: boolean) => {
    if (!person.zone) return;
    // Sofort umlegen, dann schicken: Ein Schalter, der eine halbe
    // Sekunde auf den Hub wartet, fühlt sich kaputt an. Geht es schief,
    // holt das Nachladen den wahren Stand zurück.
    setDaten((alt) =>
      alt === null
        ? alt
        : {
            ...alt,
            people: alt.people.map((p) =>
              p.zone === person.zone
                ? { ...p, meldungen: { ...(p.meldungen ?? {}), [key]: wert } }
                : p
            ),
          }
    );
    try {
      await hub.post(`/api/personen/${encodeURIComponent(person.zone)}/meldungen`, {
        key,
        enabled: wert,
      });
    } catch {
      setFehler('Der Schalter liess sich nicht speichern.');
      laden();
    }
  };

  if (fehler && daten === null) {
    return <Fehlschlag text="Familie und Freunde liessen sich nicht laden." onRetry={laden} />;
  }
  if (daten === null) return <Laedt was="Familie und Freunde" />;

  const leute = sortiert(daten.people);

  return (
    <Card style={styles.card}>
      <Text style={styles.titel}>Familie und Freunde</Text>
      <Text style={styles.hinweis}>
        Alle, die der Hub kennt – Haushalt und geortete Personen. Antippen zeigt,
        was über eine Person gemeldet wird.
      </Text>
      {fehler ? <Text style={styles.fehler}>{fehler}</Text> : null}

      {leute.length === 0 ? (
        <Leer
          titel="Noch niemand erfasst"
          hinweis="Sobald ein Benutzer angelegt oder eine Ortungszone eingerichtet ist, steht die Person hier."
        />
      ) : null}

      {leute.map((person) => {
        const auf = offen === (person.zone ?? person.name);
        const neben = nebenZeile(person);
        return (
          <View key={person.zone ?? person.name} style={styles.zeile}>
            <Pressable
              onPress={() => setOffen(auf ? null : (person.zone ?? person.name))}
              accessibilityRole="button"
              accessibilityState={{ expanded: auf }}
              accessibilityLabel={`${person.name}, ${ortZeile(person, jetzt)}`}
              style={({ pressed }) => [styles.kopf, pressed && { opacity: 0.7 }]}
            >
              <Ionicons
                name={person.household ? 'person-circle-outline' : 'location-outline'}
                size={22}
                color={colors.inkSoft}
              />
              <View style={{ flex: 1 }}>
                <View style={styles.namenszeile}>
                  <Text style={styles.name} numberOfLines={1}>
                    {person.name}
                  </Text>
                  <Text style={styles.marke}>{herkunft(person)}</Text>
                </View>
                <Text style={styles.ort} numberOfLines={1}>
                  {ortZeile(person, jetzt)}
                </Text>
                {neben ? (
                  <Text style={styles.neben} numberOfLines={1}>
                    {neben}
                  </Text>
                ) : null}
              </View>
              {person.zone ? (
                <Text style={styles.zahl}>{anzahlAn(person)}</Text>
              ) : null}
              <Ionicons
                name={auf ? 'chevron-up' : 'chevron-down'}
                size={18}
                color={colors.inkFaint}
              />
            </Pressable>

            {auf ? (
              person.zone ? (
                <View style={styles.schalter}>
                  {Object.entries(daten.meldungen).map(([key, label]) => (
                    <View key={key} style={styles.schalterZeile}>
                      <Text style={styles.schalterText} numberOfLines={2}>
                        {label}
                      </Text>
                      <Switch
                        value={!!person.meldungen?.[key]}
                        onValueChange={(wert) => umlegen(person, key, wert)}
                        accessibilityLabel={`${label} für ${person.name}`}
                        trackColor={{ false: colors.surfaceBorder, true: colors.accent }}
                      />
                    </View>
                  ))}
                </View>
              ) : (
                /* Ohne Ortung gibt es nichts zu melden. Das ist kein
                   Fehler – ein Wandtablet ist ein Benutzer und geht
                   nirgendwohin –, aber es soll dastehen, statt dass man
                   nach den fehlenden Schaltern sucht. */
                <Text style={styles.ohne}>
                  Für {person.name} ist keine Ortung eingerichtet – darum gibt es
                  nichts zu melden. Ortungszonen stehen unter System → Konfiguration
                  im Block «geofence».
                </Text>
              )
            ) : null}
          </View>
        );
      })}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: space.gap },
    titel: { color: colors.ink, fontSize: 18, fontWeight: '700' },
    hinweis: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    fehler: { color: colors.danger, fontSize: 13 },
    zeile: {
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.surfaceBorder,
      paddingTop: 10,
      gap: 8,
    },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    namenszeile: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    name: { color: colors.ink, fontSize: 15, fontWeight: '600', flexShrink: 1 },
    marke: {
      color: colors.inkFaint,
      fontSize: 11,
      paddingHorizontal: 7,
      paddingVertical: 2,
      borderRadius: radius.pill,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.surfaceBorder,
      overflow: 'hidden',
    },
    ort: { color: colors.inkSoft, fontSize: 13, marginTop: 2 },
    neben: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    zahl: { color: colors.inkFaint, fontSize: 13 },
    schalter: { paddingLeft: 32, paddingBottom: 4, gap: 2 },
    schalterZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: 12,
      paddingVertical: 4,
    },
    schalterText: { color: colors.ink, fontSize: 14, flexShrink: 1 },
    ohne: {
      color: colors.inkFaint,
      fontSize: 12,
      lineHeight: 18,
      paddingLeft: 32,
      paddingBottom: 6,
    },
  });
