import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { HubFehler, hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Klappe } from '../components/Klappe';
import { RenameDialog } from '../components/entity/anpassen';
import {
  Box,
  boxName,
  boxSchluessel,
  boxStand,
  boxZeile,
  boxenSortiert,
  uebersichtSatz,
} from '../lib/lautsprecher';
import { Colors, radius, space, type, useColors } from '../theme';

/**
 * Lautsprecher: was im Netz steht, was der Hub kennt, und welche davon
 * Gruppen sind.
 *
 * Zur Einordnung, weil es die Kernfrage ist: Mehrere Boxen spielen nur
 * dann wirklich gleichzeitig, wenn sie eine echte Google-Lautsprecher-
 * gruppe bilden. Google gleicht darin die Uhren der Boxen ab; von aussen
 * an mehrere Boxen zu senden ergäbe hörbaren Versatz. Eine solche Gruppe
 * entsteht einmalig in der Google-Home-App und meldet sich danach im Netz
 * als ein einzelnes Gerät – der Hub kann sie benutzen, aber nicht selbst
 * herstellen.
 *
 * **Umgebaut**, weil die Seite aus vier gleich aussehenden Karten
 * bestand - «Gruppen», «Einzelne Boxen», «Eingebunden, aber nicht
 * gefunden» und «Einbinden» -, und keine davon die Frage beantwortete,
 * mit der man herkommt: Kennt der Hub die Box im Wohnzimmer schon? Man
 * musste zwei Listen durchgehen und je Zeile ein kleines Wort am rechten
 * Rand lesen. Der Knopf, den man wirklich sucht («erneut suchen»), stand
 * zuunterst in einem Absatz Erklärung.
 *
 * Jetzt: ein Satz und der Suchknopf zuoberst, darunter *eine* Liste, in
 * der jede Box ihren Zustand als Farbe und Wort trägt, und die
 * Erklärungen hinter einer Klappe. Was entscheidbar ist - Stand,
 * Übersichtssatz, Reihenfolge - steht in lib/lautsprecher.ts und hat
 * dort seine Tests.
 */

export function SpeakersScreen({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [speakers, setSpeakers] = useState<Box[] | null>(null);
  const [configured, setConfigured] = useState<string[]>([]);
  const [members, setMembers] = useState<Record<string, string[]>>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Was gerade eingetragen wird, und was ein Neustart noch braucht.
  const [adopting, setAdopting] = useState<string | null>(null);
  const [pending, setPending] = useState<string[]>([]);
  /** Welche Box gerade umbenannt wird - öffnet den Dialog. */
  const [renameFor, setRenameFor] = useState<Box | null>(null);
  const [restarting, setRestarting] = useState(false);

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}` }
    : {};

  // Das Übernehmen unten bleibt ein roher fetch-Aufruf: Seine
  // Fehlermeldung kommt aus dem detail-Feld der Hub-Antwort.
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const load = useCallback(() => {
    setBusy(true);
    setError(null);
    hub
      .get<{ speakers?: Box[]; configured?: string[] }>('/api/speakers', {
        still: true,
      })
      .then((data) => {
        setSpeakers(data.speakers ?? []);
        setConfigured(data.configured ?? []);
      })
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)))
      .finally(() => setBusy(false));
  }, [hub]);

  useEffect(load, [load]);

  /** Mitglieder einer Gruppe nachladen – nur auf Wunsch, das kostet
   *  jeweils eine Verbindung zur Box. */
  const loadMembers = async (entry: Box) => {
    const id = boxSchluessel(entry);
    const data = await hub.get<{ members?: string[] }>(
      `/api/speakers/members?host=${encodeURIComponent(entry.host)}` +
        `&port=${entry.port ?? 8009}`,
      { fallback: { members: [] }, still: true }
    );
    setMembers((prev) => ({ ...prev, [id]: data.members ?? [] }));
  };

  /** Fehlertexte des Hubs lesbar machen – bei Eingabefehlern liefert
   *  FastAPI eine Liste von Objekten statt eines Satzes. */
  const detailText = (data: { detail?: unknown }, status: number): string => {
    const detail = data?.detail;
    if (typeof detail === 'string') return detail;
    if (Array.isArray(detail)) {
      return detail
        .map((entry: { msg?: string }) => entry?.msg ?? JSON.stringify(entry))
        .join(', ');
    }
    return `Hub antwortet mit ${status}`;
  };

  /** Eine gefundene Box in die config.yaml eintragen – der Hub ergänzt dort
   *  zwei Zeilen und lässt den Rest der Datei in Ruhe. */
  const adopt = async (entry: Box) => {
    if (!entry.host) {
      // Kommt bei Gruppen vor, deren Adresse das Netz gerade nicht meldet –
      // ohne Adresse gibt es nichts einzutragen.
      setError(
        `Für «${entry.name}» meldet das Netz keine Adresse. Die Gruppe in der ` +
          'Google-Home-App einmal kurz bespielen, dann hier erneut suchen.'
      );
      return;
    }
    setAdopting(boxSchluessel(entry));
    setError(null);
    try {
      const response = await fetch(`${settings.url}/api/speakers/adopt`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: entry.name,
          host: entry.host,
          port: entry.port ?? 8009,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(detailText(data, response.status));
      }
      setPending((prev) => (prev.includes(entry.name) ? prev : [...prev, entry.name]));
      load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    } finally {
      setAdopting(null);
    }
  };

  /** Eine eingebundene Box umbenennen - als Anzeigename der Entität.
   *
   *  Derselbe Weg wie der Stift auf der Gerätekachel (PUT …/meta): Der
   *  Name gilt damit überall in der App - Musikkarte, Boxenwahl,
   *  Durchsagen. Das Verschieben der Musik bricht dabei nicht: Der Hub
   *  übersetzt an der Spotify-Grenze zwischen Netz- und Anzeigename
   *  (integrations/spotify.py, `uebersetzte_namen`). Leer speichern
   *  stellt den Netz-Namen wieder her. */
  const rename = async (entry: Box, name: string) => {
    setRenameFor(null);
    if (!entry.entity_id) return;
    try {
      await hub.put(`/api/entities/${encodeURIComponent(entry.entity_id)}/meta`, {
        name,
      });
      load();
    } catch (err) {
      setError(err instanceof HubFehler ? err.message : String(err));
    }
  };

  /** Hub neu starten, damit frisch eingetragene Boxen erscheinen. */
  const restartNow = async () => {
    setRestarting(true);
    // Die Verbindung reisst beim Neustart sowieso ab – kein Fehler.
    await hub.post('/api/system/restart', undefined, { fallback: null, still: true });
  };

  // Nur wenn schon die erste Suche scheitert, gibt es nichts zu zeigen.
  // Fehler bei einer Aktion erscheinen als Banner über der Liste – vorher
  // ersetzten sie die ganze Seite, und ein Fehlschlag sah aus wie «nichts
  // passiert».
  if (error && speakers == null) {
    return <Text style={styles.note}>Lautsprecher nicht abrufbar: {error}</Text>;
  }

  const liste = boxenSortiert(speakers ?? []);
  const missing = configured.filter(
    (name) => !(speakers ?? []).some((entry) => entry.name === name)
  );

  /** Eine Zeile der Liste: Symbol, Name, Nebensatz - und rechts das,
   *  was man mit ihr tun kann. */
  const Zeile = ({ entry, erste }: { entry: Box; erste?: boolean }) => {
    const id = boxSchluessel(entry);
    const stand = boxStand(entry, pending);
    const drin = stand === 'eingebunden';
    return (
      // Die Trennlinie sitzt oben, also nicht an der ersten Zeile - sonst
      // liegt ein Strich direkt unter dem Kartenrand.
      <View style={[styles.zeile, erste && styles.zeileErste]}>
        <View style={[styles.symbol, drin && styles.symbolAn]}>
          <Ionicons
            name={entry.group ? 'people' : 'volume-medium'}
            size={18}
            color={drin ? colors.on : colors.inkSoft}
          />
        </View>
        <View style={styles.zeileText}>
          <Text style={styles.name} numberOfLines={1}>
            {boxName(entry)}
          </Text>
          <Text style={styles.unterzeile} numberOfLines={2}>
            {boxZeile(entry, members[id])}
          </Text>
          {/* Wer in einer Gruppe steckt, sieht man sonst nirgends - und
              es ist die Frage, die man bei «Erdgeschoss» wirklich hat.
              Der Abruf kostet eine Verbindung zur Box, deshalb erst auf
              Tippen. */}
          {entry.group && !members[id] ? (
            <Pressable
              onPress={() => loadMembers(entry)}
              accessibilityRole="button"
              accessibilityLabel={`Mitglieder von ${boxName(entry)} zeigen`}
              hitSlop={6}
            >
              <Text style={styles.leiser}>Wer ist dabei?</Text>
            </Pressable>
          ) : null}
        </View>

        {stand === 'neu' ? (
          <Pressable
            onPress={() => adopt(entry)}
            accessibilityRole="button"
            accessibilityLabel={`${boxName(entry)} übernehmen`}
            disabled={adopting != null}
            style={({ pressed }) => [styles.adopt, pressed && { opacity: 0.8 }]}
          >
            <Ionicons
              name={adopting === id ? 'hourglass-outline' : 'add'}
              size={15}
              color="#FFFFFF"
            />
            <Text style={styles.adoptText}>Übernehmen</Text>
          </Pressable>
        ) : stand === 'wartet' ? (
          <Text style={styles.badgeWait}>nach Neustart</Text>
        ) : (
          <>
            <Text style={styles.badgeOk}>eingebunden</Text>
            <Pressable
              onPress={() => setRenameFor(entry)}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={`${boxName(entry)} umbenennen`}
            >
              <Ionicons name="pencil-outline" size={18} color={colors.inkSoft} />
            </Pressable>
          </>
        )}
      </View>
    );
  };

  return (
    <View style={styles.list}>
      {error ? <Text style={styles.errorBanner}>{error}</Text> : null}

      {/* Zuoberst, was man beim Herkommen wissen will - und der einzige
          Knopf, den man hier regelmässig braucht. Er stand vorher am
          Fuss der Seite, unter einem Absatz Erklärung. */}
      <Card style={styles.card}>
        <View style={styles.kopf}>
          <View style={styles.kopfText}>
            <Text style={styles.heading}>Lautsprecher im Netz</Text>
            <Text style={styles.uebersicht}>{uebersichtSatz(speakers, missing)}</Text>
          </View>
          <Pressable
            onPress={load}
            accessibilityRole="button"
            accessibilityLabel="Erneut nach Boxen suchen"
            disabled={busy}
            style={({ pressed }) => [styles.suchen, pressed && { opacity: 0.85 }]}
          >
            <Ionicons
              name={busy ? 'hourglass-outline' : 'refresh'}
              size={16}
              color="#FFFFFF"
            />
            <Text style={styles.suchenText}>{busy ? 'Sucht …' : 'Suchen'}</Text>
          </Pressable>
        </View>

        {/* Der Neustart-Hinweis gehört zuoberst und nicht in eine eigene
            Karte: Er ist eine offene Aufgabe, keine Auskunft. */}
        {pending.length > 0 ? (
          <View style={styles.wartend}>
            <Text style={styles.wait}>
              Eingetragen: {pending.join(', ')}. Als Gerät sichtbar wird das erst
              nach einem Neustart des Hubs.
            </Text>
            <Pressable
              onPress={restartNow}
              accessibilityRole="button"
              disabled={restarting}
              style={({ pressed }) => [
                styles.button,
                (pressed || restarting) && { opacity: 0.7 },
              ]}
            >
              <Ionicons name="refresh-circle-outline" size={16} color="#FFFFFF" />
              <Text style={styles.buttonText}>
                {restarting ? 'Hub startet neu …' : 'Jetzt neu starten'}
              </Text>
            </Pressable>
            {restarting ? (
              <Text style={styles.hint}>
                Die Verbindung reisst dabei kurz ab und kommt von selbst wieder.
              </Text>
            ) : null}
          </View>
        ) : null}
      </Card>

      {/* Eine Liste statt zweier Karten. Gruppen stehen vorn und tragen
          ihr eigenes Symbol - das ist der Unterschied, auf den es
          ankommt, und dafür braucht es keine zweite Überschrift. */}
      <Card style={styles.card}>
        {speakers == null ? (
          <Text style={styles.hint}>Wird gesucht …</Text>
        ) : liste.length === 0 ? (
          <Text style={styles.hint}>
            Keine Box im Netz gefunden. Boxen melden sich nur im selben Netz wie
            der Hub – ein Gäste-WLAN oder ein zweiter Router trennt sie.
          </Text>
        ) : (
          liste.map((entry, index) => (
            <Zeile key={boxSchluessel(entry)} entry={entry} erste={index === 0} />
          ))
        )}

        {/* Vermisste stehen in derselben Liste, nur blass: Sie sind
            eingebunden, aber gerade nicht da - das gehört neben die
            anderen und nicht in eine eigene Karte am Seitenende. Der
            Grund steht einmal darunter und nicht in jeder Zeile: Er ist
            für alle derselbe. */}
        {missing.length > 0 ? (
          <>
            <Text style={styles.abschnitt}>Nicht im Netz gesehen</Text>
            {missing.map((name, index) => (
              // Die Überschrift bringt den Strich schon mit - nur die
              // zweite Zeile und die folgenden brauchen einen eigenen.
              <View
                key={`fehlt:${name}`}
                style={[styles.zeile, index === 0 && styles.zeileErste]}
              >
                <View style={styles.symbol}>
                  <Ionicons
                    name="cloud-offline-outline"
                    size={18}
                    color={colors.inkFaint}
                  />
                </View>
                <View style={styles.zeileText}>
                  <Text
                    style={[styles.name, { color: colors.inkFaint }]}
                    numberOfLines={1}
                  >
                    {name}
                  </Text>
                </View>
              </View>
            ))}
            <Text style={styles.hint}>
              Diese Boxen kennt der Hub aus der config.yaml – die Suche hat sie
              aber nicht gesehen. Sie sind aus, woanders eingesteckt oder in
              einem anderen Netz.
            </Text>
          </>
        ) : null}
      </Card>

      {/* Die Erklärungen: dreimal ein Absatz, den man einmal liest und
          danach nie wieder. Zugeklappt stehen sie niemandem im Weg und
          sind trotzdem da, wenn die Gruppe fehlt. */}
      <Card style={styles.card}>
        <Klappe label="Warum Gruppen in der Google-Home-App entstehen">
          <Text style={styles.hint}>
            Eine Gruppe spielt auf allen Boxen gleichzeitig – Google gleicht
            dafür die Uhren der Boxen ab. Genau deshalb entsteht sie dort und
            nicht hier: Von aussen an mehrere Boxen zu senden ergäbe hörbaren
            Versatz. In der Google-Home-App: «Hinzufügen» → «Lautsprechergruppe
            erstellen», Boxen auswählen und benennen. Danach hier suchen – die
            Gruppe erscheint wie eine einzelne Box und lässt sich im Player
            auswählen.
          </Text>
        </Klappe>
        <Klappe label="Was «Übernehmen» tut">
          <Text style={styles.hint}>
            Es trägt die Box mit Namen und Adresse in die config.yaml ein – der
            Hub ergänzt dort zwei Zeilen und lässt den Rest der Datei samt
            Kommentaren, wie er ist. Wirksam wird der Eintrag beim nächsten
            Neustart; bis dahin steht «nach Neustart» daneben. Eine Gruppe wird
            genauso eingetragen wie eine einzelne Box – für den Hub ist sie ein
            Gerät.
          </Text>
        </Klappe>
        <Klappe label="Umbenennen">
          <Text style={styles.hint}>
            Der Stift benennt eine eingebundene Box für die App um – der Name
            gilt überall, auch in der Musikkarte und bei Durchsagen. Der Name aus
            der Google-Home-App bleibt im Netz bestehen und steht dann klein
            darunter. Leer speichern stellt ihn wieder her.
          </Text>
        </Klappe>
      </Card>

      <RenameDialog
        visible={renameFor != null}
        current={renameFor ? boxName(renameFor) : ''}
        onClose={() => setRenameFor(null)}
        onSubmit={(name) => {
          if (renameFor) rename(renameFor, name);
        }}
      />
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    list: { gap: space.gap },
    card: { minHeight: 0, gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    note: { color: colors.onGradientSoft, fontSize: 14, marginTop: 20 },
    wait: { color: colors.warn, fontSize: 12, lineHeight: 18, fontWeight: '600' },
    /** Kopf: Titel und Zahl links, der Suchknopf rechts auf derselben
     *  Höhe – er ist die Handlung, die zu dieser Auskunft gehört. */
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    kopfText: { flex: 1, gap: 2 },
    uebersicht: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    wartend: {
      gap: 10,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    zeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
      paddingVertical: 10,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    zeileErste: { borderTopWidth: 0, paddingTop: 0 },
    zeileText: { flex: 1, gap: 2 },
    /** Die leise Überschrift über den vermissten Boxen - gross genug,
     *  dass die blassen Zeilen darunter nicht wie ein Fehler aussehen. */
    abschnitt: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    /** Das Symbol im Kreis: eingebunden trägt den grünen Ton, alles
     *  andere bleibt grau. Der Zustand ist damit schon von weitem zu
     *  sehen, ohne das Wort am rechten Rand zu lesen. */
    symbol: {
      width: 38,
      height: 38,
      borderRadius: 19,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSoft,
    },
    symbolAn: { backgroundColor: colors.surfaceStrong },
    name: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    unterzeile: { color: colors.inkSoft, fontSize: 12, lineHeight: 17 },
    leiser: { color: colors.accent, fontSize: 12, fontWeight: '600', paddingTop: 2 },
    badgeWait: { color: colors.warn, fontSize: 11, fontWeight: '700' },
    badgeOk: { color: colors.on, fontSize: 11, fontWeight: '700' },
    /** «Übernehmen» ist die Handlung dieser Seite und sieht jetzt danach
     *  aus: gefüllt statt als blasser Umriss neben zwei anderen Symbolen. */
    adopt: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    adoptText: { color: '#FFFFFF', fontSize: 12, fontWeight: '700' },
    suchen: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    suchenText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    errorBanner: {
      color: colors.danger,
      fontSize: 13,
      fontWeight: '600',
      lineHeight: 19,
    },
    button: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      backgroundColor: colors.accent,
      borderRadius: radius.control,
      paddingVertical: 12,
    },
    buttonText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  });
