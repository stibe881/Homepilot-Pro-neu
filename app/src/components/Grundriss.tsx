import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Image, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import {
  GrundrissPunkt,
  GrundrissStand,
  anzeigeMasse,
  bildAdresse,
  getroffenerPunkt,
  punktArt,
  punktEntfernen,
  punktSetzen,
  schaltbar,
  sichtbarePunkte,
  unplatzierte,
} from '../lib/grundriss';
import { Card } from './Card';
import { KIND_ICONS, shortState } from './RoomTile';
import { Colors, radius, type, useColors } from '../theme';

/**
 * Der Grundriss: ein Foto des Wohnungsplans, darauf die Geräte als
 * antippbare Punkte.
 *
 * Fürs Wandpanel gedacht (einschaltbar in den Einstellungen, beim
 * App-Symbol): Wer im Flur aufs iPad schaut, denkt nicht in einer
 * Kachelliste, sondern in «das Licht da hinten links».
 *
 * Bewusst ohne Ziehen: Punkte werden durch Antippen gesetzt und
 * versetzt (Gerät wählen, Stelle tippen). Die Ziehen-Geste hat uns auf
 * iOS zweimal hintereinander getäuscht - der Browser zeigte grün, das
 * Telefon tat nichts (siehe DraggableList). Zwei Tipps kann jede
 * Plattform, und daneben tippen kann man nicht.
 */

interface Props {
  settings: HubSettings;
  entities: Entity[];
  /** Darf Bild und Punkte ändern (edit_devices). */
  darfAnpassen: boolean;
  onCommand: (entityId: string, command: string) => void;
  /** Verfügbare Breite - vom selben Raster wie die Kacheln darunter. */
  width: number;
}

/** Höchsthöhe des Plans - darüber wird er zum Tunnel, unter dem die
 *  Raumkacheln verschwinden. */
const MAX_HOEHE = 520;

/** Trefferfläche eines Punkts beim Tippen, in Bildpunkten. */
const TREFFER_PX = 26;

export function Grundriss({ settings, entities, darfAnpassen, onCommand, width }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const [stand, setStand] = useState<GrundrissStand | null>(null);
  // Die Pixelmasse des Bildes - erst damit sitzen die Punkte richtig.
  const [bildMasse, setBildMasse] = useState<{ w: number; h: number } | null>(null);
  const [anpassen, setAnpassen] = useState(false);
  // Der Anpassen-Entwurf: gespeichert wird erst bei «Fertig».
  const [entwurf, setEntwurf] = useState<GrundrissPunkt[]>([]);
  // Was als Nächstes auf den Plan kommt - ein Gerät aus der Liste oder
  // ein schon gesetzter Punkt, der umziehen soll.
  const [gewaehlt, setGewaehlt] = useState<string | null>(null);
  const [suche, setSuche] = useState('');
  const [note, setNote] = useState<string | null>(null);
  // Die Sprechblase nach einem Tipp: Name und Zustand des Geräts.
  const [info, setInfo] = useState<{ id: string; text: string } | null>(null);
  const infoTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const laden = useCallback(() => {
    hub
      .get<GrundrissStand | null>('/api/grundriss', { fallback: null, still: true })
      .then((data) => {
        if (data) setStand({ bild: data.bild ?? null, punkte: data.punkte ?? [] });
      });
  }, [hub]);

  useEffect(laden, [laden]);
  useEffect(() => () => {
    if (infoTimer.current) clearTimeout(infoTimer.current);
  }, []);

  // Die Bildmasse holen, sobald es ein Bild gibt. Ohne sie kein Plan -
  // Punkte auf einem Bild mit geratenem Seitenverhältnis sässen alle
  // ein Stück daneben.
  const adresse = bildAdresse(stand?.bild, settings);
  useEffect(() => {
    if (!adresse) {
      setBildMasse(null);
      return;
    }
    let weg = false;
    Image.getSize(
      adresse,
      (w, h) => {
        if (!weg) setBildMasse({ w, h });
      },
      () => {
        if (!weg) setBildMasse(null);
      }
    );
    return () => {
      weg = true;
    };
  }, [adresse]);

  const masse = bildMasse
    ? anzeigeMasse(width, MAX_HOEHE, bildMasse.w, bildMasse.h)
    : { width: 0, height: 0 };
  const punkte = anpassen ? entwurf : (stand?.punkte ?? []);
  const paare = sichtbarePunkte(punkte, entities);

  const zeigeInfo = (entity: Entity) => {
    setInfo({ id: entity.id, text: `${entity.name} · ${shortState(entity)}` });
    if (infoTimer.current) clearTimeout(infoTimer.current);
    infoTimer.current = setTimeout(() => setInfo(null), 2500);
  };

  /** Ein Tipp auf einen Punkt in der Ansicht: Schaltbares schalten,
   *  alles andere sagt Name und Zustand. */
  const punktTipp = (entity: Entity) => {
    if (schaltbar(entity.commands)) {
      onCommand(entity.id, 'toggle');
    }
    zeigeInfo(entity);
  };

  /** Ein Tipp auf den Plan im Anpassen-Modus: setzt das gewählte Gerät
   *  oder wählt den getroffenen Punkt zum Umziehen. */
  const planTipp = (event: {
    nativeEvent: {
      locationX?: number;
      locationY?: number;
      offsetX?: number;
      offsetY?: number;
    };
  }) => {
    if (!anpassen || masse.width <= 0) return;
    // Nativ heisst die Stelle locationX, im Browser offsetX - dort ist
    // das rohe DOM-Ereignis das nativeEvent. Fehlt beides, lieber
    // nichts tun als einen Punkt an eine geratene Stelle setzen.
    const px = event.nativeEvent.locationX ?? event.nativeEvent.offsetX;
    const py = event.nativeEvent.locationY ?? event.nativeEvent.offsetY;
    if (px == null || py == null) return;
    const x = px / masse.width;
    const y = py / masse.height;
    if (gewaehlt) {
      setEntwurf((liste) => punktSetzen(liste, gewaehlt, x, y));
      setGewaehlt(null);
      return;
    }
    const getroffen = getroffenerPunkt(
      entwurf,
      x,
      y,
      TREFFER_PX / masse.width,
      masse.height / masse.width
    );
    if (getroffen) setGewaehlt(getroffen.entity_id);
  };

  const anpassenStarten = () => {
    setEntwurf(stand?.punkte ?? []);
    setGewaehlt(null);
    setSuche('');
    setNote(null);
    setAnpassen(true);
  };

  const anpassenFertig = async () => {
    try {
      const antwort = await hub.put<{ punkte: GrundrissPunkt[] }>(
        '/api/grundriss/punkte',
        { punkte: entwurf }
      );
      setStand((alt) => ({ bild: alt?.bild ?? null, punkte: antwort.punkte }));
      setAnpassen(false);
    } catch (fehler) {
      // Der Entwurf bleibt offen - nichts ist verloren, nur nicht
      // gespeichert, und genau das steht da.
      setNote(fehler instanceof Error ? fehler.message : 'Speichern fehlgeschlagen');
    }
  };

  /** Ein Bild holen, verkleinern und zum Hub bringen. Verkleinert wie
   *  die Rezeptfotos (Punkt 138), nur grosszügiger: Ein Plan trägt
   *  feine Linien, 1600 px behalten sie. */
  const bildWaehlen = async (quelle: 'galerie' | 'kamera') => {
    const erlaubt =
      quelle === 'kamera'
        ? await ImagePicker.requestCameraPermissionsAsync()
        : await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!erlaubt.granted) return;
    const optionen = {
      mediaTypes: ImagePicker.MediaTypeOptions.Images,
      quality: 0.7,
      base64: true,
    } as const;
    const ergebnis =
      quelle === 'kamera'
        ? await ImagePicker.launchCameraAsync(optionen).catch(() => null)
        : await ImagePicker.launchImageLibraryAsync(optionen);
    const asset = ergebnis?.assets?.[0];
    if (!asset) return;
    let uri: string | null = asset.base64
      ? `data:image/jpeg;base64,${asset.base64}`
      : null;
    try {
      if ((asset.width ?? 0) > 1600) {
        // Zur Laufzeit laden statt oben importieren: Auf einem älteren
        // Build ohne das native Modul stürzt die App sonst ab.
        // eslint-disable-next-line @typescript-eslint/no-require-imports
        const { manipulateAsync, SaveFormat } = require('expo-image-manipulator');
        const kleiner = await manipulateAsync(asset.uri, [{ resize: { width: 1600 } }], {
          compress: 0.7,
          format: SaveFormat.JPEG,
          base64: true,
        });
        if (kleiner.base64) uri = `data:image/jpeg;base64,${kleiner.base64}`;
      }
    } catch {
      // Verkleinern ist eine Zugabe - das Original tut es auch.
    }
    if (!uri) return;
    try {
      const antwort = await hub.post<{ bild: string | null }>('/api/grundriss/bild', {
        image: uri,
      });
      setStand((alt) => ({ bild: antwort.bild, punkte: alt?.punkte ?? [] }));
      setNote(null);
    } catch (fehler) {
      setNote(fehler instanceof Error ? fehler.message : 'Bild nicht gespeichert');
    }
  };

  // Ohne Bild: sagen, was das hier wäre - und wer darf, lädt eines.
  if (!stand || !adresse) {
    // Solange der Stand noch nicht da ist, gar nichts zeigen: Ein
    // aufblitzender «kein Bild»-Kasten bei jedem Öffnen wäre gelogen.
    if (!stand) return null;
    return (
      <Card style={styles.leerKarte}>
        <Text style={styles.leerTitel}>Grundriss</Text>
        <Text style={styles.leerText}>
          Ein Foto des Wohnungsplans, darauf die Geräte zum Antippen.
          {darfAnpassen
            ? ' Zuerst braucht es das Bild - ein Foto des Plans aus den Bauunterlagen genügt.'
            : ' Das Bild kann hinterlegen, wer Geräte anpassen darf.'}
        </Text>
        {darfAnpassen ? (
          <View style={styles.zeile}>
            <Knopf
              icon="images-outline"
              text="Bild wählen"
              onPress={() => bildWaehlen('galerie')}
              styles={styles}
              colors={colors}
            />
            <Knopf
              icon="camera-outline"
              text="Abfotografieren"
              onPress={() => bildWaehlen('kamera')}
              styles={styles}
              colors={colors}
            />
          </View>
        ) : null}
        {note ? <Text style={styles.fehler}>{note}</Text> : null}
      </Card>
    );
  }

  const geraeteListe = anpassen
    ? unplatzierte(entities, entwurf).filter(
        (entity) =>
          !suche.trim() ||
          `${entity.name} ${entity.room ?? ''}`
            .toLowerCase()
            .includes(suche.trim().toLowerCase())
      )
    : [];

  return (
    <View style={styles.rahmen}>
      <View style={[styles.plan, { width: masse.width, height: masse.height }]}>
        <Pressable onPress={planTipp} disabled={!anpassen} accessibilityRole="image">
          <Image
            source={{ uri: adresse }}
            style={{ width: masse.width, height: masse.height, borderRadius: radius.card }}
            resizeMode="contain"
          />
        </Pressable>
        {paare.map(({ punkt, entity }) => {
          const art = punktArt(entity);
          const umzug = anpassen && gewaehlt === entity.id;
          return (
            <Pressable
              key={entity.id}
              // Im Anpassen-Modus fängt der Plan alle Tipps: Wer ein
              // Gerät gewählt hat, darf es auch haarscharf neben einen
              // bestehenden Punkt setzen.
              disabled={anpassen}
              onPress={() => punktTipp(entity)}
              accessibilityRole="button"
              accessibilityLabel={`${entity.name}, ${shortState(entity)}`}
              hitSlop={8}
              style={[
                styles.punkt,
                {
                  left: punkt.x * masse.width - PUNKT / 2,
                  top: punkt.y * masse.height - PUNKT / 2,
                },
                art === 'an' && { backgroundColor: colors.on, borderColor: colors.on },
                art === 'weg' && { opacity: 0.35 },
                umzug && { borderColor: colors.accent, borderWidth: 3 },
              ]}
              pointerEvents={anpassen ? 'none' : 'auto'}
            >
              <Ionicons
                name={KIND_ICONS[entity.kind] ?? 'ellipse-outline'}
                size={13}
                color={art === 'an' ? colors.panel : colors.ink}
              />
            </Pressable>
          );
        })}
        {info ? (
          <View style={styles.infoBlase} pointerEvents="none">
            <Text style={styles.infoText}>{info.text}</Text>
          </View>
        ) : null}
      </View>

      {darfAnpassen && !anpassen ? (
        <View style={styles.zeile}>
          <Knopf
            icon="create-outline"
            text="Anpassen"
            onPress={anpassenStarten}
            styles={styles}
            colors={colors}
          />
        </View>
      ) : null}

      {anpassen ? (
        <View style={styles.werkzeug}>
          <Text style={styles.hinweis}>
            {gewaehlt
              ? `Stelle antippen für «${
                  entities.find((entity) => entity.id === gewaehlt)?.name ?? gewaehlt
                }».`
              : 'Gerät unten wählen und die Stelle auf dem Plan antippen. Ein Tipp auf einen Punkt wählt ihn zum Umziehen.'}
          </Text>
          {gewaehlt && entwurf.some((punkt) => punkt.entity_id === gewaehlt) ? (
            <View style={styles.zeile}>
              <Knopf
                icon="trash-outline"
                text="Vom Plan nehmen"
                onPress={() => {
                  setEntwurf((liste) => punktEntfernen(liste, gewaehlt));
                  setGewaehlt(null);
                }}
                styles={styles}
                colors={colors}
              />
            </View>
          ) : null}
          <TextInput
            style={styles.suche}
            value={suche}
            onChangeText={setSuche}
            placeholder="Gerät suchen …"
            placeholderTextColor={colors.inkFaint}
            autoCorrect={false}
          />
          <View style={styles.chips}>
            {geraeteListe.slice(0, 24).map((entity) => (
              <Pressable
                key={entity.id}
                onPress={() => setGewaehlt(entity.id)}
                accessibilityRole="button"
                style={[styles.chip, gewaehlt === entity.id && styles.chipAktiv]}
              >
                <Text
                  style={[
                    styles.chipText,
                    gewaehlt === entity.id && { color: colors.panel },
                  ]}
                >
                  {entity.room ? `${entity.room} · ` : ''}
                  {entity.name}
                </Text>
              </Pressable>
            ))}
            {geraeteListe.length > 24 ? (
              <Text style={styles.hinweis}>… über die Suche eingrenzen</Text>
            ) : null}
          </View>
          <View style={styles.zeile}>
            <Knopf
              icon="images-outline"
              text="Anderes Bild"
              onPress={() => bildWaehlen('galerie')}
              styles={styles}
              colors={colors}
            />
            <Knopf
              icon="checkmark-outline"
              text="Fertig"
              onPress={anpassenFertig}
              styles={styles}
              colors={colors}
              betont
            />
          </View>
          {note ? <Text style={styles.fehler}>{note}</Text> : null}
        </View>
      ) : null}
    </View>
  );
}

/** Durchmesser eines Punkts. Gross genug für den Finger am Panel,
 *  klein genug, dass ein Zimmer mehrere trägt. */
const PUNKT = 28;

function Knopf({
  icon,
  text,
  onPress,
  styles,
  colors,
  betont,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  onPress: () => void;
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  betont?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [
        styles.knopf,
        betont && { backgroundColor: colors.ink, borderColor: colors.ink },
        pressed && { opacity: 0.7 },
      ]}
    >
      <Ionicons name={icon} size={15} color={betont ? colors.panel : colors.ink} />
      <Text style={[styles.knopfText, betont && { color: colors.panel }]}>{text}</Text>
    </Pressable>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    rahmen: { gap: 10, marginBottom: 14 },
    plan: {
      alignSelf: 'center',
      borderRadius: radius.card,
      overflow: 'hidden',
      backgroundColor: colors.surfaceSoft,
    },
    punkt: {
      position: 'absolute',
      width: PUNKT,
      height: PUNKT,
      borderRadius: PUNKT / 2,
      alignItems: 'center',
      justifyContent: 'center',
      // Deckend statt durchscheinend: Der Plan darunter ist meist hell,
      // und ein Glas-Punkt verschwand darauf fast - `panel` ist in jeder
      // Palette die deckende Gegenfarbe zur Schrift.
      backgroundColor: colors.panel,
      borderWidth: 2,
      borderColor: colors.inkSoft,
    },
    infoBlase: {
      position: 'absolute',
      top: 10,
      alignSelf: 'center',
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.ink,
    },
    infoText: { color: colors.panel, fontSize: 13, fontWeight: '600' },
    leerKarte: { gap: 10, padding: 18, marginBottom: 14 },
    leerTitel: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    leerText: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },
    werkzeug: { gap: 10 },
    hinweis: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    suche: {
      backgroundColor: colors.surfaceStrong,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 9,
      fontSize: 14,
    },
    chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    chip: {
      paddingHorizontal: 11,
      paddingVertical: 7,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    chipAktiv: { backgroundColor: colors.ink, borderColor: colors.ink },
    chipText: { color: colors.inkSoft, fontSize: 12, fontWeight: '600' },
    zeile: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
    knopf: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingHorizontal: 12,
      paddingVertical: 8,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    knopfText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    fehler: { color: colors.danger, fontSize: 13 },
  });
