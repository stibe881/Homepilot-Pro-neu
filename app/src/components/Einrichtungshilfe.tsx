/**
 * Was noch eingerichtet werden will – an einem Ort.
 *
 * Der Hub findet Geräte von selbst: Cast-Boxen im Netz, alles, was über
 * Zigbee2MQTT oder Matter dazukommt. Danach stehen sie als Kacheln da,
 * mit dem Namen vom Hersteller und ohne Raum. Wer sie einrichten wollte,
 * musste jede Kachel einzeln suchen, in den Anpassen-Modus wechseln und
 * dort zweimal tippen – und vorher wissen, dass es sie überhaupt gibt.
 *
 * Hier stehen sie zusammen, mit Namensvorschlag und Raumauswahl. Wer
 * fertig ist, sieht die Karte nicht mehr: Eine Aufgabenliste, die auch
 * dann noch dasteht, wenn nichts mehr zu tun ist, liest bald niemand.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { Entity } from '../api/types';
import { Offen, namensVorschlag, offenSatz, offeneGeraete } from '../lib/einrichten';
import { Colors, radius, type, useColors } from '../theme';

import { Card } from './Card';

export function Einrichtungshilfe({
  entities,
  raeume,
  onRaum,
  onName,
}: {
  entities: Entity[];
  raeume: string[];
  onRaum: (entityId: string, raum: string) => void;
  onName: (entityId: string, name: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offenAuf, setOffenAuf] = useState<string | null>(null);
  const [entwurf, setEntwurf] = useState('');

  const offen = useMemo(() => offeneGeraete(entities, raeume), [entities, raeume]);
  // Wer fertig ist, sieht die Karte nicht mehr.
  if (offen.length === 0) return null;

  const aufmachen = (eintrag: Offen) => {
    const auf = offenAuf === eintrag.entity.id;
    setOffenAuf(auf ? null : eintrag.entity.id);
    setEntwurf(
      auf ? '' : namensVorschlag(eintrag.entity.room, eintrag.entity.kind) || eintrag.entity.name,
    );
  };

  return (
    <Card>
      <View style={styles.kopf}>
        <Ionicons name="construct-outline" size={18} color={colors.inkSoft} />
        <Text style={styles.titel}>Noch einzurichten</Text>
      </View>
      <Text style={styles.satz}>{offenSatz(offen)}</Text>

      <ScrollView style={{ maxHeight: 420 }}>
        {offen.map((eintrag) => {
          const auf = offenAuf === eintrag.entity.id;
          return (
            <View key={eintrag.entity.id} style={styles.block}>
              <Pressable
                onPress={() => aufmachen(eintrag)}
                accessibilityRole="button"
                accessibilityLabel={`${eintrag.entity.name} einrichten`}
                style={({ pressed }) => [styles.zeile, pressed && { opacity: 0.7 }]}
              >
                <View style={{ flex: 1 }}>
                  <Text style={styles.name} numberOfLines={1}>
                    {eintrag.entity.name}
                  </Text>
                  <Text style={styles.grund}>
                    {eintrag.grund === 'raum'
                      ? 'Kein Raum – taucht in keiner Raumansicht auf'
                      : `Name aus der Verpackung · ${eintrag.entity.room}`}
                  </Text>
                </View>
                <Ionicons
                  name={auf ? 'chevron-up' : 'chevron-down'}
                  size={18}
                  color={colors.inkFaint}
                />
              </Pressable>

              {auf ? (
                <View style={styles.formular}>
                  {/* Zuerst der Raum: Aus ihm entsteht der Namensvorschlag,
                      und ohne ihn ist «Licht» kein Name. */}
                  <View style={styles.chips}>
                    {raeume.map((raum) => (
                      <Pressable
                        key={raum}
                        onPress={() => {
                          onRaum(eintrag.entity.id, raum);
                          setEntwurf(namensVorschlag(raum, eintrag.entity.kind));
                        }}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: eintrag.entity.room === raum }}
                        style={({ pressed }) => [
                          styles.chip,
                          eintrag.entity.room === raum && styles.chipAn,
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Text
                          style={[
                            styles.chipText,
                            eintrag.entity.room === raum && styles.chipTextAn,
                          ]}
                        >
                          {raum}
                        </Text>
                      </Pressable>
                    ))}
                  </View>

                  <View style={styles.namensZeile}>
                    <TextInput
                      style={styles.eingabe}
                      value={entwurf}
                      onChangeText={setEntwurf}
                      placeholder="Name"
                      placeholderTextColor={colors.inkFaint}
                      accessibilityLabel="Name"
                    />
                    <Pressable
                      onPress={() => {
                        const sauber = entwurf.trim();
                        if (!sauber) return;
                        onName(eintrag.entity.id, sauber);
                        setOffenAuf(null);
                      }}
                      disabled={!entwurf.trim()}
                      accessibilityRole="button"
                      accessibilityLabel="Namen übernehmen"
                      style={({ pressed }) => [
                        styles.sichern,
                        (pressed || !entwurf.trim()) && { opacity: 0.5 },
                      ]}
                    >
                      <Ionicons name="checkmark" size={18} color="#FFFFFF" />
                    </Pressable>
                  </View>
                  <Text style={styles.hinweis}>
                    Vorgeschlagen, nicht gesetzt – wer sein Licht «Esstisch»
                    nennen will, tippt das.
                  </Text>
                </View>
              ) : null}
            </View>
          );
        })}
      </ScrollView>
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    titel: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700', flex: 1 },
    satz: { color: colors.inkSoft, fontSize: 13, marginTop: 2 },
    block: { borderBottomWidth: 1, borderBottomColor: colors.surfaceBorder },
    zeile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 10 },
    name: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    grund: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    formular: { gap: 8, paddingBottom: 12 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingVertical: 5,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    chipAn: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    chipTextAn: { color: '#FFFFFF' },
    namensZeile: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    eingabe: {
      flex: 1,
      color: colors.ink,
      fontSize: 14,
      paddingVertical: 7,
      paddingHorizontal: 10,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    sichern: {
      width: 38,
      height: 38,
      borderRadius: radius.control,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.accent,
    },
    hinweis: { color: colors.inkFaint, fontSize: 11 },
  });
