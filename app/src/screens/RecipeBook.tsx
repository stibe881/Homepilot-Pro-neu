import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';
import AsyncStorage from '@react-native-async-storage/async-storage';
import * as Speech from 'expo-speech';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';

import { HubSettings } from '../api/types';
import {
  Box,
  ZIEL_HIER,
  istHier,
  sprecherFuer,
  zielListe,
  zielName,
} from '../lib/vorlesen';
import { zeitenImText } from '../lib/kochzeit';
import { persoenlichLesen, persoenlichSetzen } from '../lib/persoenlich';
import { scaledAmount } from '../lib/mengen';
import { rezeptAlsText } from '../lib/rezepttext';
import {
  GRUNDVORRAT,
  ausVorrat,
  fehltText,
  vorratsNamen,
  kategorieUmbenennen,
  kategorien,
  rezeptAlsSeite,
} from '../lib/rezeptseite';
import { zutatenImSchritt } from '../lib/schrittzutaten';
import { kochVorschlaege, vorschlagsGrund } from '../lib/vorschlag';
import { Colors, radius, useColors } from '../theme';

/**
 * Ein Rezept bzw. eine Zutat, wie der Hub sie speichert (Punkt 60 der
 * Werkbank). Offen mit Absicht: Die Felder (title, ingredients, servings,
 * source, last_cooked …) wachsen mit dem Modul, und sie hier abschliessend
 * zu tippen hiesse, das Hub-Schema zu duplizieren. Der eine Alias ersetzt
 * die dreissig verstreuten `any` von vorher.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Rezept = Record<string, any>;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Zutat = Record<string, any>;

/**
 * Rezeptbuch: Übersicht mit Foto-Kacheln, Suche und Filtern; Detailansicht
 * mit Portionen-Umrechnung; «Planen» trägt das Gericht in den Essensplaner
 * ein, «Kochen» führt Schritt für Schritt durch die Zubereitung.
 *
 * Wie überall im Familie-Modul: Alle Unterkomponenten stehen auf Modulebene,
 * sonst remountet jedes Live-Update vom Hub die Eingabefelder.
 */

type Styles = ReturnType<typeof makeStyles>;

const WEEK_DAYS = ['Montag', 'Dienstag', 'Mittwoch', 'Donnerstag', 'Freitag', 'Samstag', 'Sonntag'];

interface Props {
  recipes: Rezept[];
  /** Hub-Zugang – für die Küchenuhr im Kochmodus. Ohne fehlt der Knopf. */
  settings?: HubSettings;
  currentUser?: { name: string } | null;
  /** Gleich mit dieser Detailansicht öffnen – der Essensplaner springt
   *  so direkt zum Gericht des Tages (Punkt 146). */
  initialRecipeId?: string;
  onAdd: (recipe: Rezept) => void;
  onUpdate: (id: string, patch: Rezept) => void;
  onDelete: (id: string) => void;
  /** Mit der Rezept-Kennung, nicht nur dem Namen: Zwei Rezepte
   *  «Lasagne» – oder eines, das später umbenannt wird – und der
   *  Wocheneinkauf fände die Zutaten sonst nicht mehr. Die Portionen
   *  wandern mit (Punkt 145) – der Wocheneinkauf rechnet damit. */
  planMeal: (day: string, text: string, recipeId: string, servings: number) => void;
  /** Zutaten dieses Rezepts auf die Einkaufsliste – mit dem Faktor der
   *  eingestellten Portionen. Meldet zurück, wie viele Posten wirklich
   *  dazugekommen sind - schon Vorhandenes zählt nicht mit, und «0
   *  hinzugefügt» ist eine ehrlichere Antwort als ein wortloses
   *  Häkchen. */
  onShopping: (recipe: Rezept, faktor: number) => number;
  /** Was im Vorrat steht (lib/vorrat.ts) - für «Was geht mit dem, was
   *  da ist». Ohne die Liste bleibt es beim Antippen von Hand. */
  vorratsliste?: string[];
  /** Ein einzelner Posten auf die Einkaufsliste - für das, was einem
   *  Rezept noch fehlt. */
  onShoppingItem?: (name: string) => void;
  onClose: () => void;
}

// ── Helfer (rein) ───────────────────────────────────────────────────────────

/** «6 Std 30 Min» bzw. «45 Min» aus Minuten. */
export function timeLabel(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const rest = Math.round(minutes % 60);
  if (hours === 0) return `${rest} Min`;
  return rest ? `${hours} Std ${rest} Min` : `${hours} Std`;
}

/** Gesamtzeit eines Rezepts: Vorbereitung + Kochen + Ruhen. */
export function totalMinutes(recipe: Rezept): number {
  return ['prep_time', 'cook_time', 'rest_time']
    .map((key) => Number(recipe?.[key]) || 0)
    .reduce((a, b) => a + b, 0);
}

const DIFFICULTY: Record<string, { label: string; tone: 'on' | 'warn' | 'danger' }> = {
  easy: { label: 'Einfach', tone: 'on' },
  leicht: { label: 'Einfach', tone: 'on' },
  medium: { label: 'Mittel', tone: 'warn' },
  mittel: { label: 'Mittel', tone: 'warn' },
  hard: { label: 'Anspruchsvoll', tone: 'danger' },
  schwer: { label: 'Anspruchsvoll', tone: 'danger' },
};

export function difficultyInfo(value: unknown) {
  return DIFFICULTY[String(value ?? '').toLowerCase()] ?? null;
}

/** Emoji zur Kategorie – rein kosmetisch, unbekannte bekommen den Teller. */
export function categoryEmoji(name: string): string {
  const key = name.toLowerCase();
  if (/drink|getränk|slushy|cocktail|kaffee/.test(key)) return '🥤';
  if (/bbq|grill|smoker/.test(key)) return '🍖';
  if (/dessert|süss|kuchen|glace/.test(key)) return '🍨';
  if (/suppe|eintopf/.test(key)) return '🍲';
  if (/teig|brot|pizza/.test(key)) return '🥐';
  if (/glaze|sauce|dip/.test(key)) return '🥣';
  if (/salat/.test(key)) return '🥗';
  if (/frühstück|brunch|lunch|dinner|znacht|zmittag/.test(key)) return '🍽️';
  return '🍴';
}

// Die reinen Helfer wohnen in src/lib (mengen.ts, rezepttext.ts), damit
// die Tests sie ohne die Expo-Module dieses Bildschirms laden können.
export { scaledAmount };

/** Tipps/Hinweise/Notizen: Text, Liste oder Liste von {text} → Zeilen. */
export function listOfTexts(value: unknown): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .map((entry) => (typeof entry === 'string' ? entry : String(entry?.text ?? '')))
    .map((text) => text.trim())
    .filter(Boolean);
}

/** Zutaten in der Reihenfolge ihrer Gruppen («Die Basis», «Die Würze» …). */
export function ingredientGroups(ingredients: Zutat[]): { label: string; items: Zutat[] }[] {
  const groups: { label: string; items: Zutat[] }[] = [];
  for (const ingredient of ingredients) {
    const label = String(ingredient?.category ?? '').trim();
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(ingredient);
    else groups.push({ label, items: [ingredient] });
  }
  return groups;
}

/** Suche über Titel, Beschreibung, Zutaten, Kategorie und Schlagwörter. */
export function matchesSearch(recipe: Rezept, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    recipe.text,
    recipe.description,
    recipe.category,
    ...(Array.isArray(recipe.tags) ? recipe.tags : []),
    ...(Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map((ingredient: Zutat) => ingredient?.name)
      : []),
  ]
    .map((part) => String(part ?? '').toLowerCase())
    .join(' ');
  return haystack.includes(needle);
}

// Einheiten, die beim Erfassen als «Menge Einheit Name» erkannt werden.
const UNITS = new Set([
  'g', 'kg', 'mg', 'ml', 'cl', 'dl', 'l',
  'el', 'tl', 'msp', 'prise', 'prisen', 'schuss',
  'stk', 'stück', 'bund', 'pack', 'päckchen', 'päckli', 'würfel',
  'tasse', 'tassen', 'becher', 'dose', 'dosen', 'glas',
  'zweig', 'zweige', 'blatt', 'blätter', 'scheibe', 'scheiben', 'zehe', 'zehen',
]);

/** «250 ml Ketchup» → {amount, unit, name}; «Die Würze:» eröffnet eine
 *  Gruppe. Was nicht passt, bleibt unverändert der Zutatenname. */
export function parseIngredients(text: string): Zutat[] {
  const result: Zutat[] = [];
  let category = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[-•*]\s*/, '').trim();
    if (!line) continue;
    if (line.endsWith(':')) {
      category = line.slice(0, -1).trim();
      continue;
    }
    const entry: Zutat = { name: line };
    const match = line.match(/^(\d+(?:[.,]\d+)?)\s+(\S+)\s+(.+)$/);
    if (match && UNITS.has(match[2].toLowerCase().replace(/\.$/, ''))) {
      entry.amount = Number(match[1].replace(',', '.'));
      entry.unit = match[2];
      entry.name = match[3];
    } else {
      const short = line.match(/^(\d+(?:[.,]\d+)?)\s+(.+)$/);
      if (short) {
        entry.amount = Number(short[1].replace(',', '.'));
        entry.name = short[2];
      }
    }
    if (category) entry.category = category;
    result.push(entry);
  }
  return result;
}

/** Umkehrung fürs Bearbeiten: Zutatenliste → Textzeilen mit Gruppen. */
export function serializeIngredients(ingredients: Zutat[]): string {
  const lines: string[] = [];
  let lastCategory = '';
  for (const ingredient of ingredients) {
    const category = String(ingredient?.category ?? '').trim();
    if (category && category !== lastCategory) lines.push(`${category}:`);
    lastCategory = category;
    lines.push(
      [scaledAmount(ingredient?.amount, 1) || ingredient?.amount, ingredient?.unit, ingredient?.name]
        .filter(Boolean)
        .join(' ')
    );
  }
  return lines.join('\n');
}

/** Zeilen → Schritte; führende Nummerierungen («1.», «2)») fallen weg. */
export function parseSteps(text: string): { text: string }[] {
  return text
    .split('\n')
    .map((line) => line.replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean)
    .map((line) => ({ text: line }));
}

function stepTexts(recipe: Rezept): string[] {
  const raw: Zutat[] = Array.isArray(recipe?.instructions) ? recipe.instructions : [];
  return raw
    .map((step) => (typeof step === 'string' ? step : String(step?.text ?? '')))
    .map((text) => text.trim())
    .filter(Boolean);
}

// ── Bausteine ───────────────────────────────────────────────────────────────

function DifficultyBadge({ recipe, styles, colors }: { recipe: Rezept; styles: Styles; colors: Colors }) {
  const info = difficultyInfo(recipe.difficulty);
  if (!info) return null;
  return (
    <View style={[styles.badge, { backgroundColor: colors.panel }]}>
      <View style={[styles.badgeDot, { backgroundColor: colors[info.tone] }]} />
      <Text style={[styles.badgeText, { color: colors[info.tone] }]}>{info.label}</Text>
    </View>
  );
}

/** Foto-Kachel der Übersicht: Bild, Schwierigkeit, Herz, Titel + Zeit. */
function RecipeTile({
  recipe,
  width,
  settings,
  onOpen,
  onToggleFavorite,
  styles,
  colors,
}: {
  recipe: Rezept;
  width: number;
  settings?: HubSettings;
  onOpen: () => void;
  onToggleFavorite: () => void;
  styles: Styles;
  colors: Colors;
}) {
  const minutes = totalMinutes(recipe);
  const bild = bildUri(recipe.image_url, settings);
  return (
    <Pressable onPress={onOpen} style={[styles.tile, { width }]}>
      {bild ? (
        <Image source={{ uri: bild }} style={styles.tileImage} resizeMode="cover" />
      ) : (
        <View style={[styles.tileImage, styles.tilePlaceholder]}>
          <Text style={styles.tileEmoji}>{categoryEmoji(String(recipe.category ?? ''))}</Text>
        </View>
      )}
      <LinearGradient
        colors={['transparent', 'rgba(10, 14, 20, 0.85)']}
        style={styles.tileShade}
      />
      <View style={styles.tileTop}>
        <DifficultyBadge recipe={recipe} styles={styles} colors={colors} />
        <Pressable
          onPress={onToggleFavorite}
          hitSlop={8}
          accessibilityRole="button"
          accessibilityLabel={recipe.favorite ? 'Favorit entfernen' : 'Als Favorit merken'}
        >
          <Ionicons
            name={recipe.favorite ? 'heart' : 'heart-outline'}
            size={22}
            color={recipe.favorite ? '#FF5A6E' : '#FFFFFF'}
          />
        </Pressable>
      </View>
      <View style={styles.tileBottom}>
        <Text style={styles.tileTitle} numberOfLines={2}>
          {recipe.text}
        </Text>
        {minutes > 0 ? (
          <View style={styles.tileTimeRow}>
            <Ionicons name="time-outline" size={13} color="rgba(255,255,255,0.85)" />
            <Text style={styles.tileTime}>{timeLabel(minutes)}</Text>
          </View>
        ) : null}
      </View>
    </Pressable>
  );
}

/** Erfassen und Bearbeiten – dieselbe Maske, beim Bearbeiten vorausgefüllt. */
function RecipeForm({
  initial,
  categories,
  settings,
  onSave,
  onCancel,
  styles,
  colors,
}: {
  initial?: Rezept;
  /** Vorhandene Kategorien als antippbare Chips (Punkt 137) – sonst
   *  entstehen «Dessert», «Desserts» und «dessert» nebeneinander. */
  categories: string[];
  /** Für den Link-Import (Punkt 136) – ohne Hub-Zugang fehlt das Feld. */
  settings?: HubSettings;
  onSave: (recipe: Rezept) => void;
  onCancel: () => void;
  styles: Styles;
  colors: Colors;
}) {
  const [title, setTitle] = useState(String(initial?.text ?? ''));
  const [description, setDescription] = useState(String(initial?.description ?? ''));
  const [category, setCategory] = useState(String(initial?.category ?? ''));
  const [tags, setTags] = useState(
    Array.isArray(initial?.tags) ? initial.tags.join(', ') : ''
  );
  const [servings, setServings] = useState(initial?.servings ? String(initial.servings) : '');
  const [prep, setPrep] = useState(initial?.prep_time ? String(initial.prep_time) : '');
  const [cook, setCook] = useState(initial?.cook_time ? String(initial.cook_time) : '');
  const [rest, setRest] = useState(initial?.rest_time ? String(initial.rest_time) : '');
  const [difficulty, setDifficulty] = useState(String(initial?.difficulty ?? ''));
  const [ingredients, setIngredients] = useState(
    Array.isArray(initial?.ingredients) ? serializeIngredients(initial.ingredients) : ''
  );
  const [steps, setSteps] = useState(stepTexts(initial ?? {}).join('\n'));
  const [tips, setTips] = useState(listOfTexts(initial?.tips).join('\n'));
  // Herkunft und Notizen: der Unterschied zwischen einer Rezeptsammlung
  // und einem Familienkochbuch. «Zu salzig», «bei 180° statt 200°» – ein
  // dreimal gekochtes, zweimal korrigiertes Rezept ist mehr wert als
  // eines aus dem Netz.
  const [source, setSource] = useState(String(initial?.source ?? ''));
  const [notes, setNotes] = useState(String(initial?.notes ?? ''));
  const [image, setImage] = useState<string>(String(initial?.image_url ?? ''));
  // Punkt 188: Der Link-Import deckt das Netz ab – nicht aber die
  // handgeschriebene Karte im Holzkasten. Das «Original» steht neben dem
  // Titelbild und bewahrt die Handschrift; abgetippt wird in Ruhe daneben.
  const [original, setOriginal] = useState<string>(String(initial?.original_url ?? ''));

  // Rezept aus einem Link übernehmen (Punkt 136): Der Hub liest das
  // schema.org-Rezept aus dem Seitenkopf, das Formular füllt sich -
  // nachbessern und speichern bleibt hier.
  const [importUrl, setImportUrl] = useState('');
  const [importStatus, setImportStatus] = useState('');
  const vomLink = async () => {
    if (!settings || !importUrl.trim() || importStatus === 'laedt') return;
    setImportStatus('laedt');
    try {
      const response = await fetch(`${settings.url}/api/recipes/import`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(settings.token ? { Authorization: `Bearer ${settings.token}` } : {}),
        },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      if (!response.ok) {
        // Der Hub sagt im detail-Feld, WORAN es lag («kein Rezept auf
        // dieser Seite», «Seite nicht erreichbar») - das gehört hierhin.
        const antwort = (await response.json().catch(() => null)) as {
          detail?: string;
        } | null;
        setImportStatus(String(antwort?.detail ?? `Fehler ${response.status}`));
        return;
      }
      const { recipe } = (await response.json()) as { recipe: Rezept };
      setTitle(String(recipe.text ?? ''));
      setDescription(String(recipe.description ?? ''));
      setCategory(String(recipe.category ?? ''));
      setTags(Array.isArray(recipe.tags) ? recipe.tags.join(', ') : '');
      setServings(recipe.servings ? String(recipe.servings) : '');
      setPrep(recipe.prep_time ? String(recipe.prep_time) : '');
      setCook(recipe.cook_time ? String(recipe.cook_time) : '');
      setImage(String(recipe.image_url ?? ''));
      setOriginal(String(recipe.original_url ?? ''));
      setIngredients(
        Array.isArray(recipe.ingredients) ? recipe.ingredients.join('\n') : ''
      );
      setSteps(Array.isArray(recipe.instructions) ? recipe.instructions.join('\n') : '');
      setSource(String(recipe.source ?? ''));
      setImportStatus('');
    } catch {
      setImportStatus('Hub nicht erreichbar');
    }
  };

  // Foto als data-URI (Base64) speichern, damit es über den Familie-Store
  // beim Hub liegt und nicht von einem lokalen Pfad abhängt.
  //
  // Vor dem Speichern verkleinern (Punkt 138): Ein iPhone-Foto in
  // Originalauflösung sind mehrere MB, und /api/family liefert bei jedem
  // Öffnen ALLE Fotos mit. 1200 px reichen für Kachel und Detail.
  const verkleinert = async (asset: { uri: string; base64?: string | null; width?: number }) => {
    try {
      if ((asset.width ?? 0) > 1200) {
        // Zur Laufzeit laden statt oben importieren: Auf einem älteren
        // Build ohne dieses native Modul soll die App nicht abstürzen,
        // sondern das Foto unverkleinert nehmen wie bisher.
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
  };

  /**
   * Ein Bild holen und verkleinert zurückgeben.
   *
   * Ohne festes Seitenverhältnis: Eine handgeschriebene Rezeptkarte ist
   * hochkant, ein Gericht auf dem Tisch quer (Punkt 188).
   */
  const hole = async (
    quelle: 'galerie' | 'kamera' = 'galerie',
    zuschnitt?: [number, number]
  ): Promise<string | null> => {
    const optionen = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
      allowsEditing: true,
      ...(zuschnitt ? { aspect: zuschnitt } : {}),
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
    return verkleinert(result.assets[0]);
  };

  // Galerie fürs Nachtragen, Kamera für den Moment, in dem das Gericht
  // auf dem Tisch steht.
  const pickImage = async (quelle: 'galerie' | 'kamera' = 'galerie') => {
    const foto = await hole(quelle, [16, 10]);
    if (foto) setImage(foto);
  };

  const submit = () => {
    if (!title.trim()) return;
    const recipe: Rezept = { text: title.trim() };
    recipe.image_url = image || null;
    recipe.original_url = original || null;
    recipe.description = description.trim();
    recipe.category = category.trim();
    recipe.tags = tags
      .split(',')
      .map((tag: string) => tag.trim())
      .filter(Boolean);
    for (const [key, value] of [
      ['servings', servings],
      ['prep_time', prep],
      ['cook_time', cook],
      ['rest_time', rest],
    ] as const) {
      const parsed = Number(String(value).replace(',', '.'));
      recipe[key] = Number.isFinite(parsed) && parsed > 0 ? parsed : null;
    }
    recipe.difficulty = difficulty || null;
    recipe.ingredients = parseIngredients(ingredients);
    recipe.instructions = parseSteps(steps);
    recipe.tips = parseSteps(tips).map((step) => step.text);
    recipe.source = source.trim();
    recipe.notes = notes.trim();
    onSave(recipe);
  };

  const numeric = (value: string, setter: (v: string) => void, placeholder: string) => (
    <TextInput
      style={[styles.input, { flex: 1 }]}
      value={value}
      onChangeText={setter}
      placeholder={placeholder}
      placeholderTextColor={colors.inkFaint}
      keyboardType="numeric"
    />
  );

  return (
    <ScrollView contentContainerStyle={styles.formStack} keyboardShouldPersistTaps="handled">
      <View style={styles.formHead}>
        <Pressable onPress={onCancel} hitSlop={8} accessibilityLabel="Schliessen">
          <Ionicons name="close" size={26} color={colors.ink} />
        </Pressable>
        <Text style={styles.formHeadTitle}>
          {initial ? 'Rezept bearbeiten' : 'Neues Rezept'}
        </Text>
        <View style={{ width: 26 }} />
      </View>

      {!initial && settings ? (
        <View>
          <View style={styles.formRow}>
            <TextInput
              style={[styles.input, { flex: 1 }]}
              value={importUrl}
              onChangeText={setImportUrl}
              placeholder="Link einer Rezeptseite – spart das Abtippen"
              placeholderTextColor={colors.inkFaint}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              onSubmitEditing={vomLink}
            />
            <Pressable
              onPress={vomLink}
              accessibilityRole="button"
              accessibilityLabel="Rezept aus dem Link übernehmen"
              style={[styles.importKnopf, importStatus === 'laedt' && { opacity: 0.6 }]}
            >
              <Ionicons
                name={importStatus === 'laedt' ? 'hourglass-outline' : 'download-outline'}
                size={16}
                color="#FFFFFF"
              />
              <Text style={styles.importKnopfText}>
                {importStatus === 'laedt' ? 'Holt…' : 'Holen'}
              </Text>
            </Pressable>
          </View>
          {importStatus && importStatus !== 'laedt' ? (
            <Text style={styles.importFehler}>{importStatus}</Text>
          ) : null}
        </View>
      ) : null}

      <Pressable
        onPress={() => pickImage('galerie')}
        style={styles.photoPick}
        accessibilityRole="button"
      >
        {image ? (
          <Image
            source={{ uri: String(bildUri(image, settings) ?? image) }}
            style={styles.photoPreview}
            resizeMode="cover"
          />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="images-outline" size={28} color={colors.inkSoft} />
            <Text style={styles.photoHint}>Foto aus der Galerie</Text>
          </View>
        )}
      </Pressable>
      <View style={styles.formRow}>
        <Pressable
          onPress={() => pickImage('kamera')}
          accessibilityRole="button"
          style={styles.photoAction}
        >
          <Ionicons name="camera-outline" size={16} color={colors.accent} />
          <Text style={styles.photoActionText}>Mit der Kamera</Text>
        </Pressable>
        {image ? (
          <Pressable onPress={() => setImage('')} accessibilityRole="button" style={styles.photoAction}>
            <Ionicons name="trash-outline" size={16} color={colors.inkSoft} />
            <Text style={[styles.photoActionText, { color: colors.inkSoft }]}>Foto entfernen</Text>
          </Pressable>
        ) : null}
      </View>

      {/* Punkt 188: Grossmutters Karte abfotografieren – nicht als
          Titelbild, sondern als «Original». */}
      <View style={styles.formRow}>
        <Pressable
          onPress={async () => {
            const foto = await hole('kamera');
            if (foto) setOriginal(foto);
          }}
          accessibilityRole="button"
          style={styles.photoAction}
        >
          <Ionicons name="document-text-outline" size={16} color={colors.accent} />
          <Text style={styles.photoActionText}>
            {original ? 'Original ersetzen' : 'Original abfotografieren'}
          </Text>
        </Pressable>
        {original ? (
          <Pressable
            onPress={() => setOriginal('')}
            accessibilityRole="button"
            style={styles.photoAction}
          >
            <Ionicons name="trash-outline" size={16} color={colors.inkSoft} />
            <Text style={[styles.photoActionText, { color: colors.inkSoft }]}>
              Original entfernen
            </Text>
          </Pressable>
        ) : null}
      </View>
      {original ? (
        <Image
          source={{ uri: String(bildUri(original, settings) ?? original) }}
          style={styles.photoPreview}
          resizeMode="contain"
        />
      ) : null}

      <TextInput
        style={styles.input}
        value={title}
        onChangeText={setTitle}
        placeholder="Gericht"
        placeholderTextColor={colors.inkFaint}
      />
      <TextInput
        style={styles.input}
        value={description}
        onChangeText={setDescription}
        placeholder="Kurzbeschreibung (optional)"
        placeholderTextColor={colors.inkFaint}
      />
      <View style={styles.formRow}>
        <TextInput
          style={[styles.input, { flex: 1.3 }]}
          value={category}
          onChangeText={setCategory}
          placeholder="Kategorie"
          placeholderTextColor={colors.inkFaint}
        />
        {numeric(servings, setServings, 'Portionen')}
      </View>
      {categories.length > 0 ? (
        // Die vorhandenen Kategorien zum Antippen: So entsteht nicht
        // neben «Dessert» noch «Desserts». Frei tippen geht weiterhin.
        <View style={styles.katChips}>
          {categories.map((name) => {
            const active = name === category.trim();
            return (
              <Pressable
                key={name}
                onPress={() => setCategory(active ? '' : name)}
                accessibilityRole="button"
                style={[styles.katChip, active && { backgroundColor: colors.accent }]}
              >
                <Text style={[styles.katChipText, active && { color: '#FFFFFF' }]}>
                  {categoryEmoji(name)} {name}
                </Text>
              </Pressable>
            );
          })}
        </View>
      ) : null}
      <TextInput
        style={styles.input}
        value={tags}
        onChangeText={setTags}
        placeholder="Schlagwörter, mit Komma getrennt (z.B. Party, Kinder)"
        placeholderTextColor={colors.inkFaint}
      />
      <View style={styles.formRow}>
        {numeric(prep, setPrep, 'Vorber. Min')}
        {numeric(cook, setCook, 'Kochen Min')}
        {numeric(rest, setRest, 'Ruhen Min')}
      </View>
      <View style={styles.formRow}>
        {(['leicht', 'mittel', 'schwer'] as const).map((level) => {
          const active =
            difficultyInfo(difficulty)?.label === difficultyInfo(level)?.label;
          return (
            <Pressable
              key={level}
              onPress={() => setDifficulty(active ? '' : level)}
              style={[styles.levelChip, active && { backgroundColor: colors.accent }]}
            >
              <Text style={[styles.levelChipText, active && { color: '#FFFFFF' }]}>
                {difficultyInfo(level)!.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        style={[styles.input, { minHeight: 100 }]}
        value={ingredients}
        onChangeText={setIngredients}
        placeholder={'Zutaten – eine pro Zeile:\n250 ml Ketchup\nDie Würze:\n1 TL Paprikapulver'}
        placeholderTextColor={colors.inkFaint}
        multiline
      />
      <TextInput
        style={[styles.input, { minHeight: 100 }]}
        value={steps}
        onChangeText={setSteps}
        placeholder="Zubereitung – ein Schritt pro Zeile"
        placeholderTextColor={colors.inkFaint}
        multiline
      />
      <TextInput
        style={[styles.input, { minHeight: 60 }]}
        value={tips}
        onChangeText={setTips}
        placeholder="Tipps (optional, einer pro Zeile)"
        placeholderTextColor={colors.inkFaint}
        multiline
      />
      <TextInput
        style={styles.input}
        value={source}
        onChangeText={setSource}
        placeholder="Woher? (Buch, Seite, Link, «von Mama»)"
        placeholderTextColor={colors.inkFaint}
      />
      <TextInput
        style={[styles.input, { minHeight: 60 }]}
        value={notes}
        onChangeText={setNotes}
        placeholder="Notizen nach dem Kochen («zu salzig», «180° statt 200°»)"
        placeholderTextColor={colors.inkFaint}
        multiline
      />
      <Pressable onPress={submit} style={styles.primaryWide}>
        <Text style={styles.primaryWideText}>Speichern</Text>
      </Pressable>
      <Pressable onPress={onCancel} style={styles.ghostWide}>
        <Text style={styles.ghostWideText}>Abbrechen</Text>
      </Pressable>
    </ScrollView>
  );
}

/** Geführter Kochmodus: erst Mise en Place, dann ein Schritt pro Seite. */
const KOCH_TAG = 'homepilot-kochen';

function CookMode({
  recipe,
  factor,
  settings,
  onClose,
  onFertig,
  styles,
  colors,
}: {
  recipe: Rezept;
  factor: number;
  /** Für die Küchenuhr – ohne Hub-Zugang gibt es den Knopf nicht. */
  settings?: HubSettings;
  onClose: () => void;
  /** Der letzte Schritt ist geschafft – fürs «zuletzt gekocht». */
  onFertig?: () => void;
  styles: Styles;
  colors: Colors;
}) {
  // -1 = Mise en Place, 0..n-1 = Schritte.
  const [step, setStep] = useState(-1);
  // Beim Kochen bleibt der Bildschirm an: Man hat Teig an den Händen und
  // kann ihn nicht antippen – genau der eine Ort, an dem das Einschlafen
  // nachweislich stört. Derselbe Mechanismus wie im Wandpanel-Modus.
  useEffect(() => {
    // Wachhalten ist eine Zugabe - wo es das nicht gibt (Web), kocht man
    // mit Bildschirmsperre wie bisher.
    activateKeepAwakeAsync(KOCH_TAG).catch(() => {});
    return () => {
      deactivateKeepAwake(KOCH_TAG).catch(() => {});
    };
  }, []);
  const steps = stepTexts(recipe);
  const ingredients: Zutat[] = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  // «20 Minuten backen» → ein Knopf je Zeitangabe, der die Küchenuhr des
  // Hubs stellt (Punkt 143: «10 Min köcheln, dann 20 Min ziehen» sind
  // zwei Uhren). Die Durchsage kommt dann auch im Wohnzimmer an.
  const [uhren, setUhren] = useState<number[]>([]);
  // «Wieviel Rahm war das nochmal?» – die Zutaten zum Aufklappen, ohne
  // zwei Schritte zurückzugehen.
  const [zutatenOffen, setZutatenOffen] = useState(false);
  // Abgehakte Zutaten im Mise en Place (Punkt 141): Man sieht, was schon
  // auf der Arbeitsfläche steht - und merkt VOR dem Loskochen, dass der
  // Rahm fehlt. Lebt nur in diesem Kochdurchgang, gespeichert wird nichts.
  const [bereit, setBereit] = useState<Record<number, boolean>>({});
  const schrittZeiten = step >= 0 ? zeitenImText(steps[step] ?? '') : [];
  // Die Zutaten, die DIESER Schritt meint (Punkt 142) - direkt unter dem
  // Schritt, statt die ganze Liste aufzuklappen.
  const imSchritt = step >= 0 ? zutatenImSchritt(steps[step] ?? '', ingredients) : [];
  // Querformat auf dem iPad (Punkt 151): Zutaten links stehend, Schritt
  // rechts gross. Hochkant bleibt alles wie bisher.
  const fenster = useWindowDimensions();
  const quer = fenster.width > fenster.height && fenster.width >= 700;

  // Schritt vorlesen (Punkt 144): Mit Teig an den Händen liest man
  // schlecht. Vorgelesen wird auf diesem Gerät - man liest dort mit, wo
  // man steht; die Boxen bleiben als bewusste Wahl, etwa wenn das
  // Telefon am Ladekabel im Flur hängt.
  //
  // Eigener Speicherschlüssel: Der alte hielt '' für «alle Boxen», und
  // «alle Boxen» ist von «nie gewählt» nicht zu unterscheiden. So
  // beginnen alle bei der neuen Vorgabe, statt weiter im Wohnzimmer
  // vorgelesen zu bekommen.
  const [box, setBox] = useState<string>(ZIEL_HIER);
  const [boxen, setBoxen] = useState<Box[]>([]);
  const [boxWahlOffen, setBoxWahlOffen] = useState(false);
  const [vorgelesen, setVorgelesen] = useState(false);
  // Beim Hub und nicht im Gerät: Wer einmal eingestellt hat, dass in der
  // Küche vorgelesen wird, soll das nach dem nächsten Build nicht wieder
  // tun müssen. Was auf diesem Gerät noch lag, wandert einmalig mit.
  useEffect(() => {
    if (!settings?.token) return;
    let weg = false;
    persoenlichLesen(settings)
      .then(async (werte) => {
        if (weg) return;
        const gemerkt = werte.vorleseziel;
        if (typeof gemerkt === 'string' && gemerkt) {
          setBox(gemerkt);
          return;
        }
        const alt = await AsyncStorage.getItem('homepilot.vorleseziel');
        if (weg || !alt) return;
        setBox(alt);
        persoenlichSetzen(settings, 'vorleseziel', alt);
        await AsyncStorage.removeItem('homepilot.vorleseziel');
      })
      .catch(() => {});
    return () => {
      weg = true;
    };
  }, [settings]);

  // Nichts soll weiterreden, wenn das Kochfenster zugeht.
  useEffect(
    () => () => {
      Speech.stop();
    },
    []
  );

  const kopf = {
    'Content-Type': 'application/json',
    ...(settings?.token ? { Authorization: `Bearer ${settings.token}` } : {}),
  };

  const uhrStellen = async (minuten: number) => {
    if (!settings) return;
    try {
      const response = await fetch(`${settings.url}/api/timers`, {
        method: 'POST',
        headers: kopf,
        body: JSON.stringify({
          minutes: minuten,
          text: `${recipe.text} – Schritt ${step + 1}`,
        }),
      });
      if (response.ok) setUhren((laufend) => [...laufend, minuten]);
    } catch {
      // Keine Uhr ist ärgerlich, aber kein Grund, das Kochen zu stören.
    }
  };

  const vorlesen = async () => {
    if (step < 0) return;
    if (istHier(box)) {
      // Auf diesem Gerät: kein Umweg über den Hub, kein Netz nötig.
      Speech.stop();
      Speech.speak(steps[step], { language: 'de-CH' });
      setVorgelesen(true);
      return;
    }
    if (!settings) return;
    try {
      const response = await fetch(`${settings.url}/api/broadcast`, {
        method: 'POST',
        headers: kopf,
        body: JSON.stringify({ text: steps[step], speakers: sprecherFuer(box) }),
      });
      if (response.ok) setVorgelesen(true);
    } catch {
      // Keine Durchsage ist kein Grund, das Kochen zu stören.
    }
  };

  const boxWahl = async () => {
    setBoxWahlOffen((offen) => !offen);
    if (boxen.length > 0 || !settings) return;
    try {
      const response = await fetch(`${settings.url}/api/entities`, { headers: kopf });
      if (!response.ok) return;
      const alle = (await response.json()) as {
        id: string;
        name: string;
        commands?: string[];
      }[];
      setBoxen(
        alle
          .filter((entity) => (entity.commands ?? []).includes('play_url'))
          .map((entity) => ({ id: entity.id, name: entity.name }))
      );
    } catch {
      // Ohne Liste bleibt es bei «alle Boxen».
    }
  };

  const boxWaehlen = (id: string) => {
    setBox(id);
    setBoxWahlOffen(false);
    if (settings?.token) persoenlichSetzen(settings, 'vorleseziel', id);
  };

  return (
    <Modal visible animationType="slide" onRequestClose={onClose}>
      <View style={[styles.cookRoot, { backgroundColor: colors.panel }]}>
        {step < 0 ? (
          <>
            <Pressable onPress={onClose} style={styles.cookBack} hitSlop={8}>
              <Ionicons name="arrow-back" size={22} color={colors.ink} />
              <Text style={styles.cookBackText}>Mise en Place</Text>
            </Pressable>
            <Text style={styles.cookHeading}>Zutaten bereitlegen</Text>
            <ScrollView style={{ flex: 1 }}>
              <View style={styles.ingredientCard}>
                {ingredients.map((ingredient, index) => (
                  <Pressable
                    key={index}
                    onPress={() => setBereit((stand) => ({ ...stand, [index]: !stand[index] }))}
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: !!bereit[index] }}
                    style={[styles.ingredientRow, index > 0 && styles.ingredientDivider]}
                  >
                    <Ionicons
                      name={bereit[index] ? 'checkmark-circle' : 'ellipse-outline'}
                      size={20}
                      color={bereit[index] ? colors.on : colors.inkFaint}
                    />
                    <Text
                      style={[styles.ingredientAmount, bereit[index] && { opacity: 0.45 }]}
                    >
                      {[scaledAmount(ingredient?.amount, factor), ingredient?.unit]
                        .filter(Boolean)
                        .join(' ')}
                    </Text>
                    <Text style={[styles.ingredientName, bereit[index] && { opacity: 0.45 }]}>
                      {String(ingredient?.name ?? '')}
                    </Text>
                  </Pressable>
                ))}
              </View>
            </ScrollView>
            <Pressable onPress={() => setStep(0)} style={styles.primaryWide}>
              <Text style={styles.primaryWideText}>Loskochen →</Text>
            </Pressable>
          </>
        ) : (
          (() => {
            const koerper = (
              <View style={styles.cookBody}>
                <View style={styles.stepBadge}>
                  <Text style={styles.stepBadgeText}>SCHRITT {step + 1}</Text>
                </View>
                <Text style={styles.stepText}>{steps[step]}</Text>
                {imSchritt.length > 0 ? (
                  // Nur was DIESER Schritt braucht - die ganze Liste
                  // bleibt im Panel bzw. in der Querformat-Spalte.
                  <View style={styles.schrittZutaten}>
                    {imSchritt.map((ingredient, index) => (
                      <Text key={index} style={styles.schrittZutatText}>
                        {[scaledAmount(ingredient?.amount, factor), ingredient?.unit]
                          .filter(Boolean)
                          .join(' ')}{' '}
                        {String(ingredient?.name ?? '')}
                      </Text>
                    ))}
                  </View>
                ) : null}
                {settings ? (
                  <View style={styles.uhrReihe}>
                    {schrittZeiten.map((minuten) => (
                      <Pressable
                        key={minuten}
                        onPress={() => uhrStellen(minuten)}
                        accessibilityRole="button"
                        style={({ pressed }) => [styles.uhrKnopf, pressed && { opacity: 0.8 }]}
                      >
                        <Ionicons
                          name={uhren.includes(minuten) ? 'checkmark' : 'timer-outline'}
                          size={18}
                          color={colors.accent}
                        />
                        <Text style={styles.uhrKnopfText}>
                          {uhren.includes(minuten)
                            ? `Uhr läuft (${minuten} Min)`
                            : `Uhr stellen: ${minuten} Min`}
                        </Text>
                      </Pressable>
                    ))}
                    <Pressable
                      onPress={vorlesen}
                      onLongPress={boxWahl}
                      accessibilityRole="button"
                      accessibilityLabel={
                        istHier(box)
                          ? 'Schritt auf diesem Gerät vorlesen – lange drücken wählt eine Box'
                          : 'Schritt auf den Boxen ansagen – lange drücken wählt das Ziel'
                      }
                      style={({ pressed }) => [styles.uhrKnopf, pressed && { opacity: 0.8 }]}
                    >
                      <Ionicons
                        name={
                          vorgelesen
                            ? 'checkmark'
                            : istHier(box)
                              ? 'volume-high-outline'
                              : 'megaphone-outline'
                        }
                        size={18}
                        color={colors.accent}
                      />
                      <Text style={styles.uhrKnopfText}>
                        {vorgelesen ? 'Gelesen' : zielName(box, boxen)}
                      </Text>
                    </Pressable>
                  </View>
                ) : null}
                {boxWahlOffen ? (
                  <View style={styles.boxListe}>
                    {zielListe(boxen).map((eintrag) => (
                      <Pressable
                        key={eintrag.id}
                        onPress={() => boxWaehlen(eintrag.id)}
                        accessibilityRole="button"
                        style={styles.boxZeile}
                      >
                        <Ionicons
                          name={box === eintrag.id ? 'radio-button-on' : 'radio-button-off'}
                          size={16}
                          color={colors.accent}
                        />
                        <Text style={styles.boxZeileText}>{eintrag.name}</Text>
                      </Pressable>
                    ))}
                  </View>
                ) : null}
              </View>
            );
            // Punkt 189: Mit Teig an den Händen trifft man keinen Knopf
            // am unteren Rand. Die rechte Bildschirmhälfte ist «weiter»,
            // die linke «zurück»; die Knöpfe unten bleiben als sichtbarer
            // Hinweis stehen.
            const weiter = () => {
              if (step + 1 < steps.length) {
                setStep(step + 1);
                setZutatenOffen(false);
                setUhren([]);
                setVorgelesen(false);
                setBoxWahlOffen(false);
                return;
              }
              onFertig?.();
              onClose();
            };
            const zurueck = () => {
              setStep((value) => value - 1);
              setUhren([]);
              setVorgelesen(false);
              setBoxWahlOffen(false);
            };
            const halbseiten = (
              <Pressable
                onPress={(event) => {
                  const breite = fenster.width || 1;
                  if (event.nativeEvent.pageX > breite / 2) weiter();
                  else zurueck();
                }}
                accessibilityRole="button"
                accessibilityLabel="Rechts weiter, links zurück"
                style={{ flex: 1 }}
              >
                {koerper}
              </Pressable>
            );
            const knoepfe = (
              <View style={styles.cookButtons}>
                <Pressable onPress={zurueck} style={[styles.ghostWide, { flex: 1 }]}>
                  <Text style={styles.ghostWideText}>← Zurück</Text>
                </Pressable>
                <Pressable onPress={weiter} style={[styles.primaryWide, { flex: 1.4 }]}>
                  <Text style={styles.primaryWideText}>
                    {step + 1 < steps.length ? 'Weiter →' : 'Fertig ✓'}
                  </Text>
                </Pressable>
              </View>
            );
            return (
              <>
                <View style={styles.cookHead}>
                  <Pressable
                    onPress={onClose}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel="Kochmodus beenden"
                  >
                    <Ionicons name="close" size={24} color={colors.ink} />
                  </Pressable>
                  <Text style={styles.cookTitle} numberOfLines={1}>
                    {recipe.text}
                  </Text>
                  <Text style={styles.cookCount}>
                    {step + 1}/{steps.length}
                  </Text>
                </View>
                <View style={styles.progressTrack}>
                  <View
                    style={[
                      styles.progressFill,
                      { width: `${((step + 1) / Math.max(1, steps.length)) * 100}%` },
                    ]}
                  />
                </View>
                {quer && ingredients.length > 0 ? (
                  // iPad quer (Punkt 151): Zutaten links dauerhaft sichtbar
                  // (mit denselben Haken wie im Mise en Place), Schritt
                  // rechts gross.
                  <View style={{ flex: 1, flexDirection: 'row', gap: 22 }}>
                    <ScrollView style={styles.querSpalte}>
                      <View style={styles.ingredientCard}>
                        {ingredients.map((ingredient, index) => (
                          <Pressable
                            key={index}
                            onPress={() =>
                              setBereit((stand) => ({ ...stand, [index]: !stand[index] }))
                            }
                            accessibilityRole="checkbox"
                            accessibilityState={{ checked: !!bereit[index] }}
                            style={[styles.ingredientRow, index > 0 && styles.ingredientDivider]}
                          >
                            <Ionicons
                              name={bereit[index] ? 'checkmark-circle' : 'ellipse-outline'}
                              size={18}
                              color={bereit[index] ? colors.on : colors.inkFaint}
                            />
                            <Text
                              style={[styles.ingredientAmount, bereit[index] && { opacity: 0.45 }]}
                            >
                              {[scaledAmount(ingredient?.amount, factor), ingredient?.unit]
                                .filter(Boolean)
                                .join(' ')}
                            </Text>
                            <Text
                              style={[styles.ingredientName, bereit[index] && { opacity: 0.45 }]}
                            >
                              {String(ingredient?.name ?? '')}
                            </Text>
                          </Pressable>
                        ))}
                      </View>
                    </ScrollView>
                    <View style={{ flex: 1 }}>
                      {halbseiten}
                      {knoepfe}
                    </View>
                  </View>
                ) : (
                  <>
                    {halbseiten}
                    {ingredients.length > 0 ? (
                      <View>
                        <Pressable
                          onPress={() => setZutatenOffen((offen) => !offen)}
                          accessibilityRole="button"
                          accessibilityState={{ expanded: zutatenOffen }}
                          style={styles.zutatenToggle}
                        >
                          <Ionicons
                            name={zutatenOffen ? 'chevron-down' : 'chevron-up'}
                            size={16}
                            color={colors.inkSoft}
                          />
                          <Text style={styles.zutatenToggleText}>Zutaten</Text>
                        </Pressable>
                        {zutatenOffen ? (
                          <ScrollView style={{ maxHeight: 180 }}>
                            {ingredients.map((ingredient, index) => (
                              <Text key={index} style={styles.zutatenZeile}>
                                {[scaledAmount(ingredient?.amount, factor), ingredient?.unit]
                                  .filter(Boolean)
                                  .join(' ')}{' '}
                                {String(ingredient?.name ?? '')}
                              </Text>
                            ))}
                          </ScrollView>
                        ) : null}
                      </View>
                    ) : null}
                    {knoepfe}
                  </>
                )}
              </>
            );
          })()
        )}
      </View>
    </Modal>
  );
}

/** Detailansicht: grosses Bild, Fakten-Chips, Portionen, Zutaten, Schritte. */
function RecipeDetail({
  recipe,
  settings,
  onBack,
  onEdit,
  onDuplicate,
  onDelete,
  onToggleFavorite,
  onCooked,
  onNote,
  planMeal,
  onShopping,
  styles,
  colors,
}: {
  recipe: Rezept;
  onBack: () => void;
  onEdit: () => void;
  /** Als Variante kopieren (Punkt 148): «Lasagne, aber vegetarisch»
   *  beginnt sonst mit dem Neu-Erfassen des ganzen Rezepts. */
  onDuplicate: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  settings?: HubSettings;
  /** Der Kochmodus wurde bis zum Ende durchlaufen. */
  onCooked?: () => void;
  /** Eine datierte Zeile ins Kochtagebuch (Punkt 190). */
  onNote?: (text: string) => void;
  planMeal: (day: string, text: string, recipeId: string, servings: number) => void;
  onShopping: (recipe: Rezept, faktor: number) => number;
  styles: Styles;
  colors: Colors;
}) {
  const baseServings = Number(recipe.servings) || 0;
  const [servings, setServings] = useState(baseServings || 4);
  // Punkt 217: Das Rezept steht auf 4, gekocht wird immer für 6 – und
  // bei jedem Öffnen stellt man wieder um. Je Rezept gemerkt, und je
  // Person: Wer für sich anders kocht als der Rest, soll das dürfen.
  //
  // Beim Hub, nicht im Gerät: Sonst hält die Erinnerung genau so lange
  // wie die Installation, und das Umstellen beginnt nach jedem Build von
  // vorn. Was noch im Gerät lag, wandert beim ersten Öffnen mit.
  const portionen = useRef<Record<string, number>>({});
  useEffect(() => {
    if (!settings?.token) return;
    let weg = false;
    const altKey = `homepilot.portionen.${recipe.id}`;
    persoenlichLesen(settings)
      .then(async (werte) => {
        if (weg) return;
        const buch = (werte.portionen ?? {}) as Record<string, number>;
        portionen.current = buch;
        const gemerkt = Number(buch[recipe.id]);
        if (Number.isFinite(gemerkt) && gemerkt > 0) {
          setServings(gemerkt);
          return;
        }
        const alt = Number(await AsyncStorage.getItem(altKey));
        if (weg || !Number.isFinite(alt) || alt <= 0) return;
        setServings(alt);
        portionen.current = { ...portionen.current, [recipe.id]: alt };
        persoenlichSetzen(settings, 'portionen', portionen.current);
        await AsyncStorage.removeItem(altKey);
      })
      .catch(() => {});
    return () => {
      weg = true;
    };
  }, [recipe.id, settings]);
  const merkePortionen = (zahl: number) => {
    setServings(zahl);
    if (!settings?.token) return;
    portionen.current = { ...portionen.current, [recipe.id]: zahl };
    persoenlichSetzen(settings, 'portionen', portionen.current);
  };
  // Punkt 190: Aus einem gekochten Rezept wird über Jahre ein besseres.
  const [notizFrage, setNotizFrage] = useState(false);
  const [notizText, setNotizText] = useState('');
  const [planOpen, setPlanOpen] = useState(false);
  const [planned, setPlanned] = useState<string | null>(null);
  const [cooking, setCooking] = useState(false);
  // Wie viele Posten der letzte Klick auf «Einkauf» wirklich hinzugefügt
  // hat. null = noch nicht gedrückt.
  const [eingekauft, setEingekauft] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const factor = baseServings > 0 ? servings / baseServings : 1;
  const ingredients: Zutat[] = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
  const steps = stepTexts(recipe);
  const minutes = totalMinutes(recipe);
  const difficulty = difficultyInfo(recipe.difficulty);
  const tags = Array.isArray(recipe.tags) ? recipe.tags : [];
  const extras = [
    { title: 'Tipps', lines: listOfTexts(recipe.tips) },
    { title: 'Hinweise', lines: listOfTexts(recipe.hints) },
    { title: 'Notizen', lines: listOfTexts(recipe.notes) },
  ].filter((section) => section.lines.length > 0);

  return (
    <View style={{ flex: 1 }}>
      <ScrollView contentContainerStyle={styles.detailStack}>
        <View>
          {bildUri(recipe.image_url, settings) ? (
            <Image
              source={{ uri: String(bildUri(recipe.image_url, settings)) }}
              style={styles.detailImage}
              resizeMode="cover"
            />
          ) : (
            <View style={[styles.detailImage, styles.tilePlaceholder]}>
              <Text style={styles.tileEmoji}>
                {categoryEmoji(String(recipe.category ?? ''))}
              </Text>
            </View>
          )}
          <View style={styles.detailTop}>
            <Pressable
              onPress={onBack}
              style={styles.roundButton}
              hitSlop={6}
              accessibilityRole="button"
              accessibilityLabel="Zurück zur Liste"
            >
              <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={onToggleFavorite}
                style={styles.roundButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={recipe.favorite ? 'Favorit entfernen' : 'Als Favorit merken'}
              >
                <Ionicons
                  name={recipe.favorite ? 'heart' : 'heart-outline'}
                  size={20}
                  color={recipe.favorite ? '#FF5A6E' : '#FFFFFF'}
                />
              </Pressable>
              <Pressable
                onPress={() =>
                  // Mit den eingestellten Portionen - wer für 6 kocht und
                  // teilt, meint die 6er-Mengen. Ohne Teilen-Blatt (Web)
                  // passiert schlicht nichts.
                  Share.share({ message: rezeptAlsText(recipe, factor, servings) }).catch(
                    () => {}
                  )
                }
                style={styles.roundButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Rezept als Text teilen"
              >
                <Ionicons name="share-outline" size={19} color="#FFFFFF" />
              </Pressable>
              {/* Punkt 191: Manchmal will man das Blatt neben den Herd
                  legen, statt das iPad in die Küche zu tragen. */}
              <Pressable
                onPress={async () => {
                  try {
                    const Print = await import('expo-print');
                    await Print.printAsync({
                      html: rezeptAlsSeite(recipe, factor, servings),
                    });
                  } catch {
                    // Kein Drucker, kein Modul (Web) – dann eben nicht.
                  }
                }}
                style={styles.roundButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Rezept drucken"
              >
                <Ionicons name="print-outline" size={19} color="#FFFFFF" />
              </Pressable>
              <Pressable
                onPress={onDuplicate}
                style={styles.roundButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Rezept als Variante kopieren"
              >
                <Ionicons name="copy-outline" size={19} color="#FFFFFF" />
              </Pressable>
              <Pressable
                onPress={onEdit}
                style={styles.roundButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Rezept bearbeiten"
              >
                <Ionicons name="pencil-outline" size={19} color="#FFFFFF" />
              </Pressable>
              <Pressable
                onPress={() => {
                  if (confirmDelete) onDelete();
                  else {
                    setConfirmDelete(true);
                    setTimeout(() => setConfirmDelete(false), 4000);
                  }
                }}
                style={[styles.roundButton, confirmDelete && { backgroundColor: colors.danger }]}
                hitSlop={6}
              >
                <Ionicons name="trash-outline" size={19} color="#FFFFFF" />
              </Pressable>
            </View>
          </View>
        </View>

        <Text style={styles.detailTitle}>{recipe.text}</Text>
        <View style={styles.chipRow}>
          {minutes > 0 ? (
            <View style={styles.factChip}>
              <Ionicons name="time-outline" size={14} color={colors.inkSoft} />
              <Text style={styles.factChipText}>{timeLabel(minutes)}</Text>
            </View>
          ) : null}
          {baseServings > 0 ? (
            <View style={styles.factChip}>
              <Ionicons name="people-outline" size={14} color={colors.inkSoft} />
              <Text style={styles.factChipText}>{baseServings} Portionen</Text>
            </View>
          ) : null}
          {difficulty ? (
            <View style={styles.factChip}>
              <View style={[styles.badgeDot, { backgroundColor: colors[difficulty.tone] }]} />
              <Text style={[styles.factChipText, { color: colors[difficulty.tone] }]}>
                {difficulty.label}
              </Text>
            </View>
          ) : null}
          {recipe.category ? (
            <View style={styles.factChip}>
              <Text style={styles.factChipText}>
                {categoryEmoji(String(recipe.category))} {String(recipe.category)}
              </Text>
            </View>
          ) : null}
        </View>
        {tags.length > 0 ? (
          <View style={styles.chipRow}>
            {tags.map((tag: string) => (
              <Text key={tag} style={styles.tagText}>
                #{tag}
              </Text>
            ))}
          </View>
        ) : null}
        {recipe.description ? (
          <Text style={styles.description}>{String(recipe.description)}</Text>
        ) : null}

        {baseServings > 0 && ingredients.length > 0 ? (
          <View style={styles.servingsCard}>
            <Text style={styles.servingsLabel}>Portionen anpassen</Text>
            <View style={styles.servingsControls}>
              <Pressable
                onPress={() => merkePortionen(Math.max(1, servings - 1))}
                style={styles.stepperButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Eine Portion weniger"
              >
                <Ionicons name="remove" size={18} color={colors.ink} />
              </Pressable>
              <Text style={styles.servingsValue}>{servings}</Text>
              <Pressable
                onPress={() => merkePortionen(Math.min(99, servings + 1))}
                style={styles.stepperButton}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel="Eine Portion mehr"
              >
                <Ionicons name="add" size={18} color={colors.ink} />
              </Pressable>
            </View>
          </View>
        ) : null}

        {ingredients.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Zutaten</Text>
            {ingredientGroups(ingredients).map((group, groupIndex) => (
              <View key={`${group.label}-${groupIndex}`}>
                {group.label ? <Text style={styles.groupLabel}>{group.label}</Text> : null}
                <View style={styles.ingredientCard}>
                  {group.items.map((ingredient, index) => (
                    <View
                      key={index}
                      style={[styles.ingredientRow, index > 0 && styles.ingredientDivider]}
                    >
                      <Text style={styles.ingredientAmount}>
                        {[scaledAmount(ingredient?.amount, factor), ingredient?.unit]
                          .filter(Boolean)
                          .join(' ')}
                      </Text>
                      <Text style={styles.ingredientName}>
                        {String(ingredient?.name ?? '')}
                      </Text>
                    </View>
                  ))}
                </View>
              </View>
            ))}
          </>
        ) : null}

        {steps.length > 0 ? (
          <>
            <Text style={styles.sectionTitle}>Anleitung</Text>
            <View style={styles.stepsCard}>
              {steps.map((text, index) => (
                <View key={index} style={styles.stepRow}>
                  <View style={styles.stepNumber}>
                    <Text style={styles.stepNumberText}>{index + 1}</Text>
                  </View>
                  <Text style={styles.stepBody}>{text}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        {/* Punkt 188: Die Handschrift bleibt – zum Kochen ist es dann
            egal, welcher Teil zuerst da war. */}
        {recipe.original_url ? (
          <>
            <Text style={styles.sectionTitle}>Original</Text>
            <Image
              source={{ uri: String(bildUri(recipe.original_url, settings)) }}
              style={styles.originalBild}
              resizeMode="contain"
            />
          </>
        ) : null}

        {extras.map((section) => (
          <View key={section.title}>
            <Text style={styles.sectionTitle}>{section.title}</Text>
            <View style={styles.stepsCard}>
              {section.lines.map((line, index) => (
                <Text key={index} style={styles.extraLine}>
                  • {line}
                </Text>
              ))}
            </View>
          </View>
        ))}

        {/* Die .catch(() => {}) an den Links: Ohne Browser passiert
            schlicht nichts - kein Fehlerfall. */}
        {recipe.source_url ? (
          <Pressable onPress={() => Linking.openURL(String(recipe.source_url)).catch(() => {})}>
            <Text style={styles.sourceLink}>Quelle: {String(recipe.source_url)}</Text>
          </Pressable>
        ) : null}
        {recipe.source ? (
          /^https?:\/\//i.test(String(recipe.source)) ? (
            <Pressable onPress={() => Linking.openURL(String(recipe.source)).catch(() => {})}>
              <Text style={styles.sourceLink}>Quelle: {String(recipe.source)}</Text>
            </Pressable>
          ) : (
            <Text style={[styles.sourceLink, { color: colors.inkSoft }]}>
              Quelle: {String(recipe.source)}
            </Text>
          )
        ) : null}
        {recipe.last_cooked ? (
          <Text style={[styles.sourceLink, { color: colors.inkSoft }]}>
            Zuletzt gekocht: {String(recipe.last_cooked).split('-').reverse().join('.')}
          </Text>
        ) : null}
        {recipe.body && ingredients.length === 0 && steps.length === 0 ? (
          <Text style={styles.description}>{recipe.body}</Text>
        ) : null}
        <View style={{ height: 76 }} />
      </ScrollView>

      {/* Planen + Kochen, immer griffbereit am unteren Rand. */}
      <View style={styles.actionBar}>
        <Pressable
          onPress={() => setPlanOpen((value) => !value)}
          style={[styles.actionButton, { backgroundColor: colors.accent }]}
        >
          <Ionicons name="calendar-outline" size={18} color="#FFFFFF" />
          <Text style={styles.actionButtonText}>{planned ? `${planned} ✓` : 'Planen'}</Text>
        </Pressable>
        {ingredients.length > 0 ? (
          <Pressable
            onPress={() => setEingekauft(onShopping(recipe, factor))}
            accessibilityRole="button"
            accessibilityLabel="Zutaten auf die Einkaufsliste"
            style={[styles.actionButton, { backgroundColor: colors.warn }]}
          >
            <Ionicons name="cart-outline" size={18} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>
              {eingekauft === null
                ? 'Einkauf'
                : eingekauft === 0
                  ? 'Schon drauf'
                  : `+${eingekauft} ✓`}
            </Text>
          </Pressable>
        ) : null}
        {steps.length > 0 ? (
          <Pressable
            onPress={() => setCooking(true)}
            style={[styles.actionButton, { backgroundColor: colors.on, flex: 1.4 }]}
          >
            <Ionicons name="restaurant-outline" size={18} color="#FFFFFF" />
            <Text style={styles.actionButtonText}>Kochen</Text>
          </Pressable>
        ) : null}
      </View>

      {planOpen ? (
        <View style={styles.planSheet}>
          <Text style={styles.planTitle}>An welchem Tag?</Text>
          <View style={styles.planDays}>
            {WEEK_DAYS.map((day) => (
              <Pressable
                key={day}
                onPress={() => {
                  // Mit den gerade eingestellten Portionen (Punkt 145):
                  // Kommt am Samstag Besuch, rechnet der Wocheneinkauf
                  // dann auch mit den Samstag-Portionen.
                  planMeal(day, recipe.text, String(recipe.id), servings);
                  setPlanned(day.slice(0, 2));
                  setPlanOpen(false);
                }}
                style={styles.planDay}
              >
                <Text style={styles.planDayText}>{day}</Text>
              </Pressable>
            ))}
          </View>
        </View>
      ) : null}

      {cooking ? (
        <CookMode
          recipe={recipe}
          factor={factor}
          settings={settings}
          onClose={() => setCooking(false)}
          onFertig={() => {
            onCooked?.();
            // Punkt 190: Aus einem gekochten Rezept wird über Jahre ein
            // besseres - «zu salzig», «180° statt 200°». Das Notizfeld
            // war eines für alle und wurde überschrieben.
            if (onNote) setNotizFrage(true);
          }}
          styles={styles}
          colors={colors}
        />
      ) : null}

      <Modal
        visible={notizFrage}
        transparent
        animationType="fade"
        onRequestClose={() => setNotizFrage(false)}
      >
        <View style={styles.notizHintergrund}>
          <View style={styles.notizKarte}>
            <Text style={styles.sectionTitle}>Wie war es?</Text>
            <Text style={styles.description}>
              Eine Zeile fürs nächste Mal – sie bleibt mit Datum stehen.
            </Text>
            <TextInput
              style={styles.notizFeld}
              value={notizText}
              onChangeText={setNotizText}
              placeholder="z.B. zu salzig, 180° statt 200°"
              placeholderTextColor={colors.inkFaint}
              multiline
            />
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable
                onPress={() => {
                  setNotizFrage(false);
                  setNotizText('');
                }}
                style={[styles.ghostWide, { flex: 1 }]}
              >
                <Text style={styles.ghostWideText}>Nichts notieren</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  const text = notizText.trim();
                  if (text) onNote?.(text);
                  setNotizFrage(false);
                  setNotizText('');
                }}
                style={[styles.primaryWide, { flex: 1 }]}
              >
                <Text style={styles.primaryWideText}>Merken</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </View>
  );
}

/**
 * Die Zutaten, die am häufigsten vorkommen – als Auswahl für die
 * Vorratssuche (Punkt 192).
 *
 * Nicht alle: Eine Liste mit zweihundert Chips beantwortet keine Frage.
 * Und ohne Grundvorrat: «Salz» anzutippen bringt niemanden weiter.
 */
function haeufigeZutaten(recipes: Rezept[], limit = 18): string[] {
  const zaehler = new Map<string, number>();
  for (const recipe of recipes) {
    const zutaten: Zutat[] = Array.isArray(recipe?.ingredients) ? recipe.ingredients : [];
    for (const zutat of zutaten) {
      const name = String(zutat?.name ?? '').trim();
      if (name.length < 3) continue;
      if (GRUNDVORRAT.some((basis) => name.toLowerCase().includes(basis))) continue;
      zaehler.set(name, (zaehler.get(name) ?? 0) + 1);
    }
  }
  return [...zaehler.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([name]) => name);
}

/**
 * Aus dem gespeicherten Bildverweis eine anzeigbare Adresse machen
 * (Punkt 193, rein bis auf die Einstellungen).
 *
 * Rezepte, deren Bild noch als data-URI im Datenspeicher steckt, gehen
 * unverändert durch. Wer neu speichert, bekommt vom Hub eine Adresse wie
 * «/api/recipes/r1/bild?v=abc» – die braucht Hub-Adresse und Token, weil
 * `<Image>` keinen Kopf mitschicken kann.
 */
export function bildUri(wert: unknown, settings?: HubSettings): string | null {
  const text = String(wert ?? '').trim();
  if (!text) return null;
  if (!text.startsWith('/')) return text;
  if (!settings?.url) return null;
  const basis = settings.url.replace(/\/+$/, '');
  const trenner = text.includes('?') ? '&' : '?';
  return `${basis}${text}${trenner}token=${encodeURIComponent(settings.token ?? '')}`;
}

// ── Hauptkomponente ─────────────────────────────────────────────────────────

type Screen =
  | { kind: 'list' }
  | { kind: 'detail'; id: string }
  // `vorlage`: vorbefüllt ein NEUES Rezept (Variante, Punkt 148) - im
  // Unterschied zu `id`, das ein bestehendes bearbeitet.
  | { kind: 'form'; id?: string; vorlage?: Rezept };

export function RecipeBook({
  recipes,
  settings,
  currentUser,
  initialRecipeId,
  onAdd,
  onUpdate,
  onDelete,
  planMeal,
  onShopping,
  vorratsliste,
  onShoppingItem,
  onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [screen, setScreen] = useState<Screen>(
    initialRecipeId ? { kind: 'detail', id: initialRecipeId } : { kind: 'list' }
  );
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('alle');
  const [gridWidth, setGridWidth] = useState(0);
  // «Was koche ich heute?» (Punkt 139): Der Zähler ist der Würfelwurf -
  // jede Erhöhung mischt die Vorschläge neu.
  const [wurf, setWurf] = useState(0);
  const heute = new Date().toISOString().slice(0, 10);
  const vorschlaege = useMemo(
    () => (wurf > 0 ? kochVorschlaege(recipes, 3, heute) : []),
    // Absichtlich NICHT bei jeder Rezept-Änderung neu würfeln - nur wenn
    // der Wurf-Zähler steigt oder das Buch ein anderes ist.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [wurf, recipes.length]
  );

  // Punkt 192: Der Vorschlag aus 139 fragt nach dem Kalender, nicht nach
  // dem Kühlschrank. Hier die Umkehrung.
  const [vorrat, setVorrat] = useState<string[]>([]);
  // Für welche Rezepte das Fehlende schon auf der Liste steht - ein
  // Häkchen statt einer Meldung, wie beim Einkauf-Knopf im Rezept.
  const [gekauft, setGekauft] = useState<string[]>([]);
  const [vorratOffen, setVorratOffen] = useState(false);
  // Punkt 216: Der Import brachte «dinner» mit, von Hand entstand
  // Deutsches – die Filterleiste zeigt beide Welten.
  const [umbenennen, setUmbenennen] = useState<string | null>(null);
  const [neuerName, setNeuerName] = useState('');

  const categories = useMemo(
    () =>
      Array.from(
        new Set(
          recipes
            .map((recipe) => String(recipe.category ?? '').trim())
            .filter(Boolean)
        )
      ).sort((a, b) => a.localeCompare(b)),
    [recipes]
  );

  const shown = useMemo(() => {
    let list = recipes.filter((recipe) => matchesSearch(recipe, query));
    if (filter === 'favoriten') list = list.filter((recipe) => recipe.favorite);
    else if (filter === 'meine')
      list = list.filter((recipe) => recipe.author === currentUser?.name);
    else if (filter.startsWith('kat:')) {
      const category = filter.slice(4);
      list = list.filter(
        (recipe) =>
          String(recipe.category ?? '') === category ||
          (Array.isArray(recipe.tags) && recipe.tags.includes(category))
      );
    }
    if (filter === 'neueste') {
      list = [...list].sort((a, b) =>
        String(b.created ?? '').localeCompare(String(a.created ?? ''))
      );
    } else if (filter === 'klassiker') {
      // Die zwei Listen, aus denen man abends wirklich wählt (Punkt 140):
      // was sich bewährt hat - und was mal wieder dran wäre.
      list = [...list]
        .filter((recipe) => Number(recipe.cooked_count) > 0)
        .sort((a, b) => (Number(b.cooked_count) || 0) - (Number(a.cooked_count) || 0));
    } else if (filter === 'lange') {
      // Nie Gekochtes zuoberst (kein Datum = am längsten her), danach
      // aufsteigend nach dem letzten Mal.
      list = [...list].sort((a, b) =>
        String(a.last_cooked ?? '').localeCompare(String(b.last_cooked ?? ''))
      );
    }
    return list;
  }, [recipes, query, filter, currentUser]);

  const favoriteCount = recipes.filter((recipe) => recipe.favorite).length;
  const toggleFavorite = (recipe: Rezept) =>
    onUpdate(recipe.id, { favorite: !recipe.favorite });

  if (screen.kind === 'form') {
    const editing = screen.id
      ? recipes.find((recipe) => recipe.id === screen.id)
      : undefined;
    return (
      <RecipeForm
        initial={editing ?? screen.vorlage}
        categories={categories}
        settings={settings}
        onSave={(recipe) => {
          if (editing) onUpdate(editing.id, recipe);
          else onAdd(recipe);
          setScreen(editing ? { kind: 'detail', id: editing.id } : { kind: 'list' });
        }}
        onCancel={() =>
          setScreen(screen.id ? { kind: 'detail', id: screen.id } : { kind: 'list' })
        }
        styles={styles}
        colors={colors}
      />
    );
  }

  if (screen.kind === 'detail') {
    const recipe = recipes.find((entry) => entry.id === screen.id);
    if (!recipe) {
      // Gerade gelöscht (auch von jemand anderem) – zurück zur Liste.
      setTimeout(() => setScreen({ kind: 'list' }), 0);
      return null;
    }
    return (
      <RecipeDetail
        recipe={recipe}
        settings={settings}
        onCooked={() =>
          // Datum plus Zähler (Punkt 140): «wann zuletzt?» für den
          // Essensplaner, «wie oft?» für die Klassiker-Sortierung.
          onUpdate(recipe.id, {
            last_cooked: new Date().toISOString().slice(0, 10),
            cooked_count: (Number(recipe.cooked_count) || 0) + 1,
          })
        }
        onNote={(text) => {
          // Datiert und untereinander – wie ein Kochtagebuch. Das alte
          // Notizfeld bleibt, was es war: eine Liste von Zeilen.
          const bisher = listOfTexts(recipe.notes);
          const heuteKurz = new Date().toLocaleDateString('de-CH', {
            day: '2-digit',
            month: '2-digit',
          });
          onUpdate(recipe.id, { notes: [...bisher, `${heuteKurz}: ${text}`] });
        }}
        onBack={() => setScreen({ kind: 'list' })}
        onEdit={() => setScreen({ kind: 'form', id: recipe.id })}
        onDuplicate={() => {
          // Kopie ohne Kennung und Geschichte: Der Zähler, das «zuletzt
          // gekocht» und das Herz gehören zum Original, nicht zur Variante.
          const {
            id: _id,
            created: _created,
            author: _author,
            favorite: _favorite,
            last_cooked: _lastCooked,
            cooked_count: _cookedCount,
            ...rest
          } = recipe;
          setScreen({
            kind: 'form',
            vorlage: { ...rest, text: `${String(recipe.text ?? '')} – Variante` },
          });
        }}
        onDelete={() => {
          onDelete(recipe.id);
          setScreen({ kind: 'list' });
        }}
        onToggleFavorite={() => toggleFavorite(recipe)}
        planMeal={planMeal}
        onShopping={onShopping}
        styles={styles}
        colors={colors}
      />
    );
  }

  // Spaltenzahl nach Breite statt fix zwei (Punkt 150): iPhone 2, iPad
  // hoch 3, iPad quer 4. ~230 Punkte je Kachel halten Titel und Zeit
  // lesbar; schmaler würde der Foto-Ausschnitt zur Briefmarke.
  const columns = Math.max(2, Math.floor(gridWidth / 230));
  const tileWidth = gridWidth > 0 ? Math.floor((gridWidth - 12 * (columns - 1)) / columns) : 0;
  const filters: { key: string; label: string; icon?: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'alle', label: 'Alle', icon: 'book-outline' },
    { key: 'favoriten', label: 'Favoriten', icon: 'heart' },
    { key: 'neueste', label: 'Neueste', icon: 'time-outline' },
    { key: 'klassiker', label: 'Klassiker', icon: 'ribbon-outline' },
    { key: 'lange', label: 'Lange nicht gekocht', icon: 'hourglass-outline' },
    { key: 'meine', label: 'Meine', icon: 'person-outline' },
    ...categories.map((category) => ({
      key: `kat:${category}`,
      label: `${categoryEmoji(category)} ${category}`,
    })),
  ];

  return (
    <View style={{ flex: 1 }}>
      <View style={styles.header}>
        <View style={{ flex: 1 }}>
          <Text style={styles.headerTitle}>Rezeptbuch</Text>
          <Text style={styles.headerSub}>
            {recipes.length} {recipes.length === 1 ? 'Rezept' : 'Rezepte'} · {favoriteCount}{' '}
            {favoriteCount === 1 ? 'Favorit' : 'Favoriten'}
          </Text>
        </View>
        <Pressable
          onPress={() => setVorratOffen((offen) => !offen)}
          style={styles.roundButtonDim}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Was koche ich aus dem, was da ist?"
        >
          <Ionicons
            name="basket-outline"
            size={20}
            color={vorratOffen ? colors.accent : colors.ink}
          />
        </Pressable>
        <Pressable
          onPress={() => setWurf((zahl) => (zahl > 0 ? 0 : zahl + 1))}
          style={styles.roundButtonDim}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Was koche ich heute? Vorschläge zeigen"
        >
          <Ionicons name="dice-outline" size={20} color={wurf > 0 ? colors.accent : colors.ink} />
        </Pressable>
        <Pressable
          onPress={onClose}
          style={styles.roundButtonDim}
          hitSlop={6}
          accessibilityRole="button"
          accessibilityLabel="Kochbuch schliessen"
        >
          <Ionicons name="close" size={20} color={colors.ink} />
        </Pressable>
      </View>

      {/* Punkt 192: Zwei, drei Zutaten antippen und sehen, was daraus
          wird – samt der ehrlichen Angabe, was noch fehlt. */}
      {vorratOffen ? (
        <View style={styles.vorratKarte}>
          <Text style={styles.vorschlagTitel}>Was ist da?</Text>
          <ScrollView horizontal showsHorizontalScrollIndicator={false}>
            <View style={styles.filterRow}>
              {haeufigeZutaten(recipes).map((name) => {
                const aktiv = vorrat.includes(name);
                return (
                  <Pressable
                    key={name}
                    onPress={() =>
                      setVorrat((bisher) =>
                        aktiv ? bisher.filter((x) => x !== name) : [...bisher, name]
                      )
                    }
                    accessibilityRole="checkbox"
                    accessibilityState={{ checked: aktiv }}
                    style={[styles.filterChip, aktiv && { backgroundColor: colors.accent }]}
                  >
                    <Text
                      style={[styles.filterText, aktiv && { color: '#FFFFFF' }]}
                    >
                      {name}
                    </Text>
                  </Pressable>
                );
              })}
            </View>
          </ScrollView>
          {/* Der Vorrat weiss ohnehin, was da ist - ihn von Hand
              nachzutippen war die Arbeit, die diese Karte eigentlich
              abnehmen sollte. Ein Knopf füllt die Auswahl daraus. */}
          {vorratsliste && vorratsliste.length > 0 ? (
            <Pressable
              onPress={() =>
                setVorrat((bisher) =>
                  bisher.length > 0 ? [] : vorratsNamen(
                    vorratsliste.map((name) => ({ text: name }))
                  )
                )
              }
              accessibilityRole="button"
              style={({ pressed }) => [styles.vorratAusVorrat, pressed && { opacity: 0.7 }]}
            >
              <Ionicons
                name={vorrat.length > 0 ? 'close-circle-outline' : 'file-tray-full-outline'}
                size={16}
                color={colors.accent}
              />
              <Text style={styles.vorratAusVorratText}>
                {vorrat.length > 0 ? 'Auswahl leeren' : 'Alles nehmen, was im Vorrat steht'}
              </Text>
            </Pressable>
          ) : null}
          {vorrat.length === 0 ? (
            <Text style={styles.vorschlagGrund}>
              Zutaten antippen – dann steht hier, was damit geht.
            </Text>
          ) : (
            ausVorrat(recipes, vorrat)
              .slice(0, 6)
              .map(({ recipe, fehlt }) => (
                <Pressable
                  key={String(recipe.id)}
                  onPress={() => setScreen({ kind: 'detail', id: String(recipe.id) })}
                  accessibilityRole="button"
                  style={styles.vorratZeile}
                >
                  <Text style={styles.vorschlagEmoji}>
                    {categoryEmoji(String(recipe.category ?? ''))}
                  </Text>
                  <View style={{ flex: 1, minWidth: 0 }}>
                    <Text style={styles.vorschlagName} numberOfLines={1}>
                      {String(recipe.text ?? '')}
                    </Text>
                    <Text style={styles.vorratFehlt}>{fehltText(fehlt)}</Text>
                  </View>
                  {/* Was fehlt, gehört auf die Einkaufsliste - und zwar
                      von hier aus. Sonst liest man «ohne Rahm», schliesst
                      das Rezeptbuch und hat es beim Einkaufen vergessen. */}
                  {onShoppingItem && fehlt.length > 0 ? (
                    <Pressable
                      onPress={() => {
                        fehlt.forEach(onShoppingItem);
                        setGekauft((bisher) => [...bisher, String(recipe.id)]);
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${fehltText(fehlt)} auf die Einkaufsliste`}
                      hitSlop={8}
                      style={({ pressed }) => [styles.vorratKauf, pressed && { opacity: 0.6 }]}
                    >
                      <Ionicons
                        name={
                          gekauft.includes(String(recipe.id))
                            ? 'checkmark-circle'
                            : 'cart-outline'
                        }
                        size={16}
                        color={colors.accent}
                      />
                    </Pressable>
                  ) : null}
                  <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
                </Pressable>
              ))
          )}
          {vorrat.length > 0 && ausVorrat(recipes, vorrat).length === 0 ? (
            <Text style={styles.vorschlagGrund}>
              Damit allein geht noch nichts – eine Zutat weniger auswählen?
            </Text>
          ) : null}
        </View>
      ) : null}

      {wurf > 0 && vorschlaege.length > 0 ? (
        <View style={styles.vorschlagKarte}>
          <View style={styles.vorschlagKopf}>
            <Text style={styles.vorschlagTitel}>Was koche ich heute?</Text>
            <Pressable
              onPress={() => setWurf((zahl) => zahl + 1)}
              accessibilityRole="button"
              style={styles.vorschlagWurf}
            >
              <Ionicons name="refresh" size={15} color={colors.accent} />
              <Text style={styles.vorschlagWurfText}>Nochmal würfeln</Text>
            </Pressable>
          </View>
          {vorschlaege.map((recipe) => (
            <Pressable
              key={String(recipe.id)}
              onPress={() => setScreen({ kind: 'detail', id: String(recipe.id) })}
              accessibilityRole="button"
              style={styles.vorschlagZeile}
            >
              <Text style={styles.vorschlagEmoji}>
                {categoryEmoji(String(recipe.category ?? ''))}
              </Text>
              <View style={{ flex: 1, minWidth: 0 }}>
                <Text style={styles.vorschlagName} numberOfLines={1}>
                  {String(recipe.text ?? '')}
                </Text>
                <Text style={styles.vorschlagGrund}>{vorschlagsGrund(recipe, heute)}</Text>
              </View>
              <Ionicons name="chevron-forward" size={16} color={colors.inkFaint} />
            </Pressable>
          ))}
        </View>
      ) : null}

      {/* Punkt 216: Der Import brachte «dinner» mit, von Hand entstand
          Deutsches – die Chips aus Punkt 137 verhindern Neues, heilen
          aber den Bestand nicht. */}
      {umbenennen ? (
        <View style={styles.vorratKarte}>
          <Text style={styles.vorschlagTitel}>
            «{umbenennen}» umbenennen ({
              kategorien(recipes).find((k) => k.name === umbenennen)?.anzahl ?? 0
            } Rezepte)
          </Text>
          <TextInput
            style={styles.searchInput}
            value={neuerName}
            onChangeText={setNeuerName}
            placeholder="Neuer Name, z.B. Znacht"
            placeholderTextColor={colors.inkFaint}
          />
          <View style={{ flexDirection: 'row', gap: 8 }}>
            <Pressable
              onPress={() => {
                setUmbenennen(null);
                setNeuerName('');
              }}
              style={[styles.ghostWide, { flex: 1 }]}
            >
              <Text style={styles.ghostWideText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={() => {
                for (const geaendert of kategorieUmbenennen(recipes, umbenennen, neuerName)) {
                  onUpdate(String(geaendert.id), { category: geaendert.category });
                }
                if (filter === `kat:${umbenennen}`) setFilter('alle');
                setUmbenennen(null);
                setNeuerName('');
              }}
              style={[styles.primaryWide, { flex: 1 }]}
            >
              <Text style={styles.primaryWideText}>Alle umschreiben</Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      <View style={styles.searchBox}>
        <Ionicons name="search" size={16} color={colors.inkFaint} />
        <TextInput
          style={styles.searchInput}
          value={query}
          onChangeText={setQuery}
          placeholder="Rezept, Zutat oder Tag suchen…"
          placeholderTextColor={colors.inkFaint}
        />
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={{ flexGrow: 0 }}
        contentContainerStyle={styles.filterRow}
      >
        {filters.map((entry) => {
          const active = filter === entry.key;
          return (
            <Pressable
              key={entry.key}
              onPress={() => setFilter(active ? 'alle' : entry.key)}
              // Langer Druck auf eine Kategorie räumt sie auf (Punkt 216).
              onLongPress={
                entry.key.startsWith('kat:')
                  ? () => {
                      const name = entry.key.slice(4);
                      setUmbenennen(name);
                      setNeuerName(name);
                    }
                  : undefined
              }
              style={[styles.filterChip, active && { backgroundColor: colors.accent }]}
            >
              {entry.icon ? (
                <Ionicons
                  name={entry.icon}
                  size={14}
                  color={active ? '#FFFFFF' : colors.inkSoft}
                />
              ) : null}
              <Text style={[styles.filterText, active && { color: '#FFFFFF' }]}>
                {entry.label}
              </Text>
            </Pressable>
          );
        })}
      </ScrollView>

      <ScrollView style={{ flex: 1 }}>
        <View
          style={styles.grid}
          onLayout={(event) => setGridWidth(event.nativeEvent.layout.width)}
        >
          {tileWidth > 0
            ? shown.map((recipe) => (
                <RecipeTile
                  key={recipe.id}
                  recipe={recipe}
                  width={tileWidth}
                  settings={settings}
                  onOpen={() => setScreen({ kind: 'detail', id: recipe.id })}
                  onToggleFavorite={() => toggleFavorite(recipe)}
                  styles={styles}
                  colors={colors}
                />
              ))
            : null}
        </View>
        {shown.length === 0 ? (
          <Text style={styles.empty}>
            {query || filter !== 'alle'
              ? 'Nichts gefunden – Suche oder Filter anpassen.'
              : 'Noch keine Rezepte – unten rechts eines anlegen.'}
          </Text>
        ) : null}
        <View style={{ height: 90 }} />
      </ScrollView>

      <Pressable
        onPress={() => setScreen({ kind: 'form' })}
        accessibilityRole="button"
        accessibilityLabel="Neues Rezept"
        style={styles.fab}
      >
        <Ionicons name="add" size={30} color="#FFFFFF" />
      </Pressable>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    // Kopf & Suche
    header: { flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 10 },
    headerTitle: { color: colors.onGradient, fontSize: 28, fontWeight: '800' },
    headerSub: { color: colors.onGradientSoft, fontSize: 14, marginTop: 2 },
    roundButtonDim: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: colors.surfaceStrong,
      alignItems: 'center',
      justifyContent: 'center',
    },
    searchBox: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      borderRadius: radius.control,
      paddingHorizontal: 12,
      marginBottom: 10,
    },
    searchInput: { flex: 1, paddingVertical: 10, color: colors.ink, fontSize: 15 },
    filterRow: { gap: 8, paddingBottom: 12 },
    filterChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 13,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    filterText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    vorschlagKarte: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.card - 6,
      paddingHorizontal: 14,
      paddingVertical: 10,
      marginBottom: 10,
      gap: 2,
    },
    vorschlagKopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    vorschlagTitel: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    vorschlagWurf: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    vorschlagWurfText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    vorschlagZeile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    vorschlagEmoji: { fontSize: 22 },
    vorschlagName: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    vorschlagGrund: { color: colors.inkSoft, fontSize: 12 },

    // Kachel-Raster
    grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
    tile: {
      aspectRatio: 0.86,
      borderRadius: radius.card - 6,
      overflow: 'hidden',
      backgroundColor: colors.surfaceSoft,
    },
    tileImage: { position: 'absolute', width: '100%', height: '100%' },
    tilePlaceholder: {
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceStrong,
    },
    tileEmoji: { fontSize: 44 },
    tileShade: { position: 'absolute', left: 0, right: 0, bottom: 0, height: '55%' },
    tileTop: {
      flexDirection: 'row',
      justifyContent: 'space-between',
      alignItems: 'flex-start',
      padding: 10,
    },
    tileBottom: { marginTop: 'auto', padding: 12, gap: 3 },
    tileTitle: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
    tileTimeRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    tileTime: { color: 'rgba(255,255,255,0.85)', fontSize: 12, fontWeight: '600' },
    badge: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 5,
      paddingHorizontal: 9,
      paddingVertical: 4,
      borderRadius: radius.pill,
    },
    badgeDot: { width: 7, height: 7, borderRadius: 4 },
    badgeText: { fontSize: 12, fontWeight: '700' },
    empty: { color: colors.onGradientSoft, fontSize: 14, textAlign: 'center', marginTop: 30 },
    fab: {
      position: 'absolute',
      right: 6,
      bottom: 14,
      width: 58,
      height: 58,
      borderRadius: 29,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
      shadowColor: '#000',
      shadowOpacity: 0.3,
      shadowRadius: 8,
      shadowOffset: { width: 0, height: 4 },
      elevation: 6,
    },

    // Detail
    detailStack: { gap: 12 },
    detailImage: {
      width: '100%',
      aspectRatio: 16 / 10,
      borderRadius: radius.card - 6,
      backgroundColor: colors.surfaceSoft,
    },
    detailTop: {
      position: 'absolute',
      left: 10,
      right: 10,
      top: 10,
      flexDirection: 'row',
      justifyContent: 'space-between',
    },
    roundButton: {
      width: 38,
      height: 38,
      borderRadius: 19,
      backgroundColor: 'rgba(10, 14, 20, 0.45)',
      alignItems: 'center',
      justifyContent: 'center',
    },
    detailTitle: { color: colors.onGradient, fontSize: 26, fontWeight: '800' },
    chipRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, alignItems: 'center' },
    factChip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    factChipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    tagText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    description: { color: colors.onGradientSoft, fontSize: 14, lineHeight: 20 },
    servingsCard: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      paddingHorizontal: 14,
      paddingVertical: 10,
    },
    servingsLabel: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    servingsControls: { flexDirection: 'row', alignItems: 'center', gap: 14 },
    stepperButton: {
      width: 34,
      height: 34,
      borderRadius: 17,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    servingsValue: {
      color: colors.ink,
      fontSize: 20,
      fontWeight: '800',
      minWidth: 26,
      textAlign: 'center',
    },
    sectionTitle: {
      color: colors.onGradientSoft,
      fontSize: 13,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.8,
      marginTop: 4,
    },
    groupLabel: { color: colors.onGradient, fontSize: 14, fontWeight: '700', marginBottom: 6 },
    ingredientCard: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      paddingHorizontal: 14,
    },
    ingredientRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 12 },
    ingredientDivider: { borderTopWidth: 1, borderTopColor: colors.surfaceBorder },
    ingredientAmount: {
      color: colors.warn,
      fontSize: 15,
      fontWeight: '700',
      minWidth: 84,
    },
    ingredientName: { color: colors.ink, fontSize: 15, flex: 1 },
    stepsCard: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      padding: 14,
      gap: 14,
    },
    stepRow: { flexDirection: 'row', gap: 12 },
    stepNumber: {
      width: 26,
      height: 26,
      borderRadius: 13,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
      justifyContent: 'center',
    },
    stepNumberText: { color: colors.accent, fontSize: 13, fontWeight: '800' },
    stepBody: { color: colors.ink, fontSize: 15, lineHeight: 22, flex: 1 },
    extraLine: { color: colors.ink, fontSize: 14, lineHeight: 21 },
    sourceLink: { color: colors.accent, fontSize: 13 },
    actionBar: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 8,
      flexDirection: 'row',
      gap: 10,
    },
    actionButton: {
      flex: 1,
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 15,
      borderRadius: radius.pill,
    },
    actionButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
    planSheet: {
      position: 'absolute',
      left: 0,
      right: 0,
      bottom: 66,
      backgroundColor: colors.panel,
      borderRadius: radius.card - 6,
      padding: 14,
      gap: 10,
      shadowColor: '#000',
      shadowOpacity: 0.25,
      shadowRadius: 10,
      shadowOffset: { width: 0, height: 4 },
      elevation: 8,
    },
    planTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    planDays: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    planDay: {
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    planDayText: { color: colors.ink, fontSize: 13, fontWeight: '600' },

    // Kochmodus
    cookRoot: { flex: 1, padding: 20, paddingTop: 56, gap: 14 },
    cookBack: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    cookBackText: { color: colors.ink, fontSize: 17, fontWeight: '700' },
    cookHeading: { color: colors.ink, fontSize: 24, fontWeight: '800' },
    cookHead: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    cookTitle: { color: colors.inkSoft, fontSize: 16, fontWeight: '700', flex: 1, textAlign: 'center' },
    cookCount: { color: colors.accent, fontSize: 15, fontWeight: '800' },
    progressTrack: {
      height: 4,
      borderRadius: 2,
      backgroundColor: colors.track,
      overflow: 'hidden',
    },
    progressFill: { height: '100%', backgroundColor: colors.accent },
    cookBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 22 },
    stepBadge: {
      paddingHorizontal: 14,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    stepBadgeText: { color: colors.accent, fontSize: 13, fontWeight: '800', letterSpacing: 1 },
    stepText: {
      color: colors.ink,
      fontSize: 24,
      lineHeight: 34,
      fontWeight: '600',
      textAlign: 'center',
    },
    cookButtons: { flexDirection: 'row', gap: 10 },
    schrittZutaten: {
      alignItems: 'center',
      gap: 3,
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      paddingHorizontal: 16,
      paddingVertical: 10,
    },
    schrittZutatText: { color: colors.inkSoft, fontSize: 15, fontWeight: '600' },
    boxListe: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      paddingHorizontal: 14,
      paddingVertical: 6,
      gap: 2,
    },
    boxZeile: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 7 },
    boxZeileText: { color: colors.ink, fontSize: 14 },
    querSpalte: { width: 300, flexGrow: 0 },

    // Formular
    formStack: { gap: 8, paddingBottom: 30 },
    formHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
      marginBottom: 4,
    },
    formHeadTitle: { color: colors.onGradient, fontSize: 18, fontWeight: '800' },
    photoPick: {
      borderRadius: radius.control,
      overflow: 'hidden',
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    photoPreview: { width: '100%', aspectRatio: 16 / 10 },
    photoPlaceholder: {
      width: '100%',
      aspectRatio: 16 / 6,
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
    },
    photoHint: { color: colors.inkSoft, fontSize: 14, fontWeight: '600' },
    photoAction: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 4,
    },
    photoActionText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    katChips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    katChip: {
      paddingHorizontal: 11,
      paddingVertical: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceStrong,
    },
    katChipText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    importKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
      justifyContent: 'center',
    },
    importKnopfText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
    importFehler: { color: colors.danger, fontSize: 13, marginTop: 6 },
    formRow: { flexDirection: 'row', gap: 8 },
    input: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      paddingHorizontal: 13,
      paddingVertical: 11,
      color: colors.ink,
      fontSize: 15,
    },
    levelChip: {
      flex: 1,
      alignItems: 'center',
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
    },
    levelChipText: { color: colors.ink, fontSize: 14, fontWeight: '700' },
    primaryWide: {
      backgroundColor: colors.accent,
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 15,
    },
    primaryWideText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
    ghostWide: {
      borderRadius: radius.pill,
      alignItems: 'center',
      justifyContent: 'center',
      paddingVertical: 15,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    ghostWideText: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    // Die Frage nach dem Kochen (Punkt 190) und die Vorratssuche (192).
    notizHintergrund: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.5)',
      justifyContent: 'center',
      padding: 24,
    },
    notizKarte: {
      backgroundColor: colors.panel,
      borderRadius: radius.card,
      padding: 20,
      gap: 12,
    },
    notizFeld: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      color: colors.ink,
      fontSize: 15,
      minHeight: 76,
      padding: 12,
      textAlignVertical: 'top',
    },
    vorratKarte: { gap: 8, paddingHorizontal: 16, paddingBottom: 8 },
    vorratZeile: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      paddingVertical: 6,
    },
    vorratFehlt: { color: colors.inkSoft, fontSize: 12 },
    /** Der Knopf, der das Fehlende auf die Einkaufsliste legt. */
    vorratKauf: {
      padding: 6,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
    },
    /** «Alles nehmen, was im Vorrat steht» – der Knopf, der die
     *  Handarbeit abnimmt, für die es diese Karte gibt. */
    vorratAusVorrat: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      paddingVertical: 7,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      marginBottom: 4,
    },
    vorratAusVorratText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    // Grossmutters Karte: hoch statt breit, und ganz sichtbar.
    originalBild: {
      width: '100%',
      height: 360,
      borderRadius: radius.card,
      backgroundColor: colors.surfaceSoft,
    },
    uhrReihe: {
      flexDirection: 'row',
      flexWrap: 'wrap',
      justifyContent: 'center',
      gap: 8,
    },
    uhrKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      marginTop: 14,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      backgroundColor: colors.surface,
    },
    uhrKnopfText: { color: colors.accent, fontSize: 14, fontWeight: '700' },
    zutatenToggle: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 8,
    },
    zutatenToggleText: { color: colors.inkSoft, fontSize: 13, fontWeight: '700' },
    zutatenZeile: { color: colors.inkSoft, fontSize: 14, lineHeight: 21 },
  });
