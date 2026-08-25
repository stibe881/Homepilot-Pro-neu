import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { useOrtung } from '../hooks/useOrtung';
import { defaultHubUrl } from '../lib/origin';
import { PAUSEN, ortungsHinweis, pauseBis, pausiert } from '../lib/ortung';
import { zonenkennung } from '../lib/zonenkennung';
import { applySetup, QrScanner } from '../components/QrScanner';
import { Colors, radius, ThemeMode, type, useColors } from '../theme';

/** „Automatisch" schaltet ab 20 Uhr auf dunkel – die App wird abends im
    Bett geöffnet, nicht nur tagsüber. */
const MODES: { key: ThemeMode; label: string }[] = [
  { key: 'system', label: 'System' },
  { key: 'auto', label: 'Nach Sonnenstand' },
  { key: 'light', label: 'Hell' },
  { key: 'dark', label: 'Dunkel' },
  { key: 'pink', label: 'Neonpink' },
  { key: 'mitternacht', label: 'Mitternacht' },
  { key: 'sand', label: 'Sand' },
];

interface Props {
  initial: HubSettings | null;
  onSave: (settings: HubSettings) => void;
  onCancel?: () => void;
  /** Eingebettet in die Kachelfläche statt als ganzer Bildschirm. */
  embedded?: boolean;
  /** Angemeldeter Benutzer – zeigt Name und Rolle an. */
  user?: { name: string; role: string; shared?: boolean } | null;
  /** Wer die eigene Ortung sieht – für die Zeile im Profil (Punkt 197). */
  familie?: string[];
}

export function SettingsScreen({
  initial,
  onSave,
  onCancel,
  embedded,
  user,
  familie = [],
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  // Punkt 194/197: Die Ortung dieses Geräts – Gäste nie, und was läuft,
  // steht hier und lässt sich aussetzen.
  const ortung = useOrtung(
    { url: initial?.url ?? '', token: initial?.token ?? '' } as HubSettings,
    zonenkennung(user?.name),
    !!user && user.role !== 'gast'
  );
  const [url, setUrl] = useState(initial?.url ?? defaultHubUrl());
  const [token, setToken] = useState(initial?.token ?? '');
  const [name, setName] = useState(initial?.name ?? '');
  const [theme, setTheme] = useState<ThemeMode>(initial?.theme ?? 'system');
  const [panel, setPanel] = useState(!!initial?.panel);
  const [scanning, setScanning] = useState(false);
  // Zwei-Schritt-Rückfrage für «überall abmelden» – das wirft auch das
  // Gerät hinaus, auf dem man gerade tippt.
  const [logoutAll, setLogoutAll] = useState<'idle' | 'ask'>('idle');

  const form = (
    <Card style={styles.card}>
      <Text style={styles.title}>Hub verbinden</Text>
      {user ? (
        <>
          <Text style={styles.account}>
            Angemeldet als {user.name} · {user.role}
          </Text>
          {/* Am Wandtablet gibt es kein Abmelden. Wer es antippt, sperrt
              das ganze Haus aus sich selbst aus - die Anmeldedaten des
              Geräts hat niemand in der Tasche, und bis jemand mit einem
              Rechner kommt, geht im Flur gar nichts mehr. Die Sitzung
              läuft dort auch nicht ab (core/sessions.py). */}
          {user.shared ? (
            <Text style={styles.sharedNote}>
              Dieses Gerät gehört allen und bleibt angemeldet. Zum Abmelden
              die Kennzeichnung «Gemeinschaftsgerät» unter Benutzer
              aufheben.
            </Text>
          ) : (
          <View style={styles.logoutRow}>
            <Pressable
              onPress={async () => {
                // Abmelden beendet nur diese Sitzung; ein fest vergebenes
                // Token bliebe gültig – dann bleibt die App eben verbunden.
                await fetch(`${url.replace(/\/$/, '')}/api/auth/logout`, {
                  method: 'POST',
                  headers: { Authorization: `Bearer ${token}` },
                  // Best effort: Lokal wird die Sitzung gleich vergessen -
                  // erreicht der Abruf den Hub nicht, läuft sie dort ab.
                }).catch(() => {});
                onSave({ url, token: '', name, theme, panel });
              }}
              accessibilityRole="button"
              style={({ pressed }) => [styles.logout, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="log-out-outline" size={15} color={colors.ink} />
              <Text style={styles.logoutText}>Abmelden</Text>
            </Pressable>
            <Pressable
              onPress={async () => {
                if (logoutAll !== 'ask') {
                  setLogoutAll('ask');
                  setTimeout(() => setLogoutAll('idle'), 4000);
                  return;
                }
                setLogoutAll('idle');
                await fetch(`${url.replace(/\/$/, '')}/api/auth/sessions`, {
                  method: 'DELETE',
                  headers: { Authorization: `Bearer ${token}` },
                  // Best effort wie beim Abmelden: Was der Hub nicht
                  // erfährt, läuft dort von selbst ab.
                }).catch(() => {});
                onSave({ url, token: '', name, theme, panel });
              }}
              accessibilityRole="button"
              style={({ pressed }) => [
                styles.logout,
                logoutAll === 'ask' && { borderColor: colors.danger },
                pressed && { opacity: 0.7 },
              ]}
            >
              <Ionicons
                name="phone-portrait-outline"
                size={15}
                color={logoutAll === 'ask' ? colors.danger : colors.ink}
              />
              <Text
                style={[
                  styles.logoutText,
                  logoutAll === 'ask' && { color: colors.danger },
                ]}
              >
                {logoutAll === 'ask' ? 'Wirklich überall?' : 'Überall abmelden'}
              </Text>
            </Pressable>
          </View>
          )}
        </>
      ) : null}

      <Pressable
        onPress={() => setScanning(true)}
        accessibilityRole="button"
        style={({ pressed }) => [styles.scan, pressed && { opacity: 0.75 }]}
      >
        <Ionicons name="qr-code-outline" size={20} color={colors.ink} />
        <Text style={styles.scanText}>QR-Code vom Hub scannen</Text>
      </Pressable>
      <Text style={styles.scanHint}>oder von Hand eintragen</Text>

      <QrScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={(setup) => {
          // Direkt speichern: Wer scannt, will verbinden, nicht noch tippen.
          const next = applySetup(initial, setup);
          setUrl(next.url);
          setToken(next.token);
          if (next.name) setName(next.name);
          onSave({ ...next, theme, panel });
        }}
      />

      <Field
        label="Hub-URL"
        value={url}
        onChange={setUrl}
        placeholder="http://192.168.1.10:8123"
        keyboardType="url"
      />
      <Field
        label="Token"
        value={token}
        onChange={setToken}
        placeholder="Token aus config.yaml"
        secure
      />
      <View style={styles.field}>
        <Text style={styles.label}>Erscheinungsbild</Text>
        <View style={styles.modes}>
          {MODES.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => setTheme(option.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: theme === option.key }}
              style={({ pressed }) => [
                styles.mode,
                theme === option.key && styles.modeActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[
                  styles.modeText,
                  theme === option.key && styles.modeTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.modeHint}>
          «Nach Sonnenstand» wird bei Sonnenuntergang dunkel und bei
          Sonnenaufgang wieder hell, «System» folgt der Geräteeinstellung.
        </Text>
      </View>

      <Pressable
        onPress={() => setPanel((value) => !value)}
        accessibilityRole="switch"
        accessibilityState={{ checked: panel }}
        style={({ pressed }) => [styles.panelRow, pressed && { opacity: 0.7 }]}
      >
        <View style={{ flex: 1 }}>
          <Text style={styles.label}>Wandpanel-Modus</Text>
          <Text style={styles.panelHint}>
            Bildschirm bleibt an, Ansicht kehrt nach drei Minuten zur Startseite
            zurück, und nach Sonnenuntergang wird es dunkler – für ein fest
            montiertes iPad. Eine Berührung macht es sofort wieder hell.
          </Text>
        </View>
        <View style={[styles.switch, panel && styles.switchOn]}>
          <View style={[styles.knob, panel && styles.knobOn]} />
        </View>
      </Pressable>

      {/* Die Anrede gehört hierher und nicht zu den Zugangsdaten: Am
          Wandpanel ist sie die Antwort auf eine Frage, die der Schalter
          darüber gerade aufwirft. Vor dem iPad im Flur steht mal die
          eine, mal der andere – «Hallo Stefan» begrüsst dort den
          Falschen, auch wenn Stefans Zugang im Gerät steckt. Ohne Angabe
          steht deshalb «Willkommen zuhause». */}
      <Field
        label={panel ? 'Anrede auf diesem Panel' : 'Dein Name (für die Begrüssung)'}
        value={name}
        onChange={setName}
        placeholder={panel ? 'z.B. Küche – ohne Angabe: «Willkommen zuhause»' : 'optional'}
      />

      {/* Punkt 197: Sobald die App selbst ortet, ändert sich die Frage –
          nicht «geht das technisch», sondern «weiss jeder, dass es
          läuft». Ein Familiensystem, dem man beim Orten nicht zusehen
          kann, wird abgeschaltet, zu Recht. */}
      {ortung.moeglich ? (
        <View style={styles.panelRow}>
          <View style={{ flex: 1, gap: 6 }}>
            <Pressable
              onPress={() => ortung.schalten(!ortung.stand.aktiv)}
              accessibilityRole="switch"
              accessibilityState={{ checked: ortung.stand.aktiv }}
              style={({ pressed }) => [
                { flexDirection: 'row', alignItems: 'center', gap: 12 },
                pressed && { opacity: 0.7 },
              ]}
            >
              <View style={{ flex: 1 }}>
                <Text style={styles.label}>Ortung</Text>
                <Text style={styles.panelHint}>
                  {ortungsHinweis(
                    ortung.stand.aktiv,
                    ortung.stand.pausiertBis,
                    new Date(),
                    familie
                  )}
                </Text>
              </View>
              <View style={[styles.switch, ortung.stand.aktiv && styles.switchOn]}>
                <View style={[styles.knob, ortung.stand.aktiv && styles.knobOn]} />
              </View>
            </Pressable>
            <Text style={styles.panelHint}>
              Überwacht wird nur die Grenze der Orte, die im Hub stehen –
              kein laufender Standort, sonst wäre der Akku am Nachmittag
              leer.
            </Text>
            {ortung.stand.hinweis ? (
              <Text style={[styles.panelHint, { color: colors.warn }]}>
                {ortung.stand.hinweis}
              </Text>
            ) : null}
            {/* «Stefan · unterwegs», während Stefan in der Küche steht:
                Die Zonenüberwachung meldet nur Übertritte, und wer die
                Ortung zuhause einschaltet, kreuzt keine Grenze. Beim
                Einschalten meldet die App darum von selbst - und hier
                steht der Knopf für alle Fälle, in denen eine Meldung
                unterwegs verloren ging. */}
            {ortung.stand.gemeldet ? (
              <Text style={styles.panelHint}>{ortung.stand.gemeldet}</Text>
            ) : null}
            {ortung.stand.aktiv ? (
              <View style={{ flexDirection: 'row', gap: 8, flexWrap: 'wrap' }}>
                <Pressable
                  onPress={() => ortung.jetztMelden()}
                  accessibilityRole="button"
                  style={styles.mode}
                >
                  <Text style={styles.modeText}>Jetzt melden</Text>
                </Pressable>
                {/* Der stille Einrichtungsfehler: Steht der Hauskreis
                    auf einer Vorgabe oder einem vertippten Wert, ist man
                    dauerhaft «unterwegs», während man in der Stube
                    sitzt - und nichts sieht kaputt aus. Ein Knopf ist
                    hier die einzige Eingabe, bei der sich niemand
                    vertippen kann. */}
                <Pressable
                  onPress={() => ortung.zuhauseSetzen()}
                  accessibilityRole="button"
                  accessibilityLabel="Diesen Standort als Zuhause übernehmen"
                  style={styles.mode}
                >
                  <Text style={styles.modeText}>Hier ist zuhause</Text>
                </Pressable>
                {pausiert(ortung.stand.pausiertBis, new Date()) ? (
                  <Pressable
                    onPress={() => ortung.weiter()}
                    accessibilityRole="button"
                    style={styles.mode}
                  >
                    <Text style={styles.modeText}>Weiterlaufen lassen</Text>
                  </Pressable>
                ) : (
                  PAUSEN.map((pause) => (
                    <Pressable
                      key={pause.key}
                      onPress={() => ortung.pausieren(pauseBis(pause.key, new Date()))}
                      accessibilityRole="button"
                      style={styles.mode}
                    >
                      <Text style={styles.modeText}>Pause: {pause.label}</Text>
                    </Pressable>
                  ))
                )}
              </View>
            ) : null}
          </View>
        </View>
      ) : null}

      <Pressable
        style={({ pressed }) => [styles.save, pressed && { opacity: 0.8 }]}
        onPress={() =>
          onSave({
            url: url.trim().replace(/\/+$/, ''),
            token: token.trim(),
            name: name.trim(),
            theme,
            panel,
            // Was sonst noch im Gerät steht, bleibt erhalten: Wer die
            // Adresse ändert, will nicht seine ausgeblendeten Geräte
            // verlieren - und schon gar nicht die Sperren, die bisher
            // hier fehlten und bei jedem Speichern still verschwanden.
            hidden: initial?.hidden,
            locked: initial?.locked,
            order: initial?.order,
            favorites: initial?.favorites,
          })
        }
      >
        <Text style={styles.saveText}>Speichern & verbinden</Text>
      </Pressable>

      {onCancel ? (
        <Pressable style={styles.cancel} onPress={onCancel}>
          <Text style={styles.cancelText}>Abbrechen</Text>
        </Pressable>
      ) : null}
    </Card>
  );

  if (embedded) {
    return <View style={styles.embedded}>{form}</View>;
  }
  return <View style={styles.screen}>{form}</View>;
}

function Field({
  label,
  value,
  onChange,
  placeholder,
  secure,
  keyboardType,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  secure?: boolean;
  keyboardType?: 'url';
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.field}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        style={styles.input}
        value={value}
        onChangeText={onChange}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry={secure}
        keyboardType={keyboardType}
        placeholder={placeholder}
        placeholderTextColor={colors.inkFaint}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  screen: {
    flex: 1,
    justifyContent: 'center',
    padding: 22,
  },
  embedded: { marginTop: 4 },
  card: {
    width: '100%',
    maxWidth: 460,
    alignSelf: 'center',
    minHeight: 0,
    gap: 14,
    padding: 22,
  },
  title: {
    color: colors.ink,
    fontSize: 22,
    fontWeight: '700',
  },
  field: { gap: 6 },
  label: {
    color: colors.inkSoft,
    fontSize: type.cardSub,
    fontWeight: '600',
  },
  input: {
    backgroundColor: colors.surfaceStrong,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    color: colors.ink,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
  },
  save: {
    backgroundColor: colors.ink,
    borderRadius: radius.control,
    paddingVertical: 15,
    alignItems: 'center',
    marginTop: 4,
  },
  saveText: {
  // Weiss auf «ink» ist in jedem dunklen Erscheinungsbild weiss auf
  // Weiss: Dort ist ink die Schriftfarbe, also fast weiss, und als
  // Knopffüllung braucht sie eine dunkle Beschriftung. `panel` ist in
  // jeder Palette die deckende Gegenfarbe zu ink – hell im hellen
  // Erscheinungsbild, dunkel in den dunklen.
    color: colors.panel,
    fontWeight: '700',
    fontSize: 16,
  },
  account: { color: colors.inkSoft, fontSize: 13, marginTop: -8 },
  logoutRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  sharedNote: { color: colors.inkSoft, fontSize: 12, lineHeight: 17, marginTop: 4 },
  logout: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  logoutText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  scan: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
    paddingVertical: 14,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  scanText: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  scanHint: {
    color: colors.inkFaint,
    fontSize: 12,
    textAlign: 'center',
    marginTop: -8,
  },
  panelRow: { flexDirection: 'row', alignItems: 'center', gap: 14, marginTop: 4 },
  panelHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17, marginTop: 2 },
  switch: {
    width: 48,
    height: 28,
    borderRadius: radius.pill,
    backgroundColor: colors.off,
    padding: 3,
    justifyContent: 'center',
  },
  switchOn: { backgroundColor: colors.on },
  knob: {
    width: 22,
    height: 22,
    borderRadius: 11,
    backgroundColor: colors.surfaceStrong,
  },
  knobOn: { alignSelf: 'flex-end' },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  mode: {
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  modeActive: { backgroundColor: colors.ink, borderColor: colors.ink },
  modeText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
  // Der Grund des gewählten Knopfs ist `ink` – in hellem Erscheinungsbild
  // dunkel, in dunklem hell. Die Schrift muss also mitwandern: `panel`
  // ist genau die Gegenrichtung. Vorher stand hier `surfaceStrong`, ein
  // durchscheinendes Weiss – auf dunklem Grund war die Beschriftung des
  // gewählten Knopfs damit praktisch unsichtbar.
  modeTextActive: { color: colors.panel },
  modeHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17, marginTop: 6 },
  cancel: { alignItems: 'center', paddingVertical: 6 },
  cancelText: { color: colors.inkSoft, fontSize: 15 },
});
