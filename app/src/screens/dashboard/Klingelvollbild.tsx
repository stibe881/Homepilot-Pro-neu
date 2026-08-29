import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useState } from 'react';
import { Image, Linking, Modal, Pressable, Text, View } from 'react-native';

import { Entity, HubSettings } from '../../api/types';
import { CameraLive } from '../../components/CameraLive';
import { useTakt } from '../../hooks/useTakt';
import {
  AUTO_SCHLIESSEN_SEKUNDEN,
  KlingelAktion,
  neueFrist,
  restSekunden,
} from '../../lib/klingel';
import { mayOpenDirectly } from '../../lib/tuerbestaetigung';
import { Colors } from '../../theme';
import { DashboardStile } from './stile';

/**
 * Vollbild, wenn es an der Haustüre klingelt: Kamerabild gross, ein Knopf
 * zum Öffnen (mit Zwei-Schritt-Bestätigung), einer zum Schliessen. Gedacht
 * fürs Wandpanel genauso wie fürs Telefon in der Hosentasche.
 */
export function DoorbellOverlay({
  ausloeser,
  camera,
  aktionen,
  settings,
  onCommand,
  doorConfirm,
  onDismiss,
  colors,
  styles,
}: {
  /** Was geklingelt hat – Türklingel, Kamera oder Gegensprechanlage. */
  ausloeser: Entity;
  /** Das Bild dazu, sofern es eines gibt. Eine Anlage hat keines. */
  camera?: Entity;
  aktionen: KlingelAktion[];
  settings: HubSettings;
  onCommand: (entityId: string, command: string) => void;
  /** Fragt die Türe vor dem Öffnen nach? Auch hier, wo man ohnehin
   *  hinschaut: Wer die Rückfrage abgestellt hat, meint sie überall. */
  doorConfirm?: boolean;
  onDismiss: () => void;
  colors: Colors;
  styles: DashboardStile;
}) {
  // Welche Türe gerade auf die Rückfrage wartet - eine zur Zeit.
  const [confirm, setConfirm] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [liveFailed, setLiveFailed] = useState<string | null>(null);
  // Alle 3 Sekunden ein frisches Bild, solange das Vollbild offen ist.
  useTakt(() => setTick((value) => value + 1), 3000);

  // Rücklauf: Am Wandpanel bliebe sonst ein Bild der Strasse stehen, bis
  // es jemand bemerkt. Jede Berührung setzt ihn zurück - während man
  // hinschaut und überlegt, soll nichts zuklappen.
  const [frist, setFrist] = useState(() => neueFrist(Date.now()));
  const [rest, setRest] = useState(AUTO_SCHLIESSEN_SEKUNDEN);
  const verlaengern = () => {
    const neu = neueFrist(Date.now());
    setFrist(neu);
    setRest(restSekunden(neu, Date.now()));
  };
  useTakt(() => setRest(restSekunden(frist, Date.now())), 1000);
  useEffect(() => {
    if (rest <= 0) onDismiss();
  }, [rest, onDismiss]);
  // Ein neues Klingeln ist ein neuer Anlass, auch wenn das Bild noch steht.
  useEffect(() => {
    const neu = neueFrist(Date.now());
    setFrist(neu);
    setRest(restSekunden(neu, Date.now()));
    setConfirm(null);
  }, [ausloeser.state.last_ring]);
  // Die Rückfrage verfällt von selbst. Sonst stünde «Wirklich öffnen?»
  // eine Minute lang da, und der nächste beiläufige Tipp macht auf.
  useEffect(() => {
    if (!confirm) return undefined;
    const timer = setTimeout(() => setConfirm(null), 8000);
    return () => clearTimeout(timer);
  }, [confirm]);
  const base =
    camera && settings.url && settings.token
      ? `${settings.url.replace(/\/+$/, '')}/api/entities/${encodeURIComponent(camera.id)}`
      : null;
  const token = encodeURIComponent(settings.token ?? '');
  const uri = base ? `${base}/snapshot?token=${token}&t=${tick}` : null;
  // Wer klingelt, will man in Bewegung sehen – wenn die Kamera es hergibt.
  const live = base && camera?.state.stream === true && !liveFailed;

  return (
    <Modal visible animationType="fade" onRequestClose={onDismiss}>
      <Pressable
        style={styles.doorbellRoot}
        onPress={verlaengern}
        accessibilityLabel="Offen halten"
      >
        {/* Welche Klingel es war, gehört dazu: Bei zwei Türen ist «Es
            klingelt» die halbe Auskunft, und man drückt den falschen
            Knopf. */}
        <Text style={styles.doorbellTitle}>🔔 Es klingelt · {ausloeser.name}</Text>
        {live ? (
          <View style={styles.videoBox}>
            <CameraLive
              uri={`${base}/stream.m3u8?token=${token}`}
              label="Live-Bild der Türklingel"
              style={styles.videoFrame}
              onFailed={(message) => setLiveFailed(message)}
            />
          </View>
        ) : uri ? (
          <Image source={{ uri }} style={styles.doorbellImage} resizeMode="cover" />
        ) : (
          // Kein Bild, also auch kein halber Bildschirm dafür: Eine
          // Gegensprechanlage hat keine Kamera, und die schwarze Fläche
          // schob die Knöpfe nach unten, um die es hier eigentlich geht.
          <View style={styles.doorbellOhneBild}>
            <Ionicons name="videocam-off-outline" size={26} color="#8A94A6" />
            <Text style={styles.doorbellCloseText}>Kein Kamerabild an dieser Türe</Text>
          </View>
        )}
        <View style={styles.doorbellButtons}>
          {/* Sprechen läuft über die Ring-App: Die Gegensprech-Verbindung
              ist WebRTC gegen Rings Server, und die gibt der Hersteller
              nicht heraus. Ein Tipp führt dorthin, statt einen Knopf zu
              zeigen, der nichts kann. */}
          <Pressable
            onPress={() => {
              // Erst die App, dann der Browser - klappt beides nicht,
              // gibt es schlicht kein Ring-Konto auf diesem Gerät.
              Linking.openURL('ring://').catch(() =>
                Linking.openURL('https://account.ring.com/').catch(() => {})
              );
            }}
            accessibilityRole="button"
            style={styles.doorbellTalk}
          >
            <Ionicons name="mic-outline" size={20} color="#FFFFFF" />
            <Text style={styles.doorbellOpenText}>Sprechen (Ring-App)</Text>
          </Pressable>
          {/* Beide Türen nebeneinander: Wer im Treppenhaus wartet, soll
              nicht darauf warten, dass jemand die App durchsucht. Die
              Rückfrage bleibt je Türe - ein Fehlgriff öffnet sonst die
              falsche. */}
          {aktionen.map((aktion) => {
            const gefragt = confirm === aktion.id;
            // «Wirklich?» statt «Wirklich öffnen?»: Der Knopf sagt
            // darüber schon, worum es geht, und aufschliessen ist nicht
            // öffnen - die Rückfrage darf das nicht durcheinanderbringen.
            const rueckfrage = `Wirklich? ${aktion.label}`;
            return (
              <Pressable
                key={aktion.id}
                onPress={() => {
                  verlaengern();
                  // Ohne Rückfrage nur, wenn *jeder* Schritt sie
                  // überspringen dürfte: Ein Weg über zwei Türen ist
                  // nicht harmloser als seine heikelste Türe.
                  const ohneFrage = aktion.schritte.every((schritt) =>
                    mayOpenDirectly(schritt.befehl, doorConfirm)
                  );
                  if (gefragt || ohneFrage) {
                    // Der Reihe nach: unten zuerst, damit der Besuch
                    // nicht vor der zweiten Türe steht, während die
                    // erste noch zu ist.
                    for (const schritt of aktion.schritte) {
                      onCommand(schritt.entity.id, schritt.befehl);
                    }
                    onDismiss();
                  } else {
                    setConfirm(aktion.id);
                  }
                }}
                accessibilityRole="button"
                accessibilityLabel={gefragt ? rueckfrage : aktion.label}
                style={[styles.doorbellOpen, gefragt && { backgroundColor: colors.danger }]}
              >
                <Ionicons
                  name={aktion.oeffnet ? 'log-in-outline' : 'key'}
                  size={22}
                  color="#FFFFFF"
                />
                <Text style={styles.doorbellOpenText}>
                  {gefragt ? rueckfrage : aktion.label}
                </Text>
              </Pressable>
            );
          })}
          {/* Einmal erklärt, worin der Unterschied besteht. «Beide
              aufschliessen» und «Beide öffnen» stehen sonst untereinander
              und sehen aus wie dasselbe - und man drückt im Zweifel das
              Weitergehende, weil es sicherer klingt. */}
          {aktionen.some((aktion) => aktion.id.startsWith('alle')) ? (
            <Text style={styles.doorbellHinweis}>
              Aufschliessen zieht nur den Riegel – die Türe muss noch
              gedrückt werden. Öffnen zieht auch die Falle.
            </Text>
          ) : null}
          <Pressable onPress={onDismiss} style={styles.doorbellClose}>
            <Text style={styles.doorbellCloseText}>
              Schliessen{rest > 0 ? ` (${rest})` : ''}
            </Text>
          </Pressable>
        </View>
      </Pressable>
    </Modal>
  );
}
