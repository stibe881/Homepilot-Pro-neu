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
 * **Foto und Datei.** Das Foto zeigt die Karte, die Datei ist der Beleg –
 * meist das PDF aus der Bestätigungsmail (Punkt 266 der Werkbank).
 * Beides darf gleichzeitig dranhängen; die Datei liegt wie das Bild beim
 * Hub und wird von dort mit Token geholt.
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
import * as DocumentPicker from 'expo-document-picker';
import * as ImagePicker from 'expo-image-picker';
import React, { useEffect, useMemo, useState } from 'react';
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

import { hubClient } from '../../api/client';
import { HubSettings } from '../../api/types';
import { belegLesen, belegSatz } from '../../lib/gutscheinlesen';
import { Card } from '../../components/Card';
import { Tastaturplatz } from '../../components/Tastaturplatz';
import { Leerzustand } from '../../components/Leerzustand';
import { QrScanner } from '../../components/QrScanner';
import { Kassencode } from '../../components/Kassencode';
import { gescannteArt, kassenart } from '../../lib/strichcode';
import {
  Ablaufstufe,
  DATEI_TYPEN,
  CODEARTEN,
  EINHEITEN,
  EINLOESEN,
  Formular,
  GETEILT,
  Geteilt,
  Gutschein,
  GutscheinDatei,
  ablaufSatz,
  ablaufStufe,
  abziehen,
  archivieren,
  archivListe,
  istArchiviert,
  vorlageFuerLaden,
  wartetAufAnnahme,
  wiederherstellen,
  Transaktion,
  abzugPruefen,
  bilanzSatz,
  buchungSatz,
  nachLaden,
  restHinweis,
  stornieren,
  stornoPruefen,
  uebergeben,
  alsGutschein,
  anteil,
  aufgeteilt,
  betragLesen,
  betragText,
  betragZahl,
  MAX_DATEIEN,
  anhaenge,
  anhaengeSatz,
  dateiGroesse,
  dateiPruefen,
  dateiSatz,
  dateiSymbol,
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
  MITNEHMEN,
  mimeVon,
  mitMimeTyp,
  restText,
  teilText,
  verlauf,
  verlaufLeerbild,
} from '../../lib/gutscheine';
import { datumUhr } from '../../lib/format';
import { tapped } from '../../lib/haptics';
import { ZIFFERN } from '../../lib/schriftart';
import { appleMapsRoute, googleMapsRoute } from '../../components/TopStrip';
import { type Ort, kartenZiel, ortFuer } from '../../lib/ladenkarte';
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

/**
 * Eine beliebige Datei als data-URI einlesen (Punkt 266 der Werkbank).
 *
 * Das Foto nimmt den kurzen Weg über `expo-image-manipulator`, der
 * base64 gleich mitliefert; für eine beliebige Datei gäbe es
 * `expo-file-system` – das steht aber nicht in den Abhängigkeiten der
 * App, sondern hängt nur unter `expo/` mit und ist von hier aus nicht
 * auflösbar. Ein Paket dazuzunehmen hiesse eine neue runtimeVersion
 * samt TestFlight-Build (siehe CLAUDE.md).
 *
 * Deshalb der Weg über Blob und FileReader, den beide Seiten können und
 * bei dem kein Server im Spiel ist: Im Browser liegt die gewählte Datei
 * unter einer `blob:`-Adresse, auf dem Telefon nach
 * `copyToCacheDirectory` unter einer `file://`-Adresse – beide
 * beantwortet React Native selbst, das Blob-Modul hängt sich dafür vor
 * das Netz.
 */
async function alsDatenUri(uri: string, mime: string): Promise<string | null> {
  if (uri.startsWith('data:')) return mitMimeTyp(uri, mime);
  try {
    const antwort = await fetch(uri);
    const blob = await antwort.blob();
    const gelesen = await new Promise<string | null>((fertig) => {
      const leser = new FileReader();
      leser.onerror = () => fertig(null);
      leser.onload = () => fertig(typeof leser.result === 'string' ? leser.result : null);
      leser.readAsDataURL(blob);
    });
    return gelesen ? mitMimeTyp(gelesen, mime) : null;
  } catch {
    return null;
  }
}

/** null: abgebrochen. Sonst die Datei – oder der Grund, warum nicht. */
type DateiWahl = { datei: GutscheinDatei } | { fehler: string } | null;

/**
 * Eine Datei auswählen, prüfen und einlesen.
 *
 * Geprüft wird **vor** dem Einlesen: Eine 40 MB grosse Datei erst nach
 * dem Warten abgelehnt zu bekommen ist die schlechtere Reihenfolge – und
 * als data-URI im Speicher wäre sie ohnehin ein Drittel grösser.
 */
async function holeDatei(): Promise<DateiWahl> {
  const ergebnis = await DocumentPicker.getDocumentAsync({
    type: DATEI_TYPEN,
    copyToCacheDirectory: true,
    multiple: false,
  }).catch(() => null);
  if (!ergebnis || ergebnis.canceled || !ergebnis.assets?.length) return null;
  const asset = ergebnis.assets[0];
  const grund = dateiPruefen({ name: asset.name, size: asset.size, mimeType: asset.mimeType });
  if (grund) return { fehler: grund };
  const type = mimeVon(asset.name, asset.mimeType);
  // `base64` fordern wir nicht an: Der Auswähler läse die Datei dann
  // schon, bevor wir ihre Grösse prüfen konnten. Liefert eine Fassung
  // sie doch mit, nehmen wir sie natürlich.
  const data = await alsDatenUri(asset.base64 ?? asset.uri, type);
  if (!data) {
    return { fehler: 'Die Datei liess sich nicht lesen. Bitte noch einmal versuchen.' };
  }
  return { datei: { data, name: asset.name, type, bytes: asset.size } };
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

/** Der Chip «Karte mitbringen» (Punkt 267 der Werkbank).
 *
 * Er steht schon in der Liste und nicht erst im Detail: Gebraucht wird
 * er in dem Moment, in dem jemand vor der Tür überlegt, ob er noch
 * etwas einstecken muss - und da öffnet niemand jeden Gutschein
 * einzeln.
 */
function MitnehmenChip({ eigen, colors }: { eigen: Eigen; colors: Colors }) {
  return (
    <View style={eigen.chipKlein}>
      <Ionicons name="wallet-outline" size={12} color={colors.accent} />
      <Text style={eigen.chipKleinText}>{MITNEHMEN}</Text>
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
      )}, ${entry.shared === 'familie' ? 'Familie' : 'Privat'}${
        entry.physical ? `, ${MITNEHMEN}` : ''
      }${anhaenge(entry).length > 0 ? `, mit Beleg: ${anhaengeSatz(anhaenge(entry))}` : ''}`}
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
            {entry.physical ? <MitnehmenChip eigen={eigen} colors={colors} /> : null}
            {/* Wo der Beleg liegt, soll man sehen, ohne jeden Gutschein
                zu öffnen - deshalb das Symbol schon auf der Karte. */}
            {entry.file ? (
              <Ionicons
                name={dateiSymbol(entry.file.type) as keyof typeof Ionicons.glyphMap}
                size={14}
                color={colors.inkSoft}
              />
            ) : null}
            {anhaenge(entry).length > 1 ? (
              <Text style={eigen.dateiMass}>{anhaenge(entry).length}</Text>
            ) : null}
            {entry.category ? <Text style={eigen.kategorieText}>{entry.category}</Text> : null}
          </View>
          <Text style={[eigen.gueltigText, { color: ablaufFarbe(stufe, colors) }]}>
            {ablaufSatz(entry.expires, heute)}
          </Text>
          {/* «Noch CHF 3.20 drauf» ist eine andere Auskunft als
              «CHF 3.20 übrig»: Sie sagt, dass man den Gutschein beim
              nächsten Einkauf mitnimmt, statt für ihn loszufahren
              (Punkt 303 der Werkbank). */}
          {!leer && restHinweis(entry) ? (
            <Text style={eigen.kategorieText}>{restHinweis(entry)}</Text>
          ) : null}
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
  onStorno,
  onUebergeben,
  haushalt = [],
  orte = [],
  onBearbeiten,
  onLoeschen,
  onArchivieren,
  styles,
  eigen,
  colors,
}: {
  entry: Gutschein;
  heute: string;
  settings: HubSettings;
  onBack: () => void;
  onAbziehen: () => void;
  /** Einen Abzug zurücknehmen (Punkt 302). */
  onStorno?: (buchung: Transaktion) => void;
  /** Den Gutschein jemandem im Haushalt übergeben (Punkt 306). */
  onUebergeben?: (an: string) => void;
  /** Wer im Haushalt in Frage kommt - ohne mich selbst. */
  haushalt?: string[];
  /** Die Läden mit Koordinaten, wie der Einkaufszettel sie führt -
   *  daraus wird der Weg zum Laden (lib/ladenkarte.ts). */
  orte?: Ort[];
  onBearbeiten: () => void;
  onLoeschen: () => void;
  /** Ins Archiv legen bzw. von dort zurückholen (Punkt 372). */
  onArchivieren: () => void;
  styles: Styles;
  eigen: Eigen;
  colors: Colors;
}) {
  const [pinSichtbar, setPinSichtbar] = useState(false);
  // An der Kasse wird gescannt, nicht vorgelesen (Punkt 299/300).
  const [kasse, setKasse] = useState(false);
  const [uebergabeOffen, setUebergabeOffen] = useState(false);
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
          {feld('Einlösen', entry.physical ? MITNEHMEN : 'Nummer genügt')}
        </View>
        {rueckmeldung ? <Text style={eigen.rueckmeldung}>{rueckmeldung}</Text> : null}
        {stufe !== 'ok' && stufe !== 'unbegrenzt' ? (
          <Text style={[eigen.gueltigText, { color: ablaufFarbe(stufe, colors) }]}>
            {ablaufSatz(entry.expires, heute)}
          </Text>
        ) : null}
        {/* Der Weg zum Laden. Der Name allein genügt, um den Gutschein
            wiederzufinden - nicht, um hinzufahren; wer die Adresse
            sucht, tippt den Namen in eine Kartenapp ab, und bei
            «Chrüterhüsli» tippt er ihn falsch ab. Ist der Laden als Ort
            angelegt (beim Einkaufszettel), führt die Karte an die Tür
            statt an die Hauptfiliale, die zufällig denselben Namen
            trägt (lib/ladenkarte.ts). */}
        {kartenZiel(entry.shop, orte) ? (
          <Pressable
            onPress={() => {
              const ziel = kartenZiel(entry.shop, orte);
              if (!ziel) return;
              const adresse =
                Platform.OS === 'android'
                  ? googleMapsRoute(ziel)
                  : appleMapsRoute(ziel);
              Linking.openURL(adresse).catch(() => {});
            }}
            accessibilityRole="link"
            accessibilityLabel={`Route zu ${entry.shop} öffnen`}
            style={eigen.linkZeile}
          >
            <Ionicons name="location-outline" size={16} color={colors.accent} />
            <Text style={eigen.linkText} numberOfLines={1}>
              {ortFuer(entry.shop, orte)
                ? `Route zu ${ortFuer(entry.shop, orte)?.name}`
                : `${entry.shop} auf der Karte suchen`}
            </Text>
          </Pressable>
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
        {/* Alle Belege (Punkt 431): Bestellbestätigung und Gutschein-PDF
            gehören beide dran, jeder mit eigener Adresse. */}
        {anhaenge(entry).map((datei, index) => (
          <Pressable
            key={datei.id ?? datei.url ?? index}
            onPress={() => {
              // Die Datei liegt beim Hub und braucht den Token - dieselbe
              // Adresse wie das Bild, deshalb derselbe Griff.
              const ziel = bildUri(datei.url, settings);
              if (ziel) Linking.openURL(ziel).catch(() => {});
            }}
            accessibilityRole="button"
            accessibilityLabel={`${dateiSatz(datei)} – öffnen`}
            style={({ pressed }) => [eigen.dateiZeile, pressed && { opacity: 0.8 }]}
          >
            <Ionicons
              name={dateiSymbol(datei.type) as keyof typeof Ionicons.glyphMap}
              size={22}
              color={colors.accent}
            />
            <View style={{ flex: 1, minWidth: 0 }}>
              <Text style={eigen.dateiName} numberOfLines={1}>
                {datei.name}
              </Text>
              <Text style={eigen.dateiMass}>{dateiGroesse(datei.bytes) || 'Beleg'}</Text>
            </View>
            <Ionicons name="open-outline" size={18} color={colors.inkSoft} />
          </Pressable>
        ))}
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
          buchungen.map((buchung, index) => {
            // Warum eine Zeile steht, sagt sie selbst: «30.00 CHF
            // abgezogen», «zurückgebucht», «Übergeben an Bine» - ein
            // blosses «−30.00» liesse Abzug und Rücknahme gleich
            // aussehen (Punkt 302 der Werkbank).
            const hindernis = stornoPruefen(entry, buchung);
            return (
              <View key={`${buchung.at}-${index}`} style={eigen.verlaufZeile}>
                <View style={{ flex: 1 }}>
                  <Text style={styles.checkText}>{buchung.by || '?'}</Text>
                  <Text style={styles.checkSub}>
                    {buchung.at ? datumUhr(new Date(buchung.at)) : ''}
                    {buchung.note ? ` · ${buchung.note}` : ''}
                  </Text>
                </View>
                <Text style={eigen.verlaufBetrag}>{buchungSatz(entry, buchung)}</Text>
                {hindernis === null && onStorno ? (
                  <Pressable
                    onPress={() => onStorno(buchung)}
                    accessibilityRole="button"
                    accessibilityLabel={`${buchungSatz(entry, buchung)} zurücknehmen`}
                    hitSlop={8}
                  >
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.inkSoft} />
                  </Pressable>
                ) : null}
              </View>
            );
          })
        )}

        <View style={eigen.knopfReihe}>
          {/* An der Kasse wird gescannt, nicht vorgelesen. Der Knopf
              steht nur da, wenn es eine Nummer gibt - ein leerer Code
              ist schlimmer als keiner, weil man mit ihm losfährt. */}
          {entry.number ? (
            <Pressable
              onPress={() => {
                tapped();
                setKasse(true);
              }}
              accessibilityRole="button"
              accessibilityLabel="An der Kasse zeigen"
              style={({ pressed }) => [eigen.sekundaerKnopf, pressed && { opacity: 0.8 }]}
            >
              {/* Das Symbol zeigt schon, was gleich kommt - wer den
                  QR-Code sucht, erkennt am Strichcode-Symbol sonst
                  nicht, dass er hier richtig ist. */}
              <Ionicons
                name={kassenart(entry.number, entry.code) === 'qr' ? 'qr-code-outline' : 'barcode-outline'}
                size={18}
                color={colors.ink}
              />
              <Text style={eigen.sekundaerText}>An der Kasse</Text>
            </Pressable>
          ) : null}
          {onUebergeben && haushalt.length > 0 && !wartetAufAnnahme(entry) ? (
            <Pressable
              onPress={() => setUebergabeOffen((wert) => !wert)}
              accessibilityRole="button"
              accessibilityLabel="Gutschein übergeben"
              accessibilityState={{ expanded: uebergabeOffen }}
              style={({ pressed }) => [eigen.sekundaerKnopf, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="swap-horizontal-outline" size={18} color={colors.ink} />
              <Text style={eigen.sekundaerText}>Übergeben</Text>
            </Pressable>
          ) : null}
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
        {wartetAufAnnahme(entry) ? (
          // Punkt 377: solange die Annahme aussteht, gehört der
          // Gutschein noch dem bisherigen Besitzer - das soll auch hier
          // stehen, nicht nur im Verlauf.
          <Text style={styles.checkSub}>
            Wartet auf Annahme von {entry.pending_transfer_to}.
          </Text>
        ) : null}
        {uebergabeOffen && onUebergeben ? (
          <View style={{ gap: 6 }}>
            {/* Nicht dasselbe wie Teilen: Geteilt heisst «alle sehen
                ihn», übergeben heisst «er gehört jetzt dir» - bei einem
                privaten Gutschein der einzige Weg, ihn weiterzugeben,
                ohne ihn allen zu zeigen. Der Besitzer wechselt aber erst
                mit der Annahme (Punkt 377). */}
            <Text style={styles.checkSub}>Wem vorschlagen?</Text>
            <View style={eigen.knopfReihe}>
              {haushalt.map((name) => (
                <Pressable
                  key={name}
                  onPress={() => {
                    setUebergabeOffen(false);
                    onUebergeben(name);
                  }}
                  accessibilityRole="button"
                  accessibilityLabel={`${name} vorschlagen`}
                  style={({ pressed }) => [eigen.sekundaerKnopf, pressed && { opacity: 0.8 }]}
                >
                  <Text style={eigen.sekundaerText}>{name}</Text>
                </Pressable>
              ))}
            </View>
          </View>
        ) : null}
        <Pressable
          onPress={() => {
            tapped();
            onArchivieren();
          }}
          accessibilityRole="button"
          accessibilityLabel={
            istArchiviert(entry)
              ? `${entry.shop} aus dem Archiv holen`
              : `${entry.shop} archivieren`
          }
          style={({ pressed }) => [eigen.loeschKnopf, pressed && { opacity: 0.7 }]}
        >
          <Ionicons
            name={istArchiviert(entry) ? 'arrow-undo-outline' : 'archive-outline'}
            size={16}
            color={colors.inkSoft}
          />
          <Text style={[eigen.loeschText, { color: colors.inkSoft }]}>
            {istArchiviert(entry) ? 'Aus dem Archiv holen' : 'Archivieren'}
          </Text>
        </Pressable>
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

      {/* An der Kasse (Punkt 299/300 der Werkbank).
          Weiss, gross und ohne alles: Ein Scanner misst den Unterschied
          zwischen hell und dunkel, und der Kassiererin hilft eine Seite
          mit Code, Nummer und Laden - nicht die halbe App drumherum.
          Der Bildschirm bleibt dabei an; die Systemhelligkeit lässt
          sich ohne natives Modul nicht hochdrehen, aber ein weisser
          Grund über den ganzen Bildschirm bringt den grössten Teil
          davon ohnehin. */}
      <Modal visible={kasse} animationType="slide" onRequestClose={() => setKasse(false)}>
        <Pressable
          onPress={() => setKasse(false)}
          accessibilityRole="button"
          accessibilityLabel="Schliessen"
          style={{
            flex: 1,
            backgroundColor: '#FFFFFF',
            alignItems: 'center',
            justifyContent: 'center',
            padding: 24,
            gap: 18,
          }}
        >
          <Text style={{ color: '#000000', fontSize: 22, fontWeight: '700' }}>
            {entry.shop}
          </Text>
          <Kassencode nummer={entry.number} art={entry.code} hoehe={120} />
          {entry.pin ? (
            <Text style={{ color: '#000000', fontSize: 16 }}>PIN {entry.pin}</Text>
          ) : null}
          <Text style={{ color: '#000000', fontSize: 18, fontWeight: '700' }}>
            {restText(entry)}
          </Text>
          {entry.physical ? (
            <Text style={{ color: '#B45309', fontSize: 14 }}>{MITNEHMEN}</Text>
          ) : null}
          <Text style={{ color: '#666666', fontSize: 13 }}>Tippen zum Schliessen</Text>
        </Pressable>
      </Modal>
    </View>
  );
}

// ── Das Formular ─────────────────────────────────────────────────────────

function FormularBlatt({
  bisher,
  vorhandeneKategorien,
  vorhandeneLaeden,
  vorlagenQuelle,
  settings,
  onSave,
  onCancel,
  styles,
  eigen,
  colors,
}: {
  bisher: Gutschein | null;
  vorhandeneKategorien: string[];
  /** Die Läden, die es schon gibt - der Beleg-Leser rät den Laden nur
   *  aus dieser Liste («noreply» als Ladennamen hat niemandem
   *  geholfen). */
  vorhandeneLaeden: string[];
  /** Alle Gutscheine, für die Vorlage je Laden (Punkt 375 der Werkbank). */
  vorlagenQuelle: Gutschein[];
  settings: HubSettings;
  onSave: (eintrag: Gutschein) => void;
  onCancel: () => void;
  styles: Styles;
  eigen: Eigen;
  colors: Colors;
}) {
  const [form, setForm] = useState<Formular>(() => (bisher ? formularVon(bisher) : leeresFormular()));
  const [fehler, setFehler] = useState<string | null>(null);
  // Der Grund einer abgelehnten Datei steht beim Abschnitt, nicht unten
  // beim Speichern-Knopf: Dort schaut in dem Moment niemand hin.
  const [dateiFehler, setDateiFehler] = useState<string | null>(null);
  // Die Nummer scannen statt abtippen (Punkt 369).
  const [scannerOffen, setScannerOffen] = useState(false);
  const setze = <K extends keyof Formular>(key: K, wert: Formular[K]) =>
    setForm((vorher) => ({ ...vorher, [key]: wert }));
  const bild = bildUri(form.image_url, settings);

  // ── Aus dem Beleg übernehmen (Punkt 298 der Werkbank) ──────────────
  //
  // Drei Wege zum Text, und alle drei sind derselbe Knopf: Ein
  // angehängter Klartext lässt sich hier lesen, ein schon beim Hub
  // liegendes PDF holt der Hub (`/belegtext`, braucht das Extra
  // `pypdf`), und wenn beides nichts hergibt, klappt ein Feld auf, in
  // das man den Text der Mail einfügt. Der letzte Weg ist der, der
  // immer funktioniert - deshalb ist er nicht versteckt, sondern die
  // Antwort auf «nichts gefunden».
  //
  // Übernommen wird als *Vorschlag*: Die Felder füllen sich, wer
  // hinsieht, korrigiert. Bei Geld wäre ein stiller Automatismus die
  // falsche Zusage.
  const [belegText, setBelegText] = useState('');
  const [belegOffen, setBelegOffen] = useState(false);
  const [belegMeldung, setBelegMeldung] = useState<string | null>(null);

  const uebernehmen = (text: string) => {
      const fund = belegLesen(text, vorhandeneLaeden);
    setBelegMeldung(belegSatz(fund));
    setForm((vorher) => ({
      ...vorher,
      shop: fund.shop ?? vorher.shop,
      unit: fund.unit ?? vorher.unit,
      total:
        fund.total !== undefined
          ? fund.unit === 'stk'
            ? String(fund.total)
            : fund.total.toFixed(2)
          : vorher.total,
      number: fund.number ?? vorher.number,
      pin: fund.pin ?? vorher.pin,
      expires: fund.expires ? datumText(fund.expires) : vorher.expires,
    }));
    return Object.keys(fund).length > 0;
  };

  const belegLesenLassen = async () => {
    tapped();
    // Klartext-Anhänge: hier lesbar, ohne den Hub zu fragen - alle
    // hintereinander, der Betrag steht im einen, die Nummer im anderen.
    const klartext: string[] = [];
    for (const datei of form.files) {
      const roh = datei.data ?? '';
      if (!roh.startsWith('data:text/')) continue;
      const teil = roh.slice(roh.indexOf(',') + 1);
      try {
        // `atob` gibt es im Browser und in Hermes; wo nicht, greift der
        // catch und der nächste Weg. Ein fehlender Dekodierer ist kein
        // Grund für eine Fehlermeldung.
        klartext.push(roh.includes(';base64,') ? globalThis.atob(teil) : decodeURIComponent(teil));
      } catch {
        // Unlesbar heisst: den nächsten Weg versuchen.
      }
    }
    if (klartext.length > 0 && uebernehmen(klartext.join('\n\n'))) return;
    if (bisher?.id) {
      const antwort = await hubClient(settings.url, settings.token).get<{
        text?: string;
        verfuegbar?: boolean;
      } | null>(`/api/family/vouchers/${encodeURIComponent(bisher.id)}/belegtext`, {
        fallback: null,
        still: true,
      });
      if (antwort?.text && uebernehmen(antwort.text)) return;
      if (antwort && antwort.verfuegbar === false) {
        setBelegMeldung(
          'Der Hub kann PDF nicht lesen – unter System → Zusatzteile nachinstallieren.'
        );
        setBelegOffen(true);
        return;
      }
    }
    setBelegMeldung('Nichts gefunden – Text der Mail hier einfügen:');
    setBelegOffen(true);
  };

  const dateiWaehlen = async () => {
    const wahl = await holeDatei();
    if (!wahl) return;
    if ('fehler' in wahl) {
      setDateiFehler(wahl.fehler);
      return;
    }
    tapped();
    setDateiFehler(null);
    // Anhängen, nicht ersetzen (Punkt 431) - bis zur Grenze des Hubs.
    if (form.files.length >= MAX_DATEIEN) {
      setDateiFehler(`Mehr als ${MAX_DATEIEN} Belege nimmt der Hub nicht an.`);
      return;
    }
    setze('files', [...form.files, wahl.datei]);
  };

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
        {eingabe('Laden', 'shop', {
          placeholder: 'z.B. Brack.ch',
          autoFocus: !bisher,
          // Vorlage je Laden (Punkt 375): nur bei einem neuen Gutschein
          // und nur, solange noch nichts anderes eingestellt wurde -
          // sonst würde die Vorlage überschreiben, was der Beleg-Leser
          // oder die Person selbst schon eingetragen hat.
          onBlur: () => {
            if (bisher || form.category || form.unit !== 'chf' || form.physical) return;
            const vorlage = vorlageFuerLaden(vorlagenQuelle, form.shop);
            if (vorlage) setForm((vorher) => ({ ...vorher, ...vorlage }));
          },
        })}
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
        {/* Scannen statt abtippen (Punkt 369 der Werkbank) - dort
            passieren die Zahlendreher, die man erst an der Kasse merkt,
            und viele Gutschein-Karten tragen ihre Nummer ohnehin als
            Strichcode. */}
        <Pressable
          onPress={() => setScannerOffen(true)}
          accessibilityRole="button"
          accessibilityLabel="Nummer scannen"
          style={({ pressed }) => [eigen.fotoAktion, pressed && { opacity: 0.7 }]}
        >
          <Ionicons name="barcode-outline" size={16} color={colors.accent} />
          <Text style={eigen.fotoAktionText}>Nummer scannen</Text>
        </Pressable>
        {/* Womit die Kasse liest (Punkt 420). Steht direkt bei der
            Nummer, weil es zu ihr gehört - und nicht bei den Bildern,
            wo man es beim Erfassen nicht mehr sucht. */}
        <View style={eigen.formFeld}>
          <Text style={eigen.formLabel}>Code auf der Karte</Text>
          <View style={styles.chipRow}>
            {CODEARTEN.map((wahl) => (
              <Pressable
                key={wahl.key}
                onPress={() => setze('code', wahl.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: form.code === wahl.key }}
                style={[styles.chip, form.code === wahl.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, form.code === wahl.key && styles.chipTextActive]}>
                  {wahl.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.formHintSmall}>
            Das Bild, das «An der Kasse» über den Scanner geht. Beim Scannen stellt es sich
            selbst ein. Eine Nummer, die als Strichcode gar nicht lesbar wäre – eine lange
            Adresse etwa –, wird ohnehin als QR-Code gezeigt.
          </Text>
        </View>
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

        <View style={eigen.formFeld}>
          <Text style={eigen.formLabel}>Einlösen</Text>
          <View style={styles.chipRow}>
            {EINLOESEN.map((wahl) => (
              <Pressable
                key={String(wahl.key)}
                onPress={() => setze('physical', wahl.key)}
                accessibilityRole="button"
                accessibilityState={{ selected: form.physical === wahl.key }}
                style={[styles.chip, form.physical === wahl.key && styles.chipActive]}
              >
                <Text style={[styles.chipText, form.physical === wahl.key && styles.chipTextActive]}>
                  {wahl.label}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.formHintSmall}>
            «{MITNEHMEN}» heisst: Ohne die Karte, den Bon oder den Ausdruck geht im Laden
            nichts – die Nummer allein nützt dort nicht. Steht dann schon in der Liste, damit
            man es vor dem Losfahren sieht.
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

        <View style={eigen.formFeld}>
          <Text style={eigen.formLabel}>Belege</Text>
          {form.files.map((datei, index) => (
            <View key={datei.id ?? datei.url ?? `${datei.name}-${index}`} style={eigen.dateiZeile}>
              <Ionicons
                name={dateiSymbol(datei.type) as keyof typeof Ionicons.glyphMap}
                size={22}
                color={colors.accent}
              />
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={eigen.dateiName} numberOfLines={1}>
                  {datei.name}
                </Text>
                <Text style={eigen.dateiMass}>
                  {dateiGroesse(datei.bytes) || (datei.url ? 'Beim Hub abgelegt' : 'Bereit')}
                </Text>
              </View>
              <Pressable
                onPress={() => {
                  setze('files', form.files.filter((_, i) => i !== index));
                  setDateiFehler(null);
                }}
                hitSlop={8}
                accessibilityRole="button"
                accessibilityLabel={`Datei ${datei.name} entfernen`}
              >
                <Ionicons name="close-circle" size={22} color={colors.inkSoft} />
              </Pressable>
            </View>
          ))}
          <Pressable
            onPress={dateiWaehlen}
            accessibilityRole="button"
            accessibilityLabel={form.files.length > 0 ? 'Weiteren Beleg anhängen' : 'PDF oder Dokument wählen'}
            style={({ pressed }) => [eigen.fotoAktion, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="attach-outline" size={16} color={colors.accent} />
            <Text style={eigen.fotoAktionText}>
              {form.files.length > 0 ? 'Weiteren Beleg anhängen' : 'PDF oder Dokument wählen'}
            </Text>
          </Pressable>
          {dateiFehler ? <Text style={styles.error}>{dateiFehler}</Text> : null}
          <Pressable
            onPress={belegLesenLassen}
            accessibilityRole="button"
            accessibilityLabel="Betrag, Nummer und Ablaufdatum aus dem Beleg übernehmen"
            style={({ pressed }) => [eigen.fotoAktion, pressed && { opacity: 0.7 }]}
          >
            <Ionicons name="sparkles-outline" size={16} color={colors.accent} />
            <Text style={eigen.fotoAktionText}>Aus Beleg übernehmen</Text>
          </Pressable>
          {belegMeldung ? <Text style={styles.checkSub}>{belegMeldung}</Text> : null}
          {belegOffen ? (
            <View style={{ gap: 6 }}>
              <TextInput
                style={[styles.input, { minHeight: 90, textAlignVertical: 'top' }]}
                value={belegText}
                onChangeText={setBelegText}
                multiline
                placeholder="Text aus der Bestätigungsmail einfügen …"
                placeholderTextColor={colors.inkFaint}
                accessibilityLabel="Text des Belegs"
              />
              <Pressable
                onPress={() => {
                  if (uebernehmen(belegText)) setBelegOffen(false);
                }}
                accessibilityRole="button"
                style={({ pressed }) => [eigen.fotoAktion, pressed && { opacity: 0.7 }]}
              >
                <Ionicons name="download-outline" size={16} color={colors.accent} />
                <Text style={eigen.fotoAktionText}>Aus diesem Text übernehmen</Text>
              </Pressable>
            </View>
          ) : null}
          <Text style={styles.formHintSmall}>
            Foto und Datei dürfen beide dran sein: Das Foto zeigt die Karte, die Datei ist
            der Beleg – meist das PDF aus der Bestätigungsmail. Bis 10 MB, als PDF, Bild,
            Word, Excel, Text oder ZIP.
          </Text>
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
      <QrScanner
        visible={scannerOffen}
        onClose={() => setScannerOffen(false)}
        onText={(text, art) => {
          setze('number', text);
          // Die Kamera weiss, welche Schrift sie gelesen hat - und das
          // ist die verlässlichste Auskunft darüber, was auf der Karte
          // steht (Punkt 420). Von Hand umstellen kann man es darunter.
          setze('code', gescannteArt(art));
        }}
        // EAN-13 und Code 128 sind die üblichen Strichcodes auf einer
        // Gutschein-Karte (dieselben zwei, die lib/strichcode.ts an der
        // Kasse zeichnet, Punkt 299/300); QR für den selteneren Fall.
        barcodeTypes={['ean13', 'code128', 'qr']}
        titel="Nummer scannen"
        hinweis="Den Strichcode oder QR-Code auf der Gutschein-Karte ins Bild halten."
      />
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
      {/* Der Betrag wird getippt - ohne das läge die Zahlentastatur auf
          dem Feld (Punkt 265 der Werkbank). */}
      <Tastaturplatz>
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
                {/* Der Normalfall bei Stück-Gutscheinen (Punkt 376 der
                    Werkbank): «einen einlösen», nicht erst eine Zahl
                    eintippen und bestätigen. Fünf Kinoeintritte werden
                    einzeln gebraucht, nicht auf einen Schlag. */}
                {entry.unit === 'stk' && entry.left >= 1 ? (
                  <Pressable
                    onPress={() => onBestaetigen(1)}
                    accessibilityRole="button"
                    accessibilityLabel="Einen einlösen"
                    style={[styles.chip, eigen.stueckKnopf]}
                  >
                    <Text style={[styles.chipText, eigen.stueckKnopfText]}>1 einlösen</Text>
                  </Pressable>
                ) : null}
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
      </Tastaturplatz>
    </Modal>
  );
}

// ── Das Modul ────────────────────────────────────────────────────────────

export function Gutscheine({
  eintraege,
  settings,
  ich,
  haushalt = [],
  orte = [],
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
  /** Wer im Haushalt einen Gutschein übernehmen kann (Punkt 306). */
  haushalt?: string[];
  /** Die Läden mit Koordinaten - für den Weg zum Laden. */
  orte?: Ort[];
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

  // ── Eingehende Übergaben (Punkt 377) ────────────────────────────────
  //
  // Ein eigener, schmaler Abruf statt der vollen Liste: Ein privater
  // Gutschein bleibt bis zur Annahme fremd, dieser Auszug ist die
  // einzige Stelle, an der die eingeladene Person überhaupt erfährt,
  // dass da etwas wartet. Neu geladen, sobald sich an den Gutscheinen
  // etwas ändert - dieselbe Familienseite meldet das schon über den
  // WebSocket (family_changed), was hier als geänderte `eintraege`
  // ankommt.
  const [eingehend, setEingehend] = useState<
    { id: string; shop: string; left: number; unit: 'chf' | 'stk'; by: string }[]
  >([]);
  useEffect(() => {
    let abgebrochen = false;
    hubClient(settings.url, settings.token)
      .get<typeof eingehend>('/api/family/vouchers/eingehend', { still: true, fallback: [] })
      .then((liste) => {
        if (!abgebrochen) setEingehend(liste ?? []);
      })
      .catch(() => {});
    return () => {
      abgebrochen = true;
    };
  }, [eintraege, settings.url, settings.token]);

  const uebergabeEntscheiden = async (id: string, annehmen: boolean) => {
    tapped();
    try {
      await hubClient(settings.url, settings.token).post(
        `/api/family/vouchers/${encodeURIComponent(id)}/${annehmen ? 'annehmen' : 'ablehnen'}`,
        {}
      );
      setEingehend((vorher) => vorher.filter((e) => e.id !== id));
    } catch {
      // Der nächste Abruf (oben) zeigt den wahren Stand ohnehin wieder.
    }
  };
  const [filterOffen, setFilterOffen] = useState(false);
  const [kategorie, setKategorie] = useState<string | null>(null);
  const [geteilt, setGeteilt] = useState<Geteilt | null>(null);
  const [nurBald, setNurBald] = useState(false);
  const [leerOffen, setLeerOffen] = useState(false);
  const [archivOffen, setArchivOffen] = useState(false);
  const [abzugId, setAbzugId] = useState<string | null>(null);
  // Drei Gutscheine bei Coop sind ein Betrag, keine drei Karten
  // (Punkt 305 der Werkbank). Gezeigt wird die Zeile nur, wo es etwas
  // zusammenzufassen gibt - bei lauter Einzelstücken wäre sie eine
  // zweite Liste derselben Läden.
  const laeden = useMemo(
    () => nachLaden(alle, heute).filter((gruppe) => gruppe.eintraege.length > 1),
    [alle, heute]
  );
  // Für das Raten im Beleg zählen *alle* Läden, nicht nur die mit
  // mehreren Gutscheinen - der neue Gutschein ist ja meist der erste
  // seines Ladens.
  const alleLaeden = useMemo(
    () => Array.from(new Set(alle.map((eintrag) => eintrag.shop).filter(Boolean))),
    [alle]
  );

  const gefunden = gefiltert(alle, suchtext, { kategorie, geteilt, bald: nurBald }, heute);
  const { offen, leer } = aufgeteilt(gefunden, heute);
  const archivierte = archivListe(gefunden);
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
          orte={orte}
          onBack={() => setSeite({ art: 'liste' })}
          onAbziehen={() => setAbzugId(entry.id ?? null)}
          onStorno={(buchung) => {
            if (!entry.id) return;
            const neu = stornieren(entry, buchung, ich, new Date());
            onUpdate(entry.id, { left: neu.left, transactions: neu.transactions });
          }}
          onUebergeben={(an) => {
            if (!entry.id) return;
            // Nur ein Vorschlag (Punkt 377) - der Hub sagt der
            // eingeladenen Person per Push Bescheid, und erst ihre
            // Annahme ändert den Besitzer.
            const neu = uebergeben(entry, an);
            onUpdate(entry.id, { pending_transfer_to: neu.pending_transfer_to });
          }}
          haushalt={haushalt.filter((name) => name !== (entry.author ?? ich))}
          onBearbeiten={() => setSeite({ art: 'form', id: entry.id })}
          onLoeschen={() => {
            if (entry.id) onRemove(entry.id);
            setSeite({ art: 'liste' });
          }}
          onArchivieren={() => {
            if (!entry.id) return;
            // Nur das eine Feld, nicht den ganzen Eintrag ummodeln - der
            // Hub rechnet den Rest ohnehin aus dem Verlauf (Punkt 371),
            // hier geht es nur um das Archiv-Feld selbst.
            const neu = istArchiviert(entry) ? wiederherstellen(entry) : archivieren(entry);
            onUpdate(entry.id, { archived: neu.archived });
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
        vorhandeneLaeden={alleLaeden}
        vorlagenQuelle={alle}
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
        <View style={{ flex: 1 }}>
          <Text style={eigen.kopfZahl} accessibilityRole="header">
            {kopfText(alle)}
          </Text>
          {/* Die zwei Zahlen, die vorher nirgends standen: was
              bereitliegt, und was verfallen ist. Die zweite ist die
              unangenehme und darum die wichtige - sie ist das Argument
              dafür, die Ablauf-Erinnerung ernst zu nehmen (Punkt 307). */}
          <Text style={styles.checkSub}>{bilanzSatz(alle, heute)}</Text>
        </View>
        <Pressable
          onPress={() => setSeite({ art: 'form' })}
          accessibilityRole="button"
          accessibilityLabel="Gutschein erfassen"
          style={({ pressed }) => [eigen.neuKnopf, pressed && { opacity: 0.8 }]}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>

      {/* Eingehende Übergaben (Punkt 377): ganz oben, nicht in der Liste
          versteckt - wer einen Gutschein bekommen soll, weiss davon erst
          hier, denn er steht sonst nirgends (privat, noch nicht
          angenommen). */}
      {eingehend.length > 0 ? (
        <Card style={styles.listCard}>
          <Text style={eigen.formLabel}>Für dich vorgeschlagen</Text>
          {eingehend.map((e) => (
            <View key={e.id} style={[eigen.feld, { flexDirection: 'row', alignItems: 'center' }]}>
              <Text style={{ flex: 1, color: colors.ink }}>
                {e.shop} von {e.by} · {betragText(e.left, e.unit)}
              </Text>
              <Pressable
                onPress={() => uebergabeEntscheiden(e.id, true)}
                accessibilityRole="button"
                accessibilityLabel={`Gutschein von ${e.by} annehmen`}
                style={({ pressed }) => [eigen.primaerKnopf, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="checkmark" size={18} color="#FFFFFF" />
              </Pressable>
              <Pressable
                onPress={() => uebergabeEntscheiden(e.id, false)}
                accessibilityRole="button"
                accessibilityLabel={`Gutschein von ${e.by} ablehnen`}
                style={({ pressed }) => [eigen.sekundaerKnopf, pressed && { opacity: 0.8 }]}
              >
                <Ionicons name="close" size={18} color={colors.ink} />
              </Pressable>
            </View>
          ))}
        </Card>
      ) : null}

      {laeden.length > 0 ? (
        <View style={styles.chipRow}>
          {laeden.map((gruppe) => (
            <Pressable
              key={gruppe.shop}
              onPress={() => setSuchtext(suchtext === gruppe.shop ? '' : gruppe.shop)}
              accessibilityRole="button"
              accessibilityLabel={`${gruppe.shop}: ${gruppe.eintraege.length} Gutscheine${
                gruppe.summe > 0 ? `, zusammen ${betragText(gruppe.summe, 'chf')}` : ''
              }`}
              accessibilityState={{ selected: suchtext === gruppe.shop }}
              style={[styles.chip, suchtext === gruppe.shop && styles.chipActive]}
            >
              <Text style={styles.chipText}>
                {gruppe.shop}
                {gruppe.summe > 0 ? ` · ${betragText(gruppe.summe, 'chf')}` : ''}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}

      <View style={styles.suchRow}>
        <Ionicons name="search" size={16} color={colors.inkSoft} />
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

      {/* Das Archiv (Punkt 372): erledigte Gutscheine, ob automatisch
          hineingelegt (aufgebraucht, verfallen) oder von Hand. Noch
          eingeklappter als «Aufgebraucht» - wer archiviert hat, wollte
          den Gutschein aus dem Weg haben. */}
      {archivierte.length > 0 ? (
        <Pressable
          onPress={() => setArchivOffen(!archivOffen)}
          accessibilityRole="button"
          accessibilityState={{ expanded: archivOffen }}
          style={styles.clearButton}
        >
          <Text style={styles.resetText}>
            {archivOffen ? 'Archiv ausblenden' : `Archiv (${archivierte.length})`}
          </Text>
        </Pressable>
      ) : null}
      {archivOffen
        ? archivierte.map((entry) => (
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
    betragGross: { color: colors.ink, fontSize: 24, fontWeight: '800', ...ZIFFERN },
    betragEinheit: { color: colors.inkSoft, fontSize: 12, fontWeight: '700', ...ZIFFERN },
    balken: {
      height: 6,
      borderRadius: 3,
      backgroundColor: colors.track,
      overflow: 'hidden',
    },
    balkenFuellung: { height: '100%', borderRadius: 3 },
    karteFuss: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    // Umbrechend, seit ein zweiter Chip dazukam (Punkt 267): «Familie»,
    // «Karte mitbringen», das Belegsymbol und die Kategorie passen auf
    // einem schmalen Telefon nicht mehr in eine Zeile - ohne Umbruch
    // schöbe der letzte die Karte seitlich aus dem Bild.
    chipZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      rowGap: 4,
      marginBottom: 2,
    },
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
    detailZahl: { color: colors.ink, fontSize: 40, fontWeight: '800', ...ZIFFERN },
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
    verlaufBetrag: { color: colors.ink, fontSize: 15, fontWeight: '700', ...ZIFFERN },
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
    // Der Knopf «1 einlösen» bei Stück-Gutscheinen (Punkt 376) - hervor-
    // gehoben, weil das der Tipp ist, den man neunmal von zehn braucht.
    stueckKnopf: { backgroundColor: colors.accent, borderColor: colors.accent },
    stueckKnopfText: { color: '#FFFFFF' },
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

    // ── Datei ─────────────────────────────────────────────────────────
    dateiZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      padding: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    dateiName: { color: colors.ink, fontSize: 15, fontWeight: '600' },
    dateiMass: { color: colors.inkSoft, fontSize: 12 },

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
