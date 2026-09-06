import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubFehler, hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { anmeldeFehlerText } from '../lib/anmeldefehler';
import { AnmeldeModus, validate, wechselProblem } from '../lib/anmeldung';
import { defaultHubUrl } from '../lib/origin';
import { geraeteName } from '../lib/plattform';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Anmelden mit E-Mail und Passwort.
 *
 * Bewusst ohne «Konto anlegen»: Ein Haus ist kein Dienst, bei dem man
 * sich anmeldet. Wer Zugang bekommt, entscheidet der Besitzer – er trägt
 * die Person unter Benutzer ein und schickt ihr eine Einladung. In der
 * E-Mail setzt sie ihr Passwort, danach führt dieser Schirm hinein.
 *
 * Der Weg über den QR-Code bleibt daneben bestehen – für Wandpanels und
 * für den Fall, dass der Anmeldedienst gerade nicht erreichbar ist.
 *
 * Die App spricht dabei nur mit dem Hub. Der wiederum spricht mit
 * Supabase – so bleibt der Schlüssel dort, wo er hingehört, und die App
 * kennt weiterhin genau eine Adresse.
 */

type Mode = AnmeldeModus;

export function LoginScreen({
  initial,
  onSave,
  onUseToken,
}: {
  initial: HubSettings | null;
  onSave: (settings: HubSettings) => void;
  /** Zum QR-Code/Token-Weg wechseln. */
  onUseToken: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [url, setUrl] = useState(initial?.url ?? defaultHubUrl());
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Der erzwungene Wechsel nach einem Initialpasswort: Die Sitzung ist
  // schon ausgestellt, aber gespeichert wird sie erst, wenn ein eigenes
  // Passwort gesetzt ist - das Initialpasswort kennt auch der Verwalter.
  const [neu, setNeu] = useState('');
  const [neuWiederholt, setNeuWiederholt] = useState('');
  const [wartend, setWartend] = useState<HubSettings | null>(null);
  // null = noch nicht gefragt. Ohne eingerichteten Anmeldedienst hat die
  // Maske keinen Sinn und die App führt gleich zum Token-Weg.
  const [available, setAvailable] = useState<boolean | null>(null);

  useEffect(() => {
    if (!url) return;
    let cancelled = false;
    setAvailable(null);
    // Über den Hub-Client statt nacktem fetch (Punkt 247 der Werkbank):
    // Vorher hing ein nicht antwortender Hub diese Abfrage ewig auf, und
    // die Maske blieb ohne Rückmeldung. Vor der Anmeldung gibt es noch
    // kein Token - der Client schickt dann «Bearer » mit leerem Rest, und
    // die Auth-Wege des Hubs prüfen keinen Kopf (routes/auth.py), das
    // stört also nicht. `still`, weil die Maske selbst zeigt, was los
    // ist; `fallback: null` heisst wie vorher «kein Passwort-Login».
    hubClient(url.replace(/\/$/, ''), '')
      .get<{ password_login?: boolean } | null>('/api/auth/config', {
        fallback: null,
        still: true,
      })
      .then((body) => {
        if (!cancelled) setAvailable(body?.password_login === true);
      });
    return () => {
      cancelled = true;
    };
  }, [url]);

  const submit = async () => {
    const problem = validate(mode, email, password);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    setNote(null);
    const base = url.replace(/\/$/, '');
    const path = mode === 'login' ? '/api/auth/login' : '/api/auth/recover';
    try {
      // Über den Hub-Client (Punkt 247 der Werkbank): Zeitlimit statt
      // ewigem Warten, und die Fehlersätze des Clients statt nacktem
      // Status. `still`, weil der Fehler unter dem Formular steht - eine
      // Einblendung obendrauf wäre doppelt.
      const body =
        (await hubClient(base, '').post<{
          token?: string;
          user?: { name?: string };
          must_change_password?: boolean;
          message?: string;
        } | null>(
          path,
          mode === 'recover'
            ? { email: email.trim() }
            : {
                email: email.trim(),
                password,
                label: geraeteName(),
              },
          { still: true }
        )) ?? {};

      if (mode === 'login') {
        const settings = {
          ...(initial ?? {}),
          url: base,
          token: body.token,
          name: body.user?.name ?? initial?.name ?? '',
        } as HubSettings;
        if (body.must_change_password) {
          // Erst das eigene Passwort, dann hinein: Das Initialpasswort
          // kennt auch der Verwalter - drinnen ist man erst mit einem
          // eigenen.
          setWartend(settings);
          setMode('wechsel');
          return;
        }
        onSave(settings);
        return;
      }
      setNote(body.message ?? 'Erledigt.');
    } catch (err) {
      // An der Maske heisst 401 «Name oder Passwort stimmt nicht», nicht
      // «Anmeldung abgelaufen» - siehe lib/anmeldefehler.ts.
      setError(
        err instanceof HubFehler
          ? anmeldeFehlerText(err.status, err.message, 'anmelden')
          : String(err instanceof Error ? err.message : err)
      );
    } finally {
      setBusy(false);
    }
  };

  const wechseln = async () => {
    if (!wartend) return;
    const problem = wechselProblem(password, neu, neuWiederholt);
    if (problem) {
      setError(problem);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      // Hier gibt es schon ein Token: Die Sitzung ist ausgestellt, nur
      // gespeichert wird sie erst nach dem Wechsel.
      await hubClient(wartend.url, wartend.token).post(
        '/api/auth/passwort-wechsel',
        { old: password, new: neu },
        { still: true }
      );
      onSave(wartend);
    } catch (err) {
      setError(
        err instanceof HubFehler
          ? anmeldeFehlerText(err.status, err.message, 'wechsel')
          : String(err instanceof Error ? err.message : err)
      );
    } finally {
      setBusy(false);
    }
  };

  const title =
    mode === 'login'
      ? 'Anmelden'
      : mode === 'wechsel'
        ? 'Eigenes Passwort setzen'
        : 'Passwort vergessen';

  return (
    <View style={styles.screen}>
      <Card style={styles.card}>
        <Text style={styles.title}>{title}</Text>

        {mode !== 'wechsel' ? (
          <>
            <Text style={styles.label}>Adresse des Hubs</Text>
            <TextInput
              style={styles.input}
              value={url}
              onChangeText={setUrl}
              placeholder="https://homepilot.example.ch"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              accessibilityLabel="Adresse des Hubs"
            />
          </>
        ) : null}

        {mode === 'wechsel' ? (
          <>
            <Text style={styles.hint}>
              Dein Zugang wurde mit einem Initialpasswort angelegt – das
              kennt auch, wer dich eingeladen hat. Wähle jetzt ein eigenes;
              erst damit geht es hinein.
            </Text>
            <Text style={styles.label}>Neues Passwort</Text>
            <TextInput
              style={styles.input}
              value={neu}
              onChangeText={setNeu}
              placeholderTextColor={colors.inkFaint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              accessibilityLabel="Neues Passwort"
            />
            <Text style={styles.label}>Noch einmal</Text>
            <TextInput
              style={styles.input}
              value={neuWiederholt}
              onChangeText={setNeuWiederholt}
              placeholderTextColor={colors.inkFaint}
              secureTextEntry
              autoCapitalize="none"
              autoCorrect={false}
              textContentType="newPassword"
              accessibilityLabel="Neues Passwort wiederholen"
            />
            {error ? <Text style={styles.error}>{error}</Text> : null}
            <Pressable
              onPress={wechseln}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel="Passwort setzen"
              accessibilityState={{ disabled: busy, busy }}
              style={({ pressed }) => [styles.primary, (pressed || busy) && { opacity: 0.7 }]}
            >
              <Ionicons name="key-outline" size={18} color="#FFFFFF" />
              <Text style={styles.primaryText}>
                {busy ? 'Einen Moment …' : 'Passwort setzen'}
              </Text>
            </Pressable>
          </>
        ) : available === false ? (
          <>
            <Text style={styles.hint}>
              Dieser Hub bietet keine Anmeldung mit Passwort an. Verbinde dich
              mit dem QR-Code oder einem Token.
            </Text>
            <Pressable
              onPress={onUseToken}
              accessibilityRole="button"
              accessibilityLabel="Mit QR-Code verbinden"
              style={styles.primary}
            >
              <Ionicons name="qr-code-outline" size={18} color="#FFFFFF" />
              <Text style={styles.primaryText}>Mit QR-Code verbinden</Text>
            </Pressable>
          </>
        ) : (
          <>
            <Text style={styles.label}>
              {mode === 'recover' ? 'E-Mail-Adresse' : 'Name oder E-Mail-Adresse'}
            </Text>
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={setEmail}
              placeholder={mode === 'recover' ? 'du@example.ch' : 'Maja oder du@example.ch'}
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              textContentType="emailAddress"
              accessibilityLabel={
                mode === 'recover' ? 'E-Mail-Adresse' : 'Name oder E-Mail-Adresse'
              }
            />

            {mode !== 'recover' ? (
              <>
                <Text style={styles.label}>Passwort</Text>
                <TextInput
                  style={styles.input}
                  value={password}
                  onChangeText={setPassword}
                  placeholder=""
                  placeholderTextColor={colors.inkFaint}
                  secureTextEntry
                  autoCapitalize="none"
                  autoCorrect={false}
                  textContentType="password"
                  accessibilityLabel="Passwort"
                />
              </>
            ) : null}

            {error ? <Text style={styles.error}>{error}</Text> : null}
            {note ? <Text style={styles.note}>{note}</Text> : null}

            <Pressable
              onPress={submit}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={mode === 'login' ? 'Anmelden' : 'E-Mail schicken'}
              accessibilityState={{ disabled: busy, busy }}
              style={({ pressed }) => [styles.primary, (pressed || busy) && { opacity: 0.7 }]}
            >
              <Ionicons
                name={mode === 'recover' ? 'mail-outline' : 'log-in-outline'}
                size={18}
                color="#FFFFFF"
              />
              <Text style={styles.primaryText}>
                {busy ? 'Einen Moment …' : mode === 'login' ? 'Anmelden' : 'E-Mail schicken'}
              </Text>
            </Pressable>

            <View style={styles.links}>
              {mode === 'login' ? (
                <Pressable
                  onPress={() => { setMode('recover'); setError(null); }}
                  accessibilityRole="button"
                  accessibilityLabel="Passwort vergessen"
                >
                  <Text style={styles.link}>Passwort vergessen</Text>
                </Pressable>
              ) : (
                <Pressable
                  onPress={() => { setMode('login'); setError(null); }}
                  accessibilityRole="button"
                  accessibilityLabel="Zurück zum Anmelden"
                >
                  <Text style={styles.link}>Zurück zum Anmelden</Text>
                </Pressable>
              )}
            </View>

            <Text style={styles.hint}>
              Noch kein Zugang? Konten legt nur der Besitzer des Hubs an – per
              Einladung oder mit einem Initialpasswort, das du hier beim ersten
              Anmelden gegen ein eigenes tauschst.
            </Text>

            <Pressable
              onPress={onUseToken}
              accessibilityRole="button"
              accessibilityLabel="Stattdessen mit QR-Code oder Token verbinden"
              style={styles.secondary}
            >
              <Ionicons name="qr-code-outline" size={16} color={colors.ink} />
              <Text style={styles.secondaryText}>Stattdessen QR-Code oder Token</Text>
            </Pressable>
          </>
        )}
      </Card>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    screen: { flex: 1, justifyContent: 'center', padding: 22 },
    card: { gap: 10, maxWidth: 460, width: '100%', alignSelf: 'center' },
    title: { color: colors.ink, fontSize: type.greetingSmall, fontWeight: '700' },
    label: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', marginTop: 4 },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 12,
      fontSize: 15,
    },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    error: { color: colors.danger, fontSize: 13, lineHeight: 19, fontWeight: '600' },
    note: { color: colors.on, fontSize: 13, lineHeight: 19, fontWeight: '600' },
    primary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 14,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
      marginTop: 6,
    },
    primaryText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
    links: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 2 },
    link: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    secondary: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 11,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginTop: 4,
    },
    secondaryText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
  });
