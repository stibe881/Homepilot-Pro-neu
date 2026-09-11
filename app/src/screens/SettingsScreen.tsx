import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Platform, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubSettings } from '../api/types';
import { Abschnitt } from '../components/Abschnitt';
import { Card } from '../components/Card';
import { Schalterzeile } from '../components/Schalterzeile';
import { useOrtung } from '../hooks/useOrtung';
import { ConnectionStatus } from '../hooks/useHub';
import { DICHTEN, type Dichte, lesen as dichteLesen } from '../lib/dichte';
import { defaultHubUrl } from '../lib/origin';
import { VERBINDUNGSWORT, verbindungsFarbe } from '../lib/verbindungsstand';
import { PAUSEN, ortungsHinweis, pauseBis, pausiert } from '../lib/ortung';
import { ROLE_LABELS } from '../lib/rollen';
import { zonenkennung } from '../lib/zonenkennung';
import { SYMBOLE, Symbolwahl, gueltig } from '../lib/appsymbol';
import { kannWechseln, symbolWechseln } from '../lib/symbolwechsel';
import { applySetup, QrScanner } from '../components/QrScanner';
import { Colors, radius, ThemeMode, type, useColors } from '../theme';
import { themenprobe } from '../lib/themenprobe';

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
  /** Nach einer gelungenen Umbenennung: den Benutzer neu holen.
   *
   *  Der Hub schickt ihn nur mit dem ersten Schnappschuss. Ohne das
   *  stand im Profil weiter der alte Name - direkt über dem Feld, in
   *  das man gerade den neuen getippt hatte. */
  onRenamed?: () => void;
  /** Angemeldeter Benutzer – zeigt Name und Rolle an. */
  user?: { name: string; role: string; shared?: boolean } | null;
  /**
   * Karten, die zur Konto-Seite gehören, aber anderswo wohnen.
   *
   * Passwort, «Meine Geräte», Face ID, Push - sie hängen an Bausteinen
   * ausserhalb dieses Bildschirms, gehören auf der Seite aber zwischen
   * das Profil und das Erscheinungsbild. Ein zweiter SettingsScreen
   * dafür hiesse zwei Fassungen desselben Zustands nebeneinander, und
   * die schreiben sich gegenseitig zu.
   */
  sicherheit?: React.ReactNode;
  /** Was sonst noch zu diesem Gerät gehört (die Türkarte). */
  geraet?: React.ReactNode;
  /** Was ganz unten steht, vor dem Abmelden (Benachrichtigungen). */
  weiteres?: React.ReactNode;
  /** Wer die eigene Ortung sieht – für die Zeile im Profil (Punkt 197). */
  familie?: string[];
  /**
   * Die beiden Reihenfolge-Schalter der Kachel-Karte.
   *
   * Sie standen auf der Räume-Seite selbst, als zwei breite Zeilen
   * über den Raumkacheln - dort, wo man ein Zimmer sucht und nichts
   * einstellt. Werte und Rückrufe kommen von aussen, weil sie im
   * Gerätespeicher der Person liegen (hooks/usePrefs.ts) und nicht in
   * den Hub-Einstellungen, die dieser Bildschirm hält. Ohne Rückruf
   * (Ersteinrichtung, Anmeldebildschirm) bleiben die Zeilen weg. */
  tageszeit?: boolean;
  onTageszeit?: (an: boolean) => void;
  raumNutzung?: boolean;
  onRaumNutzung?: (an: boolean) => void;
  /** Woran die App gerade ist – für die Ampel in der Hub-Karte. Ohne
   *  Angabe «verbunden»: Wer diese Seite sieht, hat den Hub erreicht. */
  stand?: ConnectionStatus;
}

export function SettingsScreen({
  initial,
  onSave,
  onCancel,
  embedded,
  nur,
  onRenamed,
  user,
  familie = [],
  tageszeit,
  onTageszeit,
  raumNutzung,
  onRaumNutzung,
  stand = 'connected',
  sicherheit,
  geraet,
  weiteres,
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
  // Die Grundriss-Ansicht: wie das App-Symbol eine Eigenschaft dieses
  // Geräts, nicht der Person - und wie das Erscheinungsbild sofort
  // gespeichert, nicht erst mit «Speichern & verbinden».
  // Wie das Erscheinungsbild: Antippen ist Speichern, mit den abgelegten
  // Einstellungen statt mit dem halb ausgefüllten Formular daneben.
  const [dichte, setDichte] = useState<Dichte>(dichteLesen(initial?.dichte));
  const dichteWaehlen = (wahl: Dichte) => {
    setDichte(wahl);
    if (initial) onSave({ ...initial, dichte: wahl });
  };
  const [grundriss, setGrundriss] = useState(!!initial?.grundriss);
  const grundrissWaehlen = (an: boolean) => {
    setGrundriss(an);
    if (initial) onSave({ ...initial, grundriss: an });
  };
  const [panel, setPanel] = useState(!!initial?.panel);
  // Kindermodus: Das Panel im Kinderzimmer zeigt nur die Kinderseite
  // dieses einen Kindes. Die Namen kommen aus den Familienmitgliedern -
  // geholt erst, wenn der Wandpanel-Schalter an ist: Auf jedem Telefon
  // wäre der Abruf für eine unsichtbare Auswahl verschwendet.
  const [kindPanel, setKindPanel] = useState(initial?.kindPanel ?? '');
  const [kinderNamen, setKinderNamen] = useState<string[]>([]);
  useEffect(() => {
    if (!panel || !initial?.url || !initial?.token) return;
    let weg = false;
    fetch(`${initial.url.replace(/\/+$/, '')}/api/family/members`, {
      headers: { Authorization: `Bearer ${initial.token}` },
    })
      .then((antwort) => (antwort.ok ? antwort.json() : []))
      .then((rows) => {
        if (weg) return;
        const namen = (Array.isArray(rows) ? rows : [])
          .filter((row) => String(row?.role || 'kind') !== 'erwachsen')
          .map((row) => String(row?.text ?? '').trim())
          .filter(Boolean);
        setKinderNamen(namen);
      })
      .catch(() => {});
    return () => {
      weg = true;
    };
  }, [panel, initial?.url, initial?.token]);
  // Antippen ist Speichern, wie beim Erscheinungsbild - und die Wahl
  // eines Kindes schreibt den Panel-Modus gleich mit fest: Ein
  // Kinderzimmer-Tablet ohne Wandpanel-Verhalten ergäbe keinen Sinn.
  const kindPanelWaehlen = (name: string) => {
    setKindPanel(name);
    if (initial) onSave({ ...initial, panel: true, kindPanel: name || null });
  };
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
  // Und was gelang. Ohne das passierte beim Speichern sichtbar nichts:
  // Der Hub war umbenannt, die Zeile darüber sagte den alten Namen, und
  // aus beidem zusammen las man «hat nicht funktioniert».
  const [nameNote, setNameNote] = useState<string | null>(null);
  const darfUmbenennen = !!user && !panel && !user.shared && user.role !== 'gast';
  // Zu, bis jemand den Stift antippt.
  const [umbenennen, setUmbenennen] = useState(false);
  // Dasselbe für Adresse und Token auf der Verbindungen-Seite.
  const [zugangOffen, setZugangOffen] = useState(false);

  /** Speichern - und wenn der Name neu ist, zuerst den Hub-Benutzer
   *  umbenennen. Erst wenn das gelungen ist, wird lokal gespeichert:
   *  Ein Gerät, das «Stefano» grüsst, während der Hub «Stefan» führt,
   *  wäre genau die Verwirrung, die dieses Feld beseitigen soll. */
  const speichern = async () => {
    const gewuenscht = name.trim();
    setNameNote(null);
    const umbenannt = !!(darfUmbenennen && gewuenscht && user && gewuenscht !== user.name);
    if (umbenannt) {
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
      // Der Hub führt jetzt den neuen Namen. Die App weiss das erst,
      // wenn sie ihn neu holt - der Hub schickt ihn nur einmal.
      onRenamed?.();
      setNameNote(`Heisst jetzt ${gewuenscht}.`);
      // Das Feld hat seine Arbeit getan - offen stehen bleiben hiesse,
      // die Seite wieder in ein Formular zu verwandeln. Die Bestätigung
      // darunter bleibt stehen.
      setUmbenennen(false);
    }
    setNameFehler(null);
    onSave({
      url: url.trim().replace(/\/+$/, ''),
      token: token.trim(),
      name: gewuenscht,
      theme,
      panel,
      appSymbol,
      grundriss,
      kindPanel: (kindPanel ?? '').trim() || null,
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

  // Der Kopf der Seite: wer bin ich, was darf ich, auf wie vielen
  // Geräten. Vorher stand dort «Profil» als Überschrift und darunter
  // «Angemeldet als Stefan · besitzer» - die Kleinschreibung aus der
  // config.yaml inbegriffen. Das Namensfeld stand immer offen, obwohl
  // man seinen Namen einmal im Leben ändert; das eigentliche Formular
  // der Seite (Passwort) begann darum erst weit unten.
  const profil = user ? (
    <Card style={styles.card}>
      <View style={styles.profilKopf}>
        <View style={styles.avatar}>
          <Text style={styles.avatarText}>
            {(user.name || '?').trim().charAt(0).toUpperCase()}
          </Text>
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={styles.profilName} numberOfLines={1}>
            {user.name}
          </Text>
          <View style={styles.rollenReihe}>
            <Text style={styles.rolle}>{ROLE_LABELS[user.role] ?? user.role}</Text>
            {user.shared ? (
              <Text style={styles.rolle}>Gemeinschaftsgerät</Text>
            ) : null}
          </View>
        </View>
        {/* Umbenennen hinter dem Stift: Das Feld stand vorher immer
            offen und machte aus dem Kopf der Seite ein Formular. */}
        {darfUmbenennen ? (
          <Pressable
            onPress={() => setUmbenennen((auf) => !auf)}
            accessibilityRole="button"
            accessibilityLabel={umbenennen ? 'Umbenennen abbrechen' : 'Namen ändern'}
            accessibilityState={{ expanded: umbenennen }}
            hitSlop={8}
            style={({ pressed }) => [styles.stift, pressed && { opacity: 0.6 }]}
          >
            <Ionicons
              name={umbenennen ? 'close' : 'pencil'}
              size={16}
              color={colors.inkSoft}
            />
          </Pressable>
        ) : null}
      </View>

      {darfUmbenennen && umbenennen ? (
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
      {nameNote ? <Text style={styles.nameNote}>{nameNote}</Text> : null}
      {nameFehler && nur === 'konto' ? (
        <Text style={{ color: colors.danger, fontSize: 13 }}>{nameFehler}</Text>
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
      ) : null}
    </Card>
  ) : null;

  // Abmelden ans Ende der Seite, nicht in den Kopf: Es ist die Tat mit
  // dem grössten Schaden und dem seltensten Anlass. Zuoberst stand sie
  // zwei Fingerbreit unter dem eigenen Namen - und «Überall abmelden»
  // wirft auch die anderen im Haus hinaus.
  const abmelden =
    user && !user.shared ? (
      <Card style={styles.card}>
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
              onSave({ url, token: '', name, theme, panel, appSymbol, grundriss });
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
              onSave({ url, token: '', name, theme, panel, appSymbol, grundriss });
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
        <Text style={styles.sharedNote}>
          «Abmelden» betrifft nur dieses Gerät. «Überall abmelden» wirft
          auch die anderen Geräte deines Kontos hinaus - einzelne beenden
          geht oben unter «Meine Geräte».
        </Text>
      </Card>
    ) : null;

  // Aus einer Karte wurden drei. Vorher stand hier alles untereinander
  // in einem Block «Erscheinungsbild»: Farbe, Kachelgrösse, App-Symbol,
  // Grundriss, Wandpanel, Kindermodus - sechs Dinge, die miteinander
  // nichts zu tun haben, unter einer Überschrift, die nur auf das erste
  // passte. Wer den Wandpanel-Modus suchte, scrollte an drei
  // Chipreihen vorbei und fand ihn dort, wo er ihn nicht vermutete.
  //
  // Jetzt beantwortet jede Karte eine Frage: wie es aussieht, wie die
  // Kacheln stehen, und was dieses Gerät ist, wenn es fest an der Wand
  // hängt.
  const erscheinungsbild = (
    <Card style={styles.card}>
      <Text style={styles.title}>Erscheinungsbild</Text>
      <View style={styles.field}>
        <View style={styles.modes}>
          {MODES.map((option) => {
            const [oben, unten] = themenprobe(option.key);
            return (
              <Pressable
                key={option.key}
                onPress={() => themaWaehlen(option.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected: theme === option.key }}
                style={({ pressed }) => [
                  styles.mode,
                  styles.modeMitProbe,
                  theme === option.key && styles.modeActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                {/* Der Farbfleck sagt vor dem Antippen, was passiert -
                    «Sand» und «Mitternacht» erfuhr man sonst nur durchs
                    Ausprobieren (lib/themenprobe.ts). */}
                <View style={styles.probe}>
                  <View style={[styles.probeHaelfte, { backgroundColor: oben }]} />
                  <View style={[styles.probeHaelfte, { backgroundColor: unten }]} />
                </View>
                <Text
                  style={[
                    styles.modeText,
                    theme === option.key && styles.modeTextActive,
                  ]}
                >
                  {option.label}
                </Text>
              </Pressable>
            );
          })}
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

      {/* Nicht doppelt: Für Personen steht das Feld im Profil - hier
          bleibt es fürs Panel (Anrede) und für die Ersteinrichtung. */}
      {darfUmbenennen ? null : nameFeld}
    </Card>
  );

  // Wie die Kacheln stehen: wie viele nebeneinander, und in welcher
  // Reihenfolge. Die beiden Reihenfolge-Schalter standen bis vor
  // Kurzem auf der Räume-Seite selbst, als zwei breite Zeilen über den
  // Raumkacheln - dort, wo man die Räume sucht und nicht einstellt.
  // Sie gehören zu diesem Gerät wie die Kachelgrösse darüber.
  const kachelKarte = (
    <Card style={styles.card}>
      <Text style={styles.title}>Kacheln</Text>
      {/* Wie eng die Kacheln stehen. Hier und nicht bei den persönlichen
          Einstellungen: Es ist eine Eigenschaft dieses Geräts, wie der
          Grundriss darunter - das Wandpanel im Flur liest man aus zwei
          Metern, das iPad auf dem Sofa aus dreissig Zentimetern, und
          beide gehören derselben Person. */}
      <View style={styles.field}>
        {/* «Grösse» und nicht noch einmal «Kacheln»: Die Karte heisst
            schon so, und dasselbe Wort zweimal untereinander liest
            sich wie ein Fehler. */}
        <Text style={styles.label}>Grösse</Text>
        <View style={styles.modes}>
          {DICHTEN.map((stufe) => (
            <Pressable
              key={stufe.key}
              onPress={() => dichteWaehlen(stufe.key)}
              accessibilityRole="radio"
              accessibilityState={{ selected: dichte === stufe.key }}
              style={({ pressed }) => [
                styles.mode,
                dichte === stufe.key && styles.modeActive,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text
                style={[styles.modeText, dichte === stufe.key && styles.modeTextActive]}
              >
                {stufe.label}
              </Text>
            </Pressable>
          ))}
        </View>
        <Text style={styles.modeHint}>
          {DICHTEN.find((stufe) => stufe.key === dichte)?.hinweis}
          {' '}Nur die Anzahl nebeneinander ändert sich – Schrift und Namen
          bleiben, wie sie sind.
        </Text>
      </View>

      {onTageszeit ? (
        <Schalterzeile
          titel="Nach Tageszeit sortieren"
          symbol="sunny-outline"
          an={!!tageszeit}
          onChange={onTageszeit}
          hinweis={
            tageszeit
              ? 'Morgens Storen, abends Licht - die Reihenfolge wandert mit dem Tag. Was du um diese Zeit oft anfasst, steht vorn. Gilt nur für dich.'
              : 'Immer dieselbe Reihenfolge, egal wie spät es ist.'
          }
        />
      ) : null}
      {onRaumNutzung ? (
        <Schalterzeile
          titel="Meistbenutzte Räume zuerst"
          symbol="trending-up-outline"
          an={!!raumNutzung}
          onChange={onRaumNutzung}
          hinweis={
            raumNutzung
              ? 'Was du auf diesem Gerät oft bedienst, steht oben. Ältere Bedienungen verblassen.'
              : 'Die Reihenfolge aus der Einrichtung - egal, was du oft anfasst.'
          }
        />
      ) : null}
    </Card>
  );

  // Alles, was ein fest montiertes Tablet betrifft - und sonst
  // niemanden. Auf dem Telefon steht die Karte trotzdem: Wer ein altes
  // iPad an die Wand hängt, richtet es von dort aus ein.
  const panelKarte = (
    <Card style={styles.card}>
      <Text style={styles.title}>Fest montiert</Text>
      {/* Der Schalter wirkt sofort - die Ansicht selbst (Bild
          hinterlegen, Geräte platzieren) wohnt auf der Räume-Seite, wo
          man sie sieht. */}
      <Schalterzeile
        titel="Grundriss-Ansicht"
        symbol="map-outline"
        an={grundriss}
        onChange={grundrissWaehlen}
        hinweis="Die Räume-Seite zeigt zuoberst den Wohnungsplan mit den Geräten als Punkten - antippen schaltet. Gedacht fürs Wandpanel; Bild und Punkte richtet man direkt dort ein. Wirkt sofort, nur auf diesem Gerät."
      />

      {/* Hier und nicht bei der Verbindung: Der Modus ändert, wie die
          App aussieht und sich verhält - nicht, womit sie spricht. */}
      <Schalterzeile
        titel="Wandpanel-Modus"
        symbol="tablet-landscape-outline"
        an={panel}
        onChange={setPanel}
        hinweis="Bildschirm bleibt an, Ansicht kehrt nach drei Minuten zur Startseite zurück, und nach Sonnenuntergang wird es dunkler - für ein fest montiertes iPad. Eine Berührung macht es sofort wieder hell. Und wenn es klingelt, geht hier das Kamerabild mit den Türknöpfen auf - nur hier: Auf einem Telefon in der Tasche wäre dasselbe Vollbild eine Störung, dort tut es die Nachricht."
      />

      {/* Der Kindermodus hängt am Panel-Schalter: Er ist die Sonderform
          des Wandpanels fürs Kinderzimmer. Antippen speichert sofort. */}
      {panel && kinderNamen.length > 0 ? (
        <View style={styles.field}>
          <Text style={styles.label}>Kindermodus</Text>
          <View style={styles.modes}>
            {['', ...kinderNamen].map((wahl) => (
              <Pressable
                key={wahl || 'aus'}
                onPress={() => kindPanelWaehlen(wahl)}
                accessibilityRole="radio"
                accessibilityState={{ selected: (kindPanel ?? '') === wahl }}
                style={({ pressed }) => [
                  styles.mode,
                  (kindPanel ?? '') === wahl && styles.modeActive,
                  pressed && { opacity: 0.7 },
                ]}
              >
                <Text
                  style={[
                    styles.modeText,
                    (kindPanel ?? '') === wahl && styles.modeTextActive,
                  ]}
                >
                  {wahl || 'Aus'}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.modeHint}>
            Dieses Gerät zeigt dann nur die Kinderseite des gewählten Kindes
            - ohne Alarm, Storen und den Rest der Wohnung. Fürs Tablet im
            Kinderzimmer; zurück geht es hier über «Aus».
          </Text>
        </View>
      ) : null}
    </Card>
  );

  // Für die Ersteinrichtung: die drei Karten am Stück, in derselben
  // Reihenfolge wie auf der Konto-Seite.
  const aussehen = (
    <>
      {erscheinungsbild}
      {kachelKarte}
      {panelKarte}
    </>
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

  // Die Karte der Hub-Verbindung.
  //
  // Sie war ein immer offenes Formular: «Hub-URL», «Token», darunter
  // «Speichern & verbinden». Das ist die technischste Stelle der ganzen
  // App - und sie stand zuoberst auf einer Seite, die man aufmacht, um
  // nachzusehen, ob die Verbindung steht. Zwei Felder, die man einmal
  // beim Einrichten ausfüllt und danach nie wieder anfasst, ausser man
  // will genau das kaputtmachen.
  //
  // Jetzt sagt die Karte zuerst, woran man ist - dieselbe Ampel wie in
  // der Begrüssungskarte -, und die Felder liegen hinter «Adresse von
  // Hand ändern». Beim Einrichten (kein Benutzer) ist sie unverändert
  // offen: Da IST das Formular die Aufgabe.
  const eingerichtet = !!user;
  const felderOffen = !eingerichtet || zugangOffen;

  const verbindung = (
    <Card style={styles.card}>
      <Text style={styles.title}>{user ? 'Hub-Verbindung' : 'Hub verbinden'}</Text>

      {eingerichtet ? (
        <View style={styles.hubStand}>
          <View
            style={[
              styles.hubPunkt,
              { backgroundColor: verbindungsFarbe(colors, stand) },
            ]}
          />
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={styles.hubWort}>
              {stand === 'connected' ? 'Verbunden' : VERBINDUNGSWORT[stand]}
            </Text>
            {/* Die Adresse klein darunter: Sie ist die Antwort auf «mit
                welchem Hub eigentlich?» - im Haus oder von aussen -,
                aber keine, die man täglich liest. */}
            <Text style={styles.hubAdresse} numberOfLines={1}>
              {url || 'noch keine Adresse'}
            </Text>
          </View>
        </View>
      ) : null}

      {felderOffen ? (
        <>
          <Pressable
            onPress={() => setScanning(true)}
            accessibilityRole="button"
            style={({ pressed }) => [styles.scan, pressed && { opacity: 0.75 }]}
          >
            <Ionicons name="qr-code-outline" size={20} color={colors.ink} />
            <Text style={styles.scanText}>QR-Code vom Hub scannen</Text>
          </Pressable>
          <Text style={styles.scanHint}>oder von Hand eintragen</Text>

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
        </>
      ) : (
        <Pressable
          onPress={() => setZugangOffen(true)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.nameButton, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.nameButtonText}>Adresse von Hand ändern</Text>
        </Pressable>
      )}

      <QrScanner
        visible={scanning}
        onClose={() => setScanning(false)}
        onScanned={(setup) => {
          // Direkt speichern: Wer scannt, will verbinden, nicht noch tippen.
          const next = applySetup(initial, setup);
          setUrl(next.url);
          setToken(next.token);
          if (next.name) setName(next.name);
          onSave({ ...next, theme, panel, appSymbol, grundriss });
        }}
      />

      {/* Der Scanner steht auch dem eingerichteten Gerät offen, ohne
          dass es dafür die Felder aufmachen muss: Ein neuer Hub, ein
          neues Token - ein Scan, fertig. */}
      {eingerichtet && !felderOffen ? (
        <Pressable
          onPress={() => setScanning(true)}
          accessibilityRole="button"
          style={({ pressed }) => [styles.scan, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="qr-code-outline" size={20} color={colors.ink} />
          <Text style={styles.scanText}>Neuen QR-Code scannen</Text>
        </Pressable>
      ) : null}

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
    // Vier Blöcke statt neun gleich lauter Karten: wer ich bin, wie man
    // hereinkommt, wie sich dieses Gerät verhält, was es meldet - und
    // ganz am Ende der Ausgang. Die Karten dazwischen kommen von aussen
    // (siehe die Schlitze oben), die Reihenfolge gehört aber hierher,
    // wo die Seite entsteht.
    <>
      {profil}
      {sicherheit}
      <Abschnitt titel="Dieses Gerät" hinweis="Gilt nur hier, nicht für die anderen im Haus.">
        {erscheinungsbild}
        {kachelKarte}
        {ortungKarte}
        {geraet}
        {/* Zuletzt im Block: Auf den meisten Geräten im Haus ist die
            Karte die Antwort auf eine Frage, die niemand stellt - ein
            Telefon hängt nicht an der Wand. */}
        {panelKarte}
      </Abschnitt>
      {weiteres}
      {abmelden}
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
  nameNote: { color: colors.on, fontSize: 13, lineHeight: 18 },
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
  profilKopf: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  hubStand: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  hubPunkt: { width: 10, height: 10, borderRadius: 5 },
  hubWort: { color: colors.ink, fontSize: 16, fontWeight: '700' },
  hubAdresse: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
  /** Die Initiale statt eines Bildes: Es gibt im Haus keine Profilfotos,
   *  und ein Platzhalter-Kopf für jeden sähe aus wie ein leeres Konto. */
  avatar: {
    width: 54,
    height: 54,
    borderRadius: 27,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  avatarText: { color: '#FFFFFF', fontSize: 24, fontWeight: '700' },
  profilName: { color: colors.ink, fontSize: 22, fontWeight: '700' },
  rollenReihe: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  /** Die Rolle als Marke und nicht als Fliesstext: «Besitzer» ist eine
   *  Eigenschaft des Kontos, kein Satz - und neben ihr steht am
   *  Wandpanel noch «Gemeinschaftsgerät». */
  rolle: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: '600',
    paddingHorizontal: 9,
    paddingVertical: 3,
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    overflow: 'hidden',
  },
  stift: {
    padding: 9,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
    backgroundColor: colors.surfaceSoft,
  },
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
  /** Etwas weniger Luft links: Der Farbfleck bringt seine eigene mit. */
  modeMitProbe: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 9 },
  probe: {
    width: 20,
    height: 20,
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  probeHaelfte: { flex: 1 },
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
