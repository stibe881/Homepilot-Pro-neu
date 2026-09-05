import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Modal, Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Fehlschlag, Laedt, Leer } from '../components/Zustand';
import { useTakt } from '../hooks/useTakt';
import { DAUERN, Dauer, ablaufDatum, ablaufSatz } from '../lib/gastzugang';
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

export function PersonenScreen({
  settings,
  darfZugang = false,
}: {
  settings: HubSettings;
  /** Darf der angemeldete Benutzer Zugänge anlegen (manage_users)?
   *  Ohne das Recht wiese der Hub den Knopf ohnehin ab - er soll dann
   *  gar nicht erst dastehen. */
  darfZugang?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [daten, setDaten] = useState<Antwort | null>(null);
  const [fehler, setFehler] = useState<string | null>(null);
  const [offen, setOffen] = useState<string | null>(null);
  const [jetzt, setJetzt] = useState(() => new Date());
  // Der spontane Gast-Zugang: gewählte Dauer, laufender Aufruf und der
  // Kopplungs-QR, sobald der Zugang steht (lib/gastzugang.ts).
  const [dauer, setDauer] = useState<Dauer>('heute');
  const [zugangLaeuft, setZugangLaeuft] = useState(false);
  const [zugangFehler, setZugangFehler] = useState<string | null>(null);
  const [kopplung, setKopplung] = useState<{
    name: string;
    payload: string;
    expires: string | null;
  } | null>(null);

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

  /**
   * Gast-Zugang anlegen und gleich den Kopplungs-QR holen.
   *
   * Der Fall: Besuch sitzt auf dem Sofa und will das Licht dimmen.
   * Bisher hiess das Benutzerverwaltung, Benutzer anlegen, Rolle,
   * Ablaufdatum - fünf Schritte weit weg von der Person, um die es
   * geht. Hier steht sie schon; Dauer antippen, QR zeigen, fertig.
   */
  const zugangGeben = async (person: Person) => {
    setZugangFehler(null);
    setZugangLaeuft(true);
    const expires = ablaufDatum(dauer, new Date());
    try {
      await hub.post('/api/users', { name: person.name, role: 'gast', expires });
      const antwort = await hub.get<{ payload?: string }>(
        `/api/users/${encodeURIComponent(person.name)}/pairing`
      );
      setKopplung({ name: person.name, payload: String(antwort.payload ?? ''), expires });
      // Mit Zugang zählt die Person ab jetzt zum Haushalt - die Liste
      // soll das gleich sagen, nicht erst in einer Minute.
      laden();
    } catch (err) {
      // Der Hub schreibt in seine Fehler fertige deutsche Sätze - etwa,
      // dass es den Namen schon gibt. Die gehören hierher, unverkürzt.
      setZugangFehler(
        err instanceof Error && err.message
          ? err.message
          : 'Der Zugang liess sich nicht anlegen.'
      );
    } finally {
      setZugangLaeuft(false);
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
              onPress={() => {
                setOffen(auf ? null : (person.zone ?? person.name));
                // Der Fehler von vorhin gehört nicht zur nächsten Person.
                setZugangFehler(null);
              }}
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

            {/* Der spontane Gast-Zugang - nur bei Leuten, die der Hub
                bloss ortet: Wer schon Zugang hat, braucht keinen
                zweiten. Und nur für Verwalter; allen anderen wiese der
                Hub den Knopf ohnehin ab. */}
            {auf && darfZugang && !person.household ? (
              <View style={styles.zugang}>
                <Text style={styles.zugangTitel}>Zugang zum Haus geben</Text>
                <Text style={styles.zugangHinweis}>
                  {person.name} hat keinen Zugang zum Hub. Ein Gast-Zugang
                  zeigt Licht und Schalter – mehr lässt sich danach in der
                  Benutzerverwaltung freigeben.
                </Text>
                <View style={styles.dauerReihe}>
                  {DAUERN.map((eintrag) => {
                    const aktiv = dauer === eintrag.key;
                    return (
                      <Pressable
                        key={eintrag.key}
                        onPress={() => setDauer(eintrag.key)}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: aktiv }}
                        style={[styles.dauerChip, aktiv && styles.dauerChipAktiv]}
                      >
                        <Text
                          style={[
                            styles.dauerText,
                            aktiv && styles.dauerTextAktiv,
                          ]}
                        >
                          {eintrag.label}
                        </Text>
                      </Pressable>
                    );
                  })}
                </View>
                {zugangFehler ? (
                  <Text style={styles.fehler}>{zugangFehler}</Text>
                ) : null}
                <Pressable
                  onPress={() => zugangGeben(person)}
                  disabled={zugangLaeuft}
                  accessibilityRole="button"
                  accessibilityLabel={`Gast-Zugang für ${person.name} anlegen`}
                  style={({ pressed }) => [
                    styles.zugangKnopf,
                    (pressed || zugangLaeuft) && { opacity: 0.6 },
                  ]}
                >
                  <Ionicons name="key-outline" size={16} color={colors.accent} />
                  <Text style={styles.zugangKnopfText}>
                    {zugangLaeuft ? 'Wird angelegt …' : 'Gast-Zugang anlegen'}
                  </Text>
                </Pressable>
              </View>
            ) : null}
          </View>
        );
      })}

      {/* Der Kopplungs-QR, sobald der Zugang steht: Das Telefon des
          Gasts scannt, Verbindung und Token kommen von selbst -
          dieselbe Kopplung wie in der Benutzerverwaltung. */}
      <Modal
        visible={kopplung !== null}
        transparent
        animationType="fade"
        onRequestClose={() => setKopplung(null)}
      >
        <Pressable style={styles.qrHintergrund} onPress={() => setKopplung(null)}>
          <Pressable style={styles.qrBlatt} onPress={() => {}}>
            <Text style={styles.qrTitel}>Zugang für {kopplung?.name}</Text>
            <View style={styles.qrKasten}>
              {kopplung?.payload ? (
                <QRCode value={kopplung.payload} size={200} backgroundColor="#FFFFFF" />
              ) : (
                <Text style={styles.zugangHinweis}>
                  Der Zugang steht – der Kopplungs-Code liess sich aber nicht
                  laden. Er liegt in der Benutzerverwaltung bereit.
                </Text>
              )}
            </View>
            <Text style={styles.qrHinweis}>
              Auf dem Telefon von {kopplung?.name} in der HomePilot-App
              «QR-Code vom Hub scannen» – Verbindung und Zugang kommen von
              selbst.
            </Text>
            <Text style={styles.qrHinweis}>
              {ablaufSatz(kopplung?.expires ?? null)}
            </Text>
            <Pressable
              onPress={() => setKopplung(null)}
              accessibilityRole="button"
              style={({ pressed }) => [styles.qrSchliessen, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.qrSchliessenText}>Schliessen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>
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
    // Der Gast-Zugang: abgesetzt wie ein kleines Formular in der Zeile.
    zugang: {
      marginLeft: 32,
      marginBottom: 6,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: StyleSheet.hairlineWidth,
      borderColor: colors.surfaceBorder,
      gap: 8,
    },
    zugangTitel: { color: colors.ink, fontSize: 14, fontWeight: '700' },
    zugangHinweis: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
    dauerReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    dauerChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    dauerChipAktiv: { backgroundColor: colors.accent, borderColor: colors.accent },
    dauerText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    dauerTextAktiv: { color: '#FFFFFF' },
    zugangKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 11,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.accent,
    },
    zugangKnopfText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
    qrHintergrund: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.55)',
      alignItems: 'center',
      justifyContent: 'center',
      padding: 24,
    },
    qrBlatt: {
      width: '100%',
      maxWidth: 380,
      borderRadius: radius.control,
      backgroundColor: colors.panel,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      padding: 18,
      gap: 12,
    },
    qrTitel: { color: colors.ink, fontSize: 17, fontWeight: '700' },
    // Weisser Grund mit Rand: Ein QR-Code auf dunkler Fläche liest so
    // mancher Scanner nicht.
    qrKasten: {
      alignSelf: 'center',
      backgroundColor: '#FFFFFF',
      padding: 14,
      borderRadius: radius.control,
    },
    qrHinweis: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    qrSchliessen: {
      alignItems: 'center',
      paddingVertical: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    qrSchliessenText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  });
