/**
 * Die Konfiguration des Hubs – zum Ansehen, Antippen und Ändern.
 *
 * Bisher war das ein Textfeld mit siebenhundert Zeilen YAML. Das ist
 * mächtig und es bleibt: Wer weiss, was er tut, kommt damit überall hin.
 * Für alles andere ist es die falsche Frage – man wollte die Hausadresse
 * eintragen und musste erst herausfinden, wo `location` steht und wie
 * tief man einrücken muss.
 *
 * Also zwei Ansichten auf dieselbe Datei:
 *
 *   **Übersicht** – je Abschnitt eine Karte mit dem, was drinsteht.
 *   Handverlesene Felder (Adresse, Port, Strompreis) sind einzeln
 *   änderbar; Anbindungen lassen sich ein- und ausschalten; alles
 *   Übrige öffnet man als Block, also mit seinen paar Zeilen statt der
 *   ganzen Datei.
 *
 *   **Text** – unverändert das, was es vorher gab.
 *
 * Beide arbeiten am selben Text und teilen sich Prüfen, Speichern,
 * Neustart, Verlauf und Backup. Der Umweg ist Absicht: Der Hub *rechnet*
 * die Änderung (POST /api/config/edit) und *speichert* sie über denselben
 * Weg wie eine getippte (PUT /api/config) – mit Prüfung, Verlauf und
 * allem. Es gibt keinen zweiten Weg auf die Platte.
 *
 * Und keine Neuformatierung: Der Hub ändert Zeilen an Ort und Stelle.
 * Kommentare, Reihenfolge und die Leerzeile, die jemand bewusst gesetzt
 * hat, bleiben – die config.yaml gehört dem, der sie geschrieben hat.
 */

import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useRef, useState } from 'react';
import { Modal, Pressable, ScrollView, Share, StyleSheet, Text, TextInput, View } from 'react-native';

import { hubClient } from '../../api/client';
import { ConfigVersion, HubSettings } from '../../api/types';
import { Card } from '../../components/Card';
import {
  Abschnitt,
  Anbindung,
  Daten,
  Feld,
  alsText,
  eingabeWert,
  feldergruppe,
  maskiert,
  wertVon,
  zeilen,
  zusammenfassung,
} from '../../lib/konfig';
import { datumUhr } from '../../lib/format';
import { Colors, radius, type, useColors } from '../../theme';

type Styles = ReturnType<typeof makeStyles>;

interface Gliederung {
  content: string;
  sections: Abschnitt[];
  data: Daten;
  error?: string;
}

export function ConfigCard({ settings }: { settings: HubSettings }) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const [gliederung, setGliederung] = useState<Gliederung | null>(null);
  // Der Text, an dem beide Ansichten arbeiten. Getrennt von der
  // Gliederung, weil er sich mit jeder Änderung ändert – die Gliederung
  // erst wieder beim Laden.
  const [content, setContent] = useState<string | null>(null);
  // Derselbe Text als Ref: Wer zwei Schalter kurz hintereinander tippt,
  // löste sonst zwei Anfragen aus, die beide vom Stand *vor* der ersten
  // ausgehen – die zweite Antwort überschriebe die erste Änderung.
  const contentRef = useRef<string | null>(null);
  const setzeText = (text: string) => {
    contentRef.current = text;
    setContent(text);
  };
  const [modus, setModus] = useState<'gui' | 'text'>('gui');
  const [offen, setOffen] = useState<string | null>(null);
  const [block, setBlock] = useState<
    { titel: string; start: number; end: number; text: string } | null
  >(null);
  const [message, setMessage] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [warnings, setWarnings] = useState<string[]>([]);
  const [versions, setVersions] = useState<ConfigVersion[] | null>(null);
  // Ungespeichertes: Die Gliederung stammt vom Stand auf der Platte.
  const geaendert = gliederung != null && content != null && content !== gliederung.content;

  const load = () => {
    setMessage(null);
    hub
      .get<Gliederung>('/api/config/outline', { still: true })
      .then((daten) => {
        setGliederung(daten);
        setzeText(daten.content);
        if (daten.error) {
          setMessage(
            `Die Datei lässt sich nicht lesen (${daten.error}). Die Übersicht zeigt, ` +
              'was sich aus dem Text ablesen lässt – ändern lässt sie sich im Textmodus.'
          );
        }
      })
      .catch((err) => setMessage(String(err instanceof Error ? err.message : err)));
  };

  /**
   * Eine Änderung vom Hub rechnen lassen – gespeichert wird sie nicht.
   *
   * Zurück kommt immer auch die neue Gliederung: Ihre Zeilennummern
   * gelten für genau diesen Text. Ohne das zeigte der Blockeditor nach
   * der ersten Änderung auf Zeilen, die inzwischen woanders stehen.
   */
  const rechne = async (auftrag: Record<string, unknown>, still = false) => {
    const stand = contentRef.current;
    if (stand == null) return;
    setBusy(true);
    try {
      const body = await hub.post<Gliederung>(
        '/api/config/edit',
        { content: stand, ...auftrag },
        { still: true }
      );
      setzeText(body.content);
      // Die Gliederung mitziehen, aber den gespeicherten Stand nicht
      // vergessen – daran hängt die Anzeige «ungespeichert».
      setGliederung((alt) =>
        alt ? { ...alt, sections: body.sections, data: body.data, error: body.error } : alt
      );
      if (!still) setMessage('Geändert – noch nicht gespeichert.');
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const save = async (restart: boolean) => {
    if (content == null) return;
    setBusy(true);
    setMessage(null);
    try {
      // Die genaue Validierungsmeldung des Hubs steckt im detail-Feld –
      // die rohe Antwort lesen, statt sie im Client zu verlieren.
      const response = await fetch(`${settings.url}/api/config`, {
        method: 'PUT',
        headers: {
          Authorization: `Bearer ${settings.token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ content }),
      });
      if (!response.ok) {
        const fehler = await response.json().catch(() => null);
        throw new Error(fehler?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      const body = await response.json().catch(() => null);
      setWarnings(body?.warnings ?? []);
      if (restart) {
        await hub.post('/api/system/restart', undefined, { fallback: null, still: true });
        setMessage('Gespeichert – der Hub startet neu. Die App verbindet sich gleich wieder.');
      } else {
        setMessage('Gespeichert. Wirksam wird die Änderung beim nächsten Neustart.');
        // Die Gliederung stimmt jetzt wieder mit der Platte überein.
        setGliederung((alt) => (alt && content ? { ...alt, content } : alt));
      }
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  /** Prüfen, ohne zu speichern – den Fehler sehen, bevor er auf der Platte steht. */
  const check = async () => {
    if (content == null) return;
    setBusy(true);
    setMessage(null);
    try {
      const body = await hub.post<{ ok: boolean; error?: string; warnings?: string[] }>(
        '/api/config/check',
        { content },
        { still: true }
      );
      setWarnings(body.warnings ?? []);
      setMessage(
        body.ok
          ? body.warnings?.length
            ? 'Gültig – aber sieh dir die Hinweise unten an.'
            : 'Gültig, nichts auffällig.'
          : body.error ?? 'Ungültig.'
      );
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const backup = async () => {
    if (content == null) return;
    try {
      await Share.share({ title: 'HomePilot-Konfiguration', message: content });
    } catch (err) {
      setMessage(String(err instanceof Error ? err.message : err));
    }
  };

  if (content == null || gliederung == null) {
    return (
      <Card style={styles.card}>
        <Text style={styles.heading}>Konfiguration</Text>
        <Text style={styles.rowDetail}>
          Integrationen, Räume, Benutzer, Standort – alles, was der Hub beim
          Start liest. Als Übersicht zum Antippen oder als Text. Vor dem
          Speichern prüft der Hub die ganze Datei.
        </Text>
        <View style={styles.buttons}>
          <Button label="Konfiguration laden" onPress={load} styles={styles} />
        </View>
        {message ? <Text style={styles.configMessage}>{message}</Text> : null}
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <View style={styles.kopf}>
        <Text style={[styles.heading, { flex: 1 }]}>Konfiguration</Text>
        <View style={styles.umschalter}>
          {(['gui', 'text'] as const).map((wahl) => (
            <Pressable
              key={wahl}
              onPress={() => {
                // Aus dem Textmodus zurück: Die Zeilen haben sich
                // verschoben, also neu gliedern lassen. Still – das ist
                // keine Änderung, über die man berichten müsste.
                if (wahl === 'gui' && modus === 'text' && content !== gliederung.content) {
                  rechne({}, true);
                }
                setModus(wahl);
              }}
              accessibilityRole="radio"
              accessibilityState={{ selected: modus === wahl }}
              style={[styles.umschaltKnopf, modus === wahl && styles.umschaltAktiv]}
            >
              <Text style={[styles.umschaltText, modus === wahl && styles.umschaltTextAktiv]}>
                {wahl === 'gui' ? 'Übersicht' : 'Text'}
              </Text>
            </Pressable>
          ))}
        </View>
      </View>

      {geaendert ? (
        <View style={styles.hinweisZeile}>
          <Ionicons name="ellipse" size={9} color={colors.warn} />
          <Text style={styles.rowDetail}>
            Ungespeicherte Änderungen – unten «Speichern».
          </Text>
        </View>
      ) : null}

      {modus === 'text' ? (
        <TextInput
          multiline
          value={content}
          onChangeText={setzeText}
          autoCapitalize="none"
          autoCorrect={false}
          spellCheck={false}
          style={styles.configInput}
        />
      ) : (
        <View style={styles.abschnitte}>
          {gliederung.sections.map((abschnitt) => (
            <AbschnittKarte
              key={abschnitt.key}
              abschnitt={abschnitt}
              daten={gliederung.data}
              offen={offen === abschnitt.key}
              onToggle={() => setOffen(offen === abschnitt.key ? null : abschnitt.key)}
              onFeld={(feld, eingabe) =>
                rechne({ path: feld.pfad, ...eingabeWert(feld, eingabe) })
              }
              onBlock={(titel, start, end) =>
                setBlock({
                  titel,
                  start,
                  end,
                  text: content.split('\n').slice(start, end).join('\n'),
                })
              }
              onSchalter={(anbindung, an) =>
                rechne({ start: anbindung.code, end: anbindung.end, enabled: an })
              }
              styles={styles}
              colors={colors}
            />
          ))}
          <Text style={styles.hint}>
            Was hier kein Feld hat, öffnest du mit «Als Text bearbeiten» – dann
            siehst du nur diese paar Zeilen statt der ganzen Datei. Ganz nach
            oben führt jederzeit der Umschalter «Text».
          </Text>
        </View>
      )}

      <View style={styles.buttons}>
        <Button label={busy ? 'Prüft …' : 'Nur prüfen'} onPress={check} styles={styles} />
        <Button
          label={busy ? 'Speichert …' : 'Speichern'}
          onPress={() => save(false)}
          styles={styles}
        />
        <Button
          label="Speichern & neu starten"
          onPress={() => save(true)}
          primary
          styles={styles}
        />
      </View>
      <View style={styles.buttons}>
        <Button label="Neu laden" onPress={load} styles={styles} />
        <Button label="Backup teilen" onPress={backup} styles={styles} />
        <Button
          label={versions === null ? 'Frühere Fassungen' : 'Fassungen ausblenden'}
          styles={styles}
          onPress={async () => {
            if (versions !== null) {
              setVersions(null);
              return;
            }
            const body = await hub.get<{ versions?: ConfigVersion[] }>('/api/config/history', {
              fallback: { versions: [] },
              still: true,
            });
            setVersions(Array.isArray(body.versions) ? body.versions : []);
          }}
        />
      </View>

      {versions !== null ? (
        <View style={styles.warnBox}>
          {versions.length === 0 ? (
            <Text style={styles.rowDetail}>
              Noch keine früheren Fassungen – ab dem nächsten Speichern wird jede
              vorherige Fassung hier aufbewahrt.
            </Text>
          ) : (
            versions.map((version) => (
              <View key={version.name} style={styles.versionRow}>
                <Ionicons name="document-text-outline" size={16} color={colors.inkSoft} />
                <Text style={[styles.rowDetail, { flex: 1 }]}>
                  {datumUhr(version.created * 1000)}
                </Text>
                <Button
                  label="Ansehen"
                  styles={styles}
                  onPress={async () => {
                    try {
                      const body = await hub.get<{ content?: string }>(
                        `/api/config/history/${version.name}`,
                        { still: true }
                      );
                      if (typeof body.content === 'string') {
                        setzeText(body.content);
                        setModus('text');
                        setMessage(
                          'Fassung geladen – sie steht jetzt im Text. Mit «Speichern» ' +
                            'wird sie übernommen.'
                        );
                      }
                    } catch {
                      setMessage('Fassung nicht lesbar.');
                    }
                  }}
                />
              </View>
            ))
          )}
          <Text style={styles.rowDetail}>
            Vor jedem Speichern legt der Hub die bisherige Fassung hier ab – die
            letzten zwanzig bleiben erhalten.
          </Text>
        </View>
      ) : null}

      {message ? <Text style={styles.configMessage}>{message}</Text> : null}
      {warnings.length > 0 ? (
        <View style={styles.warnBox}>
          {warnings.map((warning, index) => (
            <View key={index} style={styles.row}>
              <Ionicons name="warning-outline" size={16} color={colors.warn} />
              <Text style={styles.warnText}>{warning}</Text>
            </View>
          ))}
        </View>
      ) : null}

      {/* Ein Block, nicht die Datei: Wer die Hue-Bridge ändern will, soll
          nicht in siebenhundert Zeilen die richtige Stelle suchen. */}
      <Modal
        visible={block != null}
        animationType="slide"
        onRequestClose={() => setBlock(null)}
      >
        <View style={styles.blattRoot}>
          <View style={styles.kopf}>
            <Text style={[styles.heading, { flex: 1 }]}>{block?.titel}</Text>
            <Pressable onPress={() => setBlock(null)} accessibilityLabel="Schliessen">
              <Ionicons name="close" size={24} color={colors.ink} />
            </Pressable>
          </View>
          <Text style={styles.hint}>
            Nur dieser Ausschnitt. Was hier steht, ersetzt genau die Zeilen, aus
            denen es kommt – der Rest der Datei bleibt unangetastet.
          </Text>
          <ScrollView>
            <TextInput
              multiline
              value={block?.text ?? ''}
              onChangeText={(text) => setBlock((alt) => (alt ? { ...alt, text } : alt))}
              autoCapitalize="none"
              autoCorrect={false}
              spellCheck={false}
              style={styles.configInput}
            />
          </ScrollView>
          <View style={styles.buttons}>
            <Button label="Abbrechen" onPress={() => setBlock(null)} styles={styles} />
            <Button
              label="Übernehmen"
              primary
              styles={styles}
              onPress={async () => {
                if (!block) return;
                await rechne({ start: block.start, end: block.end, text: block.text });
                setBlock(null);
              }}
            />
          </View>
        </View>
      </Modal>
    </Card>
  );
}

function AbschnittKarte({
  abschnitt,
  daten,
  offen,
  onToggle,
  onFeld,
  onBlock,
  onSchalter,
  styles,
  colors,
}: {
  abschnitt: Abschnitt;
  daten: Daten;
  offen: boolean;
  onToggle: () => void;
  onFeld: (feld: Feld, eingabe: string) => void;
  onBlock: (titel: string, start: number, end: number) => void;
  onSchalter: (anbindung: Anbindung, an: boolean) => void;
  styles: Styles;
  colors: Colors;
}) {
  const felder = feldergruppe(abschnitt.key);
  const anbindungen = abschnitt.items ?? [];
  return (
    <View style={styles.abschnitt}>
      <Pressable onPress={onToggle} accessibilityRole="button" style={styles.abschnittKopf}>
        <Ionicons
          name={offen ? 'chevron-down' : 'chevron-forward'}
          size={16}
          color={colors.inkSoft}
        />
        <View style={{ flex: 1 }}>
          <Text style={styles.rowTitle}>{abschnitt.label}</Text>
          <Text style={styles.rowDetail} numberOfLines={1}>
            {zusammenfassung(abschnitt.key, daten)}
          </Text>
        </View>
        <Text style={styles.zeilenZahl}>{zeilen(abschnitt)} Z.</Text>
      </Pressable>

      {offen ? (
        <View style={styles.abschnittKoerper}>
          {felder.map((feld) => (
            <FeldZeile key={feld.pfad.join('.')} feld={feld} daten={daten} onFeld={onFeld} styles={styles} />
          ))}

          {anbindungen.map((anbindung) => (
            <View key={`${anbindung.name}-${anbindung.start}`} style={styles.anbindung}>
              <Pressable
                onPress={() => onSchalter(anbindung, !anbindung.enabled)}
                accessibilityRole="switch"
                accessibilityLabel={`${anbindung.name} ${anbindung.enabled ? 'abschalten' : 'einschalten'}`}
                accessibilityState={{ checked: anbindung.enabled }}
                style={styles.schalterTap}
              >
                <Ionicons
                  name={anbindung.enabled ? 'checkmark-circle' : 'ellipse-outline'}
                  size={20}
                  color={anbindung.enabled ? colors.on : colors.inkFaint}
                />
                <Text
                  style={[
                    styles.rowTitle,
                    { flex: 1 },
                    !anbindung.enabled && { color: colors.inkFaint },
                  ]}
                >
                  {anbindung.name}
                </Text>
              </Pressable>
              <Button
                label="Bearbeiten"
                styles={styles}
                hinweis={`${anbindung.name} bearbeiten`}
                onPress={() => onBlock(anbindung.name, anbindung.start, anbindung.end)}
              />
            </View>
          ))}

          <View style={styles.buttons}>
            <Button
              label="Als Text bearbeiten"
              styles={styles}
              onPress={() => onBlock(abschnitt.label, abschnitt.start, abschnitt.end)}
            />
          </View>
        </View>
      ) : null}
    </View>
  );
}

function FeldZeile({
  feld,
  daten,
  onFeld,
  styles,
}: {
  feld: Feld;
  daten: Daten;
  onFeld: (feld: Feld, eingabe: string) => void;
  styles: Styles;
}) {
  const colors = useColors();
  const gespeichert = wertVon(daten, feld.pfad);
  const [entwurf, setEntwurf] = useState<string | null>(null);
  // Geheimnisse stehen maskiert da, bis jemand sie anfasst – die
  // Übersicht sieht man beim Vorzeigen der App, das Token liest dann
  // jemand mit. Im Textmodus steht weiterhin alles.
  const angezeigt =
    entwurf ?? (feld.geheim ? maskiert(gespeichert) : alsText(gespeichert));
  const uebernehmen = () => {
    if (entwurf == null) return;
    // Nichts geändert heisst nichts zu tun – sonst schriebe schon das
    // Antippen eines Feldes eine Änderung in die Datei.
    const vorher = feld.geheim ? '' : alsText(gespeichert);
    if (entwurf === vorher) {
      setEntwurf(null);
      return;
    }
    onFeld(feld, entwurf);
    setEntwurf(null);
  };
  return (
    <View style={styles.feld}>
      <Text style={styles.feldLabel}>{feld.label}</Text>
      <TextInput
        value={angezeigt}
        onChangeText={setEntwurf}
        onFocus={() => setEntwurf((alt) => alt ?? (feld.geheim ? '' : alsText(gespeichert)))}
        // onBlur, nicht onEndEditing: Im Browser feuert das zweite nicht
        // zuverlässig, und ein Feld, das man ausfüllt und das nichts tut,
        // ist schlimmer als gar kein Feld.
        onBlur={uebernehmen}
        onSubmitEditing={uebernehmen}
        placeholder={feld.platzhalter}
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
        autoCorrect={false}
        keyboardType={feld.art === 'zahl' ? 'numeric' : 'default'}
        style={styles.feldInput}
      />
      {feld.hinweis ? <Text style={styles.hint}>{feld.hinweis}</Text> : null}
    </View>
  );
}

function Button({
  label,
  onPress,
  primary,
  hinweis,
  styles,
}: {
  label: string;
  onPress: () => void;
  primary?: boolean;
  /** Vorlesbarer Name, wenn «Bearbeiten» allein nicht sagt, was gemeint ist. */
  hinweis?: string;
  styles: Styles;
}) {
  const colors = useColors();
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={hinweis ?? label}
      style={({ pressed }) => [
        styles.button,
        primary && { backgroundColor: colors.ink },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Text style={[styles.buttonText, primary && { color: '#fff' }]}>{label}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    row: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    rowTitle: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    rowDetail: { color: colors.inkSoft, fontSize: 13 },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    hinweisZeile: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    buttons: { flexDirection: 'row', flexWrap: 'wrap', gap: 10 },
    button: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    buttonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    configInput: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      padding: 12,
      minHeight: 320,
      maxHeight: 480,
      fontSize: 13,
      lineHeight: 19,
      fontFamily: 'Menlo',
      textAlignVertical: 'top',
    },
    configMessage: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    versionRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    warnBox: {
      gap: 6,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    warnText: { color: colors.ink, fontSize: 13, lineHeight: 19, flex: 1 },

    // Umschalter Übersicht / Text
    umschalter: {
      flexDirection: 'row',
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.pill,
      padding: 3,
      gap: 2,
    },
    umschaltKnopf: { paddingHorizontal: 14, paddingVertical: 7, borderRadius: radius.pill },
    umschaltAktiv: { backgroundColor: colors.surfaceStrong },
    umschaltText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    umschaltTextAktiv: { color: colors.ink },

    // Die Abschnitte der Datei
    abschnitte: { gap: 8 },
    abschnitt: {
      borderRadius: radius.control,
      backgroundColor: colors.surface,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      overflow: 'hidden',
    },
    abschnittKopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
    },
    abschnittKoerper: {
      gap: 12,
      paddingHorizontal: 12,
      paddingBottom: 12,
    },
    zeilenZahl: { color: colors.inkFaint, fontSize: 12 },
    feld: { gap: 4 },
    feldLabel: { color: colors.inkSoft, fontSize: 12 },
    feldInput: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    anbindung: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    schalterTap: { flexDirection: 'row', alignItems: 'center', gap: 10, flex: 1, paddingVertical: 6 },

    // Der Blockeditor als eigenes Blatt
    blattRoot: {
      flex: 1,
      backgroundColor: colors.panel,
      padding: 20,
      gap: 12,
    },
  });
