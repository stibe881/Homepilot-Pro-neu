/**
 * Die Verbindungen-Seite: dieses Gerät - und die Dienste des Hauses.
 *
 * Oben steht, was schon immer hier stand: Adresse und Token, mit denen
 * dieses eine Gerät den Hub erreicht. Darunter kommen die Verbindungen
 * des *Hauses* dazu - der Google-Kalender mit seinen Mail-Adressen,
 * Spotify und Google Home. Die standen bisher nur in der config.yaml:
 * Wer die Kalender-Adresse eines Kindes eintragen wollte, musste YAML
 * lesen und wissen, was `calendar_ids` heisst.
 *
 * Jede Karte sagt in einem Satz, woran sie ist («Verbunden»,
 * «Anmeldung fehlt», «Ausgeschaltet») - und der Satz nennt immer den
 * nächsten Schritt, nicht irgendeinen. Geändert wird über
 * /api/verbindungen; der Hub schreibt die config.yaml selbst, geprüft
 * und mit Verlauf, und Geheimnisse wandern in die secrets.env - sie
 * kommen nie zur App zurück.
 *
 * Die Dienst-Karten sieht nur, wer die Konfiguration ändern darf
 * (edit_config). Für alle anderen bleibt die Seite, was sie war.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hubClient } from '../api/client';
import { ConnectionStatus } from '../hooks/useHub';
import { Entity, HubSettings } from '../api/types';
import { Abschnitt } from '../components/Abschnitt';
import { Card } from '../components/Card';
import { TvKopplung } from '../components/TvKopplung';
import { brauchtKopplung, kannKoppeln, kopplungsZeile } from '../lib/fernsehkopplung';
import {
  Dienst,
  ERINNERUNGS_MINUTEN,
  anbieterName,
  dienstSymbol,
  erinnerungsWort,
  geraetZeile,
  gueltigeKalenderId,
  gueltigerHost,
  kalenderName,
} from '../lib/verbindungen';
import { SettingsScreen } from './SettingsScreen';
import { Colors, radius, type, useColors } from '../theme';

interface Props {
  settings: HubSettings;
  onSave: (settings: HubSettings) => void;
  user?: { name: string; role: string; shared?: boolean } | null;
  /** Nur wer die Konfiguration ändern darf, sieht die Dienst-Karten. */
  darfDienste: boolean;
  /** Für die Fernseher-Kopplung: Welche Android-TV-Geräte es gibt und
   *  woran sie sind. */
  entities?: Entity[];
  /** Woran die App gerade ist - für die Ampel in der Hub-Karte. */
  stand?: ConnectionStatus;
}

interface Antwort {
  ok?: boolean;
  restart_required?: boolean;
  unveraendert?: boolean;
  warnings?: string[];
}

export function VerbindungenScreen({
  settings,
  onSave,
  user,
  darfDienste,
  entities = [],
  stand,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  // Nur die Android-TV-Geräte: Sie sind die einzigen, die eine Kopplung
  // kennen (lib/fernsehkopplung.ts, kannKoppeln). Nach Namen, damit die
  // Reihenfolge nicht mit jeder Zustandsmeldung springt.
  const fernseher = useMemo(
    () =>
      (entities ?? [])
        .filter(kannKoppeln)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [entities]
  );

  const [dienste, setDienste] = useState<Dienst[] | null>(null);
  // Nach einer Änderung gilt sie erst mit dem nächsten Start des Hubs -
  // der Hinweis steht einmal über den Karten, nicht dreimal darin.
  const [neustartNoetig, setNeustartNoetig] = useState(false);
  const [neustart, setNeustart] = useState<'idle' | 'laeuft'>('idle');

  const laden = useCallback(() => {
    if (!darfDienste || !settings.url || !settings.token) return;
    hub
      .get<{ dienste: Dienst[] }>('/api/verbindungen', { still: true })
      // Ein alter Hub kennt die Route nicht - dann bleibt die Seite
      // schlicht, was sie war, statt eine Fehlerkarte zu zeigen.
      .then((antwort) => setDienste(antwort.dienste ?? []))
      .catch(() => setDienste(null));
  }, [hub, darfDienste, settings.url, settings.token]);

  useEffect(laden, [laden]);

  /** Eine Änderung zum Hub bringen und die Karten nachladen. */
  const aendern = useCallback(
    async (key: string, body: Record<string, unknown>) => {
      const antwort = await hub.put<Antwort>(
        `/api/verbindungen/${encodeURIComponent(key)}`,
        body,
        { still: true }
      );
      if (antwort.restart_required) setNeustartNoetig(true);
      laden();
    },
    [hub, laden]
  );

  /** Schritt 1 der Browser-Anmeldung: die Adresse beim Hub holen. */
  const anmeldeUrl = useCallback(
    (key: string) =>
      hub
        .get<{ url: string }>(
          `/api/verbindungen/${encodeURIComponent(key)}/anmeldung`,
          { still: true }
        )
        .then((antwort) => antwort.url),
    [hub]
  );

  /** Schritt 2: die zurückkopierte Adresse einlösen lassen. */
  const anmelden = useCallback(
    async (key: string, antwort: string) => {
      const ergebnis = await hub.post<Antwort>(
        `/api/verbindungen/${encodeURIComponent(key)}/anmeldung`,
        { antwort },
        { still: true }
      );
      if (ergebnis.restart_required) setNeustartNoetig(true);
      laden();
    },
    [hub, laden]
  );

  const neustarten = async () => {
    setNeustart('laeuft');
    // Der Hub beendet sich gleich - eine Antwort kommt nicht immer noch
    // an. Beides ist in Ordnung, die Karten melden sich nach dem Start.
    await hub.post('/api/system/restart', undefined, { still: true }).catch(() => {});
    setNeustartNoetig(false);
    setTimeout(() => {
      setNeustart('idle');
      laden();
    }, 4000);
  };

  return (
    <View style={styles.stack}>
      <SettingsScreen
        initial={settings}
        onSave={onSave}
        user={user}
        embedded
        nur="verbindung"
        stand={stand}
      />

      {/* Die Fernseher. Sie stehen hier und nicht mehr auf ihrer Kachel:
          Eine Kopplung richtet man einmal ein, und Einrichtung gehört zu
          den Verbindungen - nicht neben den Einschlaf-Timer, den man
          jeden Abend braucht. Ohne Android TV im Haus fällt der ganze
          Abschnitt weg. */}
      {fernseher.length > 0 ? (
        <Abschnitt
          titel="Fernseher"
          hinweis="Einmal koppeln, dann gehorcht die Fernbedienung in der App."
        >
          {fernseher.map((tv) => (
            <Card key={tv.id} style={styles.card}>
              <View style={styles.tvKopf}>
                <Ionicons
                  name="tv-outline"
                  size={20}
                  color={brauchtKopplung(tv) ? colors.warn : colors.inkSoft}
                />
                <View style={{ flex: 1 }}>
                  <Text style={styles.tvName}>{tv.name}</Text>
                  <Text
                    style={[
                      styles.tvZeile,
                      brauchtKopplung(tv) && { color: colors.warn },
                    ]}
                  >
                    {kopplungsZeile(tv)}
                    {tv.room ? ` · ${tv.room}` : ''}
                  </Text>
                </View>
              </View>
              <TvKopplung entity={tv} dringend={brauchtKopplung(tv)} />
            </Card>
          ))}
        </Abschnitt>
      ) : null}

      {darfDienste && dienste ? (
        <Abschnitt
          titel="Dienste des Hauses"
          hinweis="Gilt für alle im Haus, nicht nur für dieses Gerät."
        >
          {neustartNoetig || neustart === 'laeuft' ? (
            <Card style={styles.card}>
              <View style={styles.neustartZeile}>
                <Ionicons name="refresh-outline" size={18} color={colors.warn} />
                <Text style={styles.neustartText}>
                  {neustart === 'laeuft'
                    ? 'Der Hub startet neu – einen Moment.'
                    : 'Gespeichert. Die Änderung gilt, sobald der Hub neu gestartet ist.'}
                </Text>
                {neustart === 'idle' ? (
                  <Pressable
                    onPress={neustarten}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
                  >
                    <Text style={styles.knopfText}>Jetzt neu starten</Text>
                  </Pressable>
                ) : null}
              </View>
            </Card>
          ) : null}
          {dienste.map((dienst) => (
            <DienstKarte
              key={dienst.key}
              dienst={dienst}
              aendern={(body) => aendern(dienst.key, body)}
              anmeldeUrl={() => anmeldeUrl(dienst.key)}
              anmelden={(antwort) => anmelden(dienst.key, antwort)}
            />
          ))}
        </Abschnitt>
      ) : null}
    </View>
  );
}

// ── Eine Karte je Dienst ─────────────────────────────────────────────────

function DienstKarte({
  dienst,
  aendern,
  anmeldeUrl,
  anmelden,
}: {
  dienst: Dienst;
  aendern: (body: Record<string, unknown>) => Promise<void>;
  anmeldeUrl: () => Promise<string>;
  anmelden: (antwort: string) => Promise<void>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [fehler, setFehler] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Das Einrichten und die Zugangsdaten teilen sich ein aufklappbares
  // Formular - zwei Geheimfelder, die niemand ständig sehen muss.
  const [zugangOffen, setZugangOffen] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');

  const tu = async (body: Record<string, unknown>) => {
    setBusy(true);
    setFehler(null);
    try {
      await aendern(body);
      return true;
    } catch (err) {
      setFehler(String(err instanceof Error ? err.message : err));
      return false;
    } finally {
      setBusy(false);
    }
  };

  const zugangSchicken = async () => {
    const body: Record<string, unknown> = {};
    if (clientId.trim()) body.client_id = clientId.trim();
    if (clientSecret.trim()) body.client_secret = clientSecret.trim();
    if (!dienst.eingerichtet && !(body.client_id && body.client_secret)) {
      setFehler('Zum Einrichten braucht es Client-ID und Client-Secret.');
      return;
    }
    if (!body.client_id && !body.client_secret) {
      setFehler('Nichts eingetragen - nichts zu speichern.');
      return;
    }
    if (await tu(body)) {
      setZugangOffen(false);
      setClientId('');
      setClientSecret('');
    }
  };

  const braucheZugang = dienst.key === 'kalender' || dienst.key === 'spotify';

  return (
    <Card style={styles.card}>
      {/* Kopf: Symbol, Name, eine Zeile Erklärung - und der Stand. */}
      <View style={styles.kopf}>
        <View style={styles.symbol}>
          <Ionicons
            name={dienstSymbol(dienst.key) as keyof typeof Ionicons.glyphMap}
            size={22}
            color={colors.ink}
          />
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.titel}>{dienst.label}</Text>
          <Text style={styles.kurz}>{dienst.kurz}</Text>
        </View>
        <View
          style={[
            styles.stand,
            dienst.status.ton === 'gut' && { backgroundColor: colors.onSoft },
            dienst.status.ton === 'warnung' && { backgroundColor: colors.dangerSoft },
          ]}
        >
          <Text
            style={[
              styles.standText,
              dienst.status.ton === 'gut' && { color: colors.on },
              dienst.status.ton === 'warnung' && { color: colors.danger },
            ]}
          >
            {dienst.status.text}
          </Text>
        </View>
      </View>

      {/* Der Fehlertext des Hubs - aber nur, wenn er die Geschichte
          erzählt. Bei «Anmeldung fehlt» erklärt der Befehlskasten unten
          dasselbe besser; zweimal rot wäre ein Fehlerbericht. */}
      {dienst.fehler && dienst.status.text === 'Start fehlgeschlagen' ? (
        <Text style={styles.fehlerText}>{dienst.fehler}</Text>
      ) : null}

      {/* Noch gar nicht eingerichtet: erklären statt Felder zeigen. */}
      {!dienst.eingerichtet ? (
        <>
          <Text style={styles.hinweis}>
            {dienst.key === 'kalender'
              ? 'Verbindet den Google-Kalender des Kontos - Termine, Geburtstage und die Erinnerungen dazu. Client-ID und -Secret kommen aus der Google-Konsole (console.cloud.google.com, OAuth-Client Typ «Desktop»).'
              : dienst.key === 'spotify'
                ? 'Zeigt, was gerade läuft, und spielt Playlisten auf den Boxen. Client-ID und -Secret kommen von developer.spotify.com (Redirect-URI: http://127.0.0.1:8888/callback).'
                : 'Bindet Lautsprecher, Chromecasts und Fernseher übers Cast-Protokoll ein. Es genügt ein erstes Gerät mit Name und Adresse (feste IP aus dem Router).'}
          </Text>
          {braucheZugang ? (
            zugangOffen ? (
              <ZugangsFelder
                clientId={clientId}
                clientSecret={clientSecret}
                setClientId={setClientId}
                setClientSecret={setClientSecret}
                busy={busy}
                onSenden={zugangSchicken}
                senden="Einrichten"
              />
            ) : (
              <Pressable
                onPress={() => setZugangOffen(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
              >
                <Text style={styles.knopfText}>Einrichten</Text>
              </Pressable>
            )
          ) : (
            <GeraetForm busy={busy} onHinzu={(name, host) => tu({ geraet_hinzu: { name, host } })} />
          )}
        </>
      ) : (
        <>
          {dienst.key === 'kalender' ? (
            <KalenderInhalt dienst={dienst} busy={busy} tu={tu} />
          ) : null}
          {dienst.key === 'googlehome' ? (
            <GoogleHomeInhalt dienst={dienst} busy={busy} tu={tu} />
          ) : null}

          {/* Die fehlende Anmeldung - direkt im Browser, ohne Terminal.
              Nur wenn die Zugangsdaten schon da sind: Ohne sie kann der
              Hub die Anmeldeadresse gar nicht bauen, und der Stand-Satz
              oben sagt dann ohnehin «Zugangsdaten fehlen». */}
          {dienst.enabled && dienst.zugang !== false && dienst.angemeldet === false ? (
            <AnmeldeBereich
              dienst={dienst}
              anmeldeUrl={anmeldeUrl}
              anmelden={anmelden}
            />
          ) : null}

          {/* Zugangsdaten: nie anzeigen, nur ersetzen können. */}
          {braucheZugang && dienst.enabled ? (
            zugangOffen ? (
              <ZugangsFelder
                clientId={clientId}
                clientSecret={clientSecret}
                setClientId={setClientId}
                setClientSecret={setClientSecret}
                busy={busy}
                onSenden={zugangSchicken}
                senden="Speichern"
                onZu={() => setZugangOffen(false)}
              />
            ) : (
              <Pressable
                onPress={() => setZugangOffen(true)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.leiseZeile, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="key-outline" size={15} color={colors.inkSoft} />
                <Text style={styles.leiseText}>
                  Zugangsdaten {dienst.zugang ? 'ersetzen' : 'eintragen'}
                  {dienst.zugang ? ' (gesetzt)' : ''}
                </Text>
              </Pressable>
            )
          ) : null}

          {/* Aus, aber nicht weg: Der Block bleibt in der Datei stehen -
              mit allen Zugangsdaten - und ist in einer Minute zurück. */}
          <Pressable
            onPress={() => tu({ enabled: !dienst.enabled })}
            accessibilityRole="switch"
            accessibilityState={{ checked: dienst.enabled }}
            disabled={busy}
            style={({ pressed }) => [styles.schalterZeile, pressed && { opacity: 0.7 }]}
          >
            <View style={{ flex: 1 }}>
              <Text style={styles.label}>Eingeschaltet</Text>
              {!dienst.enabled ? (
                <Text style={styles.hinweis}>
                  Ausgeschaltet bleibt alles gespeichert - nur benutzt wird es nicht.
                </Text>
              ) : null}
            </View>
            <View style={[styles.schalter, dienst.enabled && styles.schalterAn]}>
              <View style={[styles.knubbel, dienst.enabled && styles.knubbelAn]} />
            </View>
          </Pressable>
        </>
      )}

      {fehler ? <Text style={styles.fehlerText}>{fehler}</Text> : null}
    </Card>
  );
}

// ── Kalender: die Mail-Adressen und der Erinnerungs-Vorlauf ─────────────

function KalenderInhalt({
  dienst,
  busy,
  tu,
}: {
  dienst: Dienst;
  busy: boolean;
  tu: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [neu, setNeu] = useState('');
  const [neuFehler, setNeuFehler] = useState<string | null>(null);
  const ids = dienst.werte.calendar_ids ?? [];
  const minuten = dienst.werte.remind_minutes ?? 0;

  const hinzu = async () => {
    const kern = neu.trim();
    if (!gueltigeKalenderId(kern)) {
      setNeuFehler('Das sieht nicht nach einer Kalender- oder Mail-Adresse aus.');
      return;
    }
    if (ids.includes(kern)) {
      setNeuFehler('Der Kalender steht schon in der Liste.');
      return;
    }
    setNeuFehler(null);
    if (await tu({ calendar_ids: [...ids, kern] })) setNeu('');
  };

  if (!dienst.enabled) return null;
  return (
    <>
      <View style={styles.feld}>
        <Text style={styles.label}>Kalender</Text>
        {ids.map((id) => (
          <View key={id} style={styles.zeile}>
            <Ionicons
              name={id === 'primary' ? 'person-outline' : 'mail-outline'}
              size={16}
              color={colors.inkSoft}
            />
            <View style={{ flex: 1 }}>
              <Text style={styles.zeileText} numberOfLines={1}>
                {kalenderName(id)}
              </Text>
            </View>
            {ids.length > 1 ? (
              <Pressable
                onPress={() => tu({ calendar_ids: ids.filter((rest) => rest !== id) })}
                disabled={busy}
                accessibilityRole="button"
                accessibilityLabel={`${kalenderName(id)} entfernen`}
                hitSlop={8}
              >
                <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
              </Pressable>
            ) : null}
          </View>
        ))}
        <View style={styles.hinzuZeile}>
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={neu}
            onChangeText={setNeu}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="mail@gmail.com oder Kalender-Kennung"
            placeholderTextColor={colors.inkFaint}
            onSubmitEditing={hinzu}
          />
          <Pressable
            onPress={hinzu}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
          >
            <Text style={styles.knopfText}>Hinzufügen</Text>
          </Pressable>
        </View>
        {neuFehler ? <Text style={styles.fehlerText}>{neuFehler}</Text> : null}
        <Text style={styles.hinweis}>
          «Hauptkalender» ist der Kalender des angemeldeten Google-Kontos. Ein
          geteilter Kalender kommt über seine Mail-Adresse dazu.
        </Text>
      </View>

      <View style={styles.feld}>
        <Text style={styles.label}>Erinnerung vor Terminen</Text>
        <View style={styles.chips}>
          {ERINNERUNGS_MINUTEN.map((wahl) => (
            <Pressable
              key={wahl}
              onPress={() => tu({ remind_minutes: wahl })}
              disabled={busy}
              accessibilityRole="radio"
              accessibilityState={{ selected: minuten === wahl }}
              style={({ pressed }) => [
                styles.chip,
                minuten === wahl && styles.chipAn,
                pressed && { opacity: 0.7 },
              ]}
            >
              <Text style={[styles.chipText, minuten === wahl && styles.chipTextAn]}>
                {erinnerungsWort(wahl)}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>
    </>
  );
}

// ── Google Home: die Geräteliste ─────────────────────────────────────────

function GoogleHomeInhalt({
  dienst,
  busy,
  tu,
}: {
  dienst: Dienst;
  busy: boolean;
  tu: (body: Record<string, unknown>) => Promise<boolean>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const geraete = dienst.werte.geraete ?? [];

  if (!dienst.enabled) return null;
  return (
    <View style={styles.feld}>
      <Text style={styles.label}>Geräte</Text>
      {geraete.map((geraet) => (
        <View key={`${geraet.host}:${geraet.port}`} style={styles.zeile}>
          <View
            style={[
              styles.punkt,
              geraet.erreichbar === true && { backgroundColor: colors.on },
              geraet.erreichbar === false && { backgroundColor: colors.danger },
            ]}
          />
          <View style={{ flex: 1 }}>
            <Text style={styles.zeileText} numberOfLines={1}>
              {geraet.name}
            </Text>
            <Text style={styles.zeileKlein}>{geraetZeile(geraet)}</Text>
          </View>
          <Pressable
            onPress={() => tu({ geraet_weg: { host: geraet.host, port: geraet.port } })}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={`${geraet.name} entfernen`}
            hitSlop={8}
          >
            <Ionicons name="trash-outline" size={16} color={colors.inkFaint} />
          </Pressable>
        </View>
      ))}
      <GeraetForm
        busy={busy}
        onHinzu={(name, host) => tu({ geraet_hinzu: { name, host } })}
      />
      <Text style={styles.hinweis}>
        Suchen und Übernehmen aus dem Netz kann die Lautsprecher-Seite; hier
        trägt man ein Gerät von Hand ein - mit der festen IP aus dem Router.
      </Text>
    </View>
  );
}

/** Name + Adresse für ein neues Cast-Gerät - beim Einrichten wie später. */
function GeraetForm({
  busy,
  onHinzu,
}: {
  busy: boolean;
  onHinzu: (name: string, host: string) => Promise<boolean>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [name, setName] = useState('');
  const [host, setHost] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);

  const los = async () => {
    if (!name.trim() || !gueltigerHost(host)) {
      setFehler('Es braucht einen Namen und eine Adresse wie 192.168.1.35.');
      return;
    }
    setFehler(null);
    if (await onHinzu(name.trim(), host.trim())) {
      setName('');
      setHost('');
    }
  };

  return (
    <>
      <View style={styles.hinzuZeile}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={name}
          onChangeText={setName}
          placeholder="Name (z.B. Küche)"
          placeholderTextColor={colors.inkFaint}
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={host}
          onChangeText={setHost}
          autoCapitalize="none"
          autoCorrect={false}
          keyboardType="numbers-and-punctuation"
          placeholder="192.168.1.35"
          placeholderTextColor={colors.inkFaint}
          onSubmitEditing={los}
        />
        <Pressable
          onPress={los}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.knopfText}>Hinzufügen</Text>
        </Pressable>
      </View>
      {fehler ? <Text style={styles.fehlerText}>{fehler}</Text> : null}
    </>
  );
}

/**
 * Die Anmeldung beim Anbieter - im Browser statt im Terminal.
 *
 * Vorher stand hier ein «docker exec»-Befehl: Für eine Zustimmung, die
 * ohnehin im Browser passiert, brauchte es einen Rechner mit SSH. Jetzt
 * baut der Hub die Adresse, die App öffnet sie, und die zurückkopierte
 * Redirect-Adresse löst der Hub selbst gegen das Token ein.
 *
 * Der eine unschöne Moment bleibt ehrlich benannt: Am Ende leitet der
 * Anbieter auf 127.0.0.1 um, und diese Seite lädt nicht - genau daraus
 * kopiert man die Adresse. Wer das nicht vorher liest, hält die
 * Anmeldung für gescheitert und bricht ab.
 */
function AnmeldeBereich({
  dienst,
  anmeldeUrl,
  anmelden,
}: {
  dienst: Dienst;
  anmeldeUrl: () => Promise<string>;
  anmelden: (antwort: string) => Promise<void>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offen, setOffen] = useState(false);
  const [antwort, setAntwort] = useState('');
  const [busy, setBusy] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const anbieter = anbieterName(dienst.key);

  const starten = async () => {
    setBusy(true);
    setFehler(null);
    try {
      const url = await anmeldeUrl();
      // Erst das Feld zeigen, dann den Browser öffnen: Wer zurückkommt,
      // soll die Stelle zum Einfügen schon offen vorfinden.
      setOffen(true);
      await Linking.openURL(url);
    } catch (err) {
      setFehler(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const abschliessen = async () => {
    if (!antwort.trim()) {
      setFehler('Zuerst die Adresse aus dem Browser einfügen.');
      return;
    }
    setBusy(true);
    setFehler(null);
    try {
      await anmelden(antwort.trim());
      setAntwort('');
      setOffen(false);
    } catch (err) {
      setFehler(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.befehlKasten}>
      {!offen ? (
        <>
          <Text style={styles.hinweis}>
            Damit der Hub auf das {anbieter}-Konto zugreifen darf, braucht es
            einmalig eine Zustimmung im Browser.
          </Text>
          <Pressable
            onPress={starten}
            disabled={busy}
            accessibilityRole="button"
            style={({ pressed }) => [styles.anmeldeKnopf, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="open-outline" size={16} color={colors.panel} />
            <Text style={styles.knopfText}>Bei {anbieter} anmelden</Text>
          </Pressable>
        </>
      ) : (
        <>
          <Text style={styles.hinweis}>
            Im Browser anmelden und zustimmen. Am Ende erscheint «Seite nicht
            erreichbar» - das ist richtig so. Die komplette Adresse aus der
            Adresszeile kopieren und hier einfügen (sie gilt nur ein paar
            Minuten).
          </Text>
          <TextInput
            style={styles.input}
            value={antwort}
            onChangeText={setAntwort}
            autoCapitalize="none"
            autoCorrect={false}
            placeholder="http://127.0.0.1:8888/…?code=…"
            placeholderTextColor={colors.inkFaint}
            onSubmitEditing={abschliessen}
          />
          <View style={styles.hinzuZeile}>
            <Pressable
              onPress={abschliessen}
              disabled={busy}
              accessibilityRole="button"
              style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
            >
              <Text style={styles.knopfText}>Anmeldung abschliessen</Text>
            </Pressable>
            <Pressable onPress={starten} disabled={busy} accessibilityRole="button" style={styles.leiseZeile}>
              <Text style={styles.leiseText}>Browser nochmals öffnen</Text>
            </Pressable>
          </View>
        </>
      )}
      {fehler ? <Text style={styles.fehlerText}>{fehler}</Text> : null}
    </View>
  );
}

/** Die zwei Geheimfelder - fürs Einrichten und fürs Ersetzen dieselben. */
function ZugangsFelder({
  clientId,
  clientSecret,
  setClientId,
  setClientSecret,
  busy,
  onSenden,
  senden,
  onZu,
}: {
  clientId: string;
  clientSecret: string;
  setClientId: (wert: string) => void;
  setClientSecret: (wert: string) => void;
  busy: boolean;
  onSenden: () => void;
  senden: string;
  onZu?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.feld}>
      <Text style={styles.label}>Client-ID</Text>
      <TextInput
        style={styles.input}
        value={clientId}
        onChangeText={setClientId}
        autoCapitalize="none"
        autoCorrect={false}
        placeholderTextColor={colors.inkFaint}
      />
      <Text style={styles.label}>Client-Secret</Text>
      <TextInput
        style={styles.input}
        value={clientSecret}
        onChangeText={setClientSecret}
        autoCapitalize="none"
        autoCorrect={false}
        secureTextEntry
        placeholderTextColor={colors.inkFaint}
      />
      <Text style={styles.hinweis}>
        Wird sicher neben der Konfiguration abgelegt (secrets.env) und nie
        wieder angezeigt - hier lässt es sich nur ersetzen.
      </Text>
      <View style={styles.hinzuZeile}>
        <Pressable
          onPress={onSenden}
          disabled={busy}
          accessibilityRole="button"
          style={({ pressed }) => [styles.knopf, pressed && { opacity: 0.7 }]}
        >
          <Text style={styles.knopfText}>{senden}</Text>
        </Pressable>
        {onZu ? (
          <Pressable onPress={onZu} accessibilityRole="button" style={styles.leiseZeile}>
            <Text style={styles.leiseText}>Abbrechen</Text>
          </Pressable>
        ) : null}
      </View>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: 14 },
    card: {
      width: '100%',
      maxWidth: 460,
      alignSelf: 'center',
      minHeight: 0,
      gap: 12,
      padding: 22,
    },
    tvKopf: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    tvName: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    tvZeile: { color: colors.inkFaint, fontSize: 12, marginTop: 2 },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    symbol: {
      width: 40,
      height: 40,
      borderRadius: 11,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    titel: { color: colors.ink, fontSize: 17, fontWeight: '700' },
    kurz: { color: colors.inkSoft, fontSize: 12, marginTop: 1 },
    stand: {
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
    },
    standText: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    feld: { gap: 8 },
    label: { color: colors.inkSoft, fontSize: type.cardSub, fontWeight: '600' },
    hinweis: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    zeileText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    zeileKlein: { color: colors.inkFaint, fontSize: 11, marginTop: 1 },
    punkt: {
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.off,
    },
    // Umbrechen statt hinausragen: Ein TextInput schrumpft von sich aus
    // nicht unter seine eingebaute Mindestbreite - mit zwei Feldern und
    // Knopf stand «Hinzufügen» sonst über der Kartenkante.
    hinzuZeile: { flexDirection: 'row', alignItems: 'center', gap: 8, flexWrap: 'wrap' },
    input: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 14,
      minWidth: 120,
    },
    knopf: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.ink,
    },
    knopfText: { color: colors.panel, fontSize: 13, fontWeight: '700' },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipAn: { backgroundColor: colors.ink, borderColor: colors.ink },
    chipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    chipTextAn: { color: colors.panel },
    befehlKasten: {
      gap: 6,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    // Der volle Anmelde-Knopf im Kasten - dieselbe Sprache wie «Speichern
    // & verbinden» eine Karte weiter oben: Das ist der Hauptweg, kein Nebenpfad.
    anmeldeKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.ink,
    },
    leiseZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      paddingVertical: 6,
    },
    leiseText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    schalterZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 14,
      marginTop: 2,
      paddingTop: 12,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    schalter: {
      width: 48,
      height: 28,
      borderRadius: radius.pill,
      backgroundColor: colors.off,
      padding: 3,
      justifyContent: 'center',
    },
    schalterAn: { backgroundColor: colors.on },
    knubbel: {
      width: 22,
      height: 22,
      borderRadius: 11,
      backgroundColor: colors.surfaceStrong,
    },
    knubbelAn: { alignSelf: 'flex-end' },
    neustartZeile: { flexDirection: 'row', alignItems: 'center', gap: 10, flexWrap: 'wrap' },
    neustartText: { flex: 1, color: colors.ink, fontSize: 13, lineHeight: 18, minWidth: 160 },
    fehlerText: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  });
