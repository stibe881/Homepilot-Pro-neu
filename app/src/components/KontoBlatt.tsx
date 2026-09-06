import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { HubFehler, hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from './Card';
import {
  Geraetesitzung,
  geraeteName,
  geraeteZeile,
  passwortProblem,
  revokedSatz,
  sortiereSitzungen,
} from '../lib/konto';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Selbstverwaltung fürs eigene Konto (Punkt 244 der Werkbank).
 *
 * Zwei Karten, beide auf der Konto-Seite: das Passwort wechseln und
 * «Meine Geräte». Bisher konnte beides nur die Verwaltung – wer sein
 * Passwort ändern wollte, weil es irgendwo gelandet war, musste darum
 * bitten, und statt des vergessenen iPads im Ferienhaus liess sich nur
 * «überall abmelden» drücken, das eigene Telefon inklusive.
 *
 * Die Regeln (Reihenfolge, Zeilentexte, Passwort-Prüfung) stehen in
 * lib/konto.ts; hier ist nur die Anzeige.
 */

/** Das Wenige, was das Blatt vom angemeldeten Benutzer wissen muss.
 *  Lokal statt api/types.ts: `password_set` kommt vom Hub mit, steht
 *  aber (noch) nicht im geteilten User-Typ. */
interface KontoBenutzer {
  name?: string;
  /** Gibt es zu diesem Konto überhaupt einen Passwort-Zugang? */
  password_set?: boolean;
}

export function KontoBlatt({
  settings,
  user,
}: {
  settings: HubSettings;
  user?: KontoBenutzer | null;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  // ── Meine Geräte ──────────────────────────────────────────────────
  const [sitzungen, setSitzungen] = useState<Geraetesitzung[] | null>(null);
  const [geraeteFehler, setGeraeteFehler] = useState<string | null>(null);
  // Zwei-Schritt-Rückfrage: Ein beendetes Gerät muss den QR-Code neu
  // scannen oder sich neu anmelden - das soll kein Wischer auslösen.
  const [beendenAsk, setBeendenAsk] = useState<string | null>(null);
  const [jetzt, setJetzt] = useState(() => Date.now());

  const ladeGeraete = useCallback(() => {
    setGeraeteFehler(null);
    // «still», weil die Karte den Fehler selbst hinschreibt - eine
    // Einblendung obendrauf wäre derselbe Satz zweimal.
    hub
      .get<{ sessions?: Geraetesitzung[] }>('/api/auth/sessions', { still: true })
      .then((antwort) => {
        setSitzungen(sortiereSitzungen(antwort?.sessions ?? []));
        setJetzt(Date.now());
      })
      .catch((err) =>
        setGeraeteFehler(err instanceof HubFehler ? err.message : String(err))
      );
  }, [hub]);

  useEffect(ladeGeraete, [ladeGeraete]);

  const beenden = async (sitzung: Geraetesitzung) => {
    if (beendenAsk !== sitzung.id) {
      setBeendenAsk(sitzung.id);
      return;
    }
    setBeendenAsk(null);
    try {
      await hub.del(`/api/auth/sessions/${encodeURIComponent(sitzung.id)}`, {
        still: true,
      });
    } catch (err) {
      // 404 heisst «gab es schon nicht mehr» - das ist kein Fehler,
      // sondern genau der gewünschte Zustand; das Nachladen unten räumt
      // die Zeile weg. Der generische 404-Satz des Clients («kennt den
      // Weg nicht») führte hier in die Irre.
      if (!(err instanceof HubFehler && err.status === 404)) {
        setGeraeteFehler(err instanceof HubFehler ? err.message : String(err));
      }
    }
    // Auch nach einem Fehlschlag neu laden: Eine Sitzung, die es schon
    // nicht mehr gab, soll aus der Liste verschwinden.
    ladeGeraete();
  };

  // ── Passwort wechseln ─────────────────────────────────────────────
  const [alt, setAlt] = useState('');
  const [neu, setNeu] = useState('');
  const [wiederholt, setWiederholt] = useState('');
  const [passwortFehler, setPasswortFehler] = useState<string | null>(null);
  const [passwortHinweis, setPasswortHinweis] = useState<string | null>(null);
  const [wechselLaeuft, setWechselLaeuft] = useState(false);

  const wechseln = async () => {
    if (wechselLaeuft) return;
    setPasswortHinweis(null);
    const problem = passwortProblem(alt, neu, wiederholt);
    if (problem) {
      setPasswortFehler(problem);
      return;
    }
    setPasswortFehler(null);
    setWechselLaeuft(true);
    try {
      const antwort = await hub.post<{ ok: boolean; revoked?: number }>(
        '/api/auth/passwort-wechsel',
        { old: alt, new: neu },
        { still: true }
      );
      setAlt('');
      setNeu('');
      setWiederholt('');
      setPasswortHinweis(revokedSatz(Number(antwort?.revoked ?? 0)));
      // Die anderen Sitzungen sind soeben gefallen - die Geräteliste
      // darunter soll das zeigen, nicht den Stand von vorhin.
      ladeGeraete();
    } catch (err) {
      // Der Hub schreibt fertige Sätze («Das bisherige Passwort stimmt
      // nicht.») - die gehören unverkürzt hierher.
      setPasswortFehler(err instanceof HubFehler ? err.message : String(err));
    } finally {
      setWechselLaeuft(false);
    }
  };

  return (
    <>
      {user?.password_set ? (
        <Card style={styles.card}>
          <Text style={styles.titel}>Passwort ändern</Text>
          <Text style={styles.hinweis}>
            Danach sind alle anderen Geräte abgemeldet – nur dieses hier
            bleibt drin. Genau richtig, wenn das alte Passwort irgendwo
            gelandet ist, wo es nicht hingehört.
          </Text>
          <Text style={styles.label}>Bisheriges Passwort</Text>
          <TextInput
            style={styles.feld}
            value={alt}
            onChangeText={setAlt}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            accessibilityLabel="Bisheriges Passwort"
            placeholder="••••••••"
            placeholderTextColor={colors.inkFaint}
          />
          <Text style={styles.label}>Neues Passwort</Text>
          <TextInput
            style={styles.feld}
            value={neu}
            onChangeText={setNeu}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            accessibilityLabel="Neues Passwort"
            placeholder="mindestens acht Zeichen"
            placeholderTextColor={colors.inkFaint}
          />
          <Text style={styles.label}>Noch einmal</Text>
          <TextInput
            style={styles.feld}
            value={wiederholt}
            onChangeText={setWiederholt}
            onSubmitEditing={wechseln}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="newPassword"
            accessibilityLabel="Neues Passwort wiederholen"
            placeholder="dasselbe nochmals"
            placeholderTextColor={colors.inkFaint}
          />
          {passwortFehler ? <Text style={styles.fehler}>{passwortFehler}</Text> : null}
          {passwortHinweis ? <Text style={styles.gelungen}>{passwortHinweis}</Text> : null}
          <Pressable
            onPress={wechseln}
            disabled={wechselLaeuft}
            accessibilityRole="button"
            accessibilityLabel="Passwort ändern"
            accessibilityState={{ disabled: wechselLaeuft, busy: wechselLaeuft }}
            style={({ pressed }) => [
              styles.knopf,
              (pressed || wechselLaeuft) && { opacity: 0.7 },
            ]}
          >
            <Ionicons name="key-outline" size={16} color={colors.ink} />
            <Text style={styles.knopfText}>
              {wechselLaeuft ? 'Einen Moment …' : 'Passwort ändern'}
            </Text>
          </Pressable>
        </Card>
      ) : null}

      <Card style={styles.card}>
        <Text style={styles.titel}>Meine Geräte</Text>
        <Text style={styles.hinweis}>
          Alle Anmeldungen deines Kontos. Einzelne beenden wirft nur dieses
          eine Gerät hinaus – es muss sich danach neu anmelden.
        </Text>
        {geraeteFehler ? <Text style={styles.fehler}>{geraeteFehler}</Text> : null}
        {sitzungen === null && !geraeteFehler ? (
          <Text style={styles.hinweis}>Wird geladen …</Text>
        ) : null}
        {sitzungen !== null && sitzungen.length === 0 ? (
          <Text style={styles.hinweis}>
            Keine angemeldeten Geräte – dieses hier ist über ein fest
            gekoppeltes Token verbunden (QR-Code), nicht über eine
            Anmeldung.
          </Text>
        ) : null}
        {(sitzungen ?? []).map((sitzung) => {
          const zeile = geraeteZeile(sitzung, jetzt);
          return (
            <View
              key={sitzung.id}
              style={styles.zeile}
              accessible
              accessibilityLabel={`${geraeteName(sitzung)}, ${zeile}`}
            >
              <Ionicons
                name={
                  sitzung.keep
                    ? 'tablet-landscape-outline'
                    : sitzung.current
                      ? 'phone-portrait'
                      : 'phone-portrait-outline'
                }
                size={20}
                color={sitzung.current ? colors.accent : colors.inkSoft}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.geraet} numberOfLines={1}>
                  {geraeteName(sitzung)}
                </Text>
                <Text
                  style={[styles.zeileText, sitzung.current && { color: colors.accent }]}
                  numberOfLines={1}
                >
                  {zeile}
                </Text>
              </View>
              {/* Das eigene Gerät hat hier keinen Knopf: Wer es beenden
                  will, meint «Abmelden», und der steht im Profil - so
                  räumt niemand versehentlich das Gerät in der eigenen
                  Hand mit ab. */}
              {sitzung.current ? null : (
                <Pressable
                  onPress={() => beenden(sitzung)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    beendenAsk === sitzung.id
                      ? `${geraeteName(sitzung)} wirklich abmelden`
                      : `${geraeteName(sitzung)} abmelden`
                  }
                  style={({ pressed }) => [
                    styles.beenden,
                    beendenAsk === sitzung.id && { borderColor: colors.danger },
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Text
                    style={[
                      styles.beendenText,
                      beendenAsk === sitzung.id && { color: colors.danger },
                    ]}
                  >
                    {beendenAsk === sitzung.id ? 'Wirklich?' : 'Beenden'}
                  </Text>
                </Pressable>
              )}
            </View>
          );
        })}
      </Card>
    </>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    titel: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hinweis: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    label: { color: colors.inkSoft, fontSize: type.cardSub, fontWeight: '600' },
    feld: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 11,
      fontSize: 16,
    },
    fehler: { color: colors.danger, fontSize: 13, lineHeight: 18 },
    gelungen: { color: colors.on, fontSize: 13, lineHeight: 18 },
    knopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surfaceSoft,
    },
    knopfText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingTop: 8,
      borderTopWidth: StyleSheet.hairlineWidth,
      borderTopColor: colors.surfaceBorder,
    },
    geraet: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    zeileText: { color: colors.inkFaint, fontSize: 12, marginTop: 1 },
    beenden: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    beendenText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  });
