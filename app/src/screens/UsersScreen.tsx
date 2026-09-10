import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Modal,
  Pressable,
  ScrollView,
  Share,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import QRCode from 'react-native-qrcode-svg';

import { Abschnitt } from '../components/Abschnitt';
import { Klappe } from '../components/Klappe';
import {
  artStand,
  ersterWeg,
  kinderStand,
  reichweiteStand,
  sichtschutzStand,
  Weg,
  WEGE,
  WOCHENTAGE,
  zugangStand,
} from '../lib/benutzerblatt';

import { HubFehler, hubClient } from '../api/client';
import { Entity, HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { Tastaturplatz } from '../components/Tastaturplatz';
import { einladungFrist } from '../lib/einladung';
import { gruppiereZugaenge } from '../lib/benutzergruppen';
import { ROLE_LABELS } from '../lib/rollen';
import {
  besitzerZahl,
  darfRolleAendern,
  eineZimmerwahl,
  zimmerPatch,
} from '../lib/rollenwahl';
import { DoorPass } from '../components/DoorPass';
import { GaesteWlanKarte } from '../components/GaesteWlan';
import { Fehlschlag, Umriss } from '../components/Zustand';
import { Colors, radius, space, type, useColors } from '../theme';

/** ISO-Datum für «in n Tagen ab heute» - für die Ablauf-Schnellwahl. */
function isoInDays(days: number): string {
  const datum = new Date();
  datum.setHours(12, 0, 0, 0);
  datum.setDate(datum.getDate() + days);
  return `${datum.getFullYear()}-${String(datum.getMonth() + 1).padStart(2, '0')}-${String(
    datum.getDate()
  ).padStart(2, '0')}`;
}

/**
 * Benutzerverwaltung: Wer hat Zugang zum Haus, mit welcher Rolle?
 *
 * Beim Anlegen erzeugt der Hub ein Token. Antippen eines Benutzers zeigt
 * den Kopplungs-QR-Code – die Person scannt ihn in ihrer App («QR-Code vom
 * Hub scannen») und ist verbunden, ohne etwas abzutippen. Gäste lassen sich
 * auf Bereiche einschränken und jederzeit sperren/entsperren, ohne dass sie
 * ein neues Token brauchen. Benutzer aus der config.yaml gehören der Datei
 * und sind hier nur lesbar.
 */



const ROLE_HINTS: Record<string, string> = {
  besitzer: 'darf alles, auch Benutzer und Konfiguration verwalten',
  bewohner: 'bedient das ganze Haus, darf Abläufe pausieren',
  kind: 'darf schalten und den Verlauf sehen; die Kinder-Ansicht seiner Zimmer ist der Normalfall',
  gast: 'sieht und schaltet nur die freigegebenen Bereiche',
};

/** Freigebbare Bereiche für Gäste – Schlüssel wie auf dem Hub. */
export const FEATURE_LABELS: Record<string, string> = {
  licht: 'Licht',
  storen: 'Storen',
  familie: 'Familie',
  haustuere: 'Haustüre',
  wohnungstuere: 'Wohnungstüre',
  kalender: 'Kalender',
  haushalt: 'Haushalt',
  raeume: 'Räume',
  kameras: 'Kameras',
};

interface HubUser {
  name: string;
  role: string;
  allow: string[];
  editable: boolean;
  enabled?: boolean;
  features?: string[];
  /** Zugang läuft an diesem Tag ab (JJJJ-MM-TT). */
  expires?: string | null;
  /** Zugang nur in diesem Fenster, z.B. {from: '07:00', to: '20:00'}. */
  hours?: { from?: string; to?: string };
  /** Und nur an diesen Wochentagen (0 = Montag); leer heisst alle Tage. */
  days?: number[];
  /** Darf diese Person gerade herein? Rechnet Ablauf und Fenster mit. */
  active?: boolean;
  /** Kinder-Ansicht: nur diese Räume, als grosse Knöpfe. */
  simple_rooms?: string[];
  /** Rechte je Raum: leer = ganzes Haus, sonst nur diese Räume. */
  rooms?: string[];
  /** Gemeinschaftsgerät (Wandtablet, Küchendisplay) statt einer Person. */
  shared?: boolean;
  /** Vor den persönlichen Bereichen liegt ein Passwort. Nur ob, nie welches. */
  area_locked?: boolean;
  /** Anmelde-Adresse – Voraussetzung für die Einladung. */
  email?: string | null;
}

interface Props {
  settings: HubSettings;
  currentUser?: { name: string; role: string } | null;
  /** Für die Einmal-Türöffnung – sie gehört zur Zugangsverwaltung und
   *  nicht in den System-Screen, wo es sonst um den Betrieb geht. */
  entities?: Entity[];
}

/** Mehrfach-Auswahl der Gast-Bereiche als Chips. */
/** Ablaufdatum und Zeitfenster eines Zugangs.
 *
 * Zwei Fälle, die im Alltag wirklich vorkommen: Der Wochenendgast, den man
 * sonst von Hand sperren müsste – daran denkt man genau einmal –, und das
 * Kind, das nachts um zwei kein Licht mehr schalten soll.
 *
 * Bewusst als Text statt Datumswähler: Ein Wähler auf einem Wandpanel ist
 * mehr Aufwand als «2026-08-24» zu tippen, und das Format ist eindeutig. */
function AccessLimits({
  detail,
  styles,
  colors,
  onChange,
}: {
  detail: {
    expires?: string | null;
    hours?: { from?: string; to?: string };
    days?: number[];
    active?: boolean;
  };
  styles: ReturnType<typeof makeStyles>;
  colors: Colors;
  onChange: (patch: Record<string, unknown>) => void;
}) {
  const [expires, setExpires] = useState(detail.expires ?? '');
  const [from, setFrom] = useState(detail.hours?.from ?? '');
  const [to, setTo] = useState(detail.hours?.to ?? '');
  // Die Wochentage des wiederkehrenden Gastes - «jeden Donnerstag 8-12»
  // einmal anlegen, statt jede Woche ein neues Fenster (0 = Montag).
  const [days, setDays] = useState<number[]>(detail.days ?? []);
  const tagKippen = (tag: number) => {
    const neu = days.includes(tag)
      ? days.filter((rest) => rest !== tag)
      : [...days, tag].sort((a, b) => a - b);
    setDays(neu);
    onChange({ days: neu });
  };

  return (
    <>
      <Text style={styles.formLabel}>Zugang läuft ab (optional)</Text>
      <View style={styles.expiryRow}>
        {[
          { label: '2 Tage', days: 2 },
          { label: '1 Woche', days: 7 },
          { label: '1 Monat', days: 30 },
          { label: 'unbegrenzt', days: null },
        ].map((option) => {
          const wert = option.days === null ? '' : isoInDays(option.days);
          return (
            <Pressable
              key={option.label}
              onPress={() => {
                setExpires(wert);
                onChange({ expires: wert });
              }}
              accessibilityRole="button"
              accessibilityLabel={`Zugang ${option.label}`}
              style={[styles.expiryChip, expires === wert && styles.expiryChipActive]}
            >
              <Text
                style={[
                  styles.expiryChipText,
                  expires === wert && styles.expiryChipTextActive,
                ]}
              >
                {option.label}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <TextInput
        style={styles.input}
        value={expires}
        onChangeText={setExpires}
        onBlur={() => onChange({ expires: expires.trim() })}
        placeholder="JJJJ-MM-TT, z.B. 2026-08-24"
        placeholderTextColor={colors.inkFaint}
        autoCapitalize="none"
      />

      <Text style={styles.formLabel}>Nur an diesen Tagen (optional)</Text>
      <View style={styles.expiryRow}>
        {WOCHENTAGE.map((kurz, tag) => {
          const an = days.includes(tag);
          return (
            <Pressable
              key={kurz}
              onPress={() => tagKippen(tag)}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: an }}
              accessibilityLabel={`Zugang am ${kurz}`}
              style={[styles.expiryChip, an && styles.expiryChipActive]}
            >
              <Text style={[styles.expiryChipText, an && styles.expiryChipTextActive]}>
                {kurz}
              </Text>
            </Pressable>
          );
        })}
      </View>
      <Text style={styles.qrHint}>
        Keiner gewählt heisst jeden Tag. Für die Putzhilfe am Donnerstag:
        «Do» antippen und unten das Zeitfenster setzen - der Zugang kommt
        jede Woche von selbst wieder.
      </Text>

      <Text style={styles.formLabel}>Nur zwischen (optional)</Text>
      <View style={{ flexDirection: 'row', gap: 8 }}>
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={from}
          onChangeText={setFrom}
          onBlur={() => onChange({ hours: { from: from.trim(), to: to.trim() } })}
          placeholder="07:00"
          placeholderTextColor={colors.inkFaint}
        />
        <TextInput
          style={[styles.input, { flex: 1 }]}
          value={to}
          onChangeText={setTo}
          onBlur={() => onChange({ hours: { from: from.trim(), to: to.trim() } })}
          placeholder="20:00"
          placeholderTextColor={colors.inkFaint}
        />
      </View>
      <Text style={styles.qrHint}>
        Ausserhalb des Fensters ist die Anmeldung gesperrt; ein Fenster über
        Mitternacht (22:00 bis 06:00) geht auch. Beides leer lassen heisst
        unbegrenzt.
      </Text>
      {detail.active === false ? (
        <Text style={styles.disabledNote}>
          Gerade kein Zugang – abgelaufen oder ausserhalb des Zeitfensters.
        </Text>
      ) : null}
    </>
  );
}

function FeatureChips({
  selected,
  onToggle,
  styles,
}: {
  selected: string[];
  onToggle: (feature: string) => void;
  styles: ReturnType<typeof makeStyles>;
}) {
  return (
    <View style={styles.roleRow}>
      {Object.entries(FEATURE_LABELS).map(([key, label]) => {
        const active = selected.includes(key);
        return (
          <Pressable
            key={key}
            onPress={() => onToggle(key)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: active }}
            style={[styles.roleChip, active && styles.roleChipActive]}
          >
            <Text style={[styles.roleChipText, active && styles.roleChipTextActive]}>
              {label}
            </Text>
          </Pressable>
        );
      })}
    </View>
  );
}

export function UsersScreen({ settings, currentUser, entities = [] }: Props) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const headers = useMemo(
    () => ({ Authorization: `Bearer ${settings.token}` }),
    [settings.token]
  );
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );
  // Die Mutationen unten bleiben bewusst rohe fetch-Aufrufe: Ihre
  // Fehlermeldungen kommen aus dem detail-Feld der Hub-Antwort, das der
  // Client nicht durchreicht.

  // Räume für die Kinder-Ansicht - aus den Geräten hergeleitet, wie
  // überall sonst: Ein Raum existiert, sobald ihm etwas zugeordnet ist.
  const roomNames = useMemo(
    () =>
      Array.from(
        new Set(entities.map((entity) => entity.room).filter(Boolean) as string[])
      ).sort((a, b) => a.localeCompare(b)),
    [entities]
  );

  const [users, setUsers] = useState<HubUser[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState('');
  // Initialpasswort (optional): Damit meldet sich die Person mit ihrem
  // Namen an - und muss beim ersten Anmelden ein eigenes setzen.
  const [newPassword, setNewPassword] = useState('');
  const [newRole, setNewRole] = useState('bewohner');
  // Wandtablet statt Person - siehe den Hinweis im Formular.
  const [newShared, setNewShared] = useState(false);
  const [newFeatures, setNewFeatures] = useState<string[]>(['licht']);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Detailansicht: gewählter Benutzer + geladene Kopplungs-Daten.
  const [detail, setDetail] = useState<HubUser | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  // Die Einladung zu dieser Person: Link samt Ablauf, oder nichts.
  const [einladung, setEinladung] = useState<{ link: string; expires: number } | null>(
    null
  );
  const [einladungPass, setEinladungPass] = useState('');
  // Welcher der drei Wege gerade offen steht - siehe lib/benutzerblatt.ts.
  const [weg, setWeg] = useState<Weg>('qr');
  const [einladungNote, setEinladungNote] = useState<string | null>(null);
  // Zwei-Schritt-Rückfrage fürs Token-Wechseln – das ist nicht umkehrbar.
  const [rotateAsk, setRotateAsk] = useState<string | null>(null);
  const [rotateNote, setRotateNote] = useState<string | null>(null);
  // Getippte Adressen, bis sie gespeichert sind.
  const [emailDraft, setEmailDraft] = useState<Record<string, string>>({});
  // Dasselbe fürs Passwort vor den persönlichen Bereichen. Es kommt nie
  // vom Hub zurück, also steht hier immer nur das frisch Getippte.
  const [areaDraft, setAreaDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setError(null);
    // Der Bildschirm zeigt Fehler selbst an - deshalb «still».
    hub
      .get<HubUser[]>('/api/users', { still: true })
      .then(setUsers)
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));
  }, [hub]);

  useEffect(load, [load]);

  const openDetail = async (user: HubUser) => {
    setDetail(user);
    setPairing(null);
    // Der Weg, den diese Person schon einmal gegangen ist, steht offen.
    setWeg(ersterWeg(user.email));
    setEinladungPass('');
    setEinladungNote(null);
    // Eine offene Einladung gehört gezeigt, nicht verschwiegen: Sonst
    // stellt man eine zweite aus und wundert sich, warum die erste tot
    // ist.
    setEinladung(null);
    hub
      .get<{ open: boolean; link?: string; expires?: number }>(
        `/api/users/${encodeURIComponent(user.name)}/einladung`,
        { still: true, fallback: { open: false } }
      )
      .then((offen) => {
        if (offen?.open && offen.link) {
          setEinladung({ link: offen.link, expires: Number(offen.expires) || 0 });
        }
      })
      .catch(() => {});
    try {
      const body = await hub.get<{ payload: string }>(
        `/api/users/${encodeURIComponent(user.name)}/pairing`,
        { still: true }
      );
      setPairing(body.payload);
    } catch (err) {
      setError(
        `Kopplungs-Code nicht abrufbar (${err instanceof Error ? err.message : err})`
      );
    }
  };

  const patchUser = async (name: string, body: Record<string, unknown>) => {
    setError(null);
    try {
      const response = await fetch(
        `${settings.url}/api/users/${encodeURIComponent(name)}`,
        {
          method: 'PUT',
          headers: { ...headers, 'Content-Type': 'application/json' },
          body: JSON.stringify(body),
        }
      );
      const payload = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(payload?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      if (payload?.user) setDetail(payload.user);
      load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    if (newPassword.trim() && newPassword.trim().length < 8) {
      setError('Das Initialpasswort braucht mindestens acht Zeichen.');
      return;
    }
    setError(null);
    try {
      const response = await fetch(`${settings.url}/api/users`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          role: newRole,
          features: newRole === 'gast' ? newFeatures : [],
          // Ein Kind ist ein Mensch, kein Wandtablet - die Wahl steht
          // für diese Rolle gar nicht erst da, also darf auch kein
          // liegengebliebener Schalter aus einer anderen Rolle mit.
          shared: eineZimmerwahl(newRole) ? false : newShared,
          ...(newPassword.trim() ? { password: newPassword.trim() } : {}),
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      setNewName('');
      setNewPassword('');
      setNewShared(false);
      setCreating(false);
      load();
      // Direkt die Detailansicht mit dem QR-Code öffnen – so lässt sich das
      // neue Mitglied sofort koppeln.
      openDetail(body.user);
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  const remove = async (name: string) => {
    setError(null);
    try {
      const response = await fetch(
        `${settings.url}/api/users/${encodeURIComponent(name)}`,
        { method: 'DELETE', headers }
      );
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      setConfirmDelete(null);
      setDetail(null);
      load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  const toggleNewFeature = (feature: string) =>
    setNewFeatures((current) =>
      current.includes(feature)
        ? current.filter((entry) => entry !== feature)
        : [...current, feature]
    );

  return (
    <View style={styles.stack}>
      <Text style={styles.title}>Benutzerverwaltung</Text>
      <Text style={styles.intro}>
        Benutzer antippen zeigt den Kopplungs-QR-Code. Gäste lassen sich auf
        Bereiche einschränken und jederzeit sperren – ohne neues Token.
      </Text>

      {users === null && !error ? <Umriss was="Benutzer" zeilen={3} hoehe={72} /> : null}
      {error ? <Fehlschlag text={error} onRetry={load} /> : null}

      {/* Nach Gruppen statt in einer Liste: Die Liste wächst nur in eine
          Richtung - jeder Babysitter, der einmal einen Abend hereindurfte,
          bleibt darin stehen. Die Frage hier ist fast nie «wer heisst
          wie», sondern «wer kommt eigentlich alles herein?».
          Die Einteilung steht in lib/benutzergruppen.ts. */}
      {gruppiereZugaenge(users ?? []).map((gruppe) => (
        <Abschnitt key={gruppe.key} titel={gruppe.titel} hinweis={gruppe.hinweis}>
          {gruppe.eintraege.map((user) => (
            <Card key={user.name} style={styles.userCard} onPress={() => openDetail(user)}>
              <View style={[styles.avatar, user.enabled === false && styles.avatarDisabled]}>
                {/* Ein Gerät bekommt kein Initial, sondern ein Sinnbild -
                    «F» für den Flur sähe aus wie eine Person namens F. */}
                {user.shared ? (
                  <Ionicons name="tablet-landscape-outline" size={20} color="#FFFFFF" />
                ) : (
                  <Text style={styles.avatarText}>
                    {user.name.slice(0, 1).toUpperCase()}
                  </Text>
                )}
              </View>
              <View style={{ flex: 1 }}>
                <Text style={styles.userName}>
                  {user.name}
                  {currentUser?.name === user.name ? '  (du)' : ''}
                </Text>
                <Text style={styles.userRole}>
                  {ROLE_LABELS[user.role] ?? user.role}
                  {user.role === 'gast' && (user.features?.length ?? 0) > 0
                    ? ` · ${user.features!.map((f) => FEATURE_LABELS[f] ?? f).join(', ')}`
                    : ''}
                  {!user.editable ? ' · aus config.yaml' : ''}
                </Text>
              </View>
              {user.enabled === false ? (
                <View style={styles.disabledBadge}>
                  <Text style={styles.disabledBadgeText}>Deaktiviert</Text>
                </View>
              ) : (
                <Ionicons name="qr-code-outline" size={20} color={colors.inkFaint} />
              )}
            </Card>
          ))}
        </Abschnitt>
      ))}

      {creating ? (
        <Card style={styles.form}>
          <Text style={styles.formLabel}>Name</Text>
          <TextInput
            style={styles.input}
            value={newName}
            onChangeText={setNewName}
            placeholder="z.B. Anna"
            placeholderTextColor={colors.inkFaint}
            autoFocus
          />
          <Text style={styles.formLabel}>Rolle</Text>
          <View style={styles.roleRow}>
            {Object.keys(ROLE_LABELS).map((role) => (
              <Pressable
                key={role}
                onPress={() => setNewRole(role)}
                accessibilityRole="radio"
                accessibilityState={{ selected: newRole === role }}
                style={[styles.roleChip, newRole === role && styles.roleChipActive]}
              >
                <Text
                  style={[styles.roleChipText, newRole === role && styles.roleChipTextActive]}
                >
                  {ROLE_LABELS[role]}
                </Text>
              </Pressable>
            ))}
          </View>
          <Text style={styles.roleHint}>{ROLE_HINTS[newRole]}</Text>
          <Text style={styles.formLabel}>Initialpasswort (optional)</Text>
          <TextInput
            style={styles.input}
            value={newPassword}
            onChangeText={setNewPassword}
            placeholder="mindestens acht Zeichen"
            placeholderTextColor={colors.inkFaint}
            secureTextEntry
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.roleHint}>
            Damit meldet sich die Person unter «Anmelden» mit ihrem Namen an
            und muss beim ersten Mal ein eigenes Passwort setzen. Ohne
            Initialpasswort bleibt es beim QR-Code oder der Einladung.
          </Text>
          {/* Ein Zugang, den alle benutzen: das Wandtablet im Flur, das
              Küchendisplay. Gleich beim Anlegen, nicht erst hinterher -
              sonst brummt die erste Nachricht schon an der Wand. Nicht
              für Kinder: Ein Kind ist ein Mensch, kein Gerät im Flur. */}
          {newRole !== 'gast' && !eineZimmerwahl(newRole) ? (
            <>
              <Text style={styles.formLabel}>Art des Zugangs</Text>
              <View style={styles.roleRow}>
                {[
                  { key: false, label: 'Person' },
                  { key: true, label: 'Gemeinschaftsgerät' },
                ].map((art) => (
                  <Pressable
                    key={String(art.key)}
                    onPress={() => setNewShared(art.key)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: newShared === art.key }}
                    style={[styles.roleChip, newShared === art.key && styles.roleChipActive]}
                  >
                    <Text
                      style={[
                        styles.roleChipText,
                        newShared === art.key && styles.roleChipTextActive,
                      ]}
                    >
                      {art.label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              {newShared ? (
                <Text style={styles.roleHint}>
                  Bedient das Haus wie ein Bewohner und bekommt auch die
                  Nachrichten – an der Wand im Flur sind sie am richtigen
                  Ort. Anders ist: Die App begrüsst niemanden mit Namen,
                  das Gerät bleibt angemeldet, es dunkelt nachts ab, und
                  zum Entschärfen der Alarmanlage braucht es die PIN.
                  Persönliche Bereiche lassen sich mit einem Passwort
                  abriegeln – das nach dem Anlegen unten beim Benutzer.
                </Text>
              ) : null}
            </>
          ) : null}
          {newRole === 'gast' ? (
            <>
              <Text style={styles.formLabel}>Darf sehen und bedienen</Text>
              <FeatureChips
                selected={newFeatures}
                onToggle={toggleNewFeature}
                styles={styles}
              />
            </>
          ) : null}
          <View style={styles.formButtons}>
            <Pressable onPress={() => setCreating(false)} style={styles.smallButton}>
              <Text style={styles.smallButtonText}>Abbrechen</Text>
            </Pressable>
            <Pressable
              onPress={create}
              style={[styles.smallButton, styles.primaryButton]}
              disabled={!newName.trim()}
            >
              <Text style={styles.primaryButtonText}>Anlegen</Text>
            </Pressable>
          </View>
        </Card>
      ) : (
        <Pressable onPress={() => setCreating(true)} style={styles.newButton}>
          <Ionicons name="person-add-outline" size={18} color={colors.ink} />
          <Text style={styles.newButtonText}>Benutzer anlegen</Text>
        </Pressable>
      )}

      {/* Beides gehört zum Besuch und nicht zur Verwaltung der Konten:
          die Türe für den einen Moment und das Netz für den Abend. Sie
          standen als zwei weitere gleich aussehende Karten am Ende der
          Liste - unter einer Überschrift sagen sie, wofür es sie gibt. */}
      <Abschnitt
        titel="Für Besuch ohne Zugang"
        hinweis="Wer kein Konto braucht, kommt so herein."
      >
        <DoorPass settings={settings} headers={headers} entities={entities} />
        <GaesteWlanKarte
          settings={settings}
          headers={headers}
          canConfigure={currentUser?.role === 'besitzer'}
        />
      </Abschnitt>

      {/* Detail: QR-Code, Sperren, Bereiche, Löschen */}
      <Modal
        visible={detail !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDetail(null)}
      >
        {/* E-Mail-Adresse, Einladungspasswort und Bereichs-PIN werden hier
            getippt - ohne das läge die Tastatur auf dem jeweiligen Feld
            (Punkt 265 der Werkbank). */}
        <Tastaturplatz>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <ScrollView
              contentContainerStyle={styles.modalContent}
              keyboardShouldPersistTaps="handled"
            >
              {detail ? (
                <>
                  <View style={styles.modalHead}>
                    <Text style={styles.modalTitle}>{detail.name}</Text>
                    <Pressable onPress={() => setDetail(null)} accessibilityLabel="Schliessen">
                      <Ionicons name="close" size={26} color={colors.ink} />
                    </Pressable>
                  </View>
                  <Text style={styles.userRole}>
                    {ROLE_LABELS[detail.role] ?? detail.role}
                    {!detail.editable ? ' · aus config.yaml' : ''}
                  </Text>

                  {/* Die Rolle ändern, ohne den Zugang neu auszustellen.
                      Vorher stand sie beim Anlegen fest: Wer einen
                      Mitbewohner versehentlich als Gast eingeladen hatte,
                      musste ihn löschen und neu einladen - mit neuem
                      Token auf jedem seiner Geräte. Die Schranken dazu
                      stehen in lib/rollenwahl.ts und noch einmal im Hub. */}
                  {(() => {
                    const urteil = darfRolleAendern(
                      detail,
                      currentUser?.name,
                      besitzerZahl(users ?? [])
                    );
                    return (
                      <View style={styles.rotateBox}>
                        <Text style={styles.formLabel}>Rolle</Text>
                        <View style={styles.roleRow}>
                          {Object.keys(ROLE_LABELS).map((role) => {
                            const aktiv = detail.role === role;
                            return (
                              <Pressable
                                key={role}
                                onPress={
                                  urteil.erlaubt && !aktiv
                                    ? () => patchUser(detail.name, { role })
                                    : undefined
                                }
                                accessibilityRole="radio"
                                accessibilityState={{
                                  selected: aktiv,
                                  disabled: !urteil.erlaubt,
                                }}
                                accessibilityLabel={`${detail.name}: ${ROLE_LABELS[role]}`}
                                style={[
                                  styles.roleChip,
                                  aktiv && styles.roleChipActive,
                                  !urteil.erlaubt && !aktiv && { opacity: 0.4 },
                                ]}
                              >
                                <Text
                                  style={[
                                    styles.roleChipText,
                                    aktiv && styles.roleChipTextActive,
                                  ]}
                                >
                                  {ROLE_LABELS[role]}
                                </Text>
                              </Pressable>
                            );
                          })}
                        </View>
                        <Text style={styles.roleHint}>
                          {urteil.grund ?? ROLE_HINTS[detail.role]}
                        </Text>
                      </View>
                    );
                  })()}

                  {detail.enabled === false ? (
                    <Text style={styles.disabledNote}>
                      Deaktiviert – die Anmeldung ist gesperrt, das Token bleibt
                      gültig und funktioniert nach dem Aktivieren sofort wieder.
                    </Text>
                  ) : null}

                  {/* Drei Wege, aber eine Frage: Wie kommt diese Person in
                      ihre App? Sie standen alle drei ausgeklappt
                      untereinander - QR-Code, Link, E-Mail - und füllten
                      zusammen anderthalb Bildschirme, obwohl man immer nur
                      einen davon geht. Jetzt wählt man den Weg und sieht
                      nur ihn. */}
                  <View style={styles.rotateBox}>
                    <Text style={styles.formLabel}>Zugang einrichten</Text>
                    <View style={styles.roleRow}>
                      {WEGE.map((eintrag) => {
                        const aktiv = weg === eintrag.key;
                        return (
                          <Pressable
                            key={eintrag.key}
                            onPress={() => setWeg(eintrag.key)}
                            accessibilityRole="radio"
                            accessibilityState={{ selected: aktiv }}
                            style={[styles.roleChip, aktiv && styles.roleChipActive]}
                          >
                            <Text
                              style={[
                                styles.roleChipText,
                                aktiv && styles.roleChipTextActive,
                              ]}
                            >
                              {eintrag.label}
                            </Text>
                          </Pressable>
                        );
                      })}
                    </View>

                    {weg === 'qr' ? (
                      <>
                      <View style={styles.qrBox}>
                        {pairing ? (
                          <QRCode value={pairing} size={220} backgroundColor="#FFFFFF" />
                        ) : (
                          <Text style={styles.note}>Kopplungs-Code wird geladen …</Text>
                        )}
                      </View>
                      <Text style={styles.qrHint}>
                        In der HomePilot-App der Person: «QR-Code vom Hub scannen» –
                        Verbindung und Token werden automatisch übernommen.
                      </Text>
                      </>
                    ) : null}

                    {weg === 'link' ? (
                      <>
                      {/* Wer nicht danebensteht, kann keinen QR-Code
                          scannen. Früher ging dafür der Kopplungstext
                          als Nachricht raus – und der *ist* der
                          Schlüssel zum Haus. Ein Schlüssel, der einmal in
                          einem Chat liegt, liegt dort für immer: in der
                          Sicherung des Telefons, in der Wolke des
                          Anbieters, in der Vorschau auf dem
                          Sperrbildschirm. Jetzt reisen zwei Teile
                          getrennt: ein Link, der allein nichts öffnet,
                          und ein Passwort, das man durchgibt. */}
                        {einladung ? (
                          <>
                            <Text style={styles.qrHint}>
                              Der Link gilt einmal und läuft{' '}
                              {einladungFrist(einladung.expires, new Date())} ab.
                              Das Passwort gibst du auf einem anderen Weg durch –
                              am Telefon oder persönlich, nicht im selben Chat.
                            </Text>
                            <Text style={styles.linkText} selectable>
                              {einladung.link}
                            </Text>
                            <Pressable
                              onPress={() => {
                                Share.share({
                                  message:
                                    `Zugang zu unserem HomePilot für ${detail.name}:\n\n` +
                                    `${einladung.link}\n\n` +
                                    'Das Passwort bekommst du von mir separat.',
                                  // Abgebrochenes Teilen ist eine
                                  // Entscheidung, kein Fehler.
                                }).catch(() => {});
                              }}
                              accessibilityRole="button"
                              style={({ pressed }) => [
                                styles.shareButton,
                                pressed && { opacity: 0.8 },
                              ]}
                            >
                              <Ionicons name="share-outline" size={17} color={colors.ink} />
                              <Text style={styles.shareButtonText}>Link senden</Text>
                            </Pressable>
                            <Pressable
                              onPress={async () => {
                                await hub
                                  .del(`/api/users/${encodeURIComponent(detail.name)}/einladung`, {
                                    still: true,
                                  })
                                  .catch(() => {});
                                setEinladung(null);
                                setEinladungNote('Einladung zurückgezogen.');
                              }}
                              accessibilityRole="button"
                              style={({ pressed }) => [
                                styles.rotateButton,
                                pressed && { opacity: 0.7 },
                              ]}
                            >
                              <Ionicons name="close" size={15} color={colors.ink} />
                              <Text style={styles.rotateText}>Einladung zurückziehen</Text>
                            </Pressable>
                          </>
                        ) : (
                          <>
                            <Text style={styles.qrHint}>
                              Leg ein Passwort fest. Der Link allein öffnet nichts –
                              erst beide zusammen geben den Zugang frei.
                            </Text>
                            <TextInput
                              value={einladungPass}
                              onChangeText={setEinladungPass}
                              placeholder="Passwort (mind. 6 Zeichen)"
                              placeholderTextColor={colors.inkFaint}
                              autoCapitalize="none"
                              style={styles.input}
                            />
                            <Pressable
                              onPress={async () => {
                                setEinladungNote(null);
                                try {
                                  const antwort = await hub.post<{
                                    link: string;
                                    expires: number;
                                  }>(
                                    `/api/users/${encodeURIComponent(detail.name)}/einladung`,
                                    { password: einladungPass }
                                  );
                                  setEinladung(antwort);
                                  setEinladungPass('');
                                } catch (err) {
                                  setEinladungNote(
                                    String(err instanceof Error ? err.message : err)
                                  );
                                }
                              }}
                              accessibilityRole="button"
                              style={({ pressed }) => [
                                styles.shareButton,
                                pressed && { opacity: 0.8 },
                              ]}
                            >
                              <Ionicons name="link-outline" size={17} color={colors.ink} />
                              <Text style={styles.shareButtonText}>Einladung erstellen</Text>
                            </Pressable>
                          </>
                        )}
                        {einladungNote ? (
                          <Text style={styles.qrHint}>{einladungNote}</Text>
                        ) : null}
                      </>
                    ) : null}

                    {weg === 'mail' ? (
                      <>
                    <Text style={styles.qrHint}>
                      Erst die Adresse eintragen, dann einladen. Die Person
                      bekommt eine E-Mail, setzt darin ihr Passwort und meldet
                      sich danach ohne QR-Code an. Selbst anlegen kann sich
                      niemand ein Konto – der Weg führt immer über diesen Knopf.
                    </Text>
                    <TextInput
                      style={styles.input}
                      value={emailDraft[detail.name] ?? detail.email ?? ''}
                      onChangeText={(value) =>
                        setEmailDraft((prev) => ({ ...prev, [detail.name]: value }))
                      }
                      placeholder="name@example.ch"
                      placeholderTextColor={colors.inkFaint}
                      autoCapitalize="none"
                      autoCorrect={false}
                      keyboardType="email-address"
                    />
                    <Pressable
                      onPress={async () => {
                        const value = (emailDraft[detail.name] ?? detail.email ?? '').trim();
                        try {
                          const response = await fetch(
                            `${settings.url}/api/users/${encodeURIComponent(
                              detail.name
                            )}/email`,
                            {
                              method: 'PUT',
                              headers: { ...headers, 'Content-Type': 'application/json' },
                              body: JSON.stringify({ email: value || null }),
                            }
                          );
                          const body = await response.json();
                          if (!response.ok) throw new Error(body.detail ?? 'Fehlgeschlagen');
                          setRotateNote(
                            value
                              ? `${value} gespeichert. Jetzt einladen.`
                              : 'Adresse entfernt.'
                          );
                          load();
                        } catch (err) {
                          setRotateNote(String(err instanceof Error ? err.message : err));
                        }
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.rotateButton, pressed && { opacity: 0.7 }]}
                    >
                      <Ionicons name="mail-outline" size={15} color={colors.ink} />
                      <Text style={styles.rotateText}>Adresse speichern</Text>
                    </Pressable>
                    <Pressable
                      onPress={async () => {
                        setRotateNote('Einladung geht raus …');
                        try {
                          const response = await fetch(
                            `${settings.url}/api/users/${encodeURIComponent(
                              detail.name
                            )}/invite`,
                            { method: 'POST', headers }
                          );
                          const body = await response.json();
                          if (!response.ok) throw new Error(body.detail ?? 'Fehlgeschlagen');
                          setRotateNote(body.message ?? 'Einladung verschickt.');
                        } catch (err) {
                          setRotateNote(String(err instanceof Error ? err.message : err));
                        }
                      }}
                      disabled={!detail.email}
                      accessibilityRole="button"
                      style={({ pressed }) => [
                        styles.rotateButton,
                        (pressed || !detail.email) && { opacity: 0.6 },
                      ]}
                    >
                      <Ionicons name="paper-plane-outline" size={15} color={colors.ink} />
                      <Text style={styles.rotateText}>
                        {detail.email ? 'Einladung schicken' : 'Zuerst Adresse speichern'}
                      </Text>
                    </Pressable>
                      </>
                    ) : null}
                  </View>


                  {/* Ab hier: alles, was man selten braucht und nie
                      gleichzeitig. Es stand ausgeklappt untereinander und
                      war der Grund, warum diese Seite eine Wand war.
                      Zugeklappt beantwortet der Kopf die Frage, mit der
                      man kommt - siehe lib/benutzerblatt.ts. */}
                  {/* Nicht bei Kindern: Ein Kind ist ein Mensch, kein
                      Wandtablet - die Wahl wäre tote Bedienung. */}
                  {detail.editable && !eineZimmerwahl(detail.role) ? (
                    <Klappe
                      label="Art des Zugangs"
                      stand={artStand(detail.shared)}
                      zuBeginnZu
                    >
                      <Text style={styles.formHint}>
                        Für das Wandtablet im Flur oder das Küchendisplay:
                        ein Zugang, den alle benutzen, keine Person.
                        Nachrichten bekommt es wie jeder andere. Anders
                        ist: keine Begrüssung mit Namen, kein Abmelden und
                        kein Sitzungsablauf, nachts wird der Bildschirm
                        dunkler, und zum Entschärfen der Alarmanlage ist
                        die PIN Pflicht – auch dann, wenn sonst keine
                        verlangt wird.
                      </Text>
                      <Pressable
                        onPress={() =>
                          patchUser(detail.name, { shared: !detail.shared })
                        }
                        accessibilityRole="switch"
                        accessibilityState={{ checked: !!detail.shared }}
                        style={[
                          styles.roleChip,
                          detail.shared && styles.roleChipActive,
                          { alignSelf: 'flex-start' },
                        ]}
                      >
                        <Text
                          style={[
                            styles.roleChipText,
                            detail.shared && styles.roleChipTextActive,
                          ]}
                        >
                          {detail.shared ? 'Gemeinschaftsgerät' : 'Persönlicher Zugang'}
                        </Text>
                      </Pressable>

                    </Klappe>
                  ) : null}

                  {detail.editable ? (
                    <Klappe
                      label="Zugang beschränken"
                      stand={zugangStand(detail.expires, detail.hours, detail.days)}
                      zuBeginnZu
                    >
                    <AccessLimits
                      detail={detail}
                      styles={styles}
                      colors={colors}
                      onChange={(patch) => patchUser(detail.name, patch)}
                    />
                    </Klappe>
                  ) : null}

                      {/* Der Riegel vor den persönlichen Bereichen. Fürs
                          Wandtablet gedacht - Licht und Storen bedient
                          jeder, der vorbeigeht, die Einkaufsliste und der
                          Kalender der Familie sollen aber nicht offen im
                          Flur stehen. Er hält an aufgestellten Geräten
                          (Panel oder Gemeinschaftsgerät) zu, solange der
                          Besuch- oder Babysitter-Modus läuft; warum,
                          steht in lib/bereichsriegel.ts. Nicht bei
                          Kindern: Deren Gerät ist keines, das offen im
                          Flur steht. */}
                  {detail.editable && !eineZimmerwahl(detail.role) ? (
                    <Klappe
                      label="Riegel vor Familie & Konto"
                      stand={sichtschutzStand(detail.area_locked)}
                      zuBeginnZu
                    >
                      <Text style={styles.formHint}>
                        {detail.area_locked
                          ? 'Gesetzt. Gefragt wird nur am Wandpanel und an Gemeinschaftsgeräten und nur, solange der Besuch- oder Babysitter-Modus läuft: Familie, Kalender und Nachrichten sind dann verriegelt, Licht, Storen und Alarm bleiben frei. Ein neues Passwort ersetzt das alte, leer speichern nimmt den Riegel weg.'
                          : 'Kein Riegel: Am Wandtablet steht auch mit Besuch alles offen. Mindestens 4 Zeichen; auch eine Zahlenfolge ist erlaubt, am Wandtablet tippt man auf Glas.'}
                      </Text>
                      <TextInput
                        style={styles.input}
                        value={areaDraft[detail.name] ?? ''}
                        onChangeText={(value) =>
                          setAreaDraft((prev) => ({ ...prev, [detail.name]: value }))
                        }
                        placeholder={detail.area_locked ? 'Neues Passwort' : 'z. B. 2580'}
                        placeholderTextColor={colors.inkFaint}
                        autoCapitalize="none"
                        autoCorrect={false}
                        secureTextEntry
                      />
                      <View style={styles.formButtons}>
                        <Pressable
                          onPress={async () => {
                            const value = areaDraft[detail.name] ?? '';
                            await patchUser(detail.name, { area_password: value });
                            setAreaDraft((prev) => ({ ...prev, [detail.name]: '' }));
                          }}
                          accessibilityRole="button"
                          style={({ pressed }) => [
                            styles.rotateButton,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Ionicons name="lock-closed-outline" size={15} color={colors.ink} />
                          <Text style={styles.rotateText}>Passwort speichern</Text>
                        </Pressable>
                        {detail.area_locked ? (
                          <Pressable
                            onPress={async () => {
                              await patchUser(detail.name, { area_password: '' });
                              setAreaDraft((prev) => ({ ...prev, [detail.name]: '' }));
                            }}
                            accessibilityRole="button"
                            style={({ pressed }) => [
                              styles.rotateButton,
                              pressed && { opacity: 0.7 },
                            ]}
                          >
                            <Ionicons name="lock-open-outline" size={15} color={colors.ink} />
                            <Text style={styles.rotateText}>Riegel entfernen</Text>
                          </Pressable>
                        ) : null}
                      </View>
                    </Klappe>
                  ) : null}

                  {/* Punkt 245 der Werkbank: Bei Kindern spiegelt der
                      Hub Schranke (rooms) und Kinder-Ansicht
                      (simple_rooms) füreinander - zwei getrennte
                      Klappen wären tote Bedienung, das Antippen der
                      einen änderte still die andere. Kinder bekommen
                      darum unten EINE Zimmerwahl. */}
                  {detail.editable && eineZimmerwahl(detail.role) ? (
                    <Klappe
                      label="Zimmer"
                      stand={reichweiteStand(detail.simple_rooms)}
                      zuBeginnZu
                    >
                      <Text style={styles.formHint}>
                        Angetippte Zimmer sind die Welt dieses Kindes:
                        Es sieht sie als grosse Knöpfe (Kinder-Ansicht)
                        und kann auch nur dort schalten – alles andere
                        weist der Hub ab. Eine Wahl für beides; nichts
                        angetippt heisst ganzes Haus mit normaler App.
                      </Text>
                      <View style={styles.roleRow}>
                        {roomNames.map((room) => {
                          const active = (detail.simple_rooms ?? []).includes(room);
                          return (
                            <Pressable
                              key={room}
                              onPress={() => {
                                const current = detail.simple_rooms ?? [];
                                const next = active
                                  ? current.filter((entry) => entry !== room)
                                  : [...current, room];
                                // Beide Felder mit derselben Liste -
                                // warum, steht in lib/rollenwahl.ts.
                                patchUser(detail.name, zimmerPatch(next));
                              }}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: active }}
                              accessibilityLabel={`Zimmer ${room} für ${detail.name}`}
                              style={[styles.roleChip, active && styles.roleChipActive]}
                            >
                              <Text
                                style={[
                                  styles.roleChipText,
                                  active && styles.roleChipTextActive,
                                ]}
                              >
                                {room}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </Klappe>
                  ) : null}

                  {detail.editable && !eineZimmerwahl(detail.role) ? (
                    <Klappe
                      label="Reicht bis"
                      stand={reichweiteStand(detail.rooms)}
                      zuBeginnZu
                    >
                      <Text style={styles.formHint}>
                        Angetippte Räume sind die einzigen, die diese Person
                        sieht und schaltet – alles andere weist der Hub ab,
                        auch am Ende einer Leitung, die an der App vorbeigeht.
                        Nichts angetippt = ganzes Haus.
                      </Text>
                      <Text style={styles.formHint}>
                        Anders als die Kinder-Ansicht darunter: Die räumt den
                        Rest der Wohnung aus dem Bild, nicht aus der
                        Reichweite. Geräte ohne Raum – Stromzähler,
                        Anwesenheit – fallen mit heraus.
                      </Text>
                      <View style={styles.roleRow}>
                        {roomNames.map((room) => {
                          const active = (detail.rooms ?? []).includes(room);
                          return (
                            <Pressable
                              key={room}
                              onPress={() => {
                                const current = detail.rooms ?? [];
                                const next = active
                                  ? current.filter((entry) => entry !== room)
                                  : [...current, room];
                                patchUser(detail.name, { rooms: next });
                              }}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: active }}
                              style={[styles.roleChip, active && styles.roleChipActive]}
                            >
                              <Text
                                style={[
                                  styles.roleChipText,
                                  active && styles.roleChipTextActive,
                                ]}
                              >
                                {room}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </Klappe>
                  ) : null}

                  {detail.editable && !eineZimmerwahl(detail.role) ? (
                    <Klappe
                      label="Kinder-Ansicht"
                      stand={kinderStand(detail.simple_rooms)}
                      zuBeginnZu
                    >
                      <Text style={styles.formHint}>
                        Angetippte Räume erscheinen dieser Person als grosse
                        Knöpfe - ohne Einstellungen, Alarm und den Rest der
                        Wohnung. Nichts angetippt = normale App.
                      </Text>
                      <View style={styles.roleRow}>
                        {roomNames.map((room) => {
                          const active = (detail.simple_rooms ?? []).includes(room);
                          return (
                            <Pressable
                              key={room}
                              onPress={() => {
                                const current = detail.simple_rooms ?? [];
                                const next = active
                                  ? current.filter((entry) => entry !== room)
                                  : [...current, room];
                                patchUser(detail.name, { simple_rooms: next });
                              }}
                              accessibilityRole="checkbox"
                              accessibilityState={{ checked: active }}
                              style={[styles.roleChip, active && styles.roleChipActive]}
                            >
                              <Text
                                style={[
                                  styles.roleChipText,
                                  active && styles.roleChipTextActive,
                                ]}
                              >
                                {room}
                              </Text>
                            </Pressable>
                          );
                        })}
                      </View>
                    </Klappe>
                  ) : null}

                  {detail.editable ? (
                    <Klappe label="Token erneuern">
                      <Text style={styles.qrHint}>
                        Ist das Token irgendwo gelandet, wo es nicht hingehört –
                        Screenshot, Chat, verlorenes Telefon –, hier ein neues
                        ausstellen. Das alte gilt sofort nicht mehr; die App
                        dieser Person muss den QR-Code neu scannen.
                      </Text>
                      <Pressable
                        onPress={async () => {
                          if (rotateAsk !== detail.name) {
                            setRotateAsk(detail.name);
                            return;
                          }
                          setRotateAsk(null);
                          try {
                            const response = await fetch(
                              `${settings.url}/api/users/${encodeURIComponent(
                                detail.name
                              )}/token`,
                              { method: 'POST', headers }
                            );
                            const body = await response.json();
                            if (!response.ok) throw new Error(body.detail ?? 'Fehlgeschlagen');
                            setPairing(body.payload ?? null);
                            setRotateNote(
                              body.self
                                ? 'Neues Token gesetzt – deine eigene Verbindung ist jetzt ungültig. QR-Code neu scannen.'
                                : 'Neues Token gesetzt. Der QR-Code oben zeigt bereits das neue.'
                            );
                          } catch (err) {
                            setRotateNote(String(err instanceof Error ? err.message : err));
                          }
                        }}
                        accessibilityRole="button"
                        style={({ pressed }) => [
                          styles.rotateButton,
                          rotateAsk === detail.name && { borderColor: colors.danger },
                          pressed && { opacity: 0.7 },
                        ]}
                      >
                        <Ionicons
                          name="refresh-outline"
                          size={15}
                          color={rotateAsk === detail.name ? colors.danger : colors.ink}
                        />
                        <Text
                          style={[
                            styles.rotateText,
                            rotateAsk === detail.name && { color: colors.danger },
                          ]}
                        >
                          {rotateAsk === detail.name
                            ? 'Wirklich? Altes Token wird ungültig'
                            : 'Neues Token ausstellen'}
                        </Text>
                      </Pressable>
                      {rotateNote ? (
                        <Text style={styles.qrHint}>{rotateNote}</Text>
                      ) : null}
                    </Klappe>
                  ) : null}

                  {detail.editable && detail.role === 'gast' ? (
                    <>
                      <Text style={styles.formLabel}>Darf sehen und bedienen</Text>
                      <FeatureChips
                        selected={detail.features ?? []}
                        onToggle={(feature) => {
                          const current = detail.features ?? [];
                          const next = current.includes(feature)
                            ? current.filter((entry) => entry !== feature)
                            : [...current, feature];
                          patchUser(detail.name, { features: next });
                        }}
                        styles={styles}
                      />
                    </>
                  ) : null}

                  {detail.editable && currentUser?.name !== detail.name ? (
                    <View style={styles.modalButtons}>
                      <Pressable
                        onPress={() =>
                          patchUser(detail.name, { enabled: detail.enabled === false })
                        }
                        style={[styles.smallButton, { flex: 1 }]}
                      >
                        <Text style={styles.smallButtonText}>
                          {detail.enabled === false ? 'Aktivieren' : 'Deaktivieren'}
                        </Text>
                      </Pressable>
                      <Pressable
                        onPress={() =>
                          confirmDelete === detail.name
                            ? remove(detail.name)
                            : setConfirmDelete(detail.name)
                        }
                        style={[styles.smallButton, styles.dangerButton, { flex: 1 }]}
                      >
                        <Text style={styles.dangerButtonText}>
                          {confirmDelete === detail.name ? 'Wirklich löschen' : 'Löschen'}
                        </Text>
                      </Pressable>
                    </View>
                  ) : null}
                </>
              ) : null}
            </ScrollView>
          </View>
        </View>
        </Tastaturplatz>
      </Modal>
    </View>
  );
}

/** Gäste-WLAN als QR-Code - Besuch scannt mit der Kamera, fertig.

    Kommt aus der config.yaml (guest_wifi). Ohne Eintrag erscheint die
    Karte gar nicht - besser keine Karte als eine leere. */
/** Ein WLAN-Gutschein, wie /api/wifi/vouchers ihn führt. */

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
    stack: { gap: space.gap },
    title: { color: colors.onGradient, fontSize: 18, fontWeight: '700' },
    cardTitle: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
    card: { minHeight: 0, gap: 10 },
    voucherCode: {
      color: colors.ink,
      fontSize: 16,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      letterSpacing: 1,
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
    voucherBig: {
      color: colors.ink,
      fontSize: 28,
      fontWeight: '800',
      fontVariant: ['tabular-nums'],
      letterSpacing: 2,
    },
    voucherChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    voucherChipText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
    voucherChipStark: { backgroundColor: colors.accent, borderColor: colors.accent },
    voucherChipStarkText: { color: '#FFFFFF' },
    intro: { color: colors.onGradientSoft, fontSize: 13, lineHeight: 19, maxWidth: 520 },
    note: { color: colors.inkSoft, fontSize: 14 },
    error: { color: colors.danger, fontSize: 13, fontWeight: '600' },

    userCard: {
      minHeight: 0,
      flexDirection: 'row',
      alignItems: 'center',
      gap: 12,
    },
    avatar: {
      width: 42,
      height: 42,
      borderRadius: 21,
      backgroundColor: colors.accent,
      alignItems: 'center',
      justifyContent: 'center',
    },
    avatarDisabled: { backgroundColor: colors.inkFaint },
    avatarText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700' },
    userName: { color: colors.ink, fontSize: 16, fontWeight: '600' },
    userRole: { color: colors.inkSoft, fontSize: 13, marginTop: 1 },
    disabledBadge: {
      backgroundColor: colors.track,
      borderRadius: radius.pill,
      paddingHorizontal: 10,
      paddingVertical: 4,
    },
    disabledBadgeText: { color: colors.inkFaint, fontSize: 11, fontWeight: '700' },
    disabledNote: { color: colors.inkSoft, fontSize: 13, lineHeight: 19 },

    form: { minHeight: 0, gap: 8 },
    formLabel: { color: colors.inkSoft, fontSize: 12, fontWeight: '700' },
    formHint: { color: colors.inkFaint, fontSize: 12, lineHeight: 17 },
    linkText: {
      color: colors.accent,
      fontSize: 13,
      lineHeight: 19,
      marginTop: 8,
      // Ein Link bricht mitten im Wort um – sonst schiebt er die Karte
      // seitlich hinaus.
      flexShrink: 1,
    },
    input: {
      backgroundColor: colors.surfaceSoft,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      color: colors.ink,
      paddingHorizontal: 12,
      paddingVertical: 10,
      fontSize: 15,
    },
    roleRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
    roleChip: {
      paddingHorizontal: 14,
      paddingVertical: 8,
      borderRadius: radius.pill,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    roleChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    roleChipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    roleChipTextActive: { color: '#FFFFFF' },
    roleHint: { color: colors.inkFaint, fontSize: 12 },
    formButtons: { flexDirection: 'row', gap: 8, justifyContent: 'flex-end' },
    smallButton: {
      paddingHorizontal: 14,
      paddingVertical: 10,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
      alignItems: 'center',
    },
    smallButtonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
    primaryButton: { backgroundColor: colors.accent, borderColor: colors.accent },
    primaryButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },
    dangerButton: { backgroundColor: colors.danger, borderColor: colors.danger },
    dangerButtonText: { color: '#FFFFFF', fontSize: 13, fontWeight: '700' },

    newButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 13,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceStrong,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    newButtonText: { color: colors.ink, fontSize: 15, fontWeight: '600' },

    modalBackdrop: {
      flex: 1,
      backgroundColor: 'rgba(0,0,0,0.45)',
      justifyContent: 'flex-end',
    },
    modalSheet: {
      backgroundColor: colors.panel,
      borderTopLeftRadius: radius.card,
      borderTopRightRadius: radius.card,
      maxHeight: '88%',
    },
    modalContent: { padding: 22, gap: 12 },
    modalHead: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'space-between',
    },
    modalTitle: { color: colors.ink, fontSize: 22, fontWeight: '700' },
    qrBox: {
      alignSelf: 'center',
      backgroundColor: '#FFFFFF',
      padding: 16,
      borderRadius: radius.control,
      marginTop: 6,
    },
    rotateBox: { gap: 8, marginTop: 4 },
    rotateButton: {
      flexDirection: 'row',
      alignItems: 'center',
      alignSelf: 'flex-start',
      gap: 8,
      paddingHorizontal: 14,
      paddingVertical: 9,
      borderRadius: radius.control,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    rotateText: { color: colors.ink, fontSize: 13, fontWeight: '700' },
    expiryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
    expiryChip: {
      paddingHorizontal: 12,
      paddingVertical: 7,
      borderRadius: 999,
      backgroundColor: colors.surfaceSoft,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    expiryChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
    expiryChipText: { color: colors.inkSoft, fontSize: 13, fontWeight: '600' },
    expiryChipTextActive: { color: '#FFFFFF' },
    shareButton: {
      flexDirection: 'row',
      alignItems: 'center',
      justifyContent: 'center',
      gap: 8,
      paddingVertical: 11,
      borderRadius: radius.control,
      borderWidth: 1,
      borderColor: colors.surfaceBorder,
    },
    shareButtonText: { color: colors.ink, fontSize: 14, fontWeight: '600' },
    qrHint: {
      color: colors.inkSoft,
      fontSize: 13,
      lineHeight: 19,
      textAlign: 'center',
    },
    modalButtons: { flexDirection: 'row', gap: 10, marginTop: 6 },
  });
