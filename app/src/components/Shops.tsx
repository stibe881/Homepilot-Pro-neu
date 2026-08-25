import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from './Card';
import {
  ORTE_KURZ,
  SHOP_CATEGORIES,
  Shop,
  gangReihenfolge,
  orteFuerLaden,
} from '../lib/einkauf';
import { Vorschlag as OrtVorschlag } from '../hooks/useOrte';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Die Läden und die Reihenfolge, in der man sie durchläuft.
 *
 * Im einen Laden kommt zuerst das Gemüse, im anderen die Getränke – und
 * wer die Liste in der falschen Reihenfolge abarbeitet, läuft dreimal
 * hin und her. Deshalb gehört die Reihenfolge zum Laden, nicht zur
 * Liste: Beim Einkaufen wählt man den Laden, und die Liste sortiert sich
 * danach.
 *
 * Die Gänge werden nicht gezogen, sondern angetippt: Ein Tipp hängt den
 * Gang hinten an die eigene Reihenfolge, ein zweiter nimmt ihn wieder
 * heraus. Das ist die Art, wie man einen Rundgang aufschreibt – der
 * Reihe nach, so wie man geht.
 */

/** Reihenfolge nach einem Tipp auf einen Gang (rein, testbar). */
export function toggleCategory(current: string[], category: string): string[] {
  return current.includes(category)
    ? current.filter((name) => name !== category)
    : [...current, category];
}

export function Shops({
  shops,
  orte = [],
  onAdd,
  onUpdate,
  onRemove,
  onOrtHier,
  onSuche,
  onVorschlag,
}: {
  shops: Shop[];
  /** Die Orte, die der Hub kennt – daraus wählt ein Laden seinen. */
  orte?: { id: string; name: string }[];
  onAdd: (shop: { name: string; categories: string[]; zone: string }) => void;
  onUpdate: (id: string, changes: Partial<Shop>) => void;
  onRemove: (id: string) => void;
  /** «Ich stehe jetzt hier»: legt den Ort an und hängt ihn an den Laden.
   *  Gibt eine Fehlermeldung zurück, leer heisst geklappt. */
  onOrtHier?: (shop: Shop) => Promise<string>;
  /** Adresse, Ladenname oder eingefügte Koordinaten nachschlagen. */
  onSuche?: (text: string) => Promise<{ treffer: OrtVorschlag[]; fehler: string }>;
  /** Einen Vorschlag als Ort des Ladens übernehmen. */
  onVorschlag?: (shop: Shop, vorschlag: OrtVorschlag) => Promise<string>;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [offen, setOffen] = useState(false);
  const [neu, setNeu] = useState('');
  const [bearbeitet, setBearbeitet] = useState<string | null>(null);
  const [meldung, setMeldung] = useState<string | null>(null);
  const [suchtext, setSuchtext] = useState('');
  const [vorschlaege, setVorschlaege] = useState<OrtVorschlag[]>([]);
  // Neunzehn Ortsknöpfe sind kein Angebot, sondern eine Wand.
  const [alleOrte, setAlleOrte] = useState(false);

  async function suchen(shop: Shop) {
    if (!onSuche) return;
    setMeldung('Suche …');
    const { treffer, fehler } = await onSuche(suchtext || shop.name);
    setVorschlaege(treffer);
    setMeldung(fehler || null);
  }

  async function uebernehmen(shop: Shop, vorschlag: OrtVorschlag) {
    if (!onVorschlag) return;
    const fehler = await onVorschlag(shop, vorschlag);
    setVorschlaege([]);
    setSuchtext('');
    setMeldung(fehler || `«${shop.name}» liegt jetzt bei ${vorschlag.name}.`);
  }

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOffen((war) => !war)}
        accessibilityRole="button"
        accessibilityState={{ expanded: offen }}
        style={({ pressed }) => [styles.head, pressed && { opacity: 0.8 }]}
      >
        <Ionicons name="storefront-outline" size={18} color={colors.inkSoft} />
        <View style={{ flex: 1 }}>
          <Text style={styles.heading}>Läden</Text>
          <Text style={styles.hint}>
            {shops.length === 0
              ? 'Noch keine – beim Einkaufen gilt dann die Standardreihenfolge'
              : shops.map((shop) => shop.name).join(' · ')}
          </Text>
        </View>
        <Ionicons
          name={offen ? 'chevron-up' : 'chevron-down'}
          size={20}
          color={colors.inkFaint}
        />
      </Pressable>

      {offen ? (
        <>
          <View style={styles.addRow}>
            <TextInput
              style={styles.input}
              value={neu}
              onChangeText={setNeu}
              placeholder="Neuer Laden, z.B. Coop Willisau"
              placeholderTextColor={colors.inkFaint}
              onSubmitEditing={() => {
                const name = neu.trim();
                if (!name) return;
                onAdd({ name, categories: [], zone: '' });
                setNeu('');
              }}
              returnKeyType="done"
            />
            <Pressable
              onPress={() => {
                const name = neu.trim();
                if (!name) return;
                onAdd({ name, categories: [], zone: '' });
                setNeu('');
              }}
              accessibilityRole="button"
              accessibilityLabel="Laden hinzufügen"
              style={({ pressed }) => [styles.addButton, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="add" size={20} color={colors.ink} />
            </Pressable>
          </View>

          {shops.map((shop) => {
            const aufgeklappt = bearbeitet === shop.id;
            const eigene = shop.categories ?? [];
            return (
              <View key={shop.id} style={styles.shop}>
                <Pressable
                  onPress={() => setBearbeitet(aufgeklappt ? null : shop.id)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.shopHead, pressed && { opacity: 0.8 }]}
                >
                  <Text style={styles.shopName} numberOfLines={1}>
                    {shop.name}
                  </Text>
                  <Text style={styles.hint}>
                    {eigene.length === 0
                      ? 'Standardreihenfolge'
                      : `${eigene.length} von ${SHOP_CATEGORIES.length} geordnet`}
                  </Text>
                  <Ionicons
                    name={aufgeklappt ? 'chevron-up' : 'chevron-down'}
                    size={18}
                    color={colors.inkFaint}
                  />
                </Pressable>

                {aufgeklappt ? (
                  <>
                    <View style={styles.gangKopf}>
                      <Text style={[styles.hint, { flex: 1 }]}>
                        Die Gänge der Reihe nach antippen, so wie du durch den
                        Laden gehst. Was du nicht antippst, hängt hinten an.
                      </Text>
                      {eigene.length > 0 ? (
                        <Pressable
                          onPress={() => onUpdate(shop.id, { categories: [] })}
                          accessibilityRole="button"
                          accessibilityLabel={`Reihenfolge von ${shop.name} zurücksetzen`}
                          style={({ pressed }) => [pressed && { opacity: 0.6 }]}
                        >
                          <Text style={styles.zuruecksetzen}>Zurücksetzen</Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {/* In ihrer eigenen Reihenfolge, nicht in der der
                        festen Liste: Vorher standen die Knöpfe als «1.
                        Früchte, 3. Milch / 2. Brot, 4. Fleisch» da, und
                        man musste die Nummern suchen, statt sie zu
                        lesen. Damit erübrigt sich auch die Zeile
                        «Ergibt: … → … → …», die dasselbe noch einmal
                        sagte. */}
                    <View style={styles.chips}>
                      {gangReihenfolge(shop).map(({ name, platz }) => (
                        <Pressable
                          key={name}
                          onPress={() =>
                            onUpdate(shop.id, {
                              categories: toggleCategory(eigene, name),
                            })
                          }
                          accessibilityRole="button"
                          accessibilityLabel={
                            platz
                              ? `${name}, Platz ${platz} – antippen entfernt ihn`
                              : `${name} als Nächstes einordnen`
                          }
                          style={[styles.chip, platz ? styles.chipActive : null]}
                        >
                          {platz ? <Text style={styles.chipNummer}>{platz}</Text> : null}
                          <Text
                            style={[styles.chipText, platz ? styles.chipTextActive : null]}
                          >
                            {name}
                          </Text>
                        </Pressable>
                      ))}
                    </View>

                    <Text style={styles.label}>Ort (für die Erinnerung)</Text>
                    {/* Kein Koordinatenfeld: Wer davorsteht, drückt einen
                        Knopf. Abgetippte Koordinaten liegen zu oft daneben,
                        und ein Ort, der 300 m danebenliegt, meldet sich nie. */}
                    <View style={styles.chips}>
                      {orteFuerLaden(orte, shop.place, alleOrte).map((ort) => {
                        const gewaehlt = shop.place === ort.id;
                        return (
                          <Pressable
                            key={ort.id}
                            onPress={() =>
                              onUpdate(shop.id, { place: gewaehlt ? '' : ort.id })
                            }
                            accessibilityRole="button"
                            style={[styles.chip, gewaehlt && styles.chipActive]}
                          >
                            <Text
                              style={[styles.chipText, gewaehlt && styles.chipTextActive]}
                            >
                              {ort.name}
                            </Text>
                          </Pressable>
                        );
                      })}
                      {orte.length > ORTE_KURZ ? (
                        <Pressable
                          onPress={() => setAlleOrte((war) => !war)}
                          accessibilityRole="button"
                          style={({ pressed }) => [
                            styles.chip,
                            styles.chipMehr,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Text style={styles.chipText}>
                            {alleOrte ? 'weniger' : `alle ${orte.length} zeigen`}
                          </Text>
                        </Pressable>
                      ) : null}
                    </View>
                    {onSuche ? (
                      <View style={styles.addRow}>
                        <TextInput
                          style={styles.input}
                          value={suchtext}
                          onChangeText={setSuchtext}
                          onSubmitEditing={() => suchen(shop)}
                          placeholder="Adresse, Laden oder Koordinaten"
                          placeholderTextColor={colors.inkFaint}
                          returnKeyType="search"
                        />
                        <Pressable
                          onPress={() => suchen(shop)}
                          accessibilityRole="button"
                          accessibilityLabel="Ort suchen"
                          style={styles.addButton}
                        >
                          <Ionicons name="search" size={18} color={colors.ink} />
                        </Pressable>
                      </View>
                    ) : null}
                    {/* Die volle Adresse steht dabei: Daran erkennt man den
                        richtigen von drei gleichnamigen Läden. */}
                    {vorschlaege.map((vorschlag, index) => (
                      <Pressable
                        key={`${vorschlag.latitude}-${vorschlag.longitude}-${index}`}
                        onPress={() => uebernehmen(shop, vorschlag)}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.vorschlag,
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Ionicons name="location-outline" size={16} color={colors.inkSoft} />
                        <View style={{ flex: 1 }}>
                          <Text style={styles.ortKnopfText} numberOfLines={1}>
                            {vorschlag.name}
                          </Text>
                          <Text style={styles.hint} numberOfLines={2}>
                            {vorschlag.address}
                          </Text>
                        </View>
                      </Pressable>
                    ))}
                    {onOrtHier ? (
                      <Pressable
                        onPress={async () => {
                          setMeldung(null);
                          const fehler = await onOrtHier(shop);
                          setMeldung(fehler || `«${shop.name}» ist jetzt hier.`);
                        }}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.ortKnopf,
                          pressed && { opacity: 0.8 },
                        ]}
                      >
                        <Ionicons name="location" size={16} color={colors.ink} />
                        <Text style={styles.ortKnopfText}>
                          … oder: ich stehe jetzt bei «{shop.name}»
                        </Text>
                      </Pressable>
                    ) : null}
                    {meldung ? <Text style={styles.hint}>{meldung}</Text> : null}
                    <Text style={styles.hint}>
                      Zeigt der Laden auf einen Ort, meldet sich der Hub, wenn du
                      länger als vier Minuten dort bist und noch etwas auf der
                      Liste steht. Ohne Ort passiert nichts – der Laden
                      funktioniert trotzdem.
                    </Text>

                    <Pressable
                      onPress={() => onRemove(shop.id)}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.remove, pressed && { opacity: 0.8 }]}
                    >
                      <Ionicons name="trash-outline" size={16} color={colors.danger} />
                      <Text style={styles.removeText}>Laden entfernen</Text>
                    </Pressable>
                  </>
                ) : null}
              </View>
            );
          })}
        </>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { gap: 10, minHeight: 0 },
    head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
    heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    hint: { color: colors.inkFaint, fontSize: 12, lineHeight: 18 },
    label: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      marginTop: 6,
    },
    addRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    input: {
      flex: 1,
      color: colors.ink,
      fontSize: 14,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    ortKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      alignSelf: 'flex-start',
      marginTop: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    ortKnopfText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    vorschlag: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 10,
      marginTop: 8,
      paddingVertical: 8,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    addButton: {
      width: 36,
      height: 36,
      borderRadius: 18,
      alignItems: 'center',
      justifyContent: 'center',
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    shop: {
      gap: 8,
      paddingTop: 10,
      borderTopWidth: 1,
      borderTopColor: colors.surfaceBorder,
    },
    shopHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
    shopName: { color: colors.ink, fontSize: 14, fontWeight: '600', flex: 1 },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    chip: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    chipText: { color: colors.ink, fontSize: 12 },
    chipTextActive: { color: '#FFFFFF', fontWeight: '600' },
    // Die Nummer als eigenes Zeichen, nicht als «1. » im Text: So steht
    // sie bei jedem Gang an derselben Stelle, statt mit der Länge des
    // Namens zu wandern.
    chipNummer: {
      color: '#FFFFFF',
      fontSize: 11,
      fontWeight: '700',
      minWidth: 14,
      textAlign: 'center',
      opacity: 0.85,
      fontVariant: ['tabular-nums'],
    },
    chipMehr: { borderStyle: 'dashed' },
    gangKopf: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
    zuruecksetzen: { color: colors.inkSoft, fontSize: 12, paddingTop: 1 },
    remove: { flexDirection: 'row', alignItems: 'center', gap: 6, paddingTop: 4 },
    removeText: { color: colors.danger, fontSize: 13 },
  });
