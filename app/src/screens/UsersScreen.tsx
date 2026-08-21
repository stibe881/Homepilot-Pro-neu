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

import { Entity, HubSettings } from '../api/types';
import { Card } from '../components/Card';
import { DoorPass } from '../components/DoorPass';
import { Fehlschlag, Laedt } from '../components/Zustand';
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

export const ROLE_LABELS: Record<string, string> = {
  besitzer: 'Besitzer',
  bewohner: 'Mitbewohner',
  gast: 'Gast',
};

const ROLE_HINTS: Record<string, string> = {
  besitzer: 'darf alles, auch Benutzer und Konfiguration verwalten',
  bewohner: 'bedient das ganze Haus, darf Abläufe pausieren',
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
  /** Darf diese Person gerade herein? Rechnet Ablauf und Fenster mit. */
  active?: boolean;
  /** Kinder-Ansicht: nur diese Räume, als grosse Knöpfe. */
  simple_rooms?: string[];
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
  detail: { expires?: string | null; hours?: { from?: string; to?: string }; active?: boolean };
  styles: any;
  colors: Colors;
  onChange: (patch: Record<string, any>) => void;
}) {
  const [expires, setExpires] = useState(detail.expires ?? '');
  const [from, setFrom] = useState(detail.hours?.from ?? '');
  const [to, setTo] = useState(detail.hours?.to ?? '');

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
  const [newRole, setNewRole] = useState('bewohner');
  const [newFeatures, setNewFeatures] = useState<string[]>(['licht']);
  const [confirmDelete, setConfirmDelete] = useState<string | null>(null);
  // Detailansicht: gewählter Benutzer + geladene Kopplungs-Daten.
  const [detail, setDetail] = useState<HubUser | null>(null);
  const [pairing, setPairing] = useState<string | null>(null);
  // Zwei-Schritt-Rückfrage fürs Token-Wechseln – das ist nicht umkehrbar.
  const [rotateAsk, setRotateAsk] = useState<string | null>(null);
  const [rotateNote, setRotateNote] = useState<string | null>(null);
  // Getippte Adressen, bis sie gespeichert sind.
  const [emailDraft, setEmailDraft] = useState<Record<string, string>>({});

  const load = useCallback(() => {
    setError(null);
    fetch(`${settings.url}/api/users`, { headers })
      .then((response) => {
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
        return response.json();
      })
      .then(setUsers)
      .catch((err) => setError(String(err.message ?? err)));
  }, [settings.url, headers]);

  useEffect(load, [load]);

  const openDetail = async (user: HubUser) => {
    setDetail(user);
    setPairing(null);
    try {
      const response = await fetch(
        `${settings.url}/api/users/${encodeURIComponent(user.name)}/pairing`,
        { headers }
      );
      if (!response.ok) throw new Error(String(response.status));
      const body = await response.json();
      setPairing(body.payload);
    } catch (err: any) {
      setError(`Kopplungs-Code nicht abrufbar (${err.message ?? err})`);
    }
  };

  const patchUser = async (name: string, body: Record<string, any>) => {
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
    } catch (err: any) {
      setError(String(err.message ?? err));
    }
  };

  const create = async () => {
    if (!newName.trim()) return;
    setError(null);
    try {
      const response = await fetch(`${settings.url}/api/users`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: newName.trim(),
          role: newRole,
          features: newRole === 'gast' ? newFeatures : [],
        }),
      });
      const body = await response.json().catch(() => null);
      if (!response.ok) {
        throw new Error(body?.detail ?? `Hub antwortet mit ${response.status}`);
      }
      setNewName('');
      setCreating(false);
      load();
      // Direkt die Detailansicht mit dem QR-Code öffnen – so lässt sich das
      // neue Mitglied sofort koppeln.
      openDetail(body.user);
    } catch (err: any) {
      setError(String(err.message ?? err));
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
    } catch (err: any) {
      setError(String(err.message ?? err));
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

      {users === null && !error ? <Laedt was="Benutzer" /> : null}
      {error ? <Fehlschlag text={error} onRetry={load} /> : null}

      {(users ?? []).map((user) => (
        <Card key={user.name} style={styles.userCard} onPress={() => openDetail(user)}>
          <View style={[styles.avatar, user.enabled === false && styles.avatarDisabled]}>
            <Text style={styles.avatarText}>{user.name.slice(0, 1).toUpperCase()}</Text>
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

      <DoorPass settings={settings} headers={headers} entities={entities} />

      <GuestWifiCard
        settings={settings}
        headers={headers}
        canConfigure={currentUser?.role === 'besitzer'}
      />

      {/* Detail: QR-Code, Sperren, Bereiche, Löschen */}
      <Modal
        visible={detail !== null}
        animationType="slide"
        transparent
        onRequestClose={() => setDetail(null)}
      >
        <View style={styles.modalBackdrop}>
          <View style={styles.modalSheet}>
            <ScrollView contentContainerStyle={styles.modalContent}>
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

                  {detail.enabled === false ? (
                    <Text style={styles.disabledNote}>
                      Deaktiviert – die Anmeldung ist gesperrt, das Token bleibt
                      gültig und funktioniert nach dem Aktivieren sofort wieder.
                    </Text>
                  ) : (
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
                      {pairing ? (
                        <Pressable
                          onPress={() => {
                            // Wer nicht danebensteht, kann keinen QR-Code
                            // scannen. Derselbe Inhalt als Text, zum
                            // Verschicken - mit dem Ablaufdatum dabei,
                            // damit der Empfänger weiss, woran er ist.
                            const bis = detail.expires
                              ? `\n\nDer Zugang läuft am ${detail.expires} ab.`
                              : '';
                            Share.share({
                              message:
                                `Zugang zu unserem HomePilot für ${detail.name}:\n\n` +
                                `${pairing}\n\n` +
                                'In der HomePilot-App unter «Verbinden» einfügen.' +
                                bis,
                            }).catch(() => {});
                          }}
                          accessibilityRole="button"
                          style={({ pressed }) => [
                            styles.shareButton,
                            pressed && { opacity: 0.8 },
                          ]}
                        >
                          <Ionicons
                            name="share-outline"
                            size={17}
                            color={colors.ink}
                          />
                          <Text style={styles.shareButtonText}>
                            Zugang als Nachricht senden
                          </Text>
                        </Pressable>
                      ) : null}
                      <Text style={styles.qrHint}>
                        Der Text enthält das Token – er ist der Schlüssel zum
                        Haus. Schick ihn einzeln und nicht in eine Gruppe, und
                        setz oben ein Ablaufdatum, wenn der Zugang enden soll.
                      </Text>
                    </>
                  )}

                  <View style={styles.rotateBox}>
                    <Text style={styles.formLabel}>Anmeldung mit E-Mail</Text>
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
                        } catch (err: any) {
                          setRotateNote(String(err.message ?? err));
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
                        } catch (err: any) {
                          setRotateNote(String(err.message ?? err));
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
                  </View>

                  {detail.editable ? (
                    <View style={styles.rotateBox}>
                      <Text style={styles.formLabel}>Token</Text>
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
                          } catch (err: any) {
                            setRotateNote(String(err.message ?? err));
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
                    </View>
                  ) : null}

                  {detail.editable ? (
                    <AccessLimits
                      detail={detail}
                      styles={styles}
                      colors={colors}
                      onChange={(patch) => patchUser(detail.name, patch)}
                    />
                  ) : null}

                  {detail.editable ? (
                    <>
                      <Text style={styles.formLabel}>Kinder-Ansicht</Text>
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
                    </>
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
      </Modal>
    </View>
  );
}

/** Gäste-WLAN als QR-Code - Besuch scannt mit der Kamera, fertig.

    Kommt aus der config.yaml (guest_wifi). Ohne Eintrag erscheint die
    Karte gar nicht - besser keine Karte als eine leere. */
function GuestWifiCard({
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
  const [busy, setBusy] = useState(false);

  const loadVouchers = () => {
    fetch(`${settings.url}/api/wifi/vouchers`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data) setVouchers(data.vouchers ?? []);
      })
      .catch(() => {});
  };

  useEffect(() => {
    fetch(`${settings.url}/api/wifi`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => {
        if (data?.payload) setWifi(data);
      })
      .catch(() => {});
    loadVouchers();
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
      setVoucherNote('In den Vorrat gelegt.');
      loadVouchers();
    } catch (err: any) {
      setVoucherNote(String(err.message ?? err));
    } finally {
      setBusy(false);
    }
  };

  const deleteVoucher = async (id: string) => {
    await fetch(`${settings.url}/api/wifi/vouchers/${encodeURIComponent(id)}`, {
      method: 'DELETE',
      headers,
    }).catch(() => {});
    loadVouchers();
  };

  const durationLabel = (minutes: number) =>
    minutes >= 1440 && minutes % 1440 === 0
      ? `${minutes / 1440} Tag${minutes / 1440 === 1 ? '' : 'e'}`
      : `${Math.round(minutes / 60)} Std.`;

  // Der Spender: Gezeigt wird genau ein Gutschein - der älteste noch
  // nicht eingelöste. Wird er verwendet, rückt beim nächsten Abgleich
  // der nächste nach.
  const fresh = (vouchers ?? [])
    .filter((voucher) => !voucher.used)
    .sort((a, b) => (a.created ?? 0) - (b.created ?? 0));
  const current = fresh[0] ?? null;

  useEffect(() => {
    if (!open || vouchers == null) return;
    // Kurzer Takt mit Absicht: Genau in dem Moment, in dem der Gast den
    // Code eintippt, schaut man auf diese Karte.
    const timer = setInterval(loadVouchers, 8000);
    return () => clearInterval(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, vouchers == null]);

  // Nichts eingerichtet: Für die Besitzerin bzw. den Besitzer steht hier,
  // was fehlt - für alle anderen bleibt die Karte weg. Sich stumm
  // auszublenden war die schlechtere Hälfte davon: Man sucht dann eine
  // Karte, die es gibt, und findet keinen Hinweis, woran es liegt.
  if (!wifi && (vouchers == null || vouchers.length === 0)) {
    if (!canConfigure) return null;
    return (
      <Card style={styles.card}>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 8 }}>
          <Ionicons name="wifi-outline" size={18} color={colors.inkSoft} />
          <Text style={[styles.cardTitle, { flex: 1 }]}>Gäste-WLAN</Text>
        </View>
        <Text style={styles.formHint}>
          Noch nicht eingerichtet. In der config.yaml des Hubs fehlt der
          Abschnitt «guest_wifi» - mit ihm zeigt diese Karte einen QR-Code
          zum Anmelden. Läuft das Gäste-Netz über ein Captive Portal,
          genügt der Netzname; das Netz selbst ist ja offen.
        </Text>
        <Text style={styles.formHint}>
          Für Gutscheine kommt die UniFi-Integration dazu: Der Hub stellt
          sie dann selbst aus, und niemand muss dafür in den Controller.
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

      {open && vouchers != null ? (
        <>
          <Text style={styles.formLabel}>Portal-Gutschein</Text>
          {current ? (
            <View style={styles.voucherBox}>
              <Text style={styles.voucherBig} selectable>
                {current.code}
              </Text>
              <Text style={styles.qrHint}>
                {durationLabel(current.minutes)} ab der ersten Anmeldung
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
            {[
              { hours: 4, label: '4 Std.' },
              { hours: 24, label: '1 Tag' },
              { hours: 72, label: '3 Tage' },
              { hours: 168, label: '1 Woche' },
            ].map((option) => (
              <Pressable
                key={option.hours}
                onPress={() => createVoucher(option.hours)}
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
