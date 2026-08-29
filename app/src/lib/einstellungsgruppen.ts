/**
 * Wie die Einstellungen auf dem Telefon geordnet, gefärbt und gefunden
 * werden.
 *
 * Vorher war es eine flache Reihe von fünfzehn gleich aussehenden
 * Zeilen, hinter der Hälfte davon noch eine Tür namens «Administrator».
 * Man las sie von oben nach unten, jedes Mal wieder – zum Scannen taugte
 * sie nicht, weil nichts sich von etwas anderem unterschied.
 *
 * Drei Dinge ändern das, und alle drei stehen hier, damit sie prüfbar
 * sind statt im Bildschirm verstreut:
 *
 * - **Gruppen mit Überschriften.** Was man bedient, was man weiss, was
 *   diesem Gerät gehört, was das Haus einrichtet. Die Tür entfällt: Ein
 *   Stück Weiterscrollen ist billiger als ein Tipp hinein und einer
 *   zurück.
 * - **Eine Farbe je Punkt.** Nicht Zierde – sie macht aus Lesen ein
 *   Zielen. Wer «Energie» sucht, sucht das Grüne.
 * - **Suchen statt scrollen.** Mit Stichwörtern, weil niemand «Konto»
 *   eintippt, wenn er die Benachrichtigungen sucht.
 */

/** Das Wenige, das die Ordnung von einem Menüpunkt wissen muss. */
export interface Eintrag {
  key: string;
  label: string;
  detail: string;
}

/** Eine kleine Meldung an der Zeile: «3», «läuft», «Scharf». */
export interface Plakette {
  text: string;
  /** `gut` grün, `warnung` orange, `ruhig` grau. */
  ton: 'gut' | 'warnung' | 'ruhig';
}

/**
 * Die Gruppen, in der Reihenfolge, in der sie stehen.
 *
 * Oben, was täglich vorkommt; unten, was man beim Einrichten einmal
 * braucht. Innerhalb einer Gruppe zählt die genannte Reihenfolge, nicht
 * die der Punkte im Bildschirm – so bleibt die Anordnung an einem Ort.
 */
export const GRUPPEN: readonly { key: string; titel: string; keys: readonly string[] }[] = [
  {
    key: 'bedienen',
    titel: 'Haus bedienen',
    keys: ['search', 'automations', 'alarm', 'speakers', 'energy', 'besuch'],
  },
  {
    key: 'wissen',
    titel: 'Wer und was',
    keys: ['personen', 'users', 'devices', 'sorgen'],
  },
  {
    key: 'geraet',
    titel: 'Dieses Gerät',
    keys: ['account', 'widgets', 'connection'],
  },
  {
    key: 'einrichten',
    titel: 'Einrichtung und Rückblick',
    keys: ['system', 'activity'],
  },
] as const;

/** Wo ein Punkt landet, den niemand einer Gruppe zugeordnet hat. */
const SAMMELGRUPPE = { key: 'weitere', titel: 'Weitere' };

/**
 * Eine Farbe je Punkt.
 *
 * Feste Töne und keine aus dem Farbschema: Das Plättchen liegt auf einer
 * Kartenfläche, und der Ton soll in allen fünf Erscheinungsbildern
 * derselbe sein – sonst ist «das Grüne» nachts ein anderes als tagsüber,
 * und genau das Zielen wäre wieder dahin.
 */
const FARBEN: Record<string, string> = {
  search: '#6C7C94',
  automations: '#7C5CFF',
  alarm: '#E5484D',
  speakers: '#F5A524',
  energy: '#12A594',
  besuch: '#E93D82',
  personen: '#2F6BF6',
  users: '#3E63DD',
  devices: '#5D6572',
  sorgen: '#F76B15',
  account: '#2F6BF6',
  widgets: '#8E4EC6',
  connection: '#12A594',
  system: '#5D6572',
  activity: '#0091FF',
};

/** Der Ton eines Punktes – grau für alles, was hier nicht steht. */
export function farbeVon(key: string): string {
  return FARBEN[key] ?? '#6C7C94';
}

/**
 * Stichwörter, unter denen ein Punkt zu finden sein soll.
 *
 * Niemand tippt «Konto», wenn er die Benachrichtigungen abstellen will,
 * und «Verbindungen» ist nicht das Wort, das einem bei «Token» einfällt.
 * Die Beschreibung deckt einiges ab; hier steht, was ihr fehlt.
 */
const STICHWORTE: Record<string, readonly string[]> = {
  account: ['push', 'benachrichtigung', 'mitteilung', 'profil', 'darstellung', 'design', 'farbe', 'symbol', 'sperre', 'passwort'],
  connection: ['token', 'hub', 'adresse', 'server', 'url', 'anmelden'],
  automations: ['szene', 'szenen', 'automation', 'regel', 'zeitplan'],
  besuch: ['wlan', 'gast', 'gäste', 'babysitter', 'qr'],
  sorgen: ['batterie', 'offline', 'wartung', 'kaputt', 'störung'],
  system: ['sicherung', 'backup', 'integration', 'konfiguration', 'update', 'protokoll', 'log'],
  activity: ['verlauf', 'historie', 'rückblick', 'was war'],
  users: ['rolle', 'zugang', 'berechtigung', 'benutzer', 'einladung'],
  devices: ['gerät', 'geräte', 'liste', 'ausgeblendet', 'umbenennen'],
  energy: ['strom', 'verbrauch', 'kosten', 'kwh', 'watt'],
  speakers: ['box', 'boxen', 'sonos', 'musik', 'ton', 'lautstärke'],
  alarm: ['scharf', 'sicherheit', 'einbruch', 'sensor', 'pin'],
  widgets: ['homescreen', 'sperrbildschirm', 'kachel', 'kurzbefehl'],
  personen: ['ortung', 'standort', 'zuhause', 'unterwegs', 'kontakt'],
  search: ['finden', 'suchen'],
};

/**
 * Gruppiert die sichtbaren Punkte (rein, testbar).
 *
 * Leere Gruppen fallen weg – ein Gast sieht drei Punkte, und drei
 * Überschriften darüber wären Hohn. Was in keiner Gruppe steht, geht
 * nicht verloren, sondern landet unter «Weitere»: Wer einen Punkt
 * hinzufügt und die Gruppe vergisst, soll ihn sehen und nicht suchen.
 */
export function gruppiere<T extends Eintrag>(
  punkte: readonly T[]
): { key: string; titel: string; punkte: T[] }[] {
  const nachKey = new Map(punkte.map((punkt) => [punkt.key, punkt]));
  const vergeben = new Set<string>();
  const gruppen: { key: string; titel: string; punkte: T[] }[] = [];

  for (const gruppe of GRUPPEN) {
    const drin: T[] = [];
    for (const key of gruppe.keys) {
      const punkt = nachKey.get(key);
      if (!punkt) continue;
      drin.push(punkt);
      vergeben.add(key);
    }
    if (drin.length > 0) gruppen.push({ key: gruppe.key, titel: gruppe.titel, punkte: drin });
  }

  const rest = punkte.filter((punkt) => !vergeben.has(punkt.key));
  if (rest.length > 0) gruppen.push({ ...SAMMELGRUPPE, punkte: [...rest] });
  return gruppen;
}

/** Kleinbuchstaben ohne Akzente – «Abläufe» soll auf «ablaufe» passen. */
function schlicht(text: string): string {
  return text
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/ß/g, 'ss');
}

/**
 * Passt der Punkt zum Suchtext? (rein, testbar)
 *
 * Alle eingetippten Wörter müssen vorkommen, jedes irgendwo: im Namen,
 * in der Beschreibung oder in den Stichwörtern. So findet «push konto»
 * dasselbe wie «konto push», und «lauts» findet die Lautsprecher, bevor
 * das Wort zu Ende getippt ist.
 */
export function passt(punkt: Eintrag, suche: string): boolean {
  const woerter = schlicht(suche).split(/\s+/).filter(Boolean);
  if (woerter.length === 0) return true;
  const heuhaufen = schlicht(
    [punkt.label, punkt.detail, ...(STICHWORTE[punkt.key] ?? [])].join(' ')
  );
  return woerter.every((wort) => heuhaufen.includes(wort));
}

/** Die Punkte, die zum Suchtext passen (rein, testbar). */
export function filtere<T extends Eintrag>(punkte: readonly T[], suche: string): T[] {
  return punkte.filter((punkt) => passt(punkt, suche));
}

/**
 * Die Plakette der Alarmanlage (rein, testbar).
 *
 * Sie steht an der Zeile, damit man den Zustand sieht, ohne die Seite zu
 * öffnen - die häufigste Frage an diesen Punkt ist «ist sie scharf?»,
 * und die soll die Liste selbst beantworten.
 *
 * `kind` unterscheidet die echte Anlage des Hubs von einem Schalter, der
 * bloss «Alarm» heisst: Der kennt nur ein und aus.
 */
export function alarmPlakette(
  kind: string,
  zustand: string | null | undefined
): Plakette | undefined {
  const wert = String(zustand ?? '').trim();
  if (!wert) return undefined;
  if (kind !== 'alarm') {
    return wert === 'on' ? { text: 'Scharf', ton: 'gut' } : { text: 'Unscharf', ton: 'ruhig' };
  }
  if (wert === 'ausgeloest' || wert === 'triggered') {
    return { text: 'Ausgelöst', ton: 'warnung' };
  }
  if (wert === 'unscharf' || wert === 'disarmed') return { text: 'Unscharf', ton: 'ruhig' };
  return { text: 'Scharf', ton: 'gut' };
}
