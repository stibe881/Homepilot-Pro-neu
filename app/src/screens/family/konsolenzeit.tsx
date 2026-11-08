/**
 * Konsolenzeit auf der Seite eines Kindes (Punkt 748 der Werkbank).
 *
 * Drei Teile, alle hier, weil sie zusammen angefasst werden:
 *
 * - `useKonsolenzeit`: holt die Lage vom Hub und hält sie frisch (alle
 *   halbe Minute, bei jeder Familienänderung, und zählt zwischendurch
 *   selbst weiter, solange die Uhr läuft).
 * - `KonsolenKarte`: die Karte auf der Kinderseite. Für Erwachsene mit
 *   den Knöpfen «Geben», «Heute frei», «Sperren»; für das Kind selbst
 *   gross, mit «Ich spiele jetzt» (`modus="kind"`).
 * - `KonsolenEditor`: der Plan - Konsolen, Zeiten je Tag, Monatsgrenze,
 *   Vorwarnung.
 *
 * Was gerechnet wird, steht im Hub (`core/konsolenzeit.py`); was davon wie
 * gelesen wird, rein und geprüft in `lib/konsolenzeit.ts`.
 *
 * **Warum das Kind sich anmeldet:** Weder die PlayStation noch Nintendos
 * Kindersicherung sagen, wer am Controller sitzt. Ohne «Ich spiele jetzt»
 * wüsste der Hub nicht, wessen Konto die Minuten gehören.
 */
import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Switch, Text, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { HubClient } from '../../api/client';
import { Card } from '../../components/Card';
import { useTakt } from '../../hooks/useTakt';
import {
  KonsoleInfo,
  KonsolenLage,
  KonsolenPlan,
  KonsolenUebersicht,
  MONATS_STUNDEN,
  TAGES_MINUTEN,
  TAGE_KURZ,
  WARN_WAHL,
  aufteilung,
  dauerText,
  fensterText,
  grundSatz,
  konsoleUmschalten,
  laeuft,
  leererPlan,
  minutenText,
  monatAnteil,
  monatSatz,
  monatSetzen,
  monatsHinweis,
  morgenSatz,
  restNach,
  ringAnteil,
  ringZahl,
  tagAendern,
  tagZeile,
  tempoSatz,
  verstellen,
  warnungUmschalten,
  werktageUebernehmen,
  wochenBalken,
  wochentagIndex,
  zeitText,
} from '../../lib/konsolenzeit';
import { Colors, Typmass, radius, useTyp } from '../../theme';
import { Styles } from './bausteine';

const gleich = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

function meldung(fehler: unknown): string {
  return fehler instanceof Error ? fehler.message : 'Das hat nicht geklappt.';
}

// ── Die Lage vom Hub ───────────────────────────────────────────────────

export function useKonsolenzeit(client: HubClient, name: string, changedAt?: number) {
  const [lage, setLage] = useState<KonsolenLage | null>(null);
  const [konsolen, setKonsolen] = useState<KonsoleInfo[]>([]);
  const [eltern, setEltern] = useState<NonNullable<KonsolenUebersicht['eltern']>>([]);
  const [unbekannt, setUnbekannt] = useState<'nie' | 'fragen' | 'sperren'>('nie');
  const [nintendoSperren, setNintendoSperren] = useState(false);
  const [stand, setStand] = useState(() => Date.now());
  const [jetzt, setJetzt] = useState(() => Date.now());
  const [geladen, setGeladen] = useState(false);
  const [fehler, setFehler] = useState<string | null>(null);

  const laden = useCallback(async () => {
    try {
      const antwort = await client.get<KonsolenUebersicht>('/api/konsolenzeit', { still: true });
      setKonsolen(antwort.konsolen ?? []);
      setEltern(antwort.eltern ?? []);
      setUnbekannt(antwort.einstellungen?.unbekannt ?? 'nie');
      setNintendoSperren(!!antwort.einstellungen?.nintendo_sperren);
      setLage((antwort.kinder ?? []).find((kind) => gleich(kind.kind, name)) ?? null);
      setStand(Date.now());
      setJetzt(Date.now());
      setFehler(null);
    } catch (err) {
      setFehler(meldung(err));
    } finally {
      setGeladen(true);
    }
  }, [client, name]);

  useEffect(() => {
    laden();
  }, [laden, changedAt]);
  useTakt(laden, 30_000);
  // Zwischen zwei Abrufen zählt die Anzeige selbst weiter - sonst stünde
  // «20 Minuten» eine halbe Minute still, während die Uhr läuft.
  useTakt(() => setJetzt(Date.now()), laeuft(lage) ? 1000 : null);

  const rest = lage ? restNach(lage, (jetzt - stand) / 1000) : null;

  /** Ein Aufruf an den Hub; die Antwort ist die neue Lage dieses Kindes. */
  const tun = useCallback(
    async (pfad: string, koerper?: unknown): Promise<boolean> => {
      try {
        const neu = await client.post<KonsolenLage>(`/api/konsolenzeit/${encodeURIComponent(name)}/${pfad}`, koerper ?? {});
        setLage(neu);
        setStand(Date.now());
        setJetzt(Date.now());
        setFehler(null);
        return true;
      } catch (err) {
        setFehler(meldung(err));
        return false;
      }
    },
    [client, name]
  );

  /** Die Erwachsenen spielen an dieser Konsole: nicht zählen, nicht fragen. */
  const elternSpielen = useCallback(
    async (konsole: string) => {
      try {
        await client.post('/api/konsolenzeit/eltern', { konsole });
        await laden();
      } catch (err) {
        setFehler(meldung(err));
      }
    },
    [client, laden]
  );

  return { lage, konsolen, eltern, unbekannt, nintendoSperren, rest, geladen, fehler, setFehler, laden, tun, elternSpielen };
}

// ── Bausteine ──────────────────────────────────────────────────────────

/** Der Ring: voll heisst «noch die ganze Zeit», leer «aus». */
function Ring({
  anteil,
  groesse,
  strich,
  colors,
  warnung,
  children,
}: {
  anteil: number;
  groesse: number;
  strich: number;
  colors: Colors;
  warnung?: boolean;
  children?: React.ReactNode;
}) {
  const r = (groesse - strich) / 2;
  const umfang = 2 * Math.PI * r;
  return (
    <View style={{ width: groesse, height: groesse, alignItems: 'center', justifyContent: 'center' }}>
      <Svg width={groesse} height={groesse} style={StyleSheet.absoluteFill}>
        <Circle cx={groesse / 2} cy={groesse / 2} r={r} stroke={colors.off} strokeWidth={strich} fill="none" />
        <Circle
          cx={groesse / 2}
          cy={groesse / 2}
          r={r}
          stroke={warnung ? colors.warn : colors.accent}
          strokeWidth={strich}
          strokeLinecap="round"
          fill="none"
          strokeDasharray={`${umfang * anteil} ${umfang}`}
          transform={`rotate(-90 ${groesse / 2} ${groesse / 2})`}
        />
      </Svg>
      {children}
    </View>
  );
}

function Knopf({
  text,
  icon,
  onPress,
  eigen,
  colors,
  aktiv,
  gross,
}: {
  text: string;
  icon?: React.ComponentProps<typeof Ionicons>['name'];
  onPress: () => void;
  eigen: ReturnType<typeof makeStyles>;
  colors: Colors;
  aktiv?: boolean;
  gross?: boolean;
}) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={text}
      style={({ pressed }) => [
        eigen.knopf,
        gross && eigen.knopfGross,
        aktiv && { backgroundColor: colors.accent },
        pressed && { opacity: 0.7 },
      ]}
    >
      {icon ? (
        <Ionicons name={icon} size={gross ? 22 : 16} color={aktiv ? colors.onAccent : colors.ink} />
      ) : null}
      <Text style={[eigen.knopfText, gross && eigen.knopfTextGross, aktiv && { color: colors.onAccent }]}>
        {text}
      </Text>
    </Pressable>
  );
}

// ── Die Karte ──────────────────────────────────────────────────────────

export function KonsolenKarte({
  name,
  client,
  changedAt,
  modus,
  onEinstellen,
  styles,
  colors,
}: {
  name: string;
  client: HubClient;
  changedAt?: number;
  /** «eltern»: mit allen Knöpfen. «kind»: gross, nur «Ich spiele jetzt». */
  modus: 'eltern' | 'kind';
  onEinstellen?: () => void;
  styles: Styles;
  colors: Colors;
}) {
  const typ = useTyp();
  const eigen = useMemo(() => makeStyles(colors, typ), [colors, typ]);
  const { lage, konsolen, eltern, rest, geladen, fehler, tun, elternSpielen } = useKonsolenzeit(
    client,
    name,
    changedAt
  );
  const namen = useMemo(
    () => Object.fromEntries(konsolen.map((k) => [k.id, k.name])) as Record<string, string>,
    [konsolen]
  );

  if (!geladen) return null;
  if (!lage || !lage.plan.aktiv) {
    // Ein Kind sieht nichts, was nicht eingerichtet ist - kein «Einrichten»
    // an einer Stelle, wo es nichts einrichten darf.
    if (modus === 'kind') return null;
    return (
      <Card style={styles.listCard}>
        <View style={eigen.kopf}>
          <Ionicons name="game-controller-outline" size={20} color={colors.accent} />
          <Text style={[eigen.titel, { flex: 1 }]}>Konsolenzeit</Text>
        </View>
        <Text style={eigen.leise}>
          {lage
            ? 'Der Plan ist ausgeschaltet - es gibt keine Grenze.'
            : `Feste Zeiten für ${name}: pro Tag und pro Monat, für PlayStation und Switch zusammen.`}
        </Text>
        {fehler ? <Text style={styles.error}>{fehler}</Text> : null}
        {onEinstellen ? (
          <Knopf text={lage ? 'Plan ansehen' : 'Einrichten'} icon="settings-outline" onPress={onEinstellen} eigen={eigen} colors={colors} />
        ) : null}
      </Card>
    );
  }

  const heuteTag = new Date();
  const ring = ringZahl({ rest_s: rest });
  const wenig = rest !== null && rest > 0 && rest <= 5 * 60;
  const erlaubt = (lage.heute.regel.an ? lage.heute.regel.minuten : 0) + lage.heute.bonus;
  const grund = grundSatz(lage);
  const tempo = tempoSatz(lage.monat.tempo);
  const monatName = heuteTag.toLocaleDateString('de-CH', { month: 'long' });
  const spielt = lage.sitzung;
  const kind = modus === 'kind';
  const planKonsolen = lage.plan.konsolen
    .map((id) => konsolen.find((k) => k.id === id))
    .filter((k): k is KonsoleInfo => !!k);

  const ringKnoten = (
    <Ring anteil={ringAnteil({ ...lage, rest_s: rest })} groesse={kind ? 200 : 118} strich={kind ? 18 : 12} colors={colors} warnung={wenig}>
      <Text style={[eigen.ringZahl, kind && eigen.ringZahlGross]}>{ring.zahl}</Text>
      <Text style={[eigen.ringEinheit, kind && eigen.ringEinheitGross]}>{ring.einheit}</Text>
    </Ring>
  );

  const monat = lage.monat.limit_min ? (
    <View style={{ marginTop: 6 }}>
      <View style={eigen.zeileZwischen}>
        <Text style={eigen.titelKlein}>{monatName}</Text>
        <Text style={eigen.wert}>
          {dauerText(lage.monat.gespielt_s)}{' '}
          <Text style={eigen.leise}>von {minutenText(lage.monat.limit_min)}</Text>
        </Text>
      </View>
      <View style={eigen.balken}>
        <View style={[eigen.balkenFuell, { width: `${monatAnteil(lage) * 100}%` }]} />
        {lage.monat.tempo ? (
          <View style={[eigen.strich, { left: `${lage.monat.tempo.strich * 100}%` }]} />
        ) : null}
      </View>
      <Text style={eigen.leise}>{monatSatz(lage)}</Text>
      {tempo ? <Text style={[eigen.leise, { color: colors.warnInk, fontWeight: '700' }]}>{tempo}</Text> : null}
    </View>
  ) : null;

  // ── Das Kind selbst ────────────────────────────────────────────────
  if (kind) {
    const balken = wochenBalken(lage.plan, wochentagIndex(heuteTag), lage.heute.gesamt_s, lage.tage, heuteTag);
    const hoechste = Math.max(60, ...balken.map((b) => Math.max(b.erlaubt, b.gespielt)));
    const morgen = morgenSatz(lage.plan, wochentagIndex(heuteTag));
    return (
      <>
        <Card style={{ ...styles.listCard, alignItems: 'center', paddingVertical: 20, gap: 10 }}>
          {ringKnoten}
          {spielt ? (
            <View style={eigen.pille}>
              <View style={[eigen.punkt, { backgroundColor: colors.on }]} />
              <Text style={eigen.pilleText}>Die Zeit läuft</Text>
            </View>
          ) : null}
          <Text style={[eigen.leise, { textAlign: 'center' }]}>
            {rest !== null && rest <= 0
              ? grund
              : `Heute bis ${zeitText(lage.heute.regel.bis)} erlaubt` +
                (lage.heute.gesamt_s >= 30
                  ? ` · gespielt: ${aufteilung(lage.heute.konsolen, namen) || dauerText(lage.heute.gesamt_s)}`
                  : '')}
          </Text>
          {fehler ? <Text style={styles.error}>{fehler}</Text> : null}
          {spielt ? (
            <Knopf text="Fertig – Zeit anhalten" icon="pause" onPress={() => tun('stopp')} eigen={eigen} colors={colors} gross />
          ) : rest === null || rest > 0 ? (
            planKonsolen.map((konsole) => (
              <Knopf
                key={konsole.id}
                text={`Ich spiele jetzt · ${konsole.name}`}
                icon="game-controller-outline"
                onPress={() => tun('spielen', { konsole: konsole.id })}
                eigen={eigen}
                colors={colors}
                aktiv
                gross
              />
            ))
          ) : null}
          <Text style={[eigen.klein, { textAlign: 'center' }]}>
            Wenn die Zeit um ist, geht die Konsole von selbst schlafen.
          </Text>
        </Card>
        <Card style={styles.listCard}>
          <Text style={eigen.titel}>Diese Woche</Text>
          <View style={eigen.woche}>
            {balken.map((b) => (
              <View key={b.tag} style={eigen.wocheSpalte}>
                <View
                  style={[
                    eigen.wocheKasten,
                    { height: b.frei ? 6 : Math.max(6, (b.erlaubt / hoechste) * 90) },
                    b.frei && { borderStyle: 'dashed' },
                    b.heute && { borderColor: colors.accent },
                  ]}
                >
                  {!b.frei && b.gespielt > 0 ? (
                    <View
                      style={{
                        position: 'absolute',
                        left: 0,
                        right: 0,
                        bottom: 0,
                        height: `${Math.min(100, (b.gespielt / Math.max(1, b.erlaubt)) * 100)}%`,
                        backgroundColor: colors.accent,
                      }}
                    />
                  ) : null}
                </View>
                <Text style={[eigen.wocheTag, b.heute && { color: colors.accent }]}>{b.tag}</Text>
                <Text style={eigen.klein}>{b.frei ? 'frei' : b.gespielt > 0 ? String(b.gespielt) : ' '}</Text>
              </View>
            ))}
          </View>
          <Text style={eigen.klein}>Die Rahmen zeigen, wie viel jeden Tag erlaubt ist. Blau ist gespielt.</Text>
          {monat}
          {morgen ? (
            <View style={[eigen.kopf, { marginTop: 8 }]}>
              <Ionicons name="moon-outline" size={18} color={colors.inkSoft} />
              <Text style={[eigen.leise, { flex: 1, color: colors.ink }]}>{morgen}</Text>
            </View>
          ) : null}
        </Card>
      </>
    );
  }

  // ── Die Eltern ─────────────────────────────────────────────────────
  return (
    <Card style={styles.listCard}>
      <View style={eigen.zeileZwischen}>
        <View style={eigen.kopf}>
          <Ionicons name="game-controller-outline" size={20} color={colors.accent} />
          <Text style={eigen.titel}>Konsolenzeit</Text>
        </View>
        {onEinstellen ? (
          <Pressable onPress={onEinstellen} accessibilityRole="button" accessibilityLabel="Konsolenzeit einstellen" style={eigen.kopf}>
            <Text style={eigen.link}>Einstellen</Text>
            <Ionicons name="chevron-forward" size={16} color={colors.accent} />
          </Pressable>
        ) : null}
      </View>

      <View style={[eigen.kopf, { gap: 16, marginTop: 8 }]}>
        {ringKnoten}
        <View style={{ flex: 1, gap: 6 }}>
          <Text style={eigen.wert}>
            Heute {Math.round(lage.heute.gesamt_s / 60)} von {lage.heute.frei ? '∞' : erlaubt} min
          </Text>
          {planKonsolen.map((konsole) => {
            const aktiv = spielt?.konsole === konsole.id;
            const heute = lage.heute.konsolen[konsole.id] ?? 0;
            return (
              <View key={konsole.id} style={{ flexDirection: 'row', gap: 8, alignItems: 'flex-start' }}>
                <View
                  style={[
                    eigen.punkt,
                    { marginTop: 6, backgroundColor: aktiv || konsole.an ? colors.on : colors.off },
                  ]}
                />
                <View style={{ flex: 1 }}>
                  <Text style={eigen.konsole}>{konsole.name}</Text>
                  <Text style={eigen.klein}>
                    {aktiv
                      ? `${spielt?.spiel ?? konsole.spiel ?? 'läuft'} · gezählt`
                      : konsole.an
                        ? 'läuft, nicht gezählt'
                        : 'aus'}
                    {heute >= 30 ? ` · heute ${dauerText(heute)}` : ''}
                  </Text>
                </View>
              </View>
            );
          })}
          <Text style={eigen.klein}>
            {lage.heute.frei
              ? 'Heute frei'
              : rest !== null && rest <= 0
                ? grund
                : lage.heute.regel.an
                  ? `Erlaubt ${fensterText(lage.heute.regel)}`
                  : 'Heute kein Konsolentag'}
            {lage.heute.bonus ? ` · +${lage.heute.bonus} min geschenkt` : ''}
            {lage.ferien ? ' · Ferien' : ''}
          </Text>
        </View>
      </View>

      {monat}
      {fehler ? <Text style={styles.error}>{fehler}</Text> : null}

      <View style={eigen.knoepfe}>
        <Knopf text="15 min" icon="add" onPress={() => tun('geben', { minuten: 15 })} eigen={eigen} colors={colors} />
        <Knopf
          text={lage.heute.frei ? 'Frei aufheben' : 'Heute frei'}
          icon="checkmark"
          onPress={() => tun('frei', { an: !lage.heute.frei })}
          eigen={eigen}
          colors={colors}
          aktiv={lage.heute.frei}
        />
        <Knopf
          text={lage.gesperrt ? 'Entsperren' : 'Sperren'}
          icon={lage.gesperrt ? 'lock-open-outline' : 'lock-closed-outline'}
          onPress={() => tun('sperre', { an: !lage.gesperrt })}
          eigen={eigen}
          colors={colors}
          aktiv={lage.gesperrt}
        />
      </View>

      {/* Ein Kind ohne eigenes Gerät meldet ein Erwachsener an. */}
      <View style={eigen.knoepfe}>
        {spielt ? (
          <Knopf text={`${name} ist fertig`} icon="pause" onPress={() => tun('stopp')} eigen={eigen} colors={colors} />
        ) : (
          planKonsolen.map((konsole) => (
            <Knopf
              key={konsole.id}
              text={`${name} spielt: ${konsole.name}`}
              icon="game-controller-outline"
              onPress={() => tun('spielen', { konsole: konsole.id })}
              eigen={eigen}
              colors={colors}
            />
          ))
        )}
      </View>

      {/* Läuft eine Konsole, ohne dass ein Kind angemeldet ist, spielen
          vielleicht die Erwachsenen - ein Tipp, und der Hub lässt sie in
          Ruhe (kein Zählen, keine Nachfrage). */}
      {planKonsolen
        .filter(
          (konsole) =>
            // Die Switch meldet «an» nur verzögert und, solange sie
            // gesperrt ist, gar nicht - dort muss der Knopf immer stehen.
            (konsole.an || konsole.integration === 'nintendo') &&
            spielt?.konsole !== konsole.id &&
            !eltern.some((e) => e.konsole === konsole.id)
        )
        .map((konsole) => (
          <Pressable
            key={konsole.id}
            onPress={() => elternSpielen(konsole.id)}
            accessibilityRole="button"
            accessibilityLabel={`${konsole.name}: Erwachsene spielen`}
            style={[eigen.kopf, { marginTop: 8 }]}
          >
            <Ionicons name="person-outline" size={16} color={colors.accent} />
            <Text style={eigen.link}>
              {konsole.an ? `${konsole.name} läuft - Erwachsene spielen` : `${konsole.name}: Erwachsene spielen`}
            </Text>
          </Pressable>
        ))}

      {lage.tage.length > 0 ? (
        <View style={{ marginTop: 8, gap: 4 }}>
          <Text style={eigen.titelKlein}>Zuletzt gespielt</Text>
          {lage.tage.slice(0, 3).map((tag) => (
            <View key={tag.tag} style={eigen.zeileZwischen}>
              <Text style={[eigen.leise, { color: colors.ink, flex: 1 }]}>
                {new Date(`${tag.tag}T12:00:00`).toLocaleDateString('de-CH', { weekday: 'short', day: 'numeric', month: 'numeric' })}
                {aufteilung(tag.konsolen, namen) ? ` · ${aufteilung(tag.konsolen, namen)}` : ''}
              </Text>
              <Text style={eigen.wert}>{dauerText(tag.gesamt_s)}</Text>
            </View>
          ))}
        </View>
      ) : null}
    </Card>
  );
}

// ── Der Editor ─────────────────────────────────────────────────────────

function Schritt({
  wert,
  text,
  onMinus,
  onPlus,
  eigen,
  colors,
}: {
  wert: string;
  text: string;
  onMinus: () => void;
  onPlus: () => void;
  eigen: ReturnType<typeof makeStyles>;
  colors: Colors;
}) {
  return (
    <View style={eigen.zeileZwischen}>
      <Text style={[eigen.wert, { flex: 1 }]}>{text}</Text>
      <View style={eigen.schritt}>
        <Pressable onPress={onMinus} accessibilityRole="button" accessibilityLabel={`${text} weniger`} style={eigen.schrittKnopf}>
          <Ionicons name="remove" size={18} color={colors.ink} />
        </Pressable>
        <Text style={eigen.schrittWert}>{wert}</Text>
        <Pressable onPress={onPlus} accessibilityRole="button" accessibilityLabel={`${text} mehr`} style={eigen.schrittKnopf}>
          <Ionicons name="add" size={18} color={colors.ink} />
        </Pressable>
      </View>
    </View>
  );
}

export function KonsolenEditor({
  name,
  client,
  onFertig,
  styles,
  colors,
}: {
  name: string;
  client: HubClient;
  onFertig: () => void;
  styles: Styles;
  colors: Colors;
}) {
  const typ = useTyp();
  const eigen = useMemo(() => makeStyles(colors, typ), [colors, typ]);
  const { lage, konsolen, unbekannt, nintendoSperren, geladen, fehler, setFehler, laden } =
    useKonsolenzeit(client, name);
  const [plan, setPlan] = useState<KonsolenPlan | null>(null);
  const [offen, setOffen] = useState<number | null>(null);
  const [speichert, setSpeichert] = useState(false);

  // Der Plan wird einmal übernommen, wenn die Lage da ist - spätere
  // Abrufe (alle halbe Minute) dürfen nicht überschreiben, was gerade
  // getippt wird.
  useEffect(() => {
    if (geladen && plan === null) {
      setPlan(lage?.plan ?? leererPlan(konsolen.length === 1 ? [konsolen[0].id] : []));
    }
  }, [geladen, lage, konsolen, plan]);

  if (plan === null) {
    return (
      <View style={styles.stack}>
        <Kopf name={name} onBack={onFertig} styles={styles} colors={colors} />
        <Text style={styles.checkSub}>Lade …</Text>
      </View>
    );
  }

  const speichern = async () => {
    setSpeichert(true);
    try {
      await client.put(`/api/konsolenzeit/${encodeURIComponent(name)}/plan`, plan);
      onFertig();
    } catch (err) {
      setFehler(meldung(err));
    } finally {
      setSpeichert(false);
    }
  };

  const unbekanntSetzen = async (wahl: 'nie' | 'fragen' | 'sperren') => {
    try {
      await client.put('/api/konsolenzeit/einstellungen', { unbekannt: wahl });
      laden();
    } catch (err) {
      setFehler(meldung(err));
    }
  };

  const nintendoSperrenSetzen = async (an: boolean) => {
    try {
      await client.put('/api/konsolenzeit/einstellungen', { nintendo_sperren: an });
      laden();
    } catch (err) {
      setFehler(meldung(err));
    }
  };

  const hinweis = monatsHinweis(plan);
  const schalter = (wert: boolean, bei: (neu: boolean) => void, label: string) => (
    <Switch
      value={wert}
      onValueChange={bei}
      accessibilityLabel={label}
      trackColor={{ false: colors.surfaceBorder, true: colors.accent }}
    />
  );

  return (
    <View style={styles.stack}>
      <Kopf name={name} onBack={onFertig} styles={styles} colors={colors} />
      {fehler ? <Text style={styles.error}>{fehler}</Text> : null}

      <Card style={styles.listCard}>
        <View style={eigen.zeileZwischen}>
          <View style={{ flex: 1 }}>
            <Text style={eigen.titel}>Konsolenzeit einschalten</Text>
            <Text style={eigen.leise}>Aus heisst: keine Grenze für {name}.</Text>
          </View>
          {schalter(plan.aktiv, (an) => setPlan({ ...plan, aktiv: an }), 'Konsolenzeit einschalten')}
        </View>
      </Card>

      <Text style={eigen.gruppe}>Gilt für</Text>
      <Card style={styles.listCard}>
        {konsolen.length === 0 ? (
          <Text style={eigen.leise}>
            Der Hub kennt keine Konsole. Unter Einstellungen → Verbindungen die PlayStation koppeln.
          </Text>
        ) : (
          konsolen.map((konsole) => (
            <View key={konsole.id} style={eigen.zeileZwischen}>
              <View style={{ flex: 1 }}>
                <Text style={eigen.konsole}>{konsole.name}</Text>
                <Text style={eigen.klein}>
                  {konsole.integration === 'playstation'
                    ? 'Der Hub legt sie am Ende schlafen.'
                    : 'Die Switch beendet das Spiel selbst (Nintendos Kindersicherung).'}
                </Text>
              </View>
              {schalter(plan.konsolen.includes(konsole.id), () => setPlan(konsoleUmschalten(plan, konsole.id)), konsole.name)}
            </View>
          ))
        )}
        <Text style={eigen.klein}>
          Die Zeit zählt gemeinsam: Wer 15 Minuten an der Switch spielt, hat sie an der PlayStation nicht mehr.
        </Text>
      </Card>

      <Text style={eigen.gruppe}>Pro Tag</Text>
      <Card style={styles.listCard}>
        {plan.tage.map((regel, i) => {
          const zeile = tagZeile(regel);
          return (
            <View key={TAGE_KURZ[i]}>
              <Pressable
                onPress={() => setOffen(offen === i ? null : i)}
                accessibilityRole="button"
                accessibilityState={{ expanded: offen === i }}
                accessibilityLabel={`${TAGE_KURZ[i]}: ${zeile.titel} ${zeile.unten}`}
                style={[eigen.zeileZwischen, { paddingVertical: 8 }, !regel.an && { opacity: 0.6 }]}
              >
                <Text style={eigen.tagKurz}>{TAGE_KURZ[i]}</Text>
                <View style={{ flex: 1 }}>
                  <Text style={eigen.wert}>{zeile.titel}</Text>
                  {zeile.unten ? <Text style={eigen.klein}>{zeile.unten}</Text> : null}
                </View>
                {schalter(regel.an, (an) => setPlan(tagAendern(plan, i, { an })), `${TAGE_KURZ[i]} erlaubt`)}
              </Pressable>
              {offen === i && regel.an ? (
                <View style={eigen.aufgeklappt}>
                  <Schritt
                    text="Frühestens"
                    wert={zeitText(regel.von)}
                    onMinus={() => setPlan(tagAendern(plan, i, { von: verstellen(regel.von, -1, 0, 1425) }))}
                    onPlus={() => setPlan(tagAendern(plan, i, { von: verstellen(regel.von, 1, 0, 1425) }))}
                    eigen={eigen}
                    colors={colors}
                  />
                  <Schritt
                    text="Spätestens"
                    wert={zeitText(regel.bis)}
                    onMinus={() => setPlan(tagAendern(plan, i, { bis: verstellen(regel.bis, -1, 15, 1440) }))}
                    onPlus={() => setPlan(tagAendern(plan, i, { bis: verstellen(regel.bis, 1, 15, 1440) }))}
                    eigen={eigen}
                    colors={colors}
                  />
                  <Schritt
                    text="Höchstens pro Tag"
                    wert={minutenText(regel.minuten)}
                    onMinus={() => setPlan(tagAendern(plan, i, { minuten: regel.minuten - 15 }))}
                    onPlus={() => setPlan(tagAendern(plan, i, { minuten: regel.minuten + 15 }))}
                    eigen={eigen}
                    colors={colors}
                  />
                  <View style={styles.chipRow}>
                    {TAGES_MINUTEN.map((m) => (
                      <Pressable
                        key={m}
                        onPress={() => setPlan(tagAendern(plan, i, { minuten: m }))}
                        accessibilityRole="radio"
                        accessibilityState={{ selected: regel.minuten === m }}
                        style={[styles.chip, regel.minuten === m && styles.chipActive]}
                      >
                        <Text style={[styles.chipText, regel.minuten === m && styles.chipTextActive]}>{m}</Text>
                      </Pressable>
                    ))}
                  </View>
                  {i < 5 ? (
                    <Pressable onPress={() => setPlan(werktageUebernehmen(plan, i))} accessibilityRole="button" style={eigen.kopf}>
                      <Text style={eigen.link}>Für Mo – Fr übernehmen</Text>
                      <Ionicons name="chevron-forward" size={16} color={colors.accent} />
                    </Pressable>
                  ) : null}
                </View>
              ) : null}
            </View>
          );
        })}
        <View style={[eigen.zeileZwischen, { paddingTop: 8 }]}>
          <View style={{ flex: 1 }}>
            <Text style={eigen.wert}>Schulferien: Samstagszeiten</Text>
            <Text style={eigen.klein}>In den Ferien gelten an Werktagen die Zeiten vom Samstag.</Text>
          </View>
          {schalter(plan.ferien_wie_wochenende, (an) => setPlan({ ...plan, ferien_wie_wochenende: an }), 'Ferien wie Wochenende')}
        </View>
      </Card>

      <Text style={eigen.gruppe}>Pro Monat</Text>
      <Card style={styles.listCard}>
        <Schritt
          text="Höchstens pro Monat"
          wert={plan.monat ? minutenText(plan.monat) : 'keine'}
          onMinus={() => setPlan(monatSetzen(plan, plan.monat ? Math.max(0, plan.monat / 60 - 1) : 0))}
          onPlus={() => setPlan(monatSetzen(plan, (plan.monat ?? 0) / 60 + 1))}
          eigen={eigen}
          colors={colors}
        />
        <View style={styles.chipRow}>
          {MONATS_STUNDEN.map((h) => (
            <Pressable
              key={h}
              onPress={() => setPlan(monatSetzen(plan, h))}
              accessibilityRole="radio"
              accessibilityState={{ selected: plan.monat === h * 60 }}
              style={[styles.chip, plan.monat === h * 60 && styles.chipActive]}
            >
              <Text style={[styles.chipText, plan.monat === h * 60 && styles.chipTextActive]}>{h} h</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={() => setPlan(monatSetzen(plan, null))}
            accessibilityRole="radio"
            accessibilityState={{ selected: plan.monat === null }}
            style={[styles.chip, plan.monat === null && styles.chipActive]}
          >
            <Text style={[styles.chipText, plan.monat === null && styles.chipTextActive]}>Keine</Text>
          </Pressable>
        </View>
        {hinweis ? <Text style={eigen.leise}>{hinweis}</Text> : null}
        <Text style={eigen.klein}>Es zählt der Kalendermonat. Was übrig bleibt, verfällt am Monatsende.</Text>
      </Card>

      <Text style={eigen.gruppe}>Vorwarnung</Text>
      <Card style={styles.listCard}>
        <Text style={eigen.wert}>Vor dem Ende melden bei</Text>
        <View style={styles.chipRow}>
          {WARN_WAHL.map((m) => (
            <Pressable
              key={m}
              onPress={() => setPlan(warnungUmschalten(plan, m))}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: plan.warnungen.includes(m) }}
              style={[styles.chip, plan.warnungen.includes(m) && styles.chipActive]}
            >
              <Text style={[styles.chipText, plan.warnungen.includes(m) && styles.chipTextActive]}>{m} min</Text>
            </Pressable>
          ))}
        </View>
        <View style={eigen.zeileZwischen}>
          <View style={{ flex: 1 }}>
            <Text style={eigen.wert}>Durchsage im Raum der Konsole</Text>
            <Text style={eigen.klein}>«{name}, noch 5 Minuten – speichere dein Spiel.»</Text>
          </View>
          {schalter(plan.durchsage, (an) => setPlan({ ...plan, durchsage: an }), 'Durchsage')}
        </View>
        <View style={eigen.zeileZwischen}>
          <View style={{ flex: 1 }}>
            <Text style={eigen.wert}>Meldung an die Eltern</Text>
            <Text style={eigen.klein}>Einmal, wenn die Zeit um ist.</Text>
          </View>
          {schalter(plan.eltern_melden, (an) => setPlan({ ...plan, eltern_melden: an }), 'Meldung an die Eltern')}
        </View>
        <View style={eigen.zeileZwischen}>
          <View style={{ flex: 1 }}>
            <Text style={eigen.wert}>Konsole am Ende ausschalten</Text>
            <Text style={eigen.klein}>Aus: Der Hub meldet nur, die Konsole läuft weiter.</Text>
          </View>
          {schalter(plan.abschalten, (an) => setPlan({ ...plan, abschalten: an }), 'Konsole am Ende ausschalten')}
        </View>
      </Card>

      <Text style={eigen.gruppe}>Wer spielt?</Text>
      <Card style={styles.listCard}>
        <Text style={eigen.leise}>
          Weder die PlayStation noch Nintendos Limit sagen, wer am Controller sitzt. Darum meldet sich
          {' '}{name} mit «Ich spiele jetzt» an: Die Zeit läuft ab dem Tipp bis «Fertig». Was die Konsole selbst
          zählt oder ob sie läuft, ist egal - Erwachsene spielen an denselben Geräten.
        </Text>
        <Text style={[eigen.wert, { marginTop: 8 }]}>Läuft eine Konsole ohne Anmeldung?</Text>
        <View style={styles.chipRow}>
          {(['nie', 'fragen', 'sperren'] as const).map((wahl) => (
            <Pressable
              key={wahl}
              onPress={() => unbekanntSetzen(wahl)}
              accessibilityRole="radio"
              accessibilityState={{ selected: unbekannt === wahl }}
              style={[styles.chip, unbekannt === wahl && styles.chipActive]}
            >
              <Text style={[styles.chipText, unbekannt === wahl && styles.chipTextActive]}>
                {wahl === 'nie' ? 'Nichts tun' : wahl === 'fragen' ? 'Eltern fragen' : 'Ausschalten'}
              </Text>
            </Pressable>
          ))}
        </View>
        {konsolen.some((k) => k.integration === 'nintendo') ? (
          <View style={[eigen.zeileZwischen, { marginTop: 8 }]}>
            <View style={{ flex: 1 }}>
              <Text style={eigen.wert}>Switch gesperrt halten</Text>
              <Text style={eigen.klein}>
                Ohne Anmeldung steht die Höchstzeit der Switch auf dem, was schon gespielt ist - sie
                lässt sich erst nach «Ich spiele jetzt» oder «Erwachsene spielen» starten. Aus: Die
                Switch bleibt bei Nintendos eigener Einstellung.
              </Text>
            </View>
            {schalter(nintendoSperren, nintendoSperrenSetzen, 'Switch gesperrt halten')}
          </View>
        ) : null}
        <Text style={eigen.klein}>
          Gilt für alle Kinder. Spielen die Erwachsenen, schalten sie die Konsole in der App auf
          «Eltern spielen» - dann wird weder gezählt noch gefragt.
        </Text>
      </Card>

      <Pressable
        onPress={speichern}
        disabled={speichert}
        accessibilityRole="button"
        accessibilityLabel="Speichern"
        style={({ pressed }) => [eigen.speichern, pressed && { opacity: 0.8 }, speichert && { opacity: 0.5 }]}
      >
        <Text style={eigen.speichernText}>{speichert ? 'Speichert …' : 'Speichern'}</Text>
      </Pressable>
    </View>
  );
}

function Kopf({
  name,
  onBack,
  styles,
  colors,
}: {
  name: string;
  onBack: () => void;
  styles: Styles;
  colors: Colors;
}) {
  return (
    <View style={styles.backHead}>
      <Pressable onPress={onBack} style={styles.backRow} accessibilityRole="button" accessibilityLabel={`Zurück zu ${name}`}>
        <Ionicons name="chevron-back" size={18} color={colors.onGradient} />
        <Text style={styles.backText}>{name}</Text>
      </Pressable>
      <Text style={styles.viewTitle}>Konsolenzeit</Text>
    </View>
  );
}

const makeStyles = (colors: Colors, typ: Typmass) =>
  StyleSheet.create({
    kopf: { flexDirection: 'row', alignItems: 'center', gap: 8 },
    zeileZwischen: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 10 },
    titel: { color: colors.ink, fontSize: typ.label, fontWeight: '700' },
    titelKlein: { color: colors.ink, fontSize: typ.label, fontWeight: '700' },
    gruppe: {
      color: colors.onGradientSoft,
      fontSize: typ.detail,
      fontWeight: '700',
      textTransform: 'uppercase',
      letterSpacing: 0.6,
      marginTop: 6,
      marginLeft: 4,
    },
    wert: { color: colors.ink, fontSize: typ.label, fontWeight: '600' },
    leise: { color: colors.inkSoft, fontSize: typ.label, lineHeight: 20 },
    klein: { color: colors.inkSoft, fontSize: typ.detail, lineHeight: 17 },
    konsole: { color: colors.ink, fontSize: typ.label, fontWeight: '700' },
    link: { color: colors.accent, fontSize: typ.label, fontWeight: '600' },
    punkt: { width: 8, height: 8, borderRadius: 4 },
    ringZahl: { color: colors.ink, fontSize: typ.greeting, fontWeight: '800', lineHeight: 36 },
    ringZahlGross: { fontSize: typ.greeting * 2, lineHeight: 70 },
    ringEinheitGross: { fontSize: typ.label },
    knopfTextGross: { fontSize: typ.cardTitle },
    ringEinheit: { color: colors.inkSoft, fontSize: typ.detail, fontWeight: '600' },
    balken: {
      height: 8,
      borderRadius: 4,
      backgroundColor: colors.off,
      marginVertical: 8,
      overflow: 'visible',
    },
    balkenFuell: { height: 8, borderRadius: 4, backgroundColor: colors.accent },
    strich: { position: 'absolute', top: -3, width: 2, height: 14, backgroundColor: colors.ink, opacity: 0.55 },
    knoepfe: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 10 },
    knopf: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 6,
      paddingVertical: 10,
      paddingHorizontal: 14,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    knopfGross: { alignSelf: 'stretch', paddingVertical: 16 },
    knopfText: { color: colors.ink, fontSize: typ.label, fontWeight: '600' },
    pille: {
      flexDirection: 'row',
      alignItems: 'center',
      gap: 6,
      paddingVertical: 4,
      paddingHorizontal: 12,
      borderRadius: radius.pill,
      backgroundColor: colors.onSoft,
    },
    pilleText: { color: colors.onInk, fontSize: typ.label, fontWeight: '700' },
    woche: { flexDirection: 'row', alignItems: 'flex-end', justifyContent: 'space-between', height: 130, marginTop: 8, gap: 6 },
    wocheSpalte: { flex: 1, alignItems: 'center', justifyContent: 'flex-end', gap: 4 },
    wocheKasten: {
      width: '100%',
      maxWidth: 34,
      borderWidth: 2,
      borderColor: colors.surfaceBorder,
      borderRadius: 9,
      overflow: 'hidden',
    },
    wocheTag: { color: colors.ink, fontSize: typ.cardSub, fontWeight: '700' },
    tagKurz: { color: colors.inkSoft, fontSize: typ.label, fontWeight: '700', width: 28 },
    aufgeklappt: {
      gap: 10,
      paddingVertical: 10,
      paddingLeft: 38,
      borderBottomWidth: StyleSheet.hairlineWidth,
      borderBottomColor: colors.surfaceBorder,
    },
    schritt: { flexDirection: 'row', alignItems: 'center', gap: 4 },
    schrittKnopf: {
      width: 36,
      height: 36,
      borderRadius: 12,
      alignItems: 'center',
      justifyContent: 'center',
      backgroundColor: colors.surfaceSoft,
    },
    schrittWert: { color: colors.ink, fontSize: typ.label, fontWeight: '700', minWidth: 74, textAlign: 'center' },
    speichern: {
      marginTop: 8,
      alignItems: 'center',
      paddingVertical: 15,
      borderRadius: radius.control,
      backgroundColor: colors.accent,
    },
    speichernText: { color: colors.onAccent, fontSize: typ.cardTitle, fontWeight: '700' },
  });
