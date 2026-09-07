/**
 * Gutscheine – das Familien-Modul (Punkt 264 der Werkbank).
 *
 * Geschenkkarten, Online-Codes, Kinoeintritte: Was im Haushalt noch
 * einzulösen ist, stand bisher nirgends – oder auf einem Zettel, der
 * beim Aufräumen wegkam. Hier steht jeder Gutschein mit Laden, Rest,
 * Nummer und Ablaufdatum, und jeder Abzug wird festgehalten: Wer den
 * Brack-Gutschein wann um wie viel gebraucht hat, ist danach keine
 * Frage mehr.
 *
 * Drei Ansichten in einer Datei: die Liste, das Detail und das
 * Formular – plus der kleine Abziehen-Dialog. Was gerechnet wird
 * (Rest, Ablaufstufe, Reihenfolge, der Abzug selbst), steht rein und
 * geprüft in lib/gutscheine.ts; hier nur Anzeige und Eingabe.
 *
 * **Privat oder Familie.** Ein Gutschein «privat» wird vom Hub nur dem
 * Besitzer geliefert – die App muss nichts verstecken und tut es auch
 * nicht: Was hier ankommt, darf man sehen.
 *
 * **Warum eine eigene Datei.** FamilyScreen.tsx ist über viertausend
 * Zeilen lang; die Kinderseite hat den Anfang gemacht, neue Module
 * gehören daneben, nicht hinein.
 */
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { HubSettings } from '../../api/types';
import { Card } from '../../components/Card';
import { Leerzustand } from '../../components/Leerzustand';
import {
  Ablaufstufe,
  EINHEITEN,
  Formular,
  GETEILT,
  Geteilt,
  Gutschein,
  ablaufSatz,
  ablaufStufe,
  abziehen,
  abzugPruefen,
  alsGutschein,
  anteil,
  aufgeteilt,
  betragLesen,
  betragText,
  betragZahl,
  datumText,
  einheitText,
  formularPruefen,
  formularVon,
  gefiltert,
  heuteIso,
  kategorien,
  kopfText,
  leeresFormular,
  listeLeerbild,
  restText,
  teilText,
  verlauf,
  verlaufLeerbild,
} from '../../lib/gutscheine';
import { datumUhr } from '../../lib/format';
import { tapped } from '../../lib/haptics';
import { Colors, radius } from '../../theme';
import { bildUri } from '../RecipeBook';
import { BackHead, FamilyItem, Styles } from './bausteine';

/** Die Felder des Formulars, die ein Textfeld sind. */
type TextFeld = 'shop' | 'title' | 'total' | 'number' | 'pin' | 'url' | 'notes';

type Seite =
  | { art: 'liste' }
  | { art: 'detail'; id: string }
  | { art: 'form'; id?: string };

// ── Hilfen ───────────────────────────────────────────────────────────────

/**
 * Text in die Zwischenablage – oder aufs Teilen-Blatt.
 *
 * Die native Hülle hat kein Zwischenablage-Modul, und eines dazuzunehmen
 * hiesse eine neue runtimeVersion samt TestFlight-Build (siehe
 * CLAUDE.md). Im Browser geht es direkt; auf dem Telefon öffnet sich
 * das Teilen-Blatt, dessen erster Eintrag auf iOS «Kopieren» ist – ein
 * Tipp mehr, aber die Nummer kommt an, wo sie hin soll.
 */
async function kopieren(text: string): Promise<'kopiert' | 'geteilt' | 'nichts'> {
  if (Platform.OS === 'web') {
    try {
      if (typeof navigator !== 'undefined' && navigator.clipboard) {
        await navigator.clipboard.writeText(text);
        return 'kopiert';
      }
    } catch {
      // Ohne Rechte auf die Zwischenablage bleibt nur das Anzeigen.
    }
    return 'nichts';
  }
  await Share.share({ message: text }).catch(() => {});
  return 'geteilt';
}

/**
 * Ein Foto holen und verkleinert als data-URI zurückgeben – derselbe
 * Griff wie im Rezeptbuch (Punkt 138): Ein iPhone-Foto in
 * Originalauflösung sind mehrere MB, und /api/family liefert bei jedem
 * Öffnen alle Einträge mit. 1200 px reichen für die Karte und das
 * Detail. Der Hub legt die data-URI als Datei ab und liefert danach
 * einen Pfad, den `bildUri` mit Adresse und Token versieht.
 */
async function holeFoto(quelle: 'galerie' | 'kamera'): Promise<string | null> {
  const optionen = {
    mediaTypes: ImagePicker.MediaTypeOptions.Images,
    quality: 0.6,
    base64: true,
    allowsEditing: true,
    // Eine Geschenkkarte ist quer wie eine Kreditkarte.
    aspect: [16, 10] as [number, number],
  };
  const permission =
    quelle === 'kamera'
      ? await ImagePicker.requestCameraPermissionsAsync()
      : await ImagePicker.requestMediaLibraryPermissionsAsync();
  if (!permission.granted) return null;
  const result =
    quelle === 'kamera'
      ? await ImagePicker.launchCameraAsync(optionen).catch(() => null)
      : await ImagePicker.launchImageLibraryAsync(optionen);
  if (!result || result.canceled || !result.assets?.length) return null;
  const asset = result.assets[0];
  try {
    if ((asset.width ?? 0) > 1200) {
      // Zur Laufzeit laden statt oben importieren: Auf einem älteren
      // Build ohne das native Modul soll die App nicht abstürzen,
      // sondern das Foto unverkleinert nehmen.
      // eslint-disable-next-line @typescript-eslint/no-require-imports
      const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
      const kleiner = await manipulateAsync(asset.uri, [{ resize: { width: 1200 } }], {
        compress: 0.6,
        format: SaveFormat.JPEG,
        base64: true,
      });
      if (kleiner.base64) return `data:image/jpeg;base64,${kleiner.base64}`;
    }
  } catch {
    // Verkleinern ist eine Zugabe - das Original tut es auch.
  }
  return asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri;
}

/** Die Farbe, in der das Ablaufdatum steht. */
function ablaufFarbe(stufe: Ablaufstufe, colors: Colors): string {
  if (stufe === 'bald') return colors.warn;
  if (stufe === 'abgelaufen') return colors.inkFaint;
  return colors.ink;
}

/** Der Balken Rest/Gesamt. */
function Balken({
  entry,
  stufe,
  colors,
  eigen,
}: {
  entry: Gutschein;
  stufe: Ablaufstufe;
  colors: Colors;
  eigen: Eigen;
}) {
  const farbe =
    stufe === 'abgelaufen' ? colors.inkFaint : stufe === 'bald' ? colors.warn : colors.accent;
  return (
    <View
      style={eigen.balken}
      accessibilityRole="progressbar"
      accessibilityLabel={`${restText(entry)} von ${betragText(entry.total, entry.unit)}`}
      accessibilityValue={{ min: 0, max: entry.total, now: entry.left }}
    >
      <View style={[eigen.balkenFuellung, { width: `${anteil(entry) * 100}%`, backgroundColor: farbe }]} />
    </View>
  );
}

/** Der Chip «Privat» / «Familie». */
function GeteiltChip({ shared, eigen, colors }: { shared: Geteilt; eigen: Eigen; colors: Colors }) {
  return (
    <View style={eigen.chipKlein}>
      <Ionicons
        name={shared === 'familie' ? 'people-outline' : 'lock-closed-outline'}
        size={12}
        color={colors.accent}
      />
      <Text style={eigen.chipKleinText}>{shared === 'familie' ? 'Familie' : 'Privat'}</Text>
    </View>
  );
}

// ── Die Karte in der Liste ───────────────────────────────────────────────

function GutscheinKarte({
  entry,
  heute,
  onOpen,
  onAbziehen,
  eigen,
  colors,
}: {
  entry: Gutschein;
  heute: string;
  onOpen: () => void;
  onAbziehen: () => void;
  eigen: Eigen;
  colors: Colors;
}) {
  const stufe = ablaufStufe(entry.expires, heute);
  const leer = entry.left < 0.005;
  const gedaempft = leer || stufe === 'abgelaufen';
  return (
    <Card
      style={{ ...eigen.karte, ...(gedaempft ? { opacity: 0.55 } : {}) }}
      onPress={onOpen}
      label={`${entry.shop}${entry.title ? `, ${entry.title}` : ''}, ${restText(entry)}, ${ablaufSatz(
        entry.expires,
        heute
      )}, ${entry.shared === 'familie' ? 'Familie' : 'Privat'}`}
    >
      <View style={eigen.karteKopf}>
        <View style={eigen.ladenBox}>
          <Ionicons
            name={entry.unit === 'stk' ? 'ticket-outline' : 'card-outline'}
            size={22}
            color={colors.accent}
          />
        </View>
        <View style={{ flex: 1, minWidth: 0 }}>
          <Text style={eigen.laden} numberOfLines={1}>
            {entry.shop}
          </Text>
          {entry.title ? (
            <Text style={eigen.titel} numberOfLines={1}>
              {entry.title}
            </Text>
          ) : null}
        </View>
        <View style={eigen.betragZeile}>
          <Text style={eigen.betragGross}>{betragZahl(entry.left, entry.unit)}</Text>
          <Text style={eigen.betragEinheit}>{einheitText(entry.unit)}</Text>
        </View>
      </View>
      <Balken entry={entry} stufe={stufe} colors={colors} eigen={eigen} />
      <View style={eigen.karteFuss}>
        <View style={{ flex: 1 }}>
          <View style={eigen.chipZeile}>
            <GeteiltChip shared={entry.shared} eigen={eigen} colors={colors} />
            {entry.category ? <Text style={eigen.kategorieText}>{entry.category}</Text> : null}
          </View>
          <Text style={[eigen.gueltigText, { color: ablaufFarbe(stufe, colors) }]}>
            {ablaufSatz(entry.expires, heute)}
          </Text>
        </View>
        {!leer ? (
          <Pressable
            onPress={onAbziehen}
            accessibilityRole="button"
            accessibilityLabel={`Von ${entry.shop} abziehen`}
            style={({ pressed }) => [eigen.abziehenKnopf, pressed && { opacity: 0.8 }]}
          >
            <Text style={eigen.abziehenText}>Abziehen</Text>
          </Pressable>
        ) : null}
      </View>
    </Card>
  );
}

// ── Das Detail ───────────────────────────────────────────────────────────

function Detail({
  entry,
  heute,
  settings,
  onBack,
  onAbziehen,
  onBearbeiten,
  onLoeschen,
  styles,
  eigen,
  colors,
}: {
  entry: Gutschein;
  heute: string;
  settings: HubSettings;
  onBack: () => void;
  onAbziehen: () => void;
  onBearbeiten: () => void;
  onLoeschen: () => void;
  styles: Styles;
  eigen: Eigen;
  colors: Colors;
}) {
  const [pinSichtbar, setPinSichtbar] = useState(false);
  // Zwei Schritte fürs Löschen: erst die Frage, dann der Tipp. Und was
  // weg ist, liegt dreissig Tage im Papierkorb der Familienseite.
  const [loeschFrage, setLoeschFrage] = useState(false);
  const [rueckmeldung, setRueckmeldung] = useState<string | null>(null);
  const stufe = ablaufStufe(entry.expires, heute);
  const bild = bildUri(entry.image_url, settings);
  const buchungen = verlauf(entry);

  const nummerKopieren = async () => {
    if (!entry.number) return;
    tapped();
    const wie = await kopieren(entry.number);
    setRueckmeldung(wie === 'kopiert' ? 'Nummer kopiert' : null);
    if (wie === 'kopiert') setTimeout(() => setRueckmeldung(null), 2500);
  };

  const feld = (label: string, wert: React.ReactNode, extra?: { onPress?: () => void; a11y?: string }) => (
    <Pressable
      style={eigen.feld}
      onPress={extra?.onPress}
      disabled={!extra?.onPress}
      accessibilityRole={extra?.onPress ? 'button' : undefined}
      accessibilityLabel={extra?.a11y}
    >
      <Text style={eigen.feldLabel}>{label}</Text>
      {typeof wert === 'string' ? (
        <Text style={eigen.feldWert} selectable>
          {wert || '–'}
        </Text>
      ) : (
        wert
      )}
    </Pressable>
  );

  return (
    <View style={styles.stack}>
      <BackHead title="Gutschein" onBack={onBack} styles={styles} colors={colors} />
      <Card style={eigen.detailKarte}>
        {bild ? (
          <Image
            source={{ uri: bild }}
            style={eigen.detailBild}
            resizeMode="cover"
            accessibilityLabel={`Foto des Gutscheins von ${entry.shop}`}
          />
        ) : null}
        <View style={eigen.detailKopf}>
          <View style={{ flex: 1, minWidth: 0 }}>
            <Text style={eigen.detailLaden}>{entry.shop.toUpperCase()}</Text>
            <Text style={eigen.detailTitel}>{entry.title || 'Gutschein'}</Text>
          </View>
          {entry.author ? (
            <View style={eigen.vonChip}>
              <Text style={eigen.vonText}>Von: {entry.author}</Text>
            </View>
          ) : null}
        </View>
        <View style={eigen.detailBetrag}>
          <View style={eigen.betragZeile}>
            <Text style={eigen.detailZahl}>{betragZahl(entry.left, entry.unit)}</Text>
            <Text style={eigen.detailEinheit}>{einheitText(entry.unit)}</Text>
          </View>
          <Text style={eigen.vonGesamt}>von {betragText(entry.total, entry.unit)}</Text>
        </View>
        <Balken entry={entry} stufe={stufe} colors={colors} eigen={eigen} />

        <View style={eigen.feldRaster}>
          {feld('Nummer', entry.number || '–', {
            onPress: entry.number ? nummerKopieren : undefined,
            a11y: entry.number ? `Nummer ${entry.number} kopieren` : undefined,
          })}
          {feld(
            'PIN',
            <View style={eigen.pinZeile}>
              <Text style={eigen.feldWert} selectable={pinSichtbar}>
                {entry.pin ? (pinSichtbar ? entry.pin : '•'.repeat(Math.min(entry.pin.length, 8))) : '–'}
              </Text>
              {entry.pin ? (
                <Pressable
                  onPress={() => setPinSichtbar(!pinSichtbar)}
                  hitSlop={8}
                  accessibilityRole="button"
                  accessibilityLabel={pinSichtbar ? 'PIN verbergen' : 'PIN anzeigen'}
                  accessibilityState={{ expanded: pinSichtbar }}
                >
                  <Ionicons
                    name={pinSichtbar ? 'eye-off-outline' : 'eye-outline'}
                    size={18}
                    color={colors.inkSoft}
                  />
                </Pressable>
              ) : null}
            </View>
          )}
          {feld(
            'Ablaufdatum',
            <Text style={[eigen.feldWert, { color: ablaufFarbe(stufe, colors) }]}>
              {entry.expires ? datumText(entry.expires) : 'Unbegrenzt'}
            </Text>
          )}
          {feld('Kategorie', entry.category || '–')}
          {feld('Geteilt', entry.shared === 'familie' ? 'Familie' : 'Privat')}
        </View>
        {rueckmeldung ? <Text style={eigen.rueckmeldung}>{rueckmeldung}</Text> : null}
        {stufe !== 'ok' && stufe !== 'unbegrenzt' ? (
          <Text style={[eigen.gueltigText, { color: ablaufFarbe(stufe, colors) }]}>
            {ablaufSatz(entry.expires, heute)}
          </Text>
        ) : null}
        {entry.url ? (
          <Pressable
            onPress={() => Linking.openURL(String(entry.url)).catch(() => {})}
            accessibilityRole="link"
            accessibilityLabel={`${entry.url} im Browser öffnen`}
            style={eigen.linkZeile}
          >
            <Ionicons name="globe-outline" size={16} color={colors.accent} />
            <Text style={eigen.linkText} numberOfLines={1}>
              {entry.url}
            </Text>
          </Pressable>
        ) : null}
        {entry.notes ? (
          <Text style={eigen.notiz} selectable>
            {entry.notes}
          </Text>
        ) : null}

        <View style={eigen.trenner} />
        <Text style={styles.groupTitle}>Transaktionsverlauf</Text>
        {buchungen.length === 0 ? (
          <Leerzustand bild={verlaufLeerbild()} />
        ) : (
          buchungen.map((buchung, index) => (
            <View key={`${buchung.at}-${index}`} style={eigen.verlaufZeile}>
              <View style={{ flex: 1 }}>
                <Text style={styles.checkText}>{buchung.by || '?'}</Text>
                <Text style={styles.checkSub}>
                  {buchung.at ? datumUhr(new Date(buchung.at)) : ''}
                  {buchung.note ? ` · ${buchung.note}` : ''}
                </Text>
              </View>
              <Text style={eigen.verlaufBetrag}>−{betragText(buchung.amount, entry.unit)}</Text>
            </View>
          ))
        )}

        <View style={eigen.knopfReihe}>
          {entry.left >= 0.005 ? (
            <Pressable
              onPress={onAbziehen}
              accessibilityRole="button"
              style={({ pressed }) => [eigen.primaerKnopf, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="remove-circle-outline" size={18} color="#FFFFFF" />
              <Text style={eigen.primaerText}>Betrag abziehen</Text>
            </Pressable>
          ) : (
            <Text style={styles.checkSub}>Aufgebraucht.</Text>
          )}
          <Pressable
            onPress={() => Share.share({ message: teilText(entry) }).catch(() => {})}
            accessibilityRole="button"
            accessibilityLabel="Gutschein als Text teilen"
            style={({ pressed }) => [eigen.sekundaerKnopf, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="share-outline" size={18} color={colors.ink} />
            <Text style={eigen.sekundaerText}>Teilen</Text>
          </Pressable>
          <Pressable
            onPress={onBearbeiten}
            accessibilityRole="button"
            accessibilityLabel="Gutschein bearbeiten"
            style={({ pressed }) => [eigen.sekundaerKnopf, pressed && { opacity: 0.8 }]}
          >
            <Ionicons name="create-outline" size={18} color={colors.ink} />
            <Text style={eigen.sekundaerText}>Bearbeiten</Text>
          </Pressable>
        </View>
        {loeschFrage ? (
          <View style={styles.confirmRow}>
            <Text style={[styles.checkText, { flex: 1 }]}>
              Wirklich löschen? Er landet im Papierkorb.
            </Text>
            <Pressable
              onPress={() => {
                setLoeschFrage(false);
                onLoeschen();
              }}
              style={styles.confirmOk}
              accessibilityRole="button"
              accessibilityLabel="Ja, löschen"
            >
              <Ionicons name="checkmark" size={18} color="#FFFFFF" />
            </Pressable>
            <Pressable
              onPress={() => setLoeschFrage(false)}
              style={styles.confirmNo}
              accessibilityRole="button"
              accessibilityLabel="Nein, behalten"
            >
              <Ionicons name="close" size={18} color={colors.ink} />
            </Pressable>
          </View>
        ) : (
          <Pressable
            onPress={() => setLoeschFrage(true)}
            accessibilityRole="button"
            accessibilityLabel={`Gutschein von ${entry.shop} löschen`}
            style={({ pressed }) => [eigen.loeschKnopf, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={eigen.loeschText}>Löschen</Text>
          </Pressable>
        )}
      </Card>
    </View>
  );
}

// ── Das Formular ─────────────────────────────────────────────────────────

function FormularBlatt({
  bisher,
  vorhandeneKategorien,
  settings,
  onSave,
  onCancel,
  styles,
  eigen,
  colors,
}: {
  bisher: Gutschein | null;
  vorhandeneKategorien: string[];
  settings: HubSettings;
  onSave: (eintrag: Gutschein) => void;
  onCancel: () => void;
  styles: Styles;
  eigen: Eigen;
  colors: Colors;
}) {
  const [form, setForm] = useState<Formular>(() => (bisher ? formularVon(bisher) : leeresFormular()));
  const [fehler, setFehler] = useState<string | null>(null);
  const setze = <K extends keyof Formular>(key: K, wert: Formular[K]) =>
    setForm((vorher) => ({ ...vorher, [key]: wert }));
  const bild = bildUri(form.image_url, settings);

  const speichern = () => {
    const ergebnis = formularPruefen(form, bisher);
    if (ergebnis.eintrag === null) {
      setFehler(ergebnis.fehler);
      return;
    }
    tapped();
    onSave(ergebnis.eintrag);
  };

  const eingabe = (
    label: string,
    key: TextFeld,
    extra: Partial<React.ComponentProps<typeof TextInput>> = {}
  ) => (
    <View style={eigen.formFeld}>
      <Text style={eigen.formLabel}>{label}</Text>
      <TextInput
        style={styles.input}
        value={form[key]}
        onChangeText={(text) => setze(key, text)}
        placeholderTextColor={colors.inkFaint}
        accessibilityLabel={label}
        {...extra}
      />
    </View>
  );

  return (
    <View style={styles.stack}>
      <BackHead
        title={bisher ? 'Gutschein bearbeiten' : 'Gutschein erfassen'}
        onBack={onCancel}
        styles={styles}
        colors={colors}
      />
      <Card style={styles.formCard}>
        {eingabe('Laden', 'shop', { placeholder: 'z.B. Brack.ch', autoFocus: !bisher })}
        {eingabe('Titel', 'title', { placeholder: 'z.B. Gutschein, Geschenk' })}

        <View style={eigen.formFeld}>
          <Text style={eigen.formLabel}>Einheit</Text>
          <View style={styles.chipRow}>
            {EINHEITEN.map((einheit) => (
              <Pressable
                key={einheit.key}
                onPress={() => setze('unit', einheit.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: form.unit === einheit.key }}
                style={[styles.chip, form.unit === einheit.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, form.unit === einheit.key && styles.chipTextActive]}>
                  {einheit.label}
                </Text>
              </Pressable>
            ))}
          </View>
        </View>
        {eingabe(form.unit === 'stk' ? 'Anzahl' : 'Gesamtwert (CHF)', 'total', {
          placeholder: form.unit === 'stk' ? '1' : '100.00',
          keyboardType: form.unit === 'stk' ? 'number-pad' : 'decimal-pad',
        })}
        {eingabe('Nummer', 'number', { placeholder: 'Gutschein-Nummer oder Code', autoCapitalize: 'none' })}
        {eingabe('PIN', 'pin', { placeholder: 'falls vorhanden', autoCapitalize: 'none' })}

        <View style={eigen.formFeld}>
          <Text style={eigen.formLabel}>Ablaufdatum</Text>
          <View style={styles.wahlZeile}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={form.expires}
              onChangeText={(text) => setze('expires', text)}
              placeholder="TT.MM.JJJJ"
              placeholderTextColor={colors.inkFaint}
              keyboardType="numbers-and-punctuation"
              accessibilityLabel="Ablaufdatum"
            />
            <Pressable
              onPress={() => setze('expires', '')}
              accessibilityRole="button"
              accessibilityState={{ selected: !form.expires }}
              style={[styles.chip, !form.expires && styles.chipActive]}
            >
              <Text style={[styles.chipText, !form.expires && styles.chipTextActive]}>Unbegrenzt</Text>
            </Pressable>
          </View>
        </View>

        <View style={eigen.formFeld}>
          <Text style={eigen.formLabel}>Kategorie</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.chipRow}>
              {vorhandeneKategorien.map((kat) => (
                <Pressable
                  key={kat}
                  onPress={() => setze('category', form.category === kat ? '' : kat)}
                  accessibilityRole="button"
                  accessibilityState={{ selected: form.category === kat }}
                  style={[styles.chip, form.category === kat && styles.chipActive]}
                >
                  <Text style={[styles.chipText, form.category === kat && styles.chipTextActive]}>
                    {kat}
                  </Text>
                </Pressable>
              ))}
            </View>
          </ScrollView>
          <TextInput
            style={styles.input}
            value={form.category}
            onChangeText={(text) => setze('category', text)}
            placeholder="oder eine eigene …"
            placeholderTextColor={colors.inkFaint}
            accessibilityLabel="Eigene Kategorie"
          />
        </View>

        <View style={eigen.formFeld}>
          <Text style={eigen.formLabel}>Geteilt</Text>
          <View style={styles.chipRow}>
            {GETEILT.map((wahl) => (
              <Pressable
                key={wahl.key}
                onPress={() => setze('shared', wahl.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: form.shared === wahl.key }}
                style={[styles.chip, form.shared === wahl.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, form.shared === wahl.key && styles.chipTextActive]}>
                  {wahl.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.formHintSmall}>
            Privat sieht nur, wer ihn erfasst hat. Familie sehen alle.
          </Text>
        </View>

        {eingabe('Link', 'url', {
          placeholder: 'https://…',
          autoCapitalize: 'none',
          keyboardType: 'url',
        })}

        <View style={eigen.formFeld}>
          <Text style={eigen.formLabel}>Foto</Text>
          <Pressable
            onPress={async () => {
              const foto = await holeFoto('galerie');
              if (foto) setze('image_url', foto);
            }}
            accessibilityRole="button"
            accessibilityLabel={bild ? 'Foto ersetzen' : 'Foto aus der Galerie wählen'}
            style={eigen.fotoWahl}
          >
            {bild ? (
              <Image source={{ uri: bild }} style={eigen.fotoVorschau} resizeMode="cover" />
            ) : (
              <View style={eigen.fotoLeer}>
                <Ionicons name="images-outline" size={26} color={colors.inkSoft} />
                <Text style={eigen.fotoHinweis}>Foto aus der Galerie</Text>
              </View>
            )}
          </Pressable>
          <View style={styles.chipRow}>
            <Pressable
              onPress={async () => {
                const foto = await holeFoto('kamera');
                if (foto) setze('image_url', foto);
              }}
              accessibilityRole="button"
              style={eigen.fotoAktion}
            >
              <Ionicons name="camera-outline" size={16} color={colors.accent} />
              <Text style={eigen.fotoAktionText}>Mit der Kamera</Text>
            </Pressable>
            {bild ? (
              <Pressable
                onPress={() => setze('image_url', '')}
                accessibilityRole="button"
                style={eigen.fotoAktion}
              >
                <Ionicons name="trash-outline" size={16} color={colors.inkSoft} />
                <Text style={[eigen.fotoAktionText, { color: colors.inkSoft }]}>Foto entfernen</Text>
              </Pressable>
            ) : null}
          </View>
        </View>

        {eingabe('Notiz', 'notes', { placeholder: 'z.B. nur im Laden einlösbar', multiline: true })}

        {fehler ? <Text style={styles.error}>{fehler}</Text> : null}
        <Pressable onPress={speichern} style={styles.addWide} accessibilityRole="button">
          <Text style={styles.addWideText}>{bisher ? 'Speichern' : 'Gutschein erfassen'}</Text>
        </Pressable>
        <Pressable onPress={onCancel} style={styles.clearButton} accessibilityRole="button">
          <Text style={styles.resetText}>Abbrechen</Text>
        </Pressable>
      </Card>
    </View>
  );
}

// ── Der Abziehen-Dialog ──────────────────────────────────────────────────

function AbziehenDialog({
  entry,
  onBestaetigen,
  onAbbrechen,
  styles,
  eigen,
  colors,
}: {
  entry: Gutschein | null;
  onBestaetigen: (betrag: number) => void;
  onAbbrechen: () => void;
  styles: Styles;
  eigen: Eigen;
  colors: Colors;
}) {
  const [text, setText] = useState('');
  const [fehler, setFehler] = useState<string | null>(null);
  // Beim Öffnen frisch: Der Dialog bleibt eingehängt, damit die
  // Tastatur beim Auf- und Zuklappen nicht flackert.
  const [letzteId, setLetzteId] = useState<string | undefined>(undefined);
  if (entry && entry.id !== letzteId) {
    setLetzteId(entry.id);
    setText('');
    setFehler(null);
  }

  const bestaetigen = () => {
    if (!entry) return;
    const betrag = betragLesen(text, entry.unit);
    const grund = abzugPruefen(entry, betrag);
    if (grund) {
      setFehler(grund);
      return;
    }
    onBestaetigen(betrag as number);
  };

  return (
    <Modal visible={!!entry} transparent animationType="fade" onRequestClose={onAbbrechen}>
      <Pressable style={styles.modalBack} onPress={onAbbrechen} accessibilityLabel="Dialog schliessen">
        <Pressable style={styles.modalCard} onPress={() => {}}>
          {entry ? (
            <>
              <Text style={eigen.dialogTitel}>Abziehen</Text>
              <Text style={eigen.dialogFrage}>
                Wieviel möchtest du vom Gutschein «{entry.shop}» abziehen? Noch drauf:{' '}
                {restText(entry)}.
              </Text>
              <View style={eigen.dialogEingabe}>
                <TextInput
                  style={eigen.dialogZahl}
                  value={text}
                  onChangeText={(wert) => {
                    setText(wert);
                    setFehler(null);
                  }}
                  placeholder={entry.unit === 'stk' ? '1' : '0.00'}
                  placeholderTextColor={colors.inkFaint}
                  keyboardType={entry.unit === 'stk' ? 'number-pad' : 'decimal-pad'}
                  autoFocus
                  onSubmitEditing={bestaetigen}
                  accessibilityLabel={entry.unit === 'stk' ? 'Anzahl abziehen' : 'Betrag abziehen'}
                />
                <Text style={eigen.dialogEinheit}>{einheitText(entry.unit)}</Text>
              </View>
              <View style={styles.chipRow}>
                <Pressable
                  onPress={() => {
                    setText(betragZahl(entry.left, entry.unit));
                    setFehler(null);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`Ganzen Rest abziehen, ${restText(entry)}`}
                  style={styles.chip}
                >
                  <Text style={styles.chipText}>Ganzen Rest ({restText(entry)})</Text>
                </Pressable>
              </View>
              {fehler ? <Text style={styles.error}>{fehler}</Text> : null}
              <View style={eigen.dialogKnoepfe}>
                <Pressable
                  onPress={onAbbrechen}
                  accessibilityRole="button"
                  style={({ pressed }) => [eigen.sekundaerKnopf, { flex: 1 }, pressed && { opacity: 0.8 }]}
                >
                  <Text style={eigen.sekundaerText}>Abbrechen</Text>
                </Pressable>
                <Pressable
                  onPress={bestaetigen}
                  accessibilityRole="button"
                  style={({ pressed }) => [eigen.primaerKnopf, { flex: 1 }, pressed && { opacity: 0.8 }]}
                >
                  <Text style={eigen.primaerText}>Bestätigen</Text>
                </Pressable>
              </View>
            </>
          ) : null}
        </Pressable>
      </Pressable>
    </Modal>
  );
}

// ── Das Modul ────────────────────────────────────────────────────────────

export function Gutscheine({
  eintraege,
  settings,
  ich,
  fehler,
  hinweis,
  jetzt,
  onBack,
  onAdd,
  onUpdate,
  onRemove,
  styles,
  colors,
}: {
  /** Die Sammlung `vouchers`, wie der Hub sie liefert. */
  eintraege: FamilyItem[];
  settings: HubSettings;
  /** Der angemeldete Name – steht als «by» in jeder Buchung. */
  ich: string;
  fehler?: string | null;
  hinweis?: string | null;
  jetzt: Date;
  onBack: () => void;
  onAdd: (eintrag: FamilyItem) => void;
  onUpdate: (id: string, patch: FamilyItem) => void;
  onRemove: (id: string) => void;
  styles: Styles;
  colors: Colors;
}) {
  const eigen = useMemo(() => makeStyles(colors), [colors]);
  const heute = heuteIso(jetzt);
  const alle = useMemo(() => eintraege.map(alsGutschein), [eintraege]);
  const [seite, setSeite] = useState<Seite>({ art: 'liste' });
  const [suchtext, setSuchtext] = useState('');
  const [filterOffen, setFilterOffen] = useState(false);
  const [kategorie, setKategorie] = useState<string | null>(null);
  const [geteilt, setGeteilt] = useState<Geteilt | null>(null);
  const [nurBald, setNurBald] = useState(false);
  const [leerOffen, setLeerOffen] = useState(false);
  const [abzugId, setAbzugId] = useState<string | null>(null);

  const gefunden = gefiltert(alle, suchtext, { kategorie, geteilt, bald: nurBald }, heute);
  const { offen, leer } = aufgeteilt(gefunden, heute);
  const gefiltertAktiv = !!(suchtext.trim() || kategorie || geteilt || nurBald);
  const kats = useMemo(() => kategorien(alle), [alle]);
  const abzug = abzugId ? (alle.find((entry) => entry.id === abzugId) ?? null) : null;

  const abziehenBestaetigen = (betrag: number) => {
    if (!abzug?.id) return;
    const neu = abziehen(abzug, betrag, ich, new Date());
    onUpdate(abzug.id, { left: neu.left, transactions: neu.transactions });
    tapped();
    setAbzugId(null);
  };

  const speichern = (eintrag: Gutschein, id?: string) => {
    // Was der Hub selbst setzt, geht nicht mit: id, author, created.
    const body: FamilyItem = { ...eintrag };
    delete body.id;
    delete body.author;
    delete body.created;
    if (id) onUpdate(id, body);
    else onAdd(body);
    setSeite(id ? { art: 'detail', id } : { art: 'liste' });
  };

  // ── Detail ─────────────────────────────────────────────────────────
  if (seite.art === 'detail') {
    const entry = alle.find((eintrag) => eintrag.id === seite.id);
    // Von einem anderen Gerät gelöscht, während das Detail offen war:
    // zurück zur Liste statt auf eine leere Karte.
    if (!entry) {
      setSeite({ art: 'liste' });
      return null;
    }
    return (
      <>
        <Detail
          entry={entry}
          heute={heute}
          settings={settings}
          onBack={() => setSeite({ art: 'liste' })}
          onAbziehen={() => setAbzugId(entry.id ?? null)}
          onBearbeiten={() => setSeite({ art: 'form', id: entry.id })}
          onLoeschen={() => {
            if (entry.id) onRemove(entry.id);
            setSeite({ art: 'liste' });
          }}
          styles={styles}
          eigen={eigen}
          colors={colors}
        />
        <AbziehenDialog
          entry={abzug}
          onBestaetigen={abziehenBestaetigen}
          onAbbrechen={() => setAbzugId(null)}
          styles={styles}
          eigen={eigen}
          colors={colors}
        />
      </>
    );
  }

  // ── Formular ───────────────────────────────────────────────────────
  if (seite.art === 'form') {
    const bisher = seite.id ? (alle.find((eintrag) => eintrag.id === seite.id) ?? null) : null;
    return (
      <FormularBlatt
        key={seite.id ?? 'neu'}
        bisher={bisher}
        vorhandeneKategorien={kats}
        settings={settings}
        onSave={(eintrag) => speichern(eintrag, seite.id)}
        onCancel={() => setSeite(seite.id ? { art: 'detail', id: seite.id } : { art: 'liste' })}
        styles={styles}
        eigen={eigen}
        colors={colors}
      />
    );
  }

  // ── Liste ──────────────────────────────────────────────────────────
  const filterChip = (
    label: string,
    aktiv: boolean,
    onPress: () => void,
    icon?: keyof typeof Ionicons.glyphMap
  ) => (
    <Pressable
      key={label}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityState={{ selected: aktiv }}
      style={[styles.chip, aktiv && styles.chipActive]}
    >
      <View style={{ flexDirection: 'row', alignItems: 'center', gap: 4 }}>
        {icon ? <Ionicons name={icon} size={13} color={aktiv ? '#FFFFFF' : colors.ink} /> : null}
        <Text style={[styles.chipText, aktiv && styles.chipTextActive]}>{label}</Text>
      </View>
    </Pressable>
  );

  return (
    <View style={styles.stack}>
      <BackHead title="Gutscheine" onBack={onBack} styles={styles} colors={colors} />
      {fehler ? <Text style={styles.error}>{fehler}</Text> : null}
      {hinweis ? <Text style={styles.checkSub}>{hinweis}</Text> : null}

      <View style={eigen.kopfZeile}>
        <Text style={eigen.kopfZahl} accessibilityRole="header">
          {kopfText(alle)}
        </Text>
        <Pressable
          onPress={() => setSeite({ art: 'form' })}
          accessibilityRole="button"
          accessibilityLabel="Gutschein erfassen"
          style={({ pressed }) => [eigen.neuKnopf, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      <View style={styles.suchRow}>
        <Ionicons name="search-outline" size={16} color={colors.inkSoft} />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={suchtext}
          onChangeText={setSuchtext}
          placeholder="Laden, Titel, Nummer …"
          placeholderTextColor={colors.inkFaint}
          accessibilityLabel="Gutscheine durchsuchen"
        />
        {suchtext ? (
          <Pressable onPress={() => setSuchtext('')} accessibilityRole="button" accessibilityLabel="Suche leeren">
            <Ionicons name="close" size={18} color={colors.inkFaint} />
          </Pressable>
        ) : null}
        <Pressable
          onPress={() => setFilterOffen(!filterOffen)}
          accessibilityRole="button"
          accessibilityLabel="Filter"
          accessibilityState={{ expanded: filterOffen }}
          hitSlop={6}
        >
          <Ionicons
            name="options-outline"
            size={20}
            color={kategorie || geteilt || nurBald ? colors.accent : colors.inkSoft}
          />
        </Pressable>
      </View>

      {filterOffen ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false}>
          <View style={styles.chipRow}>
            {filterChip('Läuft bald ab', nurBald, () => setNurBald(!nurBald), 'time-outline')}
            {filterChip('Privat', geteilt === 'privat', () => setGeteilt(geteilt === 'privat' ? null : 'privat'), 'lock-closed-outline')}
            {filterChip('Familie', geteilt === 'familie', () => setGeteilt(geteilt === 'familie' ? null : 'familie'), 'people-outline')}
            {kats.map((kat) =>
              filterChip(kat, kategorie === kat, () => setKategorie(kategorie === kat ? null : kat))
            )}
          </View>
        </ScrollView>
      ) : null}

      {offen.length === 0 && leer.length === 0 ? (
        <Card style={styles.listCard}>
          <Leerzustand
            bild={listeLeerbild(gefiltertAktiv)}
            onAktion={() => setSeite({ art: 'form' })}
          />
        </Card>
      ) : null}

      {offen.map((entry) => (
        <GutscheinKarte
          key={entry.id ?? entry.shop}
          entry={entry}
          heute={heute}
          onOpen={() => entry.id && setSeite({ art: 'detail', id: entry.id })}
          onAbziehen={() => setAbzugId(entry.id ?? null)}
          eigen={eigen}
          colors={colors}
        />
      ))}

      {/* Aufgebrauchte bleiben da, aber eingeklappt: Der Verlauf sagt
          noch, wer wann was gebraucht hat, und niemand will das täglich
          sehen. */}
      {leer.length > 0 ? (
        <Pressable
          onPress={() => setLeerOffen(!leerOffen)}
          accessibilityRole="button"
          accessibilityState={{ expanded: leerOffen }}
          style={styles.clearButton}
        >
          <Text style={styles.resetText}>
            {leerOffen ? 'Aufgebrauchte ausblenden' : `Aufgebraucht (${leer.length})`}
          </Text>
        </Pressable>
      ) : null}
      {leerOffen
        ? leer.map((entry) => (
            <GutscheinKarte
              key={entry.id ?? entry.shop}
              entry={entry}
              heute={heute}
              onOpen={() => entry.id && setSeite({ art: 'detail', id: entry.id })}
              onAbziehen={() => {}}
              eigen={eigen}
              colors={colors}
            />
          ))
        : null}

      <AbziehenDialog
        entry={abzug}
        onBestaetigen={abziehenBestaetigen}
        onAbbrechen={() => setAbzugId(null)}
        styles={styles}
        eigen={eigen}
        colors={colors}
      />
    </View>
  );
}

// ── Stile ────────────────────────────────────────────────────────────────

type Eigen = ReturnType<typeof makeStyles>;

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    kopfZeile: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    kopfZahl: { color: colors.onGradient, fontSize: 26, fontWeight: '800' },
    neuKnopf: {
      width: 40,
      height: 40,
      borderRadius: 20,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },

    // ── Karte in der Liste ────────────────────────────────────────────
    karte: { minHeight: 0, gap: 10 },
    karteKopf: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    ladenBox: {
      width: 44,
      height: 44,
      borderRadius: 14,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    laden: { color: colors.ink, fontSize: 17, fontWeight: '700' },
    titel: { color: colors.inkSoft, fontSize: 13 },
    betragZeile: { flexDirection: 'row', alignItems: 'baseline', gap: 4 },
    betragGross: { color: colors.ink, fontSize: 24, fontWeight: '800' },
    betragEinheit: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    balken: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.track,
      overflow: 'hidden',
    },
    balkenFuellung: { height: '100%', borderRadius: 3 },
    karteFuss: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    chipZeile: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 2 },
    chipKlein: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 4,
      paddingHorizontal: 8,
      paddingVertical: 3,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipKleinText: { color: colors.ink, fontSize: 11, fontWeight: '600' },
    kategorieText: { color: colors.inkFaint, fontSize: 11, fontWeight: '600' },
    gueltigText: { fontSize: 14, fontWeight: '600' },
    abziehenKnopf: {
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.accent,
    },
    abziehenText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

    // ── Detail ────────────────────────────────────────────────────────
    detailKarte: { minHeight: 0, gap: 12 },
    detailBild: {
      width: '100%',
      aspectRatio: 16 / 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
    },
    detailKopf: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    detailLaden: { color: colors.inkSoft, fontSize: 12, fontWeight: '700', letterSpacing: 1 },
    detailTitel: { color: colors.ink, fontSize: 24, fontWeight: '800' },
    vonChip: {
      paddingHorizontal: 10,
      paddingVertical: 5,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    vonText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    detailBetrag: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
    detailZahl: { color: colors.ink, fontSize: 40, fontWeight: '800' },
    detailEinheit: { color: colors.inkSoft, fontSize: 18, fontWeight: '800' },
    vonGesamt: { color: colors.inkSoft, fontSize: 14 },
    feldRaster: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    feld: {
      flexGrow: 1,
      flexBasis: '45%',
      gap: 2,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    feldLabel: { color: colors.inkSoft, fontSize: 11, fontWeight: '700', letterSpacing: 0.8 },
    feldWert: { color: colors.ink, fontSize: 16, fontWeight: '600' },
    pinZeile: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
    rueckmeldung: { color: colors.on, fontSize: 13, fontWeight: '600' },
    linkZeile: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    linkText: { color: colors.accent, fontSize: 14, textDecorationLine: 'underline', flex: 1 },
    notiz: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
    trenner: { height: 1, backgroundColor: colors.surfaceBorder },
    verlaufZeile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    verlaufBetrag: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    knopfReihe: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', gap: 8 },
    primaerKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 16,
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    primaerText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    sekundaerKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingHorizontal: 14,
      paddingVertical: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    sekundaerText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    loeschKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 6,
      paddingVertical: 8,
    },
    loeschText: { color: colors.danger, fontSize: 14, fontWeight: '600' },

    // ── Formular ──────────────────────────────────────────────────────
    formFeld: { gap: 6 },
    formLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    fotoWahl: {
      borderRadius: radius.control,
      overflow: 'hidden',
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    fotoVorschau: { width: '100%', aspectRatio: 16 / 10 },
    fotoLeer: {
      width: '100%',
      aspectRatio: 16 / 6,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    fotoHinweis: { color: colors.inkSoft, fontSize: 14, fontWeight: '600' },
    fotoAktion: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    fotoAktionText: { color: colors.accent, fontSize: 13, fontWeight: '600' },

    // ── Abziehen-Dialog ───────────────────────────────────────────────
    dialogTitel: { color: colors.ink, fontSize: 20, fontWeight: '800', textAlign: 'center' },
    dialogFrage: { color: colors.inkSoft, fontSize: 14, textAlign: 'center', lineHeight: 20 },
    dialogEingabe: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingHorizontal: 16,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    dialogZahl: { flex: 1, color: colors.ink, fontSize: 30, fontWeight: '800', textAlign: 'center' },
    dialogEinheit: { color: colors.inkSoft, fontSize: 18, fontWeight: '700' },
    dialogKnoepfe: { flexDirection: 'row', gap: 10 },
  });
