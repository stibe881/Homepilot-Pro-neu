import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubFehler, hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Klappe } from '../components/Klappe';
import { Fehlschlag, Umriss } from '../components/Zustand';
import { useTakt } from '../hooks/useTakt';
import { BrandSettings, BrandState, Melder, melderZeile, sortiert, zustandText } from '../lib/brand';
import { datumUhr } from '../lib/format';
import { tapped, triggered } from '../lib/haptics';
import { Colors, icon, radius, space, type, useColors } from '../theme';

/**
 * Die Brandmeldeanlage (Punkt 445) - Einstellungen → Brandmeldeanlage.
 *
 * Eine eigene Seite neben der Alarmanlage, weil sie eine andere Frage
 * beantwortet: Die Alarmanlage fragt «ist jemand drin, der nicht
 * hingehört?» und kennt dafür Betriebsarten. Die Brandmeldeanlage fragt
 * «brennt es?» - und die Antwort darauf gilt immer, scharf oder nicht.
 *
 * Oben der Zustand mit den drei Handgriffen, die man im Ernstfall
 * braucht: Quittieren (gesehen, keine Wiederholung mehr), Stumm (die
 * Aqara-Melder hören auf zu heulen), Probealarm. Darunter die Melder
 * mit Batterie und Prüfstand, dann was beim Auslösen geschieht.
 */
interface Overview {
  state: BrandState;
  settings: BrandSettings;
  disabled: string[];
  detectors: Melder[];
  history: { kind: string; text: string; by?: string; at: number; entity_id?: string }[];
  speakers?: number;
}

export function BrandScreen({
  settings,
  darfEinrichten = false,
}: {
  settings: HubSettings;
  /** Wer die Einstellungen ändern darf (edit_config) - alle anderen
   *  sehen Zustand, Melder und Verlauf und dürfen quittieren. */
  darfEinrichten?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const client = useMemo(() => hubClient(settings.url, settings.token), [settings.url, settings.token]);
  const [data, setData] = useState<Overview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [ansage, setAnsage] = useState<string | null>(null);

  const load = useCallback(() => {
    client
      .get<Overview>('/api/brand', { still: true })
      .then((antwort) => {
        setData(antwort);
        setError(null);
      })
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));
  }, [client]);

  useEffect(load, [load]);
  // Im Alarm jede paar Sekunden, sonst gemächlich: Wer hier steht,
  // während es brennt, will sehen, ob der Melder noch anschlägt.
  useTakt(load, data?.state.state === 'ausgeloest' ? 3000 : 30000);

  const speichern = async (patch: Partial<Overview>) => {
    try {
      const antwort = await client.put<Overview>('/api/brand', patch, { still: true });
      setData(antwort);
    } catch (err) {
      setError(err instanceof HubFehler ? err.message : String(err));
    }
  };

  const handgriff = async (pfad: string, meldung: string, haptik: () => void = tapped) => {
    haptik();
    setNote(null);
    try {
      await client.post(pfad, {}, { still: true });
      setNote(meldung);
      load();
    } catch (err) {
      setError(err instanceof HubFehler ? err.message : String(err));
    }
  };

  if (error && !data) {
    return <Fehlschlag text={`Brandmeldeanlage nicht abrufbar: ${error}`} onRetry={load} />;
  }
  if (!data) return <Umriss zeilen={3} hoehe={120} was="Brandmeldeanlage" />;

  const lage = zustandText(data.state);
  const tonFarbe = {
    gut: colors.on,
    warnung: colors.warn,
    ruhig: colors.inkSoft,
    gefahr: colors.danger,
  }[lage.ton];
  const melder = sortiert(data.detectors);
  const einstellungen = data.settings;
  const alarm = data.state.state === 'ausgeloest' || data.state.state === 'quittiert';
  const kannStumm = melder.some((m) => m.can_mute);

  const schalter = (
    key: keyof BrandSettings,
    label: string,
    detail: string
  ) => (
    <Pressable
      key={key}
      onPress={() => speichern({ settings: { ...einstellungen, [key]: !einstellungen[key] } })}
      disabled={!darfEinrichten}
      accessibilityRole="switch"
      accessibilityState={{ checked: Boolean(einstellungen[key]), disabled: !darfEinrichten }}
      style={styles.zeile}
    >
      <Ionicons
        name={einstellungen[key] ? 'checkmark-circle' : 'ellipse-outline'}
        size={22}
        color={einstellungen[key] ? colors.on : colors.inkFaint}
      />
      <View style={{ flex: 1 }}>
        <Text style={styles.zeileTitel}>{label}</Text>
        <Text style={styles.hint}>{detail}</Text>
      </View>
    </Pressable>
  );

  return (
    <ScrollView contentContainerStyle={styles.liste} showsVerticalScrollIndicator={false}>
      {/* Der Zustand - gross, und im Alarm rot. Darunter die drei
          Handgriffe, die man im Ernstfall braucht, und nichts sonst. */}
      <Card style={alarm ? { ...styles.card, borderColor: colors.danger, borderWidth: 2 } : styles.card}>
        <View style={styles.kopf}>
          <Ionicons
            name={alarm ? 'flame' : 'flame-outline'}
            size={28}
            color={tonFarbe}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.heading}>Brandmeldeanlage</Text>
            <Text style={[styles.lage, { color: tonFarbe }]}>{lage.text}</Text>
            {data.state.since ? (
              <Text style={styles.hint}>Seit {datumUhr(data.state.since * 1000)}</Text>
            ) : null}
          </View>
        </View>
        <View style={styles.knopfReihe}>
          {alarm && data.state.state !== 'quittiert' ? (
            <Pressable
              onPress={() => handgriff('/api/brand/quittieren', 'Quittiert – keine Wiederholung mehr.')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.knopf, styles.knopfStark, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="checkmark" size={icon.mittel} color="#FFFFFF" />
              <Text style={styles.knopfStarkText}>Quittieren</Text>
            </Pressable>
          ) : null}
          {kannStumm ? (
            <Pressable
              onPress={() => handgriff('/api/brand/stumm', 'Melder stummgeschaltet.')}
              accessibilityRole="button"
              style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="volume-mute-outline" size={icon.mittel} color={colors.ink} />
              <Text style={styles.knopfText}>Stumm</Text>
            </Pressable>
          ) : null}
          {!alarm ? (
            <Pressable
              onLongPress={() =>
                handgriff('/api/brand/probealarm', 'Probealarm läuft – Nachricht, Durchsage, Licht.', triggered)
              }
              delayLongPress={1500}
              accessibilityRole="button"
              accessibilityHint="Anderthalb Sekunden halten"
              style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="megaphone-outline" size={icon.mittel} color={colors.ink} />
              <Text style={styles.knopfText}>Probealarm (halten)</Text>
            </Pressable>
          ) : null}
        </View>
        {note ? <Text style={styles.hint}>{note}</Text> : null}
        {error ? <Text style={[styles.hint, { color: colors.danger }]}>{error}</Text> : null}
        <Text style={styles.hint}>
          Unabhängig von der Alarmanlage: Ein Melder, der Rauch meldet, löst
          immer aus – scharf oder nicht, Tag oder Nacht, auch im Babysitter-
          und Besuchsmodus. Bei Feuer zuerst raus, dann 118.
        </Text>
      </Card>

      {/* Die Melder: Aqara-Rauchmelder, Gasmelder und Kameras, die einen
          Melder hören. Jeder mit Batterie und Prüfstand; abschalten lässt
          sich der eine in der Werkstatt, der beim Schweissen anschlägt. */}
      <Card style={styles.card}>
        <Klappe label="Melder" stand={`${melder.filter((m) => m.active).length} von ${melder.length} aktiv`}>
          {melder.length === 0 ? (
            <Text style={styles.hint}>
              Noch kein Rauch- oder Gasmelder angeschlossen. Ein Aqara-Melder über
              Zigbee2MQTT erscheint hier von selbst, sobald er gekoppelt ist.
            </Text>
          ) : null}
          {melder.map((eintrag) => (
            <View key={eintrag.entity_id} style={[styles.melder, eintrag.alarm && styles.melderAlarm]}>
              <Ionicons
                name={eintrag.kind === 'camera' ? 'videocam-outline' : eintrag.alarm ? 'flame' : 'flame-outline'}
                size={22}
                color={eintrag.alarm ? colors.danger : eintrag.active ? colors.ink : colors.inkFaint}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={[styles.zeileTitel, !eintrag.active && { color: colors.inkFaint }]} numberOfLines={1}>
                  {eintrag.name}
                  {eintrag.room ? ` · ${eintrag.room}` : ''}
                </Text>
                <Text
                  style={[
                    styles.hint,
                    (eintrag.alarm || eintrag.low_battery || eintrag.test_overdue) && { color: eintrag.alarm ? colors.danger : colors.warn },
                  ]}
                >
                  {melderZeile(eintrag)}
                </Text>
              </View>
              <View style={styles.melderKnoepfe}>
                {eintrag.kind !== 'camera' ? (
                  <Pressable
                    onPress={() =>
                      handgriff(
                        `/api/brand/melder/${encodeURIComponent(eintrag.entity_id)}/getestet`,
                        `${eintrag.name} als geprüft vermerkt.`
                      )
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`${eintrag.name} als geprüft vermerken`}
                    style={({ pressed }) => [styles.kleinKnopf, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="checkmark-done-outline" size={icon.klein} color={colors.ink} />
                    <Text style={styles.kleinKnopfText}>Geprüft</Text>
                  </Pressable>
                ) : null}
                {darfEinrichten ? (
                  <Pressable
                    onPress={() =>
                      speichern({
                        disabled: eintrag.active
                          ? [...data.disabled, eintrag.entity_id]
                          : data.disabled.filter((id) => id !== eintrag.entity_id),
                      })
                    }
                    accessibilityRole="switch"
                    accessibilityState={{ checked: eintrag.active }}
                    accessibilityLabel={`${eintrag.name} ${eintrag.active ? 'abschalten' : 'einschalten'}`}
                    style={({ pressed }) => [styles.kleinKnopf, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons
                      name={eintrag.active ? 'power' : 'power-outline'}
                      size={icon.klein}
                      color={eintrag.active ? colors.on : colors.inkFaint}
                    />
                  </Pressable>
                ) : null}
              </View>
            </View>
          ))}
          <Text style={styles.hint}>
            «Geprüft» heisst: Prüftaste am Melder gedrückt, er hat gepiept. Der Hub
            erinnert alle {einstellungen.test_months || '–'} Monate daran – ein Melder
            mit leerer Batterie ist still, und das merkt man sonst erst beim Brand.
          </Text>
        </Klappe>
      </Card>

      {/* Was beim Auslösen geschieht - jeder Teil einzeln abschaltbar,
          weil im eigenen Haus der eine oder andere falsch wäre. */}
      <Card style={styles.card}>
        <Klappe label="Beim Auslösen" zuBeginnZu>
          {schalter('notify', 'Push an alle', 'Sofort, mit Bild der nächsten Kamera – auch nachts, auch stillgestellt.')}
          {schalter('lights_on', 'Alle Lichter an', 'Voll hell: Man soll den Weg nach draussen sehen.')}
          {schalter('covers_open', 'Storen hoch', 'Fluchtweg frei und Sicht für die Feuerwehr.')}
          {schalter('unlock_doors', 'Türen entriegeln', 'Aus, bis du es willst: Ein Fehlalarm ist häufiger als ein Brand, und ein entriegeltes Haus ist ein offenes.')}
          {schalter('buzz_others', 'Andere Melder mitheulen lassen', 'Aqara-Melder im ganzen Haus summen mit – wie eine vernetzte Anlage.')}
          {schalter(
            'announce',
            'Durchsage auf allen Boxen',
            data.speakers ? `Laut, mit Raum – auf ${data.speakers} Boxen.` : 'Keine Box angeschlossen – die Durchsage bliebe stumm.'
          )}
          {einstellungen.announce ? (
            <View style={styles.feld}>
              <Text style={styles.label}>Text der Durchsage</Text>
              <TextInput
                value={ansage ?? einstellungen.announce_text}
                onChangeText={setAnsage}
                editable={darfEinrichten}
                onBlur={() => {
                  if (ansage !== null && ansage.trim() && ansage.trim() !== einstellungen.announce_text) {
                    speichern({ settings: { ...einstellungen, announce_text: ansage.trim() } });
                  }
                  setAnsage(null);
                }}
                style={styles.eingabe}
                accessibilityLabel="Text der Durchsage"
              />
              <Text style={styles.hint}>{'{raum}'} wird zum Raum des Melders, {'{gerät}'} zu seinem Namen.</Text>
            </View>
          ) : null}
          <View style={styles.feld}>
            <Text style={styles.label}>Wiederholen, solange Rauch gemeldet wird</Text>
            <View style={styles.chipReihe}>
              {[0, 1, 3, 5, 10].map((minuten) => {
                const an = einstellungen.repeat_minutes === minuten;
                return (
                  <Pressable
                    key={minuten}
                    onPress={() => speichern({ settings: { ...einstellungen, repeat_minutes: minuten } })}
                    disabled={!darfEinrichten}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: an }}
                    style={[styles.chip, an && styles.chipAn]}
                  >
                    <Text style={[styles.chipText, an && { color: '#FFFFFF' }]}>
                      {minuten === 0 ? 'einmal' : `alle ${minuten} min`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
            <Text style={styles.hint}>Bis jemand quittiert – die erste Meldung kann in der Tasche verschwinden.</Text>
          </View>
          {schalter('notify_clear', 'Entwarnung melden', 'Eine Nachricht, sobald alle Melder wieder ruhig sind.')}
          <View style={styles.feld}>
            <Text style={styles.label}>An die Prüfung erinnern</Text>
            <View style={styles.chipReihe}>
              {[0, 3, 6, 12].map((monate) => {
                const an = einstellungen.test_months === monate;
                return (
                  <Pressable
                    key={monate}
                    onPress={() => speichern({ settings: { ...einstellungen, test_months: monate } })}
                    disabled={!darfEinrichten}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: an }}
                    style={[styles.chip, an && styles.chipAn]}
                  >
                    <Text style={[styles.chipText, an && { color: '#FFFFFF' }]}>
                      {monate === 0 ? 'nie' : `alle ${monate} Monate`}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </View>
          <Text style={styles.hint}>
            Mehr braucht es einen Ablauf: Auslöser «Brandmeldeanlage wird ausgelöst»
            oder der einzelne Melder – dort gehen Szenen, Kamera-Clips und
            Nachrichten an einzelne Personen.
          </Text>
        </Klappe>
      </Card>

      <Card style={styles.card}>
        <Klappe label="Verlauf" stand={data.history.length ? datumUhr(data.history[0].at * 1000) : 'leer'} zuBeginnZu>
          {data.history.length === 0 ? (
            <Text style={styles.hint}>Noch nichts – und das ist gut so.</Text>
          ) : (
            data.history.slice(0, 30).map((zeile, index) => (
              <View key={`${zeile.at}-${index}`} style={styles.verlaufZeile}>
                <Text style={styles.verlaufZeit}>{datumUhr(zeile.at * 1000)}</Text>
                <Text style={[styles.zeileTitel, zeile.kind === 'ausgeloest' && { color: colors.danger }]}>
                  {zeile.text}
                  {zeile.by ? ` · ${zeile.by}` : ''}
                </Text>
              </View>
            ))
          )}
        </Klappe>
      </Card>
    </ScrollView>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    liste: { gap: space.gap, paddingBottom: 40 },
    card: { minHeight: 0, gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    lage: { fontSize: 15, fontWeight: '700', marginTop: 2 },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    knopfReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    knopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
    },
    knopfStark: { backgroundColor: colors.danger },
    knopfText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    knopfStarkText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    zeile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    zeileTitel: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    melder: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 8,
      borderRadius: radius.control,
    },
    melderAlarm: { backgroundColor: 'rgba(229, 72, 77, 0.12)' },
    melderKnoepfe: { flexDirection: 'row', gap: 6 },
    kleinKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingVertical: 6,
      paddingHorizontal: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
    },
    kleinKnopfText: { color: colors.ink, fontSize: 12, fontWeight: '600' },
    feld: { gap: 6, paddingVertical: 4 },
    label: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    eingabe: {
      color: colors.ink,
      fontSize: 14,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
    },
    chipReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      paddingVertical: 6,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
    },
    chipAn: { backgroundColor: colors.accent },
    chipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    verlaufZeile: { flexDirection: 'row', gap: 10, paddingVertical: 4 },
    verlaufZeit: { color: colors.inkFaint, fontSize: 12, minWidth: 96, paddingTop: 2 },
  });
