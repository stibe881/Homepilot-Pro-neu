import { Ionicons } from '@expo/vector-icons';
import React from 'react';
import { Modal, Pressable, ScrollView, Text, View } from 'react-native';

import { Erinnerung, vollbildTitel } from '../../lib/erinnerungen';
import { datumUhr } from '../../lib/format';
import { DashboardStile } from './stile';

/**
 * Die fällige Erinnerung, gross und unübersehbar.
 *
 * Kein Kreuz und kein Wegwischen: Sie verschwindet nur über
 * «Erledigt» - das ist ihr ganzer Sinn. Wer sie nur wegdrücken könnte,
 * hätte einen hübschen Wecker ohne Gedächtnis. Bestätigt wird beim Hub,
 * und damit auf allen Bildschirmen zugleich.
 */
export function ErinnerungOverlay({
  erinnerungen,
  onBestaetigen,
  onQuittieren,
  styles,
}: {
  erinnerungen: Erinnerung[];
  /** «Für alle erledigt» - räumt die Erinnerung überall ab. */
  onBestaetigen: (id: string) => void;
  /** «Erledigt» - nur bei mir weg, die anderen sehen sie weiter. */
  onQuittieren: (id: string) => void;
  styles: DashboardStile;
}) {
  return (
    <Modal visible animationType="fade" onRequestClose={() => {}}>
      <View style={styles.doorbellRoot}>
        {/* Bei mehreren steht die Zahl oben: Wer von der zweiten
            Push-Nachricht kommt, soll sehen, dass hier zwei Karten
            warten - jede mit eigenen Knöpfen, jede einzeln
            bestätigbar. */}
        <Text style={styles.doorbellTitle}>{vollbildTitel(erinnerungen.length)}</Text>
        <ScrollView contentContainerStyle={styles.erinnerungListe}>
          {erinnerungen.map((erinnerung) => (
            <View key={erinnerung.id} style={styles.erinnerungKarte}>
              <Text style={styles.erinnerungText}>
                {String(erinnerung.text ?? '')}
              </Text>
              <Text style={styles.erinnerungZeit}>
                {datumUhr(Number(erinnerung.at))}
              </Text>
              <View style={styles.erinnerungKnoepfe}>
                <Pressable
                  onPress={() => onQuittieren(erinnerung.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Erinnerung «${String(erinnerung.text ?? '')}» nur bei mir erledigt`}
                  style={({ pressed }) => [
                    styles.erinnerungKnopfLeise,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Text style={styles.erinnerungKnopfLeiseText}>Erledigt</Text>
                </Pressable>
                <Pressable
                  onPress={() => onBestaetigen(erinnerung.id)}
                  accessibilityRole="button"
                  accessibilityLabel={`Erinnerung «${String(erinnerung.text ?? '')}» für alle erledigt`}
                  style={({ pressed }) => [
                    styles.erinnerungKnopf,
                    pressed && { opacity: 0.8 },
                  ]}
                >
                  <Ionicons name="checkmark" size={22} color="#FFFFFF" />
                  <Text style={styles.erinnerungKnopfText}>Für alle erledigt</Text>
                </Pressable>
              </View>
              <Text style={styles.erinnerungHinweis}>
                «Erledigt» blendet sie nur hier aus - bei den anderen bleibt sie
                stehen.
              </Text>
            </View>
          ))}
        </ScrollView>
      </View>
    </Modal>
  );
}
