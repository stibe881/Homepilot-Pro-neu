import { Ionicons } from '@expo/vector-icons';
import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  AccessibilityInfo,
  Animated,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';

import { CommandData, Entity, KalenderEintrag } from '../api/types';
import { hasOpenDoor, openContacts } from './OpenDoors';
import {
  EinkaufZeile,
  ALLGEMEIN,
  Shop,
  artikelVorschlaege,
  groupForShop,
  mengeUndName,
} from '../lib/einkauf';
import { uhr, wochentagDatum, wochentagUhr } from '../lib/format';
import { tapped } from '../lib/haptics';
import { kann } from '../lib/plattform';
import { ConnectionStatus } from '../hooks/useHub';
import { useEscape } from '../hooks/useEscape';
import { Colors, radius, type, useColors } from '../theme';

const STATUS_LABEL: Record<ConnectionStatus, string> = {
  connected: 'verbunden',
  connecting: 'verbinde …',
  disconnected: 'getrennt',
};

function statusColor(colors: Colors, status: ConnectionStatus): string {
  if (status === 'connected') return colors.on;
  return status === 'connecting' ? colors.warn : colors.danger;
}

/** Der nächste echte Termin – dasselbe Ereignis, das der Hub in
 *  `state.state`/`next_start` zusammenfasst, hier aber mit allem drum
 *  herum (Ort, Ende, ganztägig) für die Detailansicht (rein, testbar). */
export function nextCalendarEvent(calendar: Entity | undefined): KalenderEintrag | null {
  const events: KalenderEintrag[] = Array.isArray(calendar?.state.events) ? calendar!.state.events : [];
  return events.find((event) => !event.birthday) ?? null;
}

/** Routen-Adressen zu einem Termin-Ort (rein, testbar). Beide zeigen die
 *  Route ab dem aktuellen Standort, nicht bloss die Karte des Ziels. */
export function googleMapsRoute(destination: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(destination)}&travelmode=driving`;
}

export function appleMapsRoute(destination: string): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(destination)}&dirflg=d`;
}

/**
 * Kopfzeile: links Messwerte aus dem Haus, rechts Verbindung und Uhrzeit.
 *
 * Gezeigt werden die ersten Sensoren mit passender Einheit – ohne Sensoren
 * bleibt die Zeile leer statt Platzhalter zu erfinden. Die Licht- und die
 * Termin-Kachel lassen sich antippen: Licht zeigt, was genau an ist,
 * Termin den ganzen Eintrag statt nur der Kurzfassung.
 */
export function TopStrip({
  entities,
  status,
  now,
  hidden = [],
  onCommand,
  shopping,
  shops,
  knownItems,
  onShoppingAdd,
  onShoppingDone,
  onShoppingRemove,
  onShoppingCount,
  showClock = false,
  queued = 0,
}: {
  entities: Entity[];
  status: ConnectionStatus;
  now: Date;
  /** Ausgeblendete Geräte – wer eine Lampe aus den Alltagsansichten
   *  verbannt hat, will sie auch hier nicht mitgezählt sehen. */
  hidden?: string[];
  /** Für «Licht aus» direkt aus dem Popup – ohne sie bleibt die Zeile
   *  reine Anzeige. */
  onCommand?: (entityId: string, command: string, data?: CommandData) => void;
  /** Offene Einträge der Einkaufsliste – erledigte sind schon
   *  ausgefiltert, hier zählt nur, was noch fehlt. */
  shopping?: EinkaufZeile[];
  /** Die angelegten Läden (Familie → Einkaufsliste → Läden). */
  shops?: Shop[];
  /** Schon einmal eingekaufte Artikel – für die Vervollständigung. */
  knownItems?: string[];
  /** Einen Artikel auf die Liste setzen, direkt aus dem Fenster. */
  onShoppingAdd?: (text: string) => void;
  /** Einen Eintrag abhaken – direkt im Laden, ohne Umweg über Familie. */
  onShoppingDone?: (id: string) => void;
  /** Einen Eintrag wegnehmen, ohne ihn gekauft zu haben (Vertipper). */
  onShoppingRemove?: (id: string) => void;
  /** Die Stückzahl setzen. Unter eins fällt der Posten weg. */
  onShoppingCount?: (id: string, menge: number) => void;
  /** Uhrzeit anzeigen – nur fürs Wandpanel gedacht. */
  showClock?: boolean;
  /** Wie viele Befehle darauf warten, dass der Hub wieder da ist. */
  queued?: number;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [lightsOpen, setLightsOpen] = useState(false);
  const [eventOpen, setEventOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [openOpen, setOpenOpen] = useState(false);
  // Nachfrage «womit öffnen?» nach dem Tipp auf den Termin-Ort.
  const [routeAsk, setRouteAsk] = useState(false);
  const [shopOpen, setShopOpen] = useState(false);
  // Welcher Laden gerade gilt. Auf dem Gerät und nicht im Hub: Wer im
  // Coop Willisau steht, hat damit nicht entschieden, was Livia in
  // Lörrach sieht.
  const [shopId, setShopId] = useState<string>(ALLGEMEIN.id);
  // Was gerade eingetippt wird. Bleibt beim Schliessen stehen - wer aus
  // Versehen danebentippt, hat es nicht verloren.
  const [neuerArtikel, setNeuerArtikel] = useState('');

  // Im Browser schliesst Escape das offene Fenster. Am Telefon gibt es
  // dafür die Geste, am Rechner gab es bisher nichts.
  useEscape(lightsOpen, () => setLightsOpen(false));
  useEscape(openOpen, () => setOpenOpen(false));
  useEscape(shopOpen, () => setShopOpen(false));
  useEscape(eventOpen, () => setEventOpen(false));
  useEscape(alertsOpen, () => setAlertsOpen(false));
  const temperature = entities.find(
    (entity) => entity.kind === 'sensor' && entity.state.unit === '°C'
  );
  const humidity = entities.find(
    (entity) => entity.kind === 'sensor' && entity.state.unit === '%'
  );
  const people = entities.find((entity) => entity.id.endsWith('anyone_home'));

  // Die Zwei-Sekunden-Übersicht: Was ist an, was läuft, was steht an?
  const litEntities = entities.filter(
    (entity) =>
      (entity.kind === 'light' || entity.kind === 'switch') &&
      entity.state.state === 'on' &&
      !hidden.includes(entity.id) &&
      // Sonst zählte eine Deckenlampe mit fünf Spots sechsmal: einmal als
      // Leuchte und fünfmal einzeln.
      !entity.combined_into
  );
  const lightsOn = litEntities.length;
  const vacuum = entities.find(
    (entity) => entity.kind === 'vacuum' && entity.state.state === 'cleaning'
  );
  const calendar = entities.find(
    (entity) => entity.kind === 'calendar' && entity.state.next_start
  );
  const event = nextCalendarEvent(calendar);
  const alerts = entities.find(
    (entity) => entity.kind === 'alert' && entity.state.state === 'alert'
  );
  const offen = openContacts(entities);
  // Ein gekipptes Fenster ist eine Notiz, eine offene Wohnungstüre etwas,
  // das man jetzt wissen will - deshalb blinkt nur die Türe.
  const tuerOffen = hasOpenDoor(entities);
  const einkauf = shopping ?? [];
  const laeden = [ALLGEMEIN, ...(shops ?? [])];
  const laden = laeden.find((entry) => entry.id === shopId) ?? ALLGEMEIN;
  const gaenge = groupForShop(einkauf, laden);
  const vorschlaege = artikelVorschlaege(
    knownItems ?? [],
    neuerArtikel,
    einkauf.map((eintrag) => String(eintrag?.text ?? ''))
  );

  return (
    <View style={styles.row}>
      <View style={styles.chips}>
        {temperature ? (
          <Chip icon="thermometer-outline" text={`${round(temperature.state.state)} °C`} />
        ) : null}
        {humidity ? (
          <Chip icon="water-outline" text={`${round(humidity.state.state)} %`} />
        ) : null}
        {people ? (
          <Chip
            icon="people-outline"
            text={people.state.state === 'on' ? 'jemand da' : 'niemand da'}
          />
        ) : null}
        {lightsOn > 0 ? (
          <Chip
            icon="bulb-outline"
            text={lightsOn === 1 ? '1 an' : `${lightsOn} an`}
            onPress={() => setLightsOpen(true)}
          />
        ) : null}
        {offen.length > 0 ? (
          <Blinkend an={tuerOffen}>
            <Chip
              icon="alert-circle-outline"
              tone={colors.warn}
              text={offen.length === 1 ? '1 offen' : `${offen.length} offen`}
              onPress={() => setOpenOpen(true)}
            />
          </Blinkend>
        ) : null}
        {/* Immer da, damit man auch etwas *eintragen* kann - eine Liste,
            die erst erscheint, wenn schon etwas drauf steht, ist genau
            dann nicht da, wenn man sie braucht. Orange erst, sobald
            wirklich etwas fehlt: Die Einkaufsliste ist der einzige
            Eintrag hier, der einen zum Handeln bringt, statt nur zu
            berichten - man geht ohnehin gleich aus dem Haus. */}
        {/* Wer die Familienlisten nicht sehen darf, bekommt auch den
            Einkaufszettel nicht: Ohne 'shopping' bleibt der Eintrag weg,
            statt einem Gast ein leeres Fenster anzubieten, in dem jedes
            Eintragen am Hub scheitert. */}
        {shopping ? (
        <Chip
          icon="cart"
          tone={einkauf.length > 0 ? colors.warn : undefined}
          text={
            einkauf.length === 0
              ? 'Einkaufen'
              : einkauf.length === 1
                ? '1 einkaufen'
                : `${einkauf.length} einkaufen`
          }
          onPress={() => setShopOpen(true)}
        />
        ) : null}
        {vacuum ? <Chip icon="sparkles-outline" text="saugt" /> : null}
        {calendar ? (
          <Chip
            icon="calendar-outline"
            text={`${clockTime(calendar.state.next_start)} ${calendar.state.state}`}
            onPress={event ? () => setEventOpen(true) : undefined}
          />
        ) : null}
        {alerts ? (
          <Chip
            icon="warning-outline"
            text={`${alerts.state.count ?? ''} Warnung${alerts.state.count === 1 ? '' : 'en'}`}
            tone={colors.warn}
            onPress={() => setAlertsOpen(true)}
          />
        ) : null}
      </View>

      <View style={styles.chips}>
        <View style={styles.chip}>
          <View style={[styles.dot, { backgroundColor: statusColor(colors, status) }]} />
          {/* Ohne diese Zahl ist ein Tipp im Funkloch nicht von einem
              verschluckten Befehl zu unterscheiden – beides sieht nach
              «nichts passiert» aus. */}
          <Text style={styles.chipText}>
            {queued > 0
              ? `${STATUS_LABEL[status]} · ${queued} wartet`
              : STATUS_LABEL[status]}
          </Text>
        </View>
        {/* Nur auf dem Wandpanel. Telefon und Rechner zeigen die Uhrzeit
            ohnehin am Bildschirmrand - hier wäre sie ein zweites Mal
            dasselbe. Ein fest montiertes Tablet im Vollbild hat dagegen
            keine, und dort ist sie oft der Grund, hinzuschauen. */}
        {showClock ? (
          <Text style={styles.clock}>
            {uhr(now)}
          </Text>
        ) : null}
      </View>

      <Modal
        visible={lightsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setLightsOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setLightsOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.heading}>
              {litEntities.length === 1 ? '1 Licht an' : `${litEntities.length} Lichter an`}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {litEntities.map((entity) => (
                <View key={entity.id} style={styles.lightRow}>
                  <Ionicons name="bulb" size={18} color={colors.warn} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lightName}>{entity.name}</Text>
                    {entity.room ? (
                      <Text style={styles.lightRoom}>{entity.room}</Text>
                    ) : null}
                  </View>
                  {onCommand && entity.commands.includes('turn_off') ? (
                    <Pressable
                      onPress={() => onCommand(entity.id, 'turn_off')}
                      accessibilityRole="button"
                      accessibilityLabel={`${entity.name} ausschalten`}
                      style={({ pressed }) => [styles.offButton, pressed && { opacity: 0.7 }]}
                    >
                      <Text style={styles.offButtonText}>Aus</Text>
                    </Pressable>
                  ) : null}
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setLightsOpen(false)} style={styles.close}>
              <Text style={styles.closeText}>Schliessen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={openOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setOpenOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setOpenOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.heading}>
              {offen.length === 1 ? 'Ein Fenster/eine Tür offen' : `${offen.length} offen`}
            </Text>
            <ScrollView style={{ maxHeight: 360 }}>
              {offen.map((entity) => (
                <View key={entity.id} style={styles.lightRow}>
                  <Ionicons name="alert-circle-outline" size={18} color={colors.warn} />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.lightName}>{entity.name}</Text>
                    {entity.room ? (
                      <Text style={styles.lightRoom}>{entity.room}</Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </ScrollView>
            <Pressable onPress={() => setOpenOpen(false)} style={styles.close}>
              <Text style={styles.closeText}>Schliessen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Die Einkaufsliste im Laden: Gänge in der Reihenfolge dieses
          Ladens, ein Tipp hakt ab. Die Ladenwahl steht oben - im Coop
          läuft man anders herum als im Volg, und wer die Liste in der
          falschen Reihenfolge abarbeitet, geht dreimal durch. */}
      <Modal
        visible={shopOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setShopOpen(false)}
      >
        {/* Ohne das schiebt sich auf dem Telefon die Tastatur über das
            Eingabefeld, sobald man etwas eintragen will. */}
        <KeyboardAvoidingView
          behavior={kann.tastaturSchiebt ? 'padding' : undefined}
          style={{ flex: 1 }}
        >
        <Pressable style={styles.backdrop} onPress={() => setShopOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {/* Beim Abhaken des letzten Eintrags bleibt das Fenster offen –
                «0 Sachen einkaufen» wäre dann eine seltsame Überschrift. */}
            <Text style={styles.heading}>
              {einkauf.length === 0
                ? 'Einkaufsliste'
                : einkauf.length === 1
                  ? '1 Sache einkaufen'
                  : `${einkauf.length} Sachen einkaufen`}
            </Text>

            {/* Nur wenn es überhaupt etwas zu wählen gibt: Mit einem
                einzigen Laden wäre die Zeile eine Behauptung von
                Auswahl. */}
            {laeden.length > 1 ? (
              <ScrollView
                horizontal
                showsHorizontalScrollIndicator={false}
                style={{ flexGrow: 0 }}
                contentContainerStyle={styles.shopRow}
              >
                {laeden.map((entry) => (
                  <Pressable
                    key={entry.id}
                    onPress={() => setShopId(entry.id)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected: entry.id === laden.id }}
                    style={[styles.shopChip, entry.id === laden.id && styles.shopChipActive]}
                  >
                    <Text
                      style={[
                        styles.shopChipText,
                        entry.id === laden.id && styles.shopChipTextActive,
                      ]}
                    >
                      {entry.name}
                    </Text>
                  </Pressable>
                ))}
              </ScrollView>
            ) : null}

            {/* Eintragen, wo man die Liste ohnehin gerade ansieht. Der
                häufigste Fall ist «mir fällt noch etwas ein», und dafür
                erst unter Familie nachzuschlagen war ein Umweg. */}
            {onShoppingAdd ? (
              <>
                <View style={styles.addRow}>
                  <Ionicons name="add" size={17} color={colors.inkFaint} />
                  <TextInput
                    style={styles.addInput}
                    value={neuerArtikel}
                    onChangeText={setNeuerArtikel}
                    placeholder="Was fehlt?"
                    placeholderTextColor={colors.inkFaint}
                    autoCorrect={false}
                    returnKeyType="done"
                    onSubmitEditing={() => {
                      onShoppingAdd(neuerArtikel);
                      setNeuerArtikel('');
                    }}
                  />
                  {neuerArtikel.trim() ? (
                    <Pressable
                      onPress={() => {
                        onShoppingAdd(neuerArtikel);
                        setNeuerArtikel('');
                      }}
                      accessibilityRole="button"
                      accessibilityLabel={`${neuerArtikel.trim()} eintragen`}
                      hitSlop={8}
                    >
                      <Ionicons name="arrow-forward-circle" size={22} color={colors.accent} />
                    </Pressable>
                  ) : null}
                </View>
                {vorschlaege.length > 0 ? (
                  <ScrollView
                    horizontal
                    showsHorizontalScrollIndicator={false}
                    style={{ flexGrow: 0 }}
                    contentContainerStyle={styles.shopRow}
                    keyboardShouldPersistTaps="handled"
                  >
                    {vorschlaege.map((name) => (
                      <Pressable
                        key={name}
                        onPress={() => {
                          onShoppingAdd(name);
                          setNeuerArtikel('');
                        }}
                        accessibilityRole="button"
                        accessibilityLabel={`${name} eintragen`}
                        style={({ pressed }) => [styles.shopChip, pressed && { opacity: 0.7 }]}
                      >
                        <Text style={styles.shopChipText}>{name}</Text>
                      </Pressable>
                    ))}
                  </ScrollView>
                ) : null}
              </>
            ) : null}

            <ScrollView style={{ maxHeight: 360 }} keyboardShouldPersistTaps="handled">
              {gaenge.length === 0 ? (
                <Text style={styles.lightRoom}>
                  Die Liste ist leer
                  {onShoppingAdd ? ' – oben eintragen, was fehlt.' : '.'}
                </Text>
              ) : null}
              {gaenge.map((gang) => (
                <View key={gang.category}>
                  <Text style={styles.gangLabel}>{gang.category}</Text>
                  {gang.items.map((eintrag: EinkaufZeile) => {
                    const { menge, name } = mengeUndName(String(eintrag.text ?? ''));
                    return (
                      <View key={eintrag.id} style={styles.lightRow}>
                        <Pressable
                          onPress={
                            onShoppingDone
                              ? () => {
                                  // Im Laden schaut man auf das Regal, nicht
                                  // aufs Telefon – der kurze Impuls sagt, dass
                                  // der Tipp gesessen hat.
                                  tapped();
                                  onShoppingDone(String(eintrag.id));
                                }
                              : undefined
                          }
                          accessibilityRole="checkbox"
                          accessibilityState={{ checked: false }}
                          accessibilityLabel={`${eintrag.text} abhaken`}
                          hitSlop={4}
                          style={({ pressed }) => [styles.einkaufTap, pressed && { opacity: 0.6 }]}
                        >
                          <Ionicons
                            name={onShoppingDone ? 'ellipse-outline' : 'cart-outline'}
                            size={20}
                            color={colors.inkFaint}
                          />
                          <Text style={[styles.lightName, { flex: 1 }]} numberOfLines={1}>
                            {menge > 1 ? `${menge}× ${name}` : name}
                          </Text>
                        </Pressable>
                        {/* Menge und Wegnehmen stehen rechts und sind bewusst
                            klein: Der grosse Griff ist das Abhaken, alles
                            andere braucht man selten – aber dann sofort. */}
                        {onShoppingCount ? (
                          <>
                            <Pressable
                              onPress={() => onShoppingCount(String(eintrag.id), menge - 1)}
                              accessibilityRole="button"
                              accessibilityLabel={`${name}: eines weniger`}
                              hitSlop={10}
                            >
                              <Ionicons name="remove" size={17} color={colors.inkFaint} />
                            </Pressable>
                            <Pressable
                              onPress={() => onShoppingCount(String(eintrag.id), menge + 1)}
                              accessibilityRole="button"
                              accessibilityLabel={`${name}: eines mehr`}
                              hitSlop={10}
                            >
                              <Ionicons name="add" size={17} color={colors.inkFaint} />
                            </Pressable>
                          </>
                        ) : null}
                        {onShoppingRemove ? (
                          <Pressable
                            onPress={() => onShoppingRemove(String(eintrag.id))}
                            accessibilityRole="button"
                            accessibilityLabel={`${name} von der Liste nehmen`}
                            hitSlop={10}
                          >
                            <Ionicons name="close" size={17} color={colors.inkFaint} />
                          </Pressable>
                        ) : null}
                      </View>
                    );
                  })}
                </View>
              ))}
            </ScrollView>

            {onShoppingDone && einkauf.length > 0 ? (
              <Text style={styles.lightRoom}>
                Antippen hakt ab. Mit − und + die Stückzahl, mit × einen
                Vertipper wieder loswerden.
              </Text>
            ) : null}
            <Pressable onPress={() => setShopOpen(false)} style={styles.close}>
              <Text style={styles.closeText}>Schliessen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
        </KeyboardAvoidingView>
      </Modal>

      <Modal
        visible={eventOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setEventOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setEventOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            {event ? (
              <>
                <Text style={styles.heading}>{event.summary ?? '—'}</Text>
                <Text style={styles.eventWhen}>{eventWhenText(event)}</Text>
                {event.location ? (
                  <Pressable
                    onPress={() => setRouteAsk((v) => !v)}
                    accessibilityRole="button"
                    accessibilityLabel={`Route zu ${event.location}`}
                    style={({ pressed }) => [
                      styles.eventLocationRow,
                      pressed && { opacity: 0.7 },
                    ]}
                  >
                    <Ionicons name="location-outline" size={16} color={colors.accent} />
                    <Text style={[styles.eventLocation, { color: colors.accent }]}>
                      {event.location}
                    </Text>
                    <Ionicons
                      name={routeAsk ? 'chevron-up' : 'navigate-outline'}
                      size={14}
                      color={colors.inkSoft}
                    />
                  </Pressable>
                ) : null}
                {routeAsk && event.location ? (
                  <View style={styles.routeRow}>
                    <Pressable
                      onPress={() => {
                        // Keine Karten-App ist kein Fehler der Kopfzeile.
                        Linking.openURL(googleMapsRoute(String(event.location))).catch(() => {});
                        setRouteAsk(false);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.routeButton, pressed && { opacity: 0.7 }]}
                    >
                      <Ionicons name="map-outline" size={15} color={colors.ink} />
                      <Text style={styles.routeButtonText}>Google Maps</Text>
                    </Pressable>
                    <Pressable
                      onPress={() => {
                        // Wie daneben: ohne Karten-App passiert schlicht nichts.
                        Linking.openURL(appleMapsRoute(String(event.location))).catch(() => {});
                        setRouteAsk(false);
                      }}
                      accessibilityRole="button"
                      style={({ pressed }) => [styles.routeButton, pressed && { opacity: 0.7 }]}
                    >
                      <Ionicons name="navigate-circle-outline" size={15} color={colors.ink} />
                      <Text style={styles.routeButtonText}>Apple Karten</Text>
                    </Pressable>
                  </View>
                ) : null}
              </>
            ) : null}
            <Pressable
              onPress={() => {
                setEventOpen(false);
                setRouteAsk(false);
              }}
              style={styles.close}
            >
              <Text style={styles.closeText}>Schliessen</Text>
            </Pressable>
          </Pressable>
        </Pressable>
      </Modal>

      <Modal
        visible={alertsOpen}
        transparent
        animationType="fade"
        onRequestClose={() => setAlertsOpen(false)}
      >
        <Pressable style={styles.backdrop} onPress={() => setAlertsOpen(false)}>
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.heading}>
              {(alerts?.state.count ?? 0) === 1
                ? 'Wetterwarnung'
                : `${alerts?.state.count} Wetterwarnungen`}
            </Text>
            <ScrollView style={{ maxHeight: 380 }}>
              {(alerts?.state.alerts ?? []).map((warning: Record<string, string | undefined>, index: number) => (
                <View key={index} style={styles.alertRow}>
                  <Ionicons
                    name="warning"
                    size={18}
                    color={severityTone(colors, warning.severity)}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.alertTitle}>
                      {warning.event ?? warning.title ?? 'Warnung'}
                      {warning.severity
                        ? ` · ${SEVERITY_LABEL[warning.severity] ?? warning.severity}`
                        : ''}
                    </Text>
                    {alertWindow(warning) ? (
                      <Text style={styles.alertDetail}>{alertWindow(warning)}</Text>
                    ) : null}
                    {warning.area ? (
                      <Text style={styles.alertDetail} numberOfLines={2}>
                        {warning.area}
                      </Text>
                    ) : null}
                  </View>
                </View>
              ))}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>
    </View>
  );
}

/**
 * Lässt sein Kind pulsieren, solange `an` gilt.
 *
 * Für den einen Fall, in dem eine Anzeige mehr will als gelesen zu
 * werden: Die Wohnungstüre steht offen. Blinken ist dafür das richtige
 * Mittel und für alles andere das falsche – deshalb hat es hier keinen
 * zweiten Verwendungszweck.
 *
 * Wer im Betriebssystem «Bewegung reduzieren» eingeschaltet hat, bekommt
 * kein Blinken, sondern die dauerhaft eingefärbte Anzeige. Die Auskunft
 * bleibt dieselbe, nur die Bewegung fällt weg.
 */
function Blinkend({ an, children }: { an: boolean; children: React.ReactNode }) {
  const opacity = useRef(new Animated.Value(1)).current;
  const [ruhig, setRuhig] = useState(false);

  useEffect(() => {
    AccessibilityInfo.isReduceMotionEnabled()
      .then(setRuhig)
      // Nicht abfragbar heisst: normal animieren.
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (!an || ruhig) {
      opacity.setValue(1);
      return;
    }
    const puls = Animated.loop(
      Animated.sequence([
        Animated.timing(opacity, {
          toValue: 0.3,
          duration: 600,
          useNativeDriver: true,
        }),
        Animated.timing(opacity, {
          toValue: 1,
          duration: 600,
          useNativeDriver: true,
        }),
      ])
    );
    puls.start();
    return () => {
      puls.stop();
      opacity.setValue(1);
    };
  }, [an, ruhig, opacity]);

  if (!an) return <>{children}</>;
  return <Animated.View style={{ opacity }}>{children}</Animated.View>;
}

function Chip({
  icon,
  text,
  tone,
  onPress,
}: {
  icon: keyof typeof Ionicons.glyphMap;
  text: string;
  tone?: string;
  onPress?: () => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const content = (
    <>
      <Ionicons name={icon} size={15} color={tone ?? colors.onGradientSoft} />
      <Text style={[styles.chipText, tone ? { color: tone } : null]} numberOfLines={1}>
        {text}
      </Text>
    </>
  );
  if (!onPress) return <View style={styles.chip}>{content}</View>;
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      style={({ pressed }) => [styles.chip, pressed && { opacity: 0.7 }]}
    >
      {content}
    </Pressable>
  );
}

function round(value: unknown): string {
  return typeof value === 'number' ? String(Math.round(value * 10) / 10) : String(value ?? '–');
}

/** "16:00" aus einem ISO-Zeitstempel – ganztägige Termine haben keinen. */
function clockTime(iso: unknown): string {
  const date = new Date(String(iso));
  if (Number.isNaN(date.getTime())) return '';
  return uhr(date);
}

/** Datum/Zeit eines Termins ausgeschrieben – für die Detailansicht (rein,
 *  testbar). */
export function eventWhenText(event: KalenderEintrag): string {
  if (event.all_day) {
    const date = new Date(String(event.start));
    if (Number.isNaN(date.getTime())) return 'ganztägig';
    return `Ganztägig · ${wochentagDatum(date)}`;
  }
  const start = new Date(String(event.start));
  if (Number.isNaN(start.getTime())) return '';
  const day = wochentagDatum(start);
  const startTime = uhr(start);
  const end = event.end ? new Date(String(event.end)) : null;
  const endTime =
    end && !Number.isNaN(end.getTime())
      ? uhr(end)
      : null;
  return endTime ? `${day} · ${startTime}–${endTime}` : `${day} · ${startTime}`;
}

const SEVERITY_LABEL: Record<string, string> = {
  Minor: 'geringfügig',
  Moderate: 'mässig',
  Severe: 'schwer',
  Extreme: 'extrem',
};

/** Warnstufe in eine Farbe – ab «Severe» ist es kein Hinweis mehr. */
function severityTone(colors: Colors, severity?: string): string {
  return severity === 'Severe' || severity === 'Extreme' ? colors.danger : colors.warn;
}

/** «Mi 14:00 bis Do 06:00» aus onset/expires – leer, wenn nichts da ist. */
export function alertWindow(warning: {
  onset?: string | null;
  expires?: string | null;
}): string {
  const part = (iso?: string | null) => {
    if (!iso) return null;
    const stamp = new Date(iso);
    if (Number.isNaN(stamp.getTime())) return null;
    return wochentagUhr(stamp);
  };
  const from = part(warning.onset);
  const to = part(warning.expires);
  if (from && to) return `${from} bis ${to}`;
  if (from) return `ab ${from}`;
  if (to) return `bis ${to}`;
  return '';
}

const makeStyles = (colors: Colors) =>
  StyleSheet.create({
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
  },
  chips: {
    flexDirection: 'row',
    alignItems: 'center',
    flexWrap: 'wrap',
    gap: 8,
    rowGap: 4,
    flexShrink: 1,
  },
  chip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
  },
  chipText: {
    color: colors.onGradientSoft,
    fontSize: 13,
    fontWeight: '500',
  },
  clock: {
    color: colors.onGradient,
    fontSize: 15,
    fontWeight: '600',
    fontVariant: ['tabular-nums'],
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  backdrop: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.5)',
    alignItems: 'center',
    justifyContent: 'center',
    padding: 20,
  },
  sheet: {
    width: '100%',
    maxWidth: 420,
    gap: 10,
    padding: 18,
    borderRadius: radius.card,
    backgroundColor: colors.gradient[1],
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  alertRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 10,
    paddingVertical: 8,
  },
  alertTitle: { color: colors.ink, fontSize: 15, fontWeight: '700' },
  alertDetail: { color: colors.inkSoft, fontSize: 13, lineHeight: 19, marginTop: 2 },
  heading: { color: colors.ink, fontSize: type.cardTitle, fontWeight: '700' },
  shopRow: { flexDirection: 'row', gap: 6, paddingBottom: 4 },
  addRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: colors.surfaceSoft,
    borderRadius: radius.control,
    paddingHorizontal: 12,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  addInput: { flex: 1, paddingVertical: 10, color: colors.ink, fontSize: 15 },
  shopChip: {
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  shopChipActive: { backgroundColor: colors.accent, borderColor: colors.accent },
  shopChipText: { color: colors.ink, fontSize: 13 },
  shopChipTextActive: { color: '#FFFFFF', fontWeight: '600' },
  gangLabel: {
    color: colors.inkSoft,
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 0.6,
    marginTop: 10,
    marginBottom: 2,
  },
  lightRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 7,
  },
  // Der Griff zum Abhaken nimmt die ganze übrige Breite: Wer im Laden
  // mit einer Hand tippt, trifft sonst die kleinen Knöpfe daneben.
  einkaufTap: { flexDirection: 'row', alignItems: 'center', gap: 12, flex: 1 },
  lightName: { color: colors.ink, fontSize: 15, fontWeight: '600' },
  lightRoom: { color: colors.inkFaint, fontSize: 12 },
  offButton: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  offButtonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  eventWhen: { color: colors.inkSoft, fontSize: 15, fontWeight: '500' },
  eventLocationRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  eventLocation: { color: colors.inkSoft, fontSize: 14, flexShrink: 1 },
  routeRow: { flexDirection: 'row', gap: 8 },
  routeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    paddingVertical: 10,
    borderRadius: radius.control,
    backgroundColor: colors.surfaceSoft,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  routeButtonText: { color: colors.ink, fontSize: 13, fontWeight: '600' },
  close: {
    alignItems: 'center',
    paddingVertical: 12,
    marginTop: 4,
    borderRadius: radius.control,
    borderWidth: 1,
    borderColor: colors.surfaceBorder,
  },
  closeText: { color: colors.inkSoft, fontSize: 15, fontWeight: '700' },
});
