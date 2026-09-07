import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { Card } from './Card';
import {
  DAUERN,
  STANDARD_STUNDEN,
  dauerName,
  gaesteansicht,
  gezeigterGutschein,
} from '../lib/gaestewlan';
import {
  Aufkleberstand,
  aufkleberSatz,
  huerde,
  offenSatz,
} from '../lib/wlanaufkleber';
import { Colors, radius, type, useColors } from '../theme';
import { useTakt } from '../hooks/useTakt';

/**
 * Die Gäste-WLAN-Karte: QR-Code fürs Netz, Aufkleber für Gäste und der
 * Gutschein-Spender.
 *
 * Sie stand in der Benutzerverwaltung, und dort gehört sie auch hin -
 * nur ist das der falsche Ort, wenn Besuch vor einem steht und nach dem
 * WLAN fragt. Deshalb liegt sie jetzt hier statt im Bildschirm: Die
 * Startseite zeigt dasselbe in einem Blatt, ohne dass man sich durch
 * die Einstellungen gräbt.
 */

interface Gutschein {
  id: string;
  code: string;
  note: string;
  minutes: number;
  created?: number | null;
  used: boolean;
}

export function GaesteWlanKarte({
  settings,
  headers,
  canConfigure = false,
}: {
  settings: HubSettings;
  headers: Record<string, string>;
  /** Nur wer die Konfiguration ändern darf, bekommt den Einrichtungshinweis
   *  zu sehen - für Gäste wäre er eine Anleitung ins Nichts. */
  canConfigure?: boolean;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  const [wifi, setWifi] = useState<{
    ssid: string;
    password: string;
    portal_password?: string;
    open?: boolean;
    payload: string;
  } | null>(null);
  const [open, setOpen] = useState(false);
  // Gutscheine fürs Captive Portal - null heisst: keine UniFi-Anbindung.
  const [vouchers, setVouchers] = useState<
    | {
        id: string;
        code: string;
        note: string;
        minutes: number;
        created?: number | null;
        used: boolean;
      }[]
    | null
  >(null);
  const [voucherNote, setVoucherNote] = useState<string | null>(null);
  // Der eben angelegte Gutschein - er steht vor dem Vorrat.
  const [zuletzt, setZuletzt] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // Der Aufkleber: Adresse, offene Codes und was ihn hindert.
  const [aufkleber, setAufkleber] = useState<Aufkleberstand | null>(null);
  const [aufkleberOffen, setAufkleberOffen] = useState(false);

  const ladeAufkleber = () => {
    // Ein Hub, der die Route noch nicht kennt, soll die Karte nicht rot
    // machen - dann fällt der Abschnitt einfach weg.
    hub
      .get<Aufkleberstand | null>('/api/wifi/sticker', { fallback: null, still: true })
      .then(setAufkleber);
  };

  const neuerAufkleber = async () => {
    setBusy(true);
    try {
      setAufkleber(
        await hub.post<Aufkleberstand>('/api/wifi/sticker/rotate', undefined, {
          still: true,
        })
      );
      setVoucherNote('Neuer Aufkleber - der alte gilt nicht mehr.');
    } catch (err) {
      setVoucherNote(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const loadVouchers = () => {
    // Ohne Antwort bleibt die Karte beim letzten Stand.
    hub
      .get<{ vouchers?: Gutschein[] } | null>('/api/wifi/vouchers', {
        fallback: null,
        still: true,
      })
      .then((data) => {
        if (data) setVouchers(data.vouchers ?? []);
      });
  };

  useEffect(() => {
    // Kein WLAN eingerichtet sieht gleich aus wie keine Antwort - die
    // Karte erklärt dann, wie man es einrichtet.
    hub
      .get<{
        ssid: string;
        password: string;
        portal_password?: string;
        open?: boolean;
        payload: string;
      } | null>('/api/wifi', { fallback: null, still: true })
      .then((data) => {
        if (data?.payload) setWifi(data);
      });
    loadVouchers();
    ladeAufkleber();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [settings.url, settings.token]);

  const createVoucher = async (hours: number) => {
    setBusy(true);
    setVoucherNote(null);
    try {
      const response = await fetch(`${settings.url}/api/wifi/vouchers`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.detail ?? `Hub antwortet mit ${response.status}`);
      // Den frischen Gutschein gleich aus der Antwort übernehmen und
      // merken: Wer ihn eben angelegt hat, will ihn jetzt vorlesen -
      // nicht erst nach dem nächsten Abgleich, und nicht hinter dem
      // Vorrat (lib/gaestewlan.ts, gezeigterGutschein).
      const frisch: Gutschein | undefined = body.voucher;
      if (frisch?.id) {
        setVouchers((bisher) => [frisch, ...(bisher ?? []).filter((v) => v.id !== frisch.id)]);
        setZuletzt(frisch.id);
        setVoucherNote(`Neu für ${dauerName(frisch.minutes)} - der Code steht oben.`);
      } else {
        setVoucherNote('In den Vorrat gelegt.');
      }
      loadVouchers();
    } catch (err) {
      setVoucherNote(String(err instanceof Error ? err.message : err));
    } finally {
      setBusy(false);
    }
  };

  const deleteVoucher = async (id: string) => {
    // loadVouchers() gleich danach ist die Rückmeldung: Ein Gutschein,
    // der nicht gelöscht werden konnte, steht sichtbar wieder da.
    await hub.del(`/api/wifi/vouchers/${encodeURIComponent(id)}`, {
      fallback: null,
      still: true,
    });
    loadVouchers();
  };

  // Der Spender: Gezeigt wird genau ein Gutschein - der eben angelegte,
  // sonst der älteste noch nicht eingelöste. Wird er verwendet, rückt
  // beim nächsten Abgleich der nächste nach.
  const fresh = (vouchers ?? []).filter((voucher) => !voucher.used);
  const current = gezeigterGutschein(vouchers ?? [], zuletzt);

  // Kurzer Takt mit Absicht: Genau in dem Moment, in dem der Gast den
  // Code eintippt, schaut man auf diese Karte.
  useTakt(loadVouchers, open && vouchers != null ? 8000 : null);

  // Nichts eingerichtet: Für die Besitzerin bzw. den Besitzer steht hier,
  // was fehlt - für alle anderen bleibt die Karte weg. Sich stumm
  // auszublenden war die schlechtere Hälfte davon: Man sucht dann eine
  // Karte, die es gibt, und findet keinen Hinweis, woran es liegt.
  if (gaesteansicht(wifi != null, vouchers) === 'einrichten') {
    if (!canConfigure) return null;
    return (
      <Card style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="wifi-outline" size={18} color={colors.inkSoft} />
          <Text style={[styles.cardTitle, { flex: 1 }]}>Gäste-WLAN</Text>
        </View>
        <Text style={styles.formHint}>
          Noch nicht eingerichtet. Es gibt zwei Wege, und jeder genügt für
          sich. Der eine ist der Abschnitt «guest_wifi» in der config.yaml
          des Hubs - mit ihm zeigt diese Karte einen QR-Code zum Anmelden.
          Läuft das Gäste-Netz über ein Captive Portal, genügt dort der
          Netzname; das Netz selbst ist ja offen.
        </Text>
        <Text style={styles.formHint}>
          Der andere ist die UniFi-Integration: Dann stellt der Hub die
          Portal-Gutscheine selbst aus, und niemand muss dafür in den
          Controller. Dafür braucht es kein «guest_wifi» - sobald die
          Anbindung steht, erscheint hier der Spender, auch bevor der
          erste Gutschein angelegt ist.
        </Text>
      </Card>
    );
  }

  return (
    <Card style={styles.card}>
      <Pressable
        onPress={() => setOpen((value) => !value)}
        accessibilityRole="button"
        accessibilityState={{ expanded: open }}
        style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
      >
        <Ionicons name="wifi-outline" size={18} color={colors.inkSoft} />
        <Text style={[styles.cardTitle, { flex: 1 }]}>Gäste-WLAN</Text>
        <Ionicons
          name={open ? 'chevron-up' : 'chevron-down'}
          size={18}
          color={colors.inkSoft}
        />
      </Pressable>
      {open && wifi ? (
        <>
          <View style={styles.qrBox}>
            <QRCode value={wifi.payload} size={190} backgroundColor="#FFFFFF" />
          </View>
          <Text style={styles.qrHint}>
            {wifi.ssid}
            {wifi.password ? ` · Passwort: ${wifi.password}` : ' · offenes Netz'}
          </Text>
          {wifi.portal_password ? (
            <Text style={styles.qrHint}>
              Nach dem Verbinden öffnet sich die Anmeldeseite - dort dieses
              Passwort eingeben: {wifi.portal_password}
            </Text>
          ) : wifi.open ? (
            <Text style={styles.qrHint}>
              Nach dem Verbinden öffnet sich die Anmeldeseite (Captive
              Portal) - dort bestätigen bzw. anmelden.
            </Text>
          ) : null}
          <Text style={styles.qrHint}>
            Mit der Telefon-Kamera scannen - das WLAN verbindet sich von
            selbst. Passt zur Einmal-Türöffnung: Besuch bekommt Tür und
            WLAN aus derselben Karte.
          </Text>
        </>
      ) : null}

      {/* Der Aufkleber. Er steht über dem Vorrat, weil er den Normalfall
          bedient: Besuch holt sich den Code selbst, und niemand muss
          etwas vorlesen. Der Vorrat darunter bleibt für den Gast ohne
          Kamera und für den, dem man einen Code voraus geben will. */}
      {open && aufkleber ? (
        <>
          <Pressable
            onPress={() => setAufkleberOffen((wert) => !wert)}
            accessibilityRole="button"
            accessibilityState={{ expanded: aufkleberOffen }}
            style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}
          >
            <Text style={[styles.formLabel, { flex: 1, marginTop: 0 }]}>
              Aufkleber für Gäste
            </Text>
            {offenSatz(aufkleber) ? (
              <Text style={styles.qrHint}>{offenSatz(aufkleber)}</Text>
            ) : null}
            <Ionicons
              name={aufkleberOffen ? 'chevron-up' : 'chevron-down'}
              size={16}
              color={colors.inkSoft}
            />
          </Pressable>
          <Text style={styles.qrHint}>{aufkleberSatz(aufkleber)}</Text>
          {huerde(aufkleber) ? (
            <Text style={[styles.qrHint, { color: colors.warn }]}>
              {huerde(aufkleber)}
            </Text>
          ) : null}

          {aufkleberOffen ? (
            <>
              <View style={styles.qrBox}>
                <QRCode value={aufkleber.url} size={190} backgroundColor="#FFFFFF" />
              </View>
              {/* Die Adresse auch als Text: zum Abtippen aufs Wandpanel
                  und zum Nachsehen, ob sie stimmt. */}
              <Text style={styles.qrHint} selectable>
                {aufkleber.url}
              </Text>
              {/* Die gezogenen Codes standen hier einmal im Klartext.
                  Das ist der falsche Ort dafür: Die Karte hängt auf dem
                  Wandpanel im Gang, und wer vorbeigeht, liest gültige
                  Gästezugänge mit. Die Zahl oben («3 Codes offen») sagt
                  ohnehin alles, wofür man hier nachsieht - ob jemand den
                  Aufkleber benutzt, den man nicht gemeint hat. */}
              {canConfigure ? (
                <Pressable
                  onPress={neuerAufkleber}
                  disabled={busy}
                  accessibilityRole="button"
                  style={({ pressed }) => [
                    styles.voucherChip,
                    { alignSelf: 'flex-start' },
                    (pressed || busy) && { opacity: 0.6 },
                  ]}
                >
                  <Text style={styles.voucherChipText}>Neuer Aufkleber</Text>
                </Pressable>
              ) : null}
              <Text style={styles.qrHint}>
                Ausdrucken und aufhängen. Ein neuer Aufkleber macht alle
                ausgedruckten ungültig - gezogene Codes laufen trotzdem ab.
              </Text>
            </>
          ) : null}
        </>
      ) : null}

      {open && vouchers != null ? (
        <>
          <Text style={styles.formLabel}>Portal-Gutschein</Text>
          {current ? (
            <View style={styles.voucherBox}>
              <Text style={styles.voucherBig} selectable>
                {current.code}
              </Text>
              <Text style={styles.qrHint}>
                {dauerName(current.minutes)} ab der ersten Anmeldung
                {current.note ? ` · ${current.note}` : ''}
              </Text>
              <View style={{ flexDirection: 'row', alignItems: 'center', gap: 10 }}>
                <Text style={[styles.qrHint, { flex: 1 }]}>
                  {fresh.length > 1
                    ? `Wird er eingelöst, rückt der nächste nach (${fresh.length - 1} im Vorrat).`
                    : 'Letzter Gutschein im Vorrat - unten Nachschub anlegen.'}
                </Text>
                <Pressable
                  onPress={() => deleteVoucher(current.id)}
                  accessibilityLabel="Diesen Gutschein löschen"
                  hitSlop={8}
                >
                  <Ionicons name="trash-outline" size={17} color={colors.inkSoft} />
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={styles.qrHint}>
              Kein Gutschein im Vorrat - unten einen anlegen.
            </Text>
          )}
          <View style={{ flexDirection: 'row', flexWrap: 'wrap', gap: 8 }}>
            {/* Der Standard vorn und hervorgehoben: Ein Abendbesuch ist
                der Regelfall, und dafür soll niemand erst eine Dauer
                wählen müssen. Die drei längeren daneben sind die
                bewusste Entscheidung - für die Übernachtung, das lange
                Wochenende, die Ferienwoche. */}
            <Pressable
              onPress={() => createVoucher(STANDARD_STUNDEN)}
              disabled={busy}
              accessibilityRole="button"
              accessibilityLabel={`Gutschein für ${STANDARD_STUNDEN} Stunden anlegen`}
              style={({ pressed }) => [
                styles.voucherChip,
                styles.voucherChipStark,
                (pressed || busy) && { opacity: 0.6 },
              ]}
            >
              <Text style={[styles.voucherChipText, styles.voucherChipStarkText]}>
                + Gutschein ({STANDARD_STUNDEN} Std.)
              </Text>
            </Pressable>
            {DAUERN.map((option) => (
              <Pressable
                key={option.stunden}
                onPress={() => createVoucher(option.stunden)}
                disabled={busy}
                accessibilityRole="button"
                style={({ pressed }) => [
                  styles.voucherChip,
                  (pressed || busy) && { opacity: 0.6 },
                ]}
              >
                <Text style={styles.voucherChipText}>+ {option.label}</Text>
              </Pressable>
            ))}
          </View>
          {voucherNote ? (
            <Text style={styles.qrHint} selectable>
              {voucherNote}
            </Text>
          ) : null}
          <Text style={styles.qrHint}>
            Einmal-Codes fürs Anmeldefenster (Captive Portal). Die Dauer
            zählt ab der ersten Anmeldung; danach verfällt der Code.
          </Text>
        </>
      ) : null}
    </Card>
  );
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    card: { minHeight: 0, gap: 10 },
    cardTitle: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    formHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    formLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    qrBox: {
      alignSelf: 'center',
      backgroundColor: '#FFFFFF',
      padding: 16,
      borderRadius: radius.control,
      marginTop: 6,
    },
    qrHint: {
      color: colors.inkSoft,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
    },
    voucherBig: {
      color: colors.ink,
      fontSize: 28,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      letterSpacing: 2,
    },
    voucherBox: {
      alignItems: 'center',
      gap: 6,
      paddingVertical: 14,
      paddingHorizontal: 12,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    voucherChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    voucherChipStark: { backgroundColor: colors.accent, borderColor: colors.accent },
    voucherChipStarkText: { color: '#FFFFFF' },
    voucherChipText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
  });
