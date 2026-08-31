/**
 * Die Seite eines Kindes.
 *
 * Im Personenraster stand bisher nur, wer dazugehört und ob er zuhause
 * ist. Die Frage, die man mit dem Blick darauf tatsächlich stellt,
 * lautet aber «Was hat Levin heute?» – und die Antwort lag an drei
 * Orten: im Familienkalender zwischen allen anderen Terminen, auf dem
 * Stundenplan-Zettel am Kühlschrank und im Kopf (Fussball am Dienstag).
 *
 * Hier stehen die drei nebeneinander. Was gerechnet wird, steht rein und
 * geprüft in lib/kindseite.ts; hier nur die Anzeige und die Formulare.
 *
 * **Der Stundenplan zeigt einen Tag, nicht die Woche.** Fünf Tage mit je
 * sechs Lektionen sind dreissig Zeilen – dreimal die Bildschirmhöhe, und
 * der heutige Dienstag liegt in der Mitte. Mit den Wochentagen als
 * Knöpfen steht der Tag, den man sucht, sofort da; und weil der Tag
 * schon gewählt ist, braucht das Formular darunter keine zweite
 * Tagesreihe.
 *
 * **Warum eine eigene Datei.** FamilyScreen.tsx ist über viertausend
 * Zeilen lang; jede weitere Ansicht darin macht die Datei unlesbarer,
 * ohne dass sie mit den anderen etwas zu tun hätte.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { Card } from '../../components/Card';
import { terminWann } from '../../lib/kalenderliste';
import {
  TAGE,
  TAG_NAMEN,
  heuteSatz,
  kindTermine,
  naechstesMal,
  MINUTE_PUNKTE,
  Woche,
  fuerWoche,
  naechsteWocheFach,
  nachmittagFrei,
  rasterLage,
  tagVon,
  tagesplanMitPausen,
  uhrText,
  wocheVon,
  wochenliste,
  wochenplan,
  zeitNormal,
  zeitraster,
  zeitraum,
  zuUebernehmen,
} from '../../lib/kindseite';
import { Colors, radius } from '../../theme';
import { BackHead, FamilyItem, Styles } from './bausteine';

/** Die beiden wöchentlichen Listen beim Hub. */
export type Wochenliste = 'lessons' | 'activities';

/** Luft über und unter der Zeitachse, damit die erste und letzte
 *  Stundenbeschriftung nicht an der Kartenkante klebt. */
const RASTER_POLSTER = 10;
/** Breite der Stundenspalte links - dahinter beginnen die Blöcke. */
const ZEIT_SPALTE = 50;

/** Die Wochentage als Knopfreihe – einmal für den Stundenplan, einmal
 *  im Formular für die wöchentlichen Termine. */
function Tagesreihe({
  gewaehlt,
  belegt,
  onWaehlen,
  styles,
  colors,
}: {
  gewaehlt: string;
  /** Tage, an denen etwas steht – sie tragen einen Punkt. Ohne ihn
   *  müsste man jeden Tag einzeln antippen, um zu sehen, ob dort etwas
   *  ist. */
  belegt?: string[];
  onWaehlen: (tag: string) => void;
  styles: Styles;
  colors: Colors;
}) {
  const eigen = useMemo(() => makeStyles(colors), [colors]);
  return (
    <View style={styles.chipRow}>
      {TAGE.map((tag) => (
        <Pressable
          key={tag}
          onPress={() => onWaehlen(tag)}
          accessibilityRole="radio"
          accessibilityState={{ selected: gewaehlt === tag }}
          accessibilityLabel={TAG_NAMEN[tag]}
          style={[styles.chip, eigen.tagChip, gewaehlt === tag && styles.chipActive]}
        >
          <Text style={[styles.chipText, gewaehlt === tag && styles.chipTextActive]}>
            {tag}
          </Text>
          {(belegt ?? []).includes(tag) ? (
            <View
              style={[
                eigen.punkt,
                { backgroundColor: gewaehlt === tag ? '#FFFFFF' : colors.accent },
              ]}
            />
          ) : null}
        </Pressable>
      ))}
    </View>
  );
}

/**
 * Das Formular für eine wöchentliche Zeile.
 *
 * Stundenplan und Fussballtraining sind dasselbe Ding: ein Name, ein
 * Wochentag, eine Zeitspanne. Nur der Ort gehört bloss zum zweiten –
 * bei einer Schulstunde wüsste man ihn nicht auszufüllen.
 */
function WochenForm({
  platzhalter,
  mitOrt,
  tag,
  onTag,
  onAdd,
  dieseWoche,
  styles,
  colors,
}: {
  platzhalter: string;
  mitOrt?: boolean;
  tag: string;
  /** Fehlt sie, ist der Tag von aussen gesetzt (Stundenplan). */
  onTag?: (tag: string) => void;
  onAdd: (zeile: FamilyItem) => void;
  /** Gesetzt heisst: Das Fach kann alle zwei Wochen stattfinden
   *  (A/B-Wochen), und diese hier läuft gerade. */
  dieseWoche?: Woche;
  styles: Styles;
  colors: Colors;
}) {
  const [text, setText] = useState('');
  const [von, setVon] = useState('');
  const [bis, setBis] = useState('');
  const [ort, setOrt] = useState('');
  const [woche, setWoche] = useState<'' | Woche>('');
  const bereit = Boolean(text.trim()) && zeitNormal(von) !== null;

  const submit = () => {
    // Ohne Namen und ohne Anfang wäre es kein Termin, sondern eine
    // leere Zeile, die man nachher nicht mehr zuordnen kann.
    const name = text.trim();
    const anfang = zeitNormal(von);
    if (!name || !anfang) return;
    onAdd({
      day: tag,
      text: name,
      from: anfang,
      to: zeitNormal(bis) ?? '',
      ...(woche ? { week: woche } : {}),
      ...(mitOrt && ort.trim() ? { ort: ort.trim() } : {}),
    });
    setText('');
    setVon('');
    setBis('');
    setOrt('');
    setWoche('');
  };

  return (
    <View style={{ gap: 8, marginTop: 4 }}>
      {onTag ? (
        <Tagesreihe gewaehlt={tag} onWaehlen={onTag} styles={styles} colors={colors} />
      ) : null}
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={text}
          onChangeText={setText}
          placeholder={platzhalter}
          placeholderTextColor={colors.inkSoft}
          onSubmitEditing={submit}
        />
        <Pressable
          onPress={submit}
          style={[styles.addButton, !bereit && { opacity: 0.5 }]}
          accessibilityLabel={`Am ${TAG_NAMEN[tag]} eintragen`}
        >
          <Ionicons name="add" size={22} color="#FFFFFF" />
        </Pressable>
      </View>
      <View style={styles.addRow}>
        <TextInput
          style={[styles.input, { width: 82 }]}
          value={von}
          onChangeText={setVon}
          placeholder="von"
          placeholderTextColor={colors.inkSoft}
          accessibilityLabel="Beginn, zum Beispiel 08:20"
        />
        <TextInput
          style={[styles.input, { width: 82 }]}
          value={bis}
          onChangeText={setBis}
          placeholder="bis"
          placeholderTextColor={colors.inkSoft}
          accessibilityLabel="Ende, zum Beispiel 09:05"
        />
        {mitOrt ? (
          <TextInput
            style={[styles.input, { flex: 1 }]}
            value={ort}
            onChangeText={setOrt}
            placeholder="Wo?"
            placeholderTextColor={colors.inkSoft}
            onSubmitEditing={submit}
          />
        ) : null}
      </View>
      {/* Manche Fächer wechseln sich alle zwei Wochen ab (Handarbeit /
          Werken). «diese Woche» steht dran, damit man beim Eintragen
          weiss, welche Woche gerade läuft. */}
      {dieseWoche ? (
        <View style={styles.chipRow}>
          {(['', 'A', 'B'] as const).map((wahl) => (
            <Pressable
              key={wahl || 'jede'}
              onPress={() => setWoche(wahl)}
              accessibilityRole="radio"
              accessibilityState={{ selected: woche === wahl }}
              style={[styles.chip, woche === wahl && styles.chipActive]}
            >
              <Text style={[styles.chipText, woche === wahl && styles.chipTextActive]}>
                {wahl === ''
                  ? 'Jede Woche'
                  : `Woche ${wahl}${wahl === dieseWoche ? ' · diese' : ''}`}
              </Text>
            </Pressable>
          ))}
        </View>
      ) : null}
    </View>
  );
}

export function Kindseite({
  name,
  fehler,
  hinweis,
  lektionen,
  termine,
  events,
  jetzt,
  onBack,
  onAdd,
  onRemove,
  styles,
  colors,
}: {
  name: string;
  /** Warum das letzte Speichern scheiterte - dieselbe Zeile wie auf der
   *  Familienseite. Ohne sie scheiterte Speichern hier unsichtbar. */
  fehler?: string | null;
  /** «Stand von 14:12 · 2 Änderungen warten» - die ehrliche Zeile. */
  hinweis?: string | null;
  /** «lessons» – der Stundenplan. */
  lektionen: FamilyItem[];
  /** «activities» – was jede Woche wiederkehrt. */
  termine: FamilyItem[];
  /** Die Termine aus dem Kalender, so weit die Seite sie hat. */
  events: FamilyItem[];
  jetzt: Date;
  onBack: () => void;
  onAdd: (liste: Wochenliste, zeile: FamilyItem) => void;
  onRemove: (liste: Wochenliste, id: string) => void;
  styles: Styles;
  colors: Colors;
}) {
  const eigen = useMemo(() => makeStyles(colors), [colors]);
  const heuteTag = tagVon(jetzt);
  const [schultag, setSchultag] = useState(heuteTag);
  const [terminTag, setTerminTag] = useState(heuteTag);
  const [formOffen, setFormOffen] = useState<Wochenliste | null>(null);

  const plan = wochenplan(lektionen, name);
  const dieseWoche = wocheVon(jetzt);
  // Ungefiltert für Übernehmen und den Blick in die andere Woche -
  // angezeigt wird nur, was in dieser Woche gilt.
  const tagesplanAlle = plan.find((block) => block.tag === schultag)?.zeilen ?? [];
  const tagesplan = fuerWoche(tagesplanAlle, dieseWoche);
  const hatWochen = lektionen.some(
    (zeile) =>
      zeile?.member === name && (zeile?.week === 'A' || zeile?.week === 'B')
  );
  const schultage = plan.map((block) => block.tag);
  // Nur am heutigen Tag läuft etwas - für den Dienstag von morgen gibt
  // es kein «jetzt».
  const jetztMin =
    schultag === heuteTag ? jetzt.getHours() * 60 + jetzt.getMinutes() : null;
  const planZeilen = tagesplanMitPausen(tagesplan, jetztMin);
  // Die Zeitachse des Tages - null, wenn keine Zeile eine lesbare Zeit
  // trägt; dann bleibt die schlichte Liste.
  const raster = zeitraster(tagesplan);
  const ohneZeit = raster
    ? tagesplan.filter((zeile) => rasterLage(zeile?.from, zeile?.to, raster) === null)
    : [];
  const frei = nachmittagFrei(tagesplan);
  const andereTage = schultage.filter((tag) => tag !== schultag);
  const woche = wochenliste(termine, name);
  const naechste = kindTermine(events, name, jetzt);

  const zeile = (
    eintrag: FamilyItem,
    liste: Wochenliste,
    titel: string,
    unten: string
  ) => (
    <View key={String(eintrag.id)} style={eigen.zeile}>
      <View style={{ flex: 1 }}>
        <Text style={styles.checkText}>{titel}</Text>
        {unten ? <Text style={styles.checkSub}>{unten}</Text> : null}
      </View>
      <Pressable
        onPress={() => onRemove(liste, String(eintrag.id))}
        style={styles.deleteTap}
        accessibilityRole="button"
        accessibilityLabel={`${titel} entfernen`}
      >
        <Ionicons name="close" size={18} color={colors.inkFaint} />
      </Pressable>
    </View>
  );

  /** Der Knopf, der ein Formular aufmacht. Zugeklappt, weil man
   *  hundertmal nachsieht und einmal einträgt. */
  const formKnopf = (liste: Wochenliste, was: string) => (
    <Pressable
      onPress={() => setFormOffen(formOffen === liste ? null : liste)}
      accessibilityRole="button"
      accessibilityState={{ expanded: formOffen === liste }}
      style={({ pressed }) => [eigen.formKnopf, pressed && { opacity: 0.7 }]}
    >
      <Ionicons
        name={formOffen === liste ? 'chevron-up' : 'add'}
        size={16}
        color={colors.accent}
      />
      <Text style={eigen.formKnopfText}>{formOffen === liste ? 'Schliessen' : was}</Text>
    </Pressable>
  );

  return (
    <View style={styles.stack}>
      <BackHead title={name} onBack={onBack} styles={styles} colors={colors} />
      {fehler ? <Text style={styles.error}>{fehler}</Text> : null}
      {hinweis ? <Text style={styles.checkSub}>{hinweis}</Text> : null}

      {/* Die eine Zeile, für die man die Seite aufmacht. */}
      <Card style={styles.listCard}>
        <Text style={eigen.kartenTitel}>Heute</Text>
        <Text style={eigen.heute}>{heuteSatz(lektionen, termine, name, jetzt)}</Text>
      </Card>

      <Text style={styles.groupLabel}>Nächste Termine</Text>
      <Card style={styles.listCard}>
        {naechste.length === 0 ? (
          // Warum nichts dasteht, ist hier die halbe Auskunft: Die Seite
          // sucht den Namen im Termin und kann nur finden, was jemand
          // hineingeschrieben hat.
          <Text style={styles.checkSub}>
            Im Kalender steht nichts, worin «{name}» vorkommt. Wer einen Termin für{' '}
            {name} einträgt, schreibt den Namen am besten in den Titel – dann steht er
            hier.
          </Text>
        ) : (
          naechste.map((event, index) => (
            <View key={String(event.uid ?? event.id ?? index)} style={eigen.zeile}>
              <Ionicons name="calendar-outline" size={17} color={colors.inkSoft} />
              <View style={{ flex: 1 }}>
                <Text style={styles.checkText}>{String(event.summary ?? '')}</Text>
                <Text style={styles.checkSub}>
                  {[terminWann(event, jetzt), String(event.location ?? '').trim()]
                    .filter(Boolean)
                    .join(' · ')}
                </Text>
              </View>
            </View>
          ))
        )}
      </Card>

      <Text style={styles.groupLabel}>Stundenplan</Text>
      <Card style={styles.listCard}>
        <Tagesreihe
          gewaehlt={schultag}
          belegt={schultage}
          onWaehlen={setSchultag}
          styles={styles}
          colors={colors}
        />
        <Text style={eigen.tagTitel}>
          {TAG_NAMEN[schultag]}
          {schultag === heuteTag ? ' · heute' : ''}
          {hatWochen ? ` · Woche ${dieseWoche}` : ''}
        </Text>
        {tagesplan.length === 0 ? (
          <Text style={styles.checkSub}>
            Am {TAG_NAMEN[schultag]} steht nichts. Einmal getippt, steht der Plan auf
            jedem Gerät – auch am Wandpanel.
          </Text>
        ) : raster ? (
          // Ein Stundenplan-Blatt, kein Blockstapel: links die vollen
          // Stunden mit Haarlinien, jede Lektion sitzt an ihrer wahren
          // Höhe auf der Zeitachse - eine Doppellektion ist von selbst
          // doppelt so hoch, und eine Pause ist eine sichtbare Lücke.
          // Die Zeitlinie («jetzt») zeigt, wo der Tag gerade steht.
          <View
            style={[eigen.rasterBlatt, { height: raster.hoehe + 2 * RASTER_POLSTER }]}
          >
            {raster.stunden.map((marke) => (
              <View
                key={marke}
                pointerEvents="none"
                style={[
                  eigen.stundenZeile,
                  { top: RASTER_POLSTER + (marke - raster.von) * MINUTE_PUNKTE - 8 },
                ]}
              >
                <Text style={eigen.stundenText}>{uhrText(marke)}</Text>
                <View style={eigen.stundenLinie} />
              </View>
            ))}
            {planZeilen.map((planzeile, index) => {
              if (planzeile.art === 'pause') {
                const lage = rasterLage(planzeile.von, planzeile.bis, raster);
                if (!lage) return null;
                return (
                  <View
                    key={`pause-${index}`}
                    style={[
                      eigen.rasterBlock,
                      eigen.pauseBand,
                      { top: RASTER_POLSTER + lage.oben, height: lage.hoehe },
                      planzeile.laeuft && eigen.blockJetzt,
                    ]}
                  >
                    <Ionicons
                      name={
                        planzeile.titel === 'Mittag'
                          ? 'restaurant-outline'
                          : 'cafe-outline'
                      }
                      size={12}
                      color={colors.inkFaint}
                    />
                    <Text style={eigen.pauseText} numberOfLines={1}>
                      {planzeile.titel} · {planzeile.von}–{planzeile.bis}
                    </Text>
                    {planzeile.laeuft ? <Text style={eigen.jetztChip}>jetzt</Text> : null}
                  </View>
                );
              }
              const lage = rasterLage(
                planzeile.eintrag.from,
                planzeile.eintrag.to,
                raster
              );
              if (!lage) return null;
              const naechstes = naechsteWocheFach(planzeile.eintrag, tagesplanAlle);
              const zweiwoechig =
                planzeile.eintrag.week === 'A' || planzeile.eintrag.week === 'B';
              return (
                <View
                  key={String(planzeile.eintrag.id)}
                  style={[
                    eigen.rasterBlock,
                    eigen.lektionBlock,
                    { top: RASTER_POLSTER + lage.oben, height: lage.hoehe },
                    planzeile.laeuft && eigen.blockJetzt,
                  ]}
                >
                  <View style={{ flex: 1 }}>
                    <Text style={eigen.blockFach} numberOfLines={1}>
                      {String(planzeile.eintrag.text ?? '')}
                    </Text>
                    {/* Unter ~40 Punkten (halbe Lektion) trüge die zweite
                        Zeile über den Blockrand hinaus. */}
                    {lage.hoehe >= 40 ? (
                      <Text style={eigen.blockSub} numberOfLines={1}>
                        {[
                          zeitraum(planzeile.eintrag.from, planzeile.eintrag.to),
                          zweiwoechig
                            ? naechstes
                              ? `alle 2 Wochen · nächste Woche: ${naechstes}`
                              : 'alle 2 Wochen'
                            : '',
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </Text>
                    ) : null}
                  </View>
                  {planzeile.laeuft ? <Text style={eigen.jetztChip}>jetzt</Text> : null}
                  <Pressable
                    onPress={() => onRemove('lessons', String(planzeile.eintrag.id))}
                    hitSlop={8}
                    accessibilityRole="button"
                    accessibilityLabel={`${String(planzeile.eintrag.text ?? '')} entfernen`}
                  >
                    <Ionicons name="close" size={14} color={colors.inkFaint} />
                  </Pressable>
                </View>
              );
            })}
            {jetztMin !== null && jetztMin >= raster.von && jetztMin <= raster.bis ? (
              <>
                <View
                  pointerEvents="none"
                  style={[
                    eigen.jetztLinie,
                    {
                      top:
                        RASTER_POLSTER + (jetztMin - raster.von) * MINUTE_PUNKTE - 1,
                    },
                  ]}
                />
                <View
                  pointerEvents="none"
                  style={[
                    eigen.jetztPunkt,
                    {
                      top:
                        RASTER_POLSTER + (jetztMin - raster.von) * MINUTE_PUNKTE - 4,
                    },
                  ]}
                />
              </>
            ) : null}
          </View>
        ) : (
          // Ohne eine einzige lesbare Zeit gibt es keine Achse - dann
          // die schlichte Liste, statt gar nichts zu zeigen.
          <View style={eigen.planSpalte}>
            {tagesplan.map((eintrag) =>
              zeile(
                eintrag,
                'lessons',
                String(eintrag.text ?? ''),
                zeitraum(eintrag.from, eintrag.to)
              )
            )}
          </View>
        )}
        {/* Zeilen ohne lesbaren Anfang fänden auf der Achse keinen Platz
            - unsichtbar wären sie aber auch nicht mehr löschbar. */}
        {ohneZeit.map((eintrag) =>
          zeile(
            eintrag,
            'lessons',
            String(eintrag.text ?? ''),
            zeitraum(eintrag.from, eintrag.to) || 'ohne Zeit'
          )
        )}
        {tagesplan.length > 0 && frei ? (
          <View style={eigen.freiBlock}>
            <Ionicons name="sunny-outline" size={14} color={colors.inkSoft} />
            <Text style={eigen.pauseText}>Nachmittag frei · ab {frei}</Text>
          </View>
        ) : null}
        {formKnopf('lessons', 'Lektion eintragen')}
        {formOffen === 'lessons' ? (
          <>
            <WochenForm
              platzhalter={`Fach am ${TAG_NAMEN[schultag]}, z.B. Mathematik …`}
              tag={schultag}
              dieseWoche={dieseWoche}
              onAdd={(neu) => onAdd('lessons', neu)}
              styles={styles}
              colors={colors}
            />
            {/* Der Dienstag sieht oft aus wie der Montag - statt sechs
                Lektionen abzutippen, übernimmt man sie. Doppeltes lässt
                zuUebernehmen weg. */}
            {andereTage.length > 0 ? (
              <View style={eigen.uebernehmenReihe}>
                <Text style={styles.checkSub}>Zeiten übernehmen von:</Text>
                {andereTage.map((tag) => (
                  <Pressable
                    key={tag}
                    onPress={() => {
                      const quelle = plan.find((block) => block.tag === tag)?.zeilen ?? [];
                      for (const alt of zuUebernehmen(quelle, tagesplanAlle)) {
                        onAdd('lessons', {
                          day: schultag,
                          text: String(alt.text ?? ''),
                          from: zeitNormal(alt.from) ?? '',
                          to: zeitNormal(alt.to) ?? '',
                          ...(alt.week === 'A' || alt.week === 'B'
                            ? { week: alt.week }
                            : {}),
                        });
                      }
                    }}
                    accessibilityRole="button"
                    accessibilityLabel={`Lektionen vom ${TAG_NAMEN[tag]} übernehmen`}
                    style={({ pressed }) => [styles.chip, pressed && { opacity: 0.6 }]}
                  >
                    <Text style={styles.chipText}>{tag}</Text>
                  </Pressable>
                ))}
              </View>
            ) : null}
          </>
        ) : null}
      </Card>

      <Text style={styles.groupLabel}>Jede Woche</Text>
      <Card style={styles.listCard}>
        {woche.length === 0 ? (
          <Text style={styles.checkSub}>
            Fussball, Jugi, Musikschule: Was jede Woche wiederkehrt, trägt niemand
            fünfzigmal in den Kalender ein – hier steht es einmal.
          </Text>
        ) : (
          woche.map((eintrag) =>
            zeile(
              eintrag,
              'activities',
              String(eintrag.text ?? ''),
              [
                naechstesMal(eintrag, jetzt),
                eintrag.to ? `bis ${zeitNormal(eintrag.to)}` : '',
                String(eintrag.ort ?? '').trim(),
              ]
                .filter(Boolean)
                .join(' · ')
            )
          )
        )}
        {formKnopf('activities', 'Termin eintragen')}
        {formOffen === 'activities' ? (
          <WochenForm
            platzhalter="Fussball, Jugi …"
            mitOrt
            tag={terminTag}
            onTag={setTerminTag}
            onAdd={(neu) => onAdd('activities', neu)}
            styles={styles}
            colors={colors}
          />
        ) : null}
      </Card>
    </View>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    // Die Zeilen der Familienseite (checkRow) haben ihren Abstand im
    // antippbaren Innenteil - hier ist die Zeile selbst der Inhalt.
    // Der Punkt sitzt neben der Abkürzung, nicht dahinter: «Mo ·» liest
    // sich als abgeschnittener Text, ein Punkt als Markierung.
    tagChip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
    punkt: { width: 5, height: 5, borderRadius: 3 },
    zeile: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 6 },
    kartenTitel: { color: colors.ink, fontSize: 15, fontWeight: '700' },
    heute: { color: colors.inkSoft, fontSize: 14, lineHeight: 20 },
    tagTitel: {
      color: colors.inkSoft,
      fontSize: 12,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 6,
    },
    formKnopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      alignSelf: 'flex-start',
      marginTop: 6,
      paddingVertical: 6,
      paddingHorizontal: 10,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
    },
    formKnopfText: { color: colors.accent, fontSize: 13, fontWeight: '600' },
    planSpalte: { gap: 5, marginTop: 4 },
    // Das Blatt trägt die Zeitachse; alles darauf ist absolut gesetzt,
    // die Höhe kommt aus dem Raster.
    rasterBlatt: { marginTop: 6 },
    stundenZeile: {
      position: 'absolute',
      left: 0,
      right: 0,
      height: 16,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
    },
    stundenText: {
      width: 38,
      color: colors.inkFaint,
      fontSize: 10.5,
      fontVariant: ['tabular-nums'],
      textAlign: 'right',
    },
    stundenLinie: {
      flex: 1,
      height: StyleSheet.hairlineWidth,
      backgroundColor: colors.surfaceBorder,
    },
    // Alles rechts der Zeitspalte: Lektionen wie Pausen.
    rasterBlock: { position: 'absolute', left: ZEIT_SPALTE, right: 0 },
    lektionBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      borderRadius: radius.control,
      backgroundColor: `${colors.accent}14`,
      borderWidth: 1,
      borderColor: 'transparent',
      borderLeftWidth: 3,
      borderLeftColor: colors.accent,
      paddingHorizontal: 8,
      overflow: 'hidden',
    },
    pauseBand: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: 'transparent',
      overflow: 'hidden',
    },
    blockJetzt: {
      borderColor: colors.accent,
      backgroundColor: `${colors.accent}26`,
    },
    blockFach: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    blockSub: {
      color: colors.inkSoft,
      fontSize: 11,
      fontVariant: ['tabular-nums'],
      marginTop: 1,
    },
    // Die Zeitlinie: wo der Tag gerade steht - wie der rote Strich auf
    // einem Papierplan mit Lineal.
    jetztLinie: {
      position: 'absolute',
      left: ZEIT_SPALTE - 6,
      right: 0,
      height: 2,
      borderRadius: 1,
      backgroundColor: colors.accent,
    },
    jetztPunkt: {
      position: 'absolute',
      left: ZEIT_SPALTE - 12,
      width: 8,
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.accent,
    },
    freiBlock: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 8,
      paddingHorizontal: 10,
      paddingVertical: 9,
      borderRadius: radius.control,
      borderWidth: 1,
      borderStyle: 'dashed',
      borderColor: colors.surfaceBorder,
    },
    jetztChip: {
      color: '#FFFFFF',
      backgroundColor: colors.accent,
      fontSize: 10,
      fontWeight: '700',
      paddingHorizontal: 6,
      paddingVertical: 1,
      borderRadius: radius.pill,
      overflow: 'hidden',
    },
    pauseText: { color: colors.inkFaint, fontSize: 12.5 },
    uebernehmenReihe: {
      flexDirection: 'row',
      alignItems: 'center',
      flexWrap: 'wrap',
      gap: 8,
      marginTop: 8,
    },
  });
