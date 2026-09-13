import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import {
  ANLERN_MINUTEN,
  AnlernStand,
  anlernSatz,
  gefundenZeile,
  gekoppeltSatz,
  matterCodeGueltig,
} from '../lib/anlernen';
import { kann } from '../lib/plattform';
import { Colors, radius, type, useColors } from '../theme';

import { Abschnitt } from './Abschnitt';
import { Card } from './Card';
import { QrScanner } from './QrScanner';

/**
 * «Gerät hinzufügen» unter Einstellungen → Verbindungen (Punkt 632).
 *
 * Zigbee: Das Netz für ein paar Minuten öffnen, dann die Anlerntaste am
 * Gerät drücken; der Hub zählt die Restzeit herunter und sagt «Aqara
 * Türkontakt gefunden», sobald Zigbee2MQTT das Gerät ausgefragt hat.
 * Matter: den Code vom Aufkleber scannen oder tippen, koppeln, fertig.
 *
 * Beides stand bisher ausserhalb der App - an der Z2M-Oberfläche auf
 * Port 8099 und an der Kommandozeile des Hub-Rechners. Hier steht es
 * neben der Fernseher-Kopplung, wo Einrichten zuhause ist. Das neue
 * Gerät hat noch keinen Raum und landet damit von selbst unter Geräte →
 * «Noch einzurichten».
 *
 * Solange das Netz offen ist, fragt die Karte den Hub alle drei
 * Sekunden - nicht über den WebSocket, weil ein anklopfendes Gerät
 * keine Entität ist und dort nie vorbeikäme.
 */
export function GeraetAnlernen({ settings }: { settings: HubSettings }) {
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [stand, setStand] = useState<{
    zigbee: AnlernStand | null;
    matter: { verbunden: boolean } | null;
  } | null>(null);

  const laden = useCallback(() => {
    if (!settings.url || !settings.token) return;
    hub
      .get<{ zigbee: AnlernStand | null; matter: { verbunden: boolean } | null }>(
        '/api/verbindungen/anlernen',
        { still: true }
      )
      .then(setStand)
      // Ein alter Hub kennt die Route nicht - dann fehlt der Abschnitt.
      .catch(() => setStand(null));
  }, [hub, settings.url, settings.token]);

  useEffect(laden, [laden]);

  // Offen? Dann im Takt nachsehen, wer anklopft und wie lange noch.
  const offen = !!stand?.zigbee?.offen;
  useEffect(() => {
    if (!offen) return;
    const takt = setInterval(laden, 3000);
    return () => clearInterval(takt);
  }, [offen, laden]);

  if (!stand || (!stand.zigbee && !stand.matter)) return null;

  return (
    <Abschnitt
      titel="Gerät hinzufügen"
      hinweis="Das neue Gerät steht danach unter Geräte → Noch einzurichten und bekommt dort Raum und Namen."
    >
      {stand.zigbee ? (
        <ZigbeeKarte
          stand={stand.zigbee}
          onOeffnen={async (minuten) => {
            const neu = await hub.post<AnlernStand>(
              '/api/verbindungen/zigbee/anlernen',
              { minuten },
              { still: true }
            );
            setStand((alt) => (alt ? { ...alt, zigbee: neu } : alt));
          }}
        />
      ) : null}
      {stand.matter ? (
        <MatterKarte
          verbunden={stand.matter.verbunden}
          onKoppeln={(code) =>
            hub.post<{ node_id?: number | null; geraete?: string[] }>(
              '/api/verbindungen/matter/koppeln',
              { code },
              { still: true }
            )
          }
        />
      ) : null}
    </Abschnitt>
  );
}

function ZigbeeKarte({
  stand,
  onOeffnen,
}: {
  stand: AnlernStand;
  onOeffnen: (minuten: number) => Promise<void>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const schalten = async (minuten: number) => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try {
      await onOeffnen(minuten);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.kopf}>
        <Ionicons
          name="radio-outline"
          size={20}
          color={stand.offen ? colors.accent : colors.inkSoft}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>Zigbee</Text>
          <Text style={[styles.zeile, stand.offen && { color: colors.accent }]}>
            {anlernSatz(stand)}
          </Text>
        </View>
      </View>
      {stand.gefunden.length > 0 ? (
        <View style={styles.liste}>
          {stand.gefunden.map((eintrag) => (
            <View key={eintrag.name} style={styles.gefunden}>
              <Ionicons
                name={eintrag.status === 'successful' ? 'checkmark-circle' : 'ellipse-outline'}
                size={16}
                color={eintrag.status === 'successful' ? colors.on : colors.inkFaint}
              />
              <Text style={styles.gefundenText}>{gefundenZeile(eintrag)}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {fehler ? <Text style={styles.fehler}>{fehler}</Text> : null}
      <View style={styles.knoepfe}>
        {stand.offen ? (
          <Pressable
            onPress={() => schalten(0)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.knopfLeise, pressed && { opacity: 0.6 }]}
          >
            <Text style={styles.knopfLeiseText}>Netz schliessen</Text>
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => schalten(ANLERN_MINUTEN)}
          disabled={laeuft || stand.verbunden === false}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.knopf,
            (pressed || laeuft || stand.verbunden === false) && { opacity: 0.6 },
          ]}
        >
          <Text style={styles.knopfText}>
            {stand.offen ? `Weitere ${ANLERN_MINUTEN} Minuten` : `Anlernen für ${ANLERN_MINUTEN} Minuten`}
          </Text>
        </Pressable>
      </View>
    </Card>
  );
}

function MatterKarte({
  verbunden,
  onKoppeln,
}: {
  verbunden: boolean;
  onKoppeln: (code: string) => Promise<{ node_id?: number | null; geraete?: string[] }>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [code, setCode] = useState('');
  const [scanner, setScanner] = useState(false);
  const [laeuft, setLaeuft] = useState(false);
  const [meldung, setMeldung] = useState<{ text: string; fehler: boolean } | null>(null);

  const koppeln = async () => {
    if (laeuft || !matterCodeGueltig(code)) return;
    setLaeuft(true);
    setMeldung(null);
    try {
      const antwort = await onKoppeln(code.trim());
      setMeldung({ text: gekoppeltSatz(antwort.geraete ?? [], antwort.node_id), fehler: false });
      setCode('');
    } catch (err) {
      setMeldung({
        text: err instanceof Error ? err.message : 'Das hat nicht geklappt.',
        fehler: true,
      });
    } finally {
      setLaeuft(false);
    }
  };

  return (
    <Card style={styles.card}>
      <View style={styles.kopf}>
        <Ionicons name="cube-outline" size={20} color={verbunden ? colors.inkSoft : colors.warn} />
        <View style={{ flex: 1 }}>
          <Text style={styles.name}>Matter</Text>
          <Text style={[styles.zeile, !verbunden && { color: colors.warnInk }]}>
            {verbunden
              ? 'Den Code vom Aufkleber des Geräts scannen oder eintippen. Das Gerät muss im Kopplungsmodus sein.'
              : 'Der Matter-Dienst ist gerade nicht verbunden.'}
          </Text>
        </View>
      </View>
      <View style={styles.eingabe}>
        <TextInput
          style={styles.feld}
          value={code}
          onChangeText={setCode}
          placeholder="MT:… oder 3497-011-2332"
          placeholderTextColor={colors.inkFaint}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="Matter-Code"
          onSubmitEditing={koppeln}
        />
        {kann.qrScan ? (
          <Pressable
            onPress={() => setScanner(true)}
            accessibilityRole="button"
            accessibilityLabel="Code scannen"
            hitSlop={6}
            style={({ pressed }) => [styles.scan, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.ink} />
          </Pressable>
        ) : null}
      </View>
      {meldung ? (
        <Text style={meldung.fehler ? styles.fehler : styles.erfolg}>{meldung.text}</Text>
      ) : null}
      <View style={styles.knoepfe}>
        <Pressable
          onPress={koppeln}
          disabled={laeuft || !verbunden || !matterCodeGueltig(code)}
          accessibilityRole="button"
          style={({ pressed }) => [
            styles.knopf,
            (pressed || laeuft || !verbunden || !matterCodeGueltig(code)) && { opacity: 0.6 },
          ]}
        >
          <Text style={styles.knopfText}>{laeuft ? 'Koppelt …' : 'Koppeln'}</Text>
        </Pressable>
      </View>
      <QrScanner
        visible={scanner}
        onClose={() => setScanner(false)}
        onText={(text) => setCode(text.trim())}
        titel="Matter-Code scannen"
        hinweis="Der QR-Code steht auf dem Gerät oder seiner Verpackung und beginnt mit MT:."
      />
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: {
      width: '100%',
      maxWidth: 460,
      alignSelf: 'center',
      minHeight: 0,
      gap: 12,
      padding: 22,
    },
    kopf: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    name: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    zeile: { color: colors.inkSoft, fontSize: 13, lineHeight: 18, marginTop: 2 },
    liste: { gap: 6 },
    gefunden: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    gefundenText: { color: colors.ink, fontSize: 14, flex: 1 },
    fehler: { color: colors.danger, fontSize: 13, lineHeight: 18 },
    erfolg: { color: colors.on, fontSize: 13, lineHeight: 18, fontWeight: '600' },
    eingabe: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    feld: {
      flex: 1,
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    scan: {
      width: 44,
      height: 44,
      alignItems: 'center',
      justifyContent: 'center',
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    knoepfe: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end' },
    knopf: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.ink,
    },
    knopfText: { color: colors.panel, fontSize: 13, fontWeight: '700' },
    knopfLeise: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    knopfLeiseText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  });
