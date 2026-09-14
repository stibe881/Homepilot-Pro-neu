import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity } from '../api/types';
import { useSettings } from '../hooks/HubContext';
import {
  KOPPLUNGS_TEXTE,
  KopplungsStand,
  PIN_LAENGE,
  adresseBrauchbar,
  adresseSauber,
  kopplungsSchritt,
  pinSauber,
  pinVollstaendig,
} from '../lib/playstation';
import { Colors, radius, useColors } from '../theme';

/**
 * «Konsole koppeln» unter Einstellungen → Verbindungen - Punkt 643.
 *
 * Nach dem Muster von TvKopplung, aber mit zwei Schritten statt einem,
 * weil die PlayStation zweierlei verlangt: das PSN-Konto (einmal im
 * Browser anmelden, die Adresse der Seite danach hierher kopieren) und
 * die Registrierung an der Konsole (achtstelliger Code aus ihren
 * Einstellungen). Welcher Schritt dran ist, sagt der Hub
 * (`GET /api/playstation/{id}/pair`) - nicht die App: Ein Konto, das
 * schon liegt, soll niemand ein zweites Mal anmelden müssen.
 *
 * Der Umweg über die Adresse ist kein schöner, aber der einzige: Sony
 * leitet nach der Anmeldung auf eine Seite um, die es nicht gibt, und
 * nur in ihrer Adresse steckt der Code. Ein Browser in der App könnte
 * ihn abfangen - das wäre ein natives Modul und ein TestFlight-Build
 * für einen Schritt, den man einmal im Leben der Konsole macht.
 */
export function PsKopplung({
  entity,
  dringend = true,
}: {
  entity: Entity;
  /** Der Hub meldet die Kopplung als fehlend: dann ein sichtbarer
   *  Kasten. Sonst nur eine ruhige Zeile, die man aufklappt - «Neu
   *  koppeln» wirft Konto und Registrierung weg, das soll kein
   *  Danebentippen auslösen. */
  dringend?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const settings = useSettings();
  const [aufgeklappt, setAufgeklappt] = useState(false);
  const [stand, setStand] = useState<KopplungsStand | null>(null);
  const [geladen, setGeladen] = useState(false);
  // Die Anmeldeseite ist offen; jetzt fehlt die Rückkehr-Adresse.
  const [adresse, setAdresse] = useState('');
  const [pin, setPin] = useState('');
  const [laeuft, setLaeuft] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);
  const [fertig, setFertig] = useState(false);

  const pfad = `/api/playstation/${encodeURIComponent(entity.id)}/pair`;
  const offen = dringend || aufgeklappt;

  // `still`, weil die Absage hier neben dem Feld steht und nicht als
  // Einblendung darüber: «Der Code stimmt nicht» gehört dorthin, wo man
  // ihn getippt hat.
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const nachsehen = useCallback(async () => {
    try {
      const antwort = await hub.get<KopplungsStand>(pfad, { still: true });
      setStand(antwort);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Der Hub antwortet nicht.');
    } finally {
      setGeladen(true);
    }
  }, [hub, pfad]);

  // Erst nachsehen, wenn der Kasten offen ist: Die zusammengeklappte
  // Zeile braucht den Stand nicht, und auf der Verbindungen-Seite
  // sollen nicht alle Karten beim Öffnen den Hub fragen.
  useEffect(() => {
    if (offen && !geladen) void nachsehen();
  }, [offen, geladen, nachsehen]);

  const schritt = kopplungsSchritt(stand);

  const anmeldungOeffnen = async (neu: boolean) => {
    if (laeuft) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const antwort = await hub.post<{ ok: boolean; login_url: string }>(
        pfad,
        { neu },
        { still: true }
      );
      if (neu) {
        // Der Hub hat Konto und Registrierung verworfen - das Blatt
        // soll es sofort wissen und nicht erst nach einem Neuladen.
        setStand({ account: false, paired: false, online_id: null, remote_play: true });
        setFertig(false);
        setPin('');
      }
      setAdresse('');
      await Linking.openURL(antwort.login_url);
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      setLaeuft(false);
    }
  };

  const kontoUebernehmen = async () => {
    if (laeuft || !adresseBrauchbar(adresse)) return;
    setLaeuft(true);
    setFehler(null);
    try {
      const antwort = await hub.post<{ ok: boolean; online_id: string | null }>(
        `${pfad}/account`,
        { redirect_url: adresseSauber(adresse) },
        { still: true }
      );
      setStand((alt) => ({
        account: true,
        paired: false,
        online_id: antwort?.online_id ?? null,
        remote_play: alt?.remote_play ?? true,
      }));
      setAdresse('');
    } catch (err) {
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      setLaeuft(false);
    }
  };

  const koppeln = async () => {
    if (laeuft || !pinVollstaendig(pin)) return;
    setLaeuft(true);
    setFehler(null);
    try {
      await hub.post(`${pfad}/pin`, { pin: pinSauber(pin) }, { still: true });
      // Der Hub meldet den neuen Stand gleich über den WebSocket; bis
      // dahin soll hier trotzdem etwas anderes stehen als der Knopf,
      // den man gerade gedrückt hat.
      setStand((alt) => (alt ? { ...alt, paired: true } : alt));
      setFertig(true);
      setPin('');
    } catch (err) {
      // Ein falscher Code gilt an der Konsole weiter - sie zeigt
      // denselben, bis man das Menü verlässt. Also bleibt das Feld
      // stehen, nur leer: Der Tippfehler ist wahrscheinlicher als ein
      // neuer Code.
      setPin('');
      setFehler(err instanceof Error ? err.message : 'Das hat nicht geklappt.');
    } finally {
      setLaeuft(false);
    }
  };

  // Solange nichts klemmt, steht hier eine Zeile und kein Kasten: Der
  // Weg soll auffindbar sein, ohne sich vorzudrängen.
  if (!offen && !fertig) {
    return (
      <Pressable
        onPress={() => setAufgeklappt(true)}
        accessibilityRole="button"
        accessibilityLabel="Konsole koppeln"
        style={({ pressed }) => [styles.zeile, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="link-outline" size={15} color={colors.inkSoft} />
        <Text style={styles.zeileText}>Konsole koppeln</Text>
        <Ionicons name="chevron-down" size={16} color={colors.inkFaint} />
      </Pressable>
    );
  }

  const texte = KOPPLUNGS_TEXTE[schritt];
  const kopfText = fertig
    ? 'Gekoppelt – die Konsole meldet sich gleich.'
    : !geladen
      ? 'Einen Moment …'
      : dringend && schritt !== 'gekoppelt'
        ? `Nicht gekoppelt · ${texte.kopf}`
        : texte.kopf;

  return (
    <View style={[styles.box, !dringend && { borderColor: colors.surfaceBorder }]}>
      <View style={styles.kopf}>
        <Ionicons
          name="link-outline"
          size={15}
          color={dringend ? colors.warn : colors.inkSoft}
        />
        <Text style={[styles.kopfText, !dringend && { color: colors.ink }]}>
          {kopfText}
        </Text>
        {!dringend ? (
          <Pressable
            onPress={() => {
              setAufgeklappt(false);
              setFehler(null);
            }}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel="Zuklappen"
          >
            <Ionicons name="chevron-up" size={16} color={colors.inkFaint} />
          </Pressable>
        ) : null}
      </View>

      {geladen && schritt === 'ohne_bibliothek' ? (
        <Text style={styles.hinweis}>{texte.hinweis}</Text>
      ) : null}

      {geladen && schritt === 'konto' ? (
        <>
          <Text style={styles.hinweis}>{texte.hinweis}</Text>
          <Pressable
            onPress={() => anmeldungOeffnen(false)}
            disabled={laeuft}
            accessibilityRole="button"
            accessibilityLabel="PSN-Anmeldung öffnen"
            style={({ pressed }) => [styles.knopf, (pressed || laeuft) && { opacity: 0.6 }]}
          >
            <Text style={styles.knopfText}>
              {laeuft ? 'Einen Moment …' : 'PSN-Anmeldung öffnen'}
            </Text>
          </Pressable>
          <TextInput
            style={styles.adresseFeld}
            value={adresse}
            onChangeText={setAdresse}
            onSubmitEditing={kontoUebernehmen}
            placeholder="Adresse der Seite nach der Anmeldung hier einfügen"
            placeholderTextColor={colors.inkFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            returnKeyType="go"
            accessibilityLabel="Adresse der Seite nach der Anmeldung"
          />
          <Pressable
            onPress={kontoUebernehmen}
            disabled={laeuft || !adresseBrauchbar(adresse)}
            accessibilityRole="button"
            accessibilityLabel="Konto übernehmen"
            accessibilityState={{ disabled: laeuft || !adresseBrauchbar(adresse) }}
            style={({ pressed }) => [
              styles.knopf,
              (pressed || laeuft || !adresseBrauchbar(adresse)) && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.knopfText}>
              {laeuft ? 'Einen Moment …' : 'Konto übernehmen'}
            </Text>
          </Pressable>
        </>
      ) : null}

      {geladen && schritt === 'code' ? (
        <>
          <Text style={styles.hinweis}>
            {stand?.online_id ? `Konto: ${stand.online_id}. ` : ''}
            {texte.hinweis}
          </Text>
          <TextInput
            style={styles.feld}
            value={pin}
            onChangeText={(text) => setPin(pinSauber(text))}
            onSubmitEditing={koppeln}
            placeholder={'0'.repeat(PIN_LAENGE)}
            placeholderTextColor={colors.inkFaint}
            keyboardType="number-pad"
            autoCorrect={false}
            maxLength={PIN_LAENGE}
            returnKeyType="go"
            accessibilityLabel="Code von der Konsole"
          />
          <Pressable
            onPress={koppeln}
            disabled={laeuft || !pinVollstaendig(pin)}
            accessibilityRole="button"
            accessibilityLabel="Koppeln"
            accessibilityState={{ disabled: laeuft || !pinVollstaendig(pin) }}
            style={({ pressed }) => [
              styles.knopf,
              (pressed || laeuft || !pinVollstaendig(pin)) && { opacity: 0.5 },
            ]}
          >
            <Text style={styles.knopfText}>{laeuft ? 'Einen Moment …' : 'Koppeln'}</Text>
          </Pressable>
        </>
      ) : null}

      {geladen && schritt === 'gekoppelt' && !fertig ? (
        <Text style={styles.hinweis}>
          {stand?.online_id ? `Konto: ${stand.online_id}. ` : ''}
          {texte.hinweis}
        </Text>
      ) : null}

      {/* Der Ausweg, wenn es hakt: Konto und Registrierung weg, von
          vorn. Nicht im ersten Schritt - dort gibt es noch nichts
          wegzuwerfen - und nicht ohne Bibliothek. */}
      {geladen && (schritt === 'code' || schritt === 'gekoppelt') ? (
        <Pressable
          onPress={() => anmeldungOeffnen(true)}
          disabled={laeuft}
          accessibilityRole="button"
          accessibilityLabel="Neu koppeln"
          style={({ pressed }) => [styles.neuKnopf, pressed && { opacity: 0.6 }]}
        >
          <Text style={styles.neuText}>
            {schritt === 'code'
              ? 'Anderes Konto? Neu koppeln'
              : 'Klappt nicht? Neu koppeln'}
          </Text>
        </Pressable>
      ) : null}

      {fehler ? <Text style={styles.fehler}>{fehler}</Text> : null}
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    zeileText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600', flex: 1 },
    box: {
      gap: 8,
      padding: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.warn,
      backgroundColor: colors.surfaceSoft,
    },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 6 },
    kopfText: { color: colors.warnInk, fontSize: 13, fontWeight: '700', flex: 1 },
    hinweis: { color: colors.inkSoft, fontSize: 12, lineHeight: 18 },
    feld: {
      backgroundColor: colors.panel,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 14,
      paddingVertical: 10,
      fontSize: 20,
      letterSpacing: 4,
      textAlign: 'center',
    },
    // Die Adresse ist lang und klein - kein Ziffernfeld mit Sperrung.
    adresseFeld: {
      backgroundColor: colors.panel,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 13,
    },
    knopf: {
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    knopfText: { color: colors.onAccent, fontSize: 14, fontWeight: '700' },
    neuKnopf: { alignItems: 'center', paddingVertical: 4 },
    neuText: { color: colors.inkFaint, fontSize: 12, textDecorationLine: 'underline' },
    fehler: { color: colors.danger, fontSize: 12, lineHeight: 17 },
  });
