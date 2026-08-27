import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { useOrtung } from '../hooks/useOrtung';
import { defaultHubUrl } from '../lib/origin';
import { PAUSEN, ortungsHinweis, pauseBis, pausiert } from '../lib/ortung';
import { zonenkennung } from '../lib/zonenkennung';
import { SYMBOLE, Symbolwahl, gueltig } from '../lib/appsymbol';
import { kannWechseln, symbolWechseln } from '../lib/symbolwechsel';
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
  /** Welche Hälfte gezeigt wird. Ohne Angabe: alles (Einrichtung). */
  nur?: 'konto' | 'verbindung';
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
  nur,
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
  const [appSymbol, setAppSymbol] = useState<Symbolwahl>(gueltig(initial?.appSymbol));
  // Kann dieses Gerät das Symbol jetzt schon wechseln? `null` heisst:
  // noch nicht gefragt. Das entscheidet nicht, ob die Wahl dasteht -
  // sie stand vorher nur dann da, wenn es ging, und war damit genau in
  // dem Fall unsichtbar, in dem eine Erklärung nötig gewesen wäre.
  const [symbolGeht, setSymbolGeht] = useState<boolean | null>(null);
  useEffect(() => {
    let weg = false;
    kannWechseln().then((ja) => {
      if (!weg) setSymbolGeht(ja);
    });
    return () => {
      weg = true;
    };
  }, []);

  /**
   * Das App-Symbol wechseln – sofort und für sich.
   *
   * Es hing vorher am Knopf «Speichern & verbinden», und der steht eine
   * Karte weiter unten und heisst nach Hub-Adresse. Wer ein Symbol
   * wählte und die Seite verliess, hatte nichts gewählt.
   *
   * Gespeichert wird auf dem Stand, der im Gerät steht, und nicht auf
   * dem des Formulars: Wer gerade an der Hub-Adresse tippt, soll sie
   * nicht durch ein Antippen des Symbols halbfertig festschreiben.
   */
  /**
   * Das Erscheinungsbild wechseln – sofort und für sich.
   *
   * Es hing am Knopf «Speichern & verbinden», und der zog mit der
   * Verbindung auf eine eigene Seite. Ein Schalter, dessen Knopf
   * woanders steht, ist kein Schalter. Also dasselbe wie beim
   * App-Symbol: Antippen ist Speichern, mit den *abgelegten*
   * Einstellungen statt mit dem womöglich halb ausgefüllten Formular
   * daneben.
   */
  const themaWaehlen = (wahl: ThemeMode) => {
    setTheme(wahl);
    if (initial) onSave({ ...initial, theme: wahl });
  };

  const symbolWaehlen = (wahl: Symbolwahl) => {
    setAppSymbol(wahl);
    if (initial) onSave({ ...initial, appSymbol: wahl });
    symbolWechseln(wahl).then((ging) => setSymbolGeht(ging));
  };
  const [panel, setPanel] = useState(!!initial?.panel);
  const [scanning, setScanning] = useState(false);
  // Zwei-Schritt-Rückfrage für «überall abmelden» – das wirft auch das
  // Gerät hinaus, auf dem man gerade tippt.
  const [logoutAll, setLogoutAll] = useState<'idle' | 'ask'>('idle');

  // Vier Karten statt einer: Was zusammengehört, steht beieinander.
  // Die Reihenfolge folgt dem Gebrauch - wer verbunden ist, kommt wegen
  // Profil, Erscheinungsbild oder Ortung hierher; die Zugangsdaten
  // braucht er nur beim Einrichten. Also stehen sie dann zuoberst und
  // sonst zuunterst.
  // Die Anrede steht beim Wandpanel-Schalter und nicht im Profil: Dort
  // ist sie die Antwort auf eine Frage, die der Schalter gerade
  // aufwirft. Vor dem iPad im Flur steht mal die eine, mal der andere –
  // «Hallo Stefan» begrüsst dort den Falschen, auch wenn Stefans Zugang
  // im Gerät steckt. Ohne Angabe steht deshalb «Willkommen zuhause».
  const nameFeld = (
    <Field
      label={panel ? 'Anrede auf diesem Panel' : 'Dein Name'}
      value={name}
      onChange={setName}
      placeholder={
        panel ? 'z.B. Küche – ohne Angabe: «Willkommen zuhause»' : user?.name ?? 'optional'
      }
    />
  );

  // Der Name im Profil IST der Benutzername. Vorher hiess das Feld
  // «für die Begrüssung» und lebte nur im Gerät - die Benutzerverwaltung
  // zeigte weiter den alten Namen, und niemand wusste, welcher gilt.
  // Ob umbenannt werden muss, entscheidet das Speichern; hier steht,
  // was dabei schiefging (Name vergeben, Benutzer aus der config.yaml).
  const [nameFehler, setNameFehler] = useState<string | null>(null);
  const darfUmbenennen = !!user && !panel && !user.shared && user.role !== 'gast';

  /** Speichern - und wenn der Name neu ist, zuerst den Hub-Benutzer
   *  umbenennen. Erst wenn das gelungen ist, wird lokal gespeichert:
   *  Ein Gerät, das «Stefano» grüsst, während der Hub «Stefan» führt,
   *  wäre genau die Verwirrung, die dieses Feld beseitigen soll. */
  const speichern = async () => {
    const gewuenscht = name.trim();
    if (darfUmbenennen && gewuenscht && user && gewuenscht !== user.name) {
      try {
        const antwort = await fetch(`${url.trim().replace(/\/+$/, '')}/api/users/self`, {
          method: 'PUT',
          headers: {
            Authorization: `Bearer ${token.trim()}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ name: gewuenscht }),
        });
        if (!antwort.ok) {
          const detail = await antwort
            .json()
            .then((d) => String(d?.detail ?? ''))
            .catch(() => '');
          setNameFehler(detail || `Umbenennen fehlgeschlagen (${antwort.status})`);
          return;
        }
      } catch {
        setNameFehler('Der Hub ist gerade nicht erreichbar - Name unverändert.');
        return;
      }
    }
    setNameFehler(null);
    onSave({
      url: url.trim().replace(/\/+$/, ''),
      token: token.trim(),
      name: gewuenscht,
      theme,
      panel,
      appSymbol,
      // Was sonst noch im Gerät steht, bleibt erhalten: Wer die
      // Adresse ändert, will nicht seine ausgeblendeten Geräte
      // verlieren - und schon gar nicht die Sperren, die bisher
      // hier fehlten und bei jedem Speichern still verschwanden.
      hidden: initial?.hidden,
      locked: initial?.locked,
      order: initial?.order,
      favorites: initial?.favorites,
    });
  };

  const profil = user ? (
    <Card style={styles.card}>
      <Text style={styles.title}>Profil</Text>
      <Text style={styles.account}>
        Angemeldet als {user.name} · {user.role}
      </Text>
      {darfUmbenennen ? (
        <>
          {nameFeld}
          {/* Ein eigener Knopf, seit die Verbindung eine eigene Seite hat:
              «Speichern & verbinden» stand vorher darunter und hat den
              Namen mitgenommen. Jetzt steht er woanders - ein Feld ohne
              Knopf wäre ein Feld, das nichts tut. */}
          <Pressable
            onPress={speichern}
            accessibilityRole="button"
            style={({ pressed }) => [styles.nameButton, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.nameButtonText}>Namen speichern</Text>
          </Pressable>
          <Text style={styles.sharedNote}>
            Das ist dein Benutzername - er gilt überall: in der
            Benutzerverwaltung, in der Anwesenheit und als Push-Empfänger.
          </Text>
        </>
      ) : null}
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
              onSave({ url, token: '', name, theme, panel, appSymbol });
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
              onSave({ url, token: '', name, theme, panel, appSymbol });
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
    </Card>
  ) : null;

  const aussehen = (
    <Card style={styles.card}>
      <Text style={styles.title}>Erscheinungsbild</Text>
      <View style={styles.field}>
        <View style={styles.modes}>
          {MODES.map((option) => (
            <Pressable
              key={option.key}
              onPress={() => themaWaehlen(option.key)}
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
          Wirkt sofort.
        </Text>
      </View>

      {/* Das App-Symbol. Es gehört hierher und nicht zur Verbindung:
          Es ist dasselbe wie die Farbwahl darüber, nur ausserhalb der
          App. Am Gerät gespeichert und nicht an der Person - wer sich am
          Wandpanel anmeldet, färbt damit nicht das Telefon um. */}
      {/* Immer sichtbar, auch wo es (noch) nicht geht: Der Hinweis
          darunter sagt dann, warum - versteckt wäre es genau dort
          unauffindbar, wo jemand danach sucht. */}
      <View style={styles.field}>
        <Text style={styles.label}>App-Symbol</Text>
        <View style={styles.symbole}>
          {SYMBOLE.map((option) => {
            const an = option.wahl === appSymbol;
            return (
              <Pressable
                key={option.label}
                onPress={() => symbolWaehlen(option.wahl)}
                accessibilityRole="radio"
                accessibilityState={{ selected: an }}
                accessibilityLabel={`App-Symbol ${option.label}`}
                style={({ pressed }) => [
                  styles.symbolWahl,
                  an && styles.symbolWahlAktiv,
                  pressed && { opacity: 0.7 },
                ]}
              >
                {/* Eine Vorschau, keine Bilddatei: Das Symbol liegt in
                    sechs Grössen als PNG vor, und eines davon hier
                    einzubinden hiesse, es beim nächsten Umfärben an
                    zwei Stellen zu ändern. */}
                <View style={[styles.symbolBild, { backgroundColor: option.unten }]}>
                  <View style={[styles.symbolOben, { backgroundColor: option.oben }]} />
                  <Ionicons name="home" size={22} color="#FFFFFF" />
                </View>
                <Text style={[styles.modeText, an && styles.modeTextActive]}>
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
        </View>
        <Text style={styles.modeHint}>
          {symbolGeht === false
            ? // Der Fall, den man erklären muss: Ein App-Symbol steckt
              // im Programmpaket und lässt sich nicht nachladen. Über
              // eine OTA-Fassung kommt es also nicht mit. Die Wahl ist
              // trotzdem gespeichert und greift, sobald ein frischer
              // Build da ist.
              'Gespeichert. Auf diesem Gerät wechselt das Symbol aber erst mit einem neu gebauten App-Paket – ein Symbol steckt im Paket und lässt sich nicht nachladen. Im Browser wirkt es sofort.'
            : Platform.OS === 'web'
              ? 'Wirkt sofort: Färbt das Bild im Browser-Tab. Auf dem Telefon färbt es das Symbol auf dem Startbildschirm.'
              : 'Wirkt sofort. Das Wechseln übernimmt iOS – es meldet es einmal kurz. Gespeichert ist es schon.'}
        </Text>
      </View>

      {/* Beim Erscheinungsbild und nicht bei der Verbindung: Der Modus
          ändert, wie die App aussieht und sich verhält - nicht, womit
          sie spricht. */}
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

      {/* Nicht doppelt: Für Personen steht das Feld im Profil - hier
          bleibt es fürs Panel (Anrede) und für die Ersteinrichtung. */}
      {darfUmbenennen ? null : nameFeld}
    </Card>
  );

  // Punkt 197: Sobald die App selbst ortet, ändert sich die Frage –
  // nicht «geht das technisch», sondern «weiss jeder, dass es läuft».
  // Ein Familiensystem, dem man beim Orten nicht zusehen kann, wird
  // abgeschaltet, zu Recht.
  const ortungKarte = ortung.moeglich ? (
    <Card style={styles.card}>
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
              <Text style={styles.title}>Ortung</Text>
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
            leer. Wirkt sofort, ohne Speichern.
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
    </Card>
  ) : null;

  const verbindung = (
    <Card style={styles.card}>
      <Text style={styles.title}>{user ? 'Hub-Verbindung' : 'Hub verbinden'}</Text>

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
          onSave({ ...next, theme, panel, appSymbol });
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

      {nameFehler ? (
        <Text style={{ color: colors.danger, fontSize: 13 }}>{nameFehler}</Text>
      ) : null}
      <Pressable
        style={({ pressed }) => [styles.save, pressed && { opacity: 0.8 }]}
        onPress={speichern}
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

  // Die Seite hiess «Konto & Verbindung» und war beides zugleich: Wer
  // sein Erscheinungsbild ändern wollte, scrollte an Adresse und Token
  // vorbei; wer die Adresse ändern wollte, an Profil und Ortung. Zwei
  // Fragen, zwei Menüpunkte - `nur` sagt, welche gerade dran ist.
  //
  // Beim Einrichten gibt es die Trennung nicht: Da ist die Verbindung
  // das Einzige, was zählt, und das Aussehen darf gleich mit.
  const karten = !user ? (
    <>
      {verbindung}
      {aussehen}
    </>
  ) : nur === 'verbindung' ? (
    verbindung
  ) : nur === 'konto' ? (
    <>
      {profil}
      {aussehen}
      {ortungKarte}
    </>
  ) : (
    <>
      {profil}
      {aussehen}
      {ortungKarte}
      {verbindung}
    </>
  );

  if (embedded) {
    return <View style={[styles.embedded, styles.stack]}>{karten}</View>;
  }
  return <View style={[styles.screen, styles.stack]}>{karten}</View>;
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
  /** Der Knopf unter dem Namensfeld – zurückhaltend, weil er nur eine
   *  Zeile speichert und nicht die Verbindung. */
  nameButton: {
    alignSelf: 'flex-start',
    paddingHorizontal: 14,
    paddingVertical: 9,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surfaceSoft,
  },
  nameButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  // Der Abstand zwischen den Karten - gleich dem Innenabstand einer
  // Karte, damit die Seite als eine Spalte liest.
  stack: { gap: 14 },
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
  // Die Wahl des App-Symbols: eine Vorschau je Farbweg, gross genug,
  // dass man das Haus darin erkennt.
  symbole: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  symbolWahl: {
    alignItems: 'center',
    gap: 6,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surfaceSoft,
  },
  symbolWahlAktiv: { borderColor: colors.accent, borderWidth: 2 },
  symbolBild: {
    width: 46,
    height: 46,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
    overflow: 'hidden',
  },
  // Der hellere Verlauf oben – dieselbe Richtung wie im echten Symbol.
  symbolOben: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    height: '55%',
    opacity: 0.85,
  },
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
