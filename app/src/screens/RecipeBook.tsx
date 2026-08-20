import { Ionicons } from '@expo/vector-icons';
import { LinearGradient } from 'expo-linear-gradient';
import * as ImagePicker from 'expo-image-picker';
import React, { useMemo, useState } from 'react';
import {
  Image,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { Colors, radius, useColors } from '../theme';

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
  recipes: any[];
  currentUser?: { name: string } | null;
  onAdd: (recipe: Record<string, any>) => void;
  onUpdate: (id: string, patch: Record<string, any>) => void;
  onDelete: (id: string) => void;
  planMeal: (day: string, text: string) => void;
  /** Zutaten dieses Rezepts auf die Einkaufsliste. Meldet zurück, wie
   *  viele Posten wirklich dazugekommen sind - schon Vorhandenes zählt
   *  nicht mit, und «0 hinzugefügt» ist eine ehrlichere Antwort als ein
   *  wortloses Häkchen. */
  onShopping: (recipe: any) => number;
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
export function totalMinutes(recipe: any): number {
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

export function difficultyInfo(value: any) {
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

/** Menge skaliert auf die gewählten Portionen, hübsch formatiert. */
export function scaledAmount(amount: any, factor: number): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return String(amount ?? '');
  const scaled = value * factor;
  const rounded = Math.round(scaled * 100) / 100;
  return String(Number.isInteger(rounded) ? rounded : rounded).replace('.', ',');
}

/** Tipps/Hinweise/Notizen: Text, Liste oder Liste von {text} → Zeilen. */
export function listOfTexts(value: any): string[] {
  if (!value) return [];
  return (Array.isArray(value) ? value : [value])
    .map((entry) => (typeof entry === 'string' ? entry : String(entry?.text ?? '')))
    .map((text) => text.trim())
    .filter(Boolean);
}

/** Zutaten in der Reihenfolge ihrer Gruppen («Die Basis», «Die Würze» …). */
export function ingredientGroups(ingredients: any[]): { label: string; items: any[] }[] {
  const groups: { label: string; items: any[] }[] = [];
  for (const ingredient of ingredients) {
    const label = String(ingredient?.category ?? '').trim();
    const last = groups[groups.length - 1];
    if (last && last.label === label) last.items.push(ingredient);
    else groups.push({ label, items: [ingredient] });
  }
  return groups;
}

/** Suche über Titel, Beschreibung, Zutaten, Kategorie und Schlagwörter. */
export function matchesSearch(recipe: any, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [
    recipe.text,
    recipe.description,
    recipe.category,
    ...(Array.isArray(recipe.tags) ? recipe.tags : []),
    ...(Array.isArray(recipe.ingredients)
      ? recipe.ingredients.map((ingredient: any) => ingredient?.name)
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
export function parseIngredients(text: string): any[] {
  const result: any[] = [];
  let category = '';
  for (const raw of text.split('\n')) {
    const line = raw.replace(/^[-•*]\s*/, '').trim();
    if (!line) continue;
    if (line.endsWith(':')) {
      category = line.slice(0, -1).trim();
      continue;
    }
    const entry: any = { name: line };
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
export function serializeIngredients(ingredients: any[]): string {
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

function stepTexts(recipe: any): string[] {
  const raw: any[] = Array.isArray(recipe?.instructions) ? recipe.instructions : [];
  return raw
    .map((step) => (typeof step === 'string' ? step : String(step?.text ?? '')))
    .map((text) => text.trim())
    .filter(Boolean);
}

// ── Bausteine ───────────────────────────────────────────────────────────────

function DifficultyBadge({ recipe, styles, colors }: { recipe: any; styles: Styles; colors: Colors }) {
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
  onOpen,
  onToggleFavorite,
  styles,
  colors,
}: {
  recipe: any;
  width: number;
  onOpen: () => void;
  onToggleFavorite: () => void;
  styles: Styles;
  colors: Colors;
}) {
  const minutes = totalMinutes(recipe);
  return (
    <Pressable onPress={onOpen} style={[styles.tile, { width }]}>
      {recipe.image_url ? (
        <Image source={{ uri: String(recipe.image_url) }} style={styles.tileImage} resizeMode="cover" />
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
  onSave,
  onCancel,
  styles,
  colors,
}: {
  initial?: any;
  onSave: (recipe: Record<string, any>) => void;
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
  const [image, setImage] = useState<string>(String(initial?.image_url ?? ''));

  // Foto aus der Galerie: als data-URI (Base64) speichern, damit es über den
  // Familie-Store beim Hub liegt und nicht von einem lokalen Pfad abhängt.
  const pickImage = async () => {
    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) return;
    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.6,
      base64: true,
      allowsEditing: true,
      aspect: [16, 10],
    });
    if (result.canceled || !result.assets?.length) return;
    const asset = result.assets[0];
    setImage(asset.base64 ? `data:image/jpeg;base64,${asset.base64}` : asset.uri);
  };

  const submit = () => {
    if (!title.trim()) return;
    const recipe: Record<string, any> = { text: title.trim() };
    recipe.image_url = image || null;
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

      <Pressable onPress={pickImage} style={styles.photoPick} accessibilityRole="button">
        {image ? (
          <Image source={{ uri: image }} style={styles.photoPreview} resizeMode="cover" />
        ) : (
          <View style={styles.photoPlaceholder}>
            <Ionicons name="camera-outline" size={28} color={colors.inkSoft} />
            <Text style={styles.photoHint}>Foto hinzufügen</Text>
          </View>
        )}
      </Pressable>
      {image ? (
        <Pressable onPress={() => setImage('')} accessibilityRole="button">
          <Text style={[styles.sourceLink, { color: colors.inkSoft }]}>Foto entfernen</Text>
        </Pressable>
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
function CookMode({
  recipe,
  factor,
  onClose,
  styles,
  colors,
}: {
  recipe: any;
  factor: number;
  onClose: () => void;
  styles: Styles;
  colors: Colors;
}) {
  // -1 = Mise en Place, 0..n-1 = Schritte.
  const [step, setStep] = useState(-1);
  const steps = stepTexts(recipe);
  const ingredients: any[] = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];

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
                  <View
                    key={index}
                    style={[styles.ingredientRow, index > 0 && styles.ingredientDivider]}
                  >
                    <Text style={styles.ingredientAmount}>
                      {[scaledAmount(ingredient?.amount, factor), ingredient?.unit]
                        .filter(Boolean)
                        .join(' ')}
                    </Text>
                    <Text style={styles.ingredientName}>{String(ingredient?.name ?? '')}</Text>
                  </View>
                ))}
              </View>
            </ScrollView>
            <Pressable onPress={() => setStep(0)} style={styles.primaryWide}>
              <Text style={styles.primaryWideText}>Loskochen →</Text>
            </Pressable>
          </>
        ) : (
          <>
            <View style={styles.cookHead}>
              <Pressable onPress={onClose} hitSlop={8}>
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
            <View style={styles.cookBody}>
              <View style={styles.stepBadge}>
                <Text style={styles.stepBadgeText}>SCHRITT {step + 1}</Text>
              </View>
              <Text style={styles.stepText}>{steps[step]}</Text>
            </View>
            <View style={styles.cookButtons}>
              <Pressable
                onPress={() => setStep((value) => value - 1)}
                style={[styles.ghostWide, { flex: 1 }]}
              >
                <Text style={styles.ghostWideText}>← Zurück</Text>
              </Pressable>
              <Pressable
                onPress={() => (step + 1 < steps.length ? setStep(step + 1) : onClose())}
                style={[styles.primaryWide, { flex: 1.4 }]}
              >
                <Text style={styles.primaryWideText}>
                  {step + 1 < steps.length ? 'Weiter →' : 'Fertig ✓'}
                </Text>
              </Pressable>
            </View>
          </>
        )}
      </View>
    </Modal>
  );
}

/** Detailansicht: grosses Bild, Fakten-Chips, Portionen, Zutaten, Schritte. */
function RecipeDetail({
  recipe,
  onBack,
  onEdit,
  onDelete,
  onToggleFavorite,
  planMeal,
  onShopping,
  styles,
  colors,
}: {
  recipe: any;
  onBack: () => void;
  onEdit: () => void;
  onDelete: () => void;
  onToggleFavorite: () => void;
  planMeal: (day: string, text: string) => void;
  onShopping: (recipe: any) => number;
  styles: Styles;
  colors: Colors;
}) {
  const baseServings = Number(recipe.servings) || 0;
  const [servings, setServings] = useState(baseServings || 4);
  const [planOpen, setPlanOpen] = useState(false);
  const [planned, setPlanned] = useState<string | null>(null);
  const [cooking, setCooking] = useState(false);
  // Wie viele Posten der letzte Klick auf «Einkauf» wirklich hinzugefügt
  // hat. null = noch nicht gedrückt.
  const [eingekauft, setEingekauft] = useState<number | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);

  const factor = baseServings > 0 ? servings / baseServings : 1;
  const ingredients: any[] = Array.isArray(recipe.ingredients) ? recipe.ingredients : [];
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
          {recipe.image_url ? (
            <Image
              source={{ uri: String(recipe.image_url) }}
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
            <Pressable onPress={onBack} style={styles.roundButton} hitSlop={6}>
              <Ionicons name="arrow-back" size={20} color="#FFFFFF" />
            </Pressable>
            <View style={{ flexDirection: 'row', gap: 8 }}>
              <Pressable onPress={onToggleFavorite} style={styles.roundButton} hitSlop={6}>
                <Ionicons
                  name={recipe.favorite ? 'heart' : 'heart-outline'}
                  size={20}
                  color={recipe.favorite ? '#FF5A6E' : '#FFFFFF'}
                />
              </Pressable>
              <Pressable onPress={onEdit} style={styles.roundButton} hitSlop={6}>
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
                onPress={() => setServings((value) => Math.max(1, value - 1))}
                style={styles.stepperButton}
                hitSlop={6}
              >
                <Ionicons name="remove" size={18} color={colors.ink} />
              </Pressable>
              <Text style={styles.servingsValue}>{servings}</Text>
              <Pressable
                onPress={() => setServings((value) => Math.min(99, value + 1))}
                style={styles.stepperButton}
                hitSlop={6}
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

        {recipe.source_url ? (
          <Pressable onPress={() => Linking.openURL(String(recipe.source_url)).catch(() => {})}>
            <Text style={styles.sourceLink}>Quelle: {String(recipe.source_url)}</Text>
          </Pressable>
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
            onPress={() => setEingekauft(onShopping(recipe))}
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
                  planMeal(day, recipe.text);
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
          onClose={() => setCooking(false)}
          styles={styles}
          colors={colors}
        />
      ) : null}
    </View>
  );
}

// ── Hauptkomponente ─────────────────────────────────────────────────────────

type Screen = { kind: 'list' } | { kind: 'detail'; id: string } | { kind: 'form'; id?: string };

export function RecipeBook({
  recipes,
  currentUser,
  onAdd,
  onUpdate,
  onDelete,
  planMeal,
  onShopping,
  onClose,
}: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [screen, setScreen] = useState<Screen>({ kind: 'list' });
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState('alle');
  const [gridWidth, setGridWidth] = useState(0);

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
    }
    return list;
  }, [recipes, query, filter, currentUser]);

  const favoriteCount = recipes.filter((recipe) => recipe.favorite).length;
  const toggleFavorite = (recipe: any) =>
    onUpdate(recipe.id, { favorite: !recipe.favorite });

  if (screen.kind === 'form') {
    const editing = screen.id
      ? recipes.find((recipe) => recipe.id === screen.id)
      : undefined;
    return (
      <RecipeForm
        initial={editing}
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
        onBack={() => setScreen({ kind: 'list' })}
        onEdit={() => setScreen({ kind: 'form', id: recipe.id })}
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

  const columns = 2;
  const tileWidth = gridWidth > 0 ? Math.floor((gridWidth - 12) / columns) : 0;
  const filters: { key: string; label: string; icon?: keyof typeof Ionicons.glyphMap }[] = [
    { key: 'alle', label: 'Alle', icon: 'book-outline' },
    { key: 'favoriten', label: 'Favoriten', icon: 'heart' },
    { key: 'neueste', label: 'Neueste', icon: 'time-outline' },
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
        <Pressable onPress={onClose} style={styles.roundButtonDim} hitSlop={6}>
          <Ionicons name="close" size={20} color={colors.ink} />
        </Pressable>
      </View>

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
  });
