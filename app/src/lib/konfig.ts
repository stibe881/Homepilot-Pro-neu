/**
 * Die Konfiguration lesbar machen – ohne dass jemand YAML können muss.
 *
 * Der Texteditor bleibt, und er bleibt vollständig: Was hier nicht als
 * Formular erscheint, ändert man dort weiter wie bisher. Diese Datei
 * beantwortet nur zwei Fragen: Was steht in dieser Konfiguration
 * eigentlich drin, und welche Felder kann man gefahrlos einzeln
 * anfassen.
 *
 * Rein und ohne Netz: Der Hub rechnet die Textänderung, hier entsteht
 * bloss, was auf dem Bildschirm steht.
 */

/** Ein Abschnitt der Datei, so wie der Hub ihn gliedert. */
export interface Abschnitt {
  key: string;
  label: string;
  start: number;
  end: number;
  items?: Anbindung[];
}

export interface Anbindung {
  name: string;
  start: number;
  /** Wo der Eintrag selbst beginnt – ohne die Erklärzeilen darüber. */
  code: number;
  end: number;
  enabled: boolean;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Daten = Record<string, any>;

/**
 * Felder, die als Formular erscheinen.
 *
 * Bewusst eine kurze, handverlesene Liste: Was hier steht, ist einzeln
 * änderbar, ohne dass man den Zusammenhang kennen muss – eine Adresse,
 * ein Port, ein Preis. Alles, wo die Bedeutung am Zusammenspiel hängt
 * (Integrationen, Abläufe, Szenen), gehört in den Block- oder
 * Texteditor, nicht in ein Feld ohne Kontext.
 */
export interface Feld {
  /** Der Weg in der Datei, z.B. ['location', 'address']. */
  pfad: string[];
  label: string;
  hinweis?: string;
  art?: 'text' | 'zahl' | 'schalter';
  platzhalter?: string;
  /** Nicht im Klartext zeigen – Tokens und Passwörter. */
  geheim?: boolean;
}

export const FELDER: { abschnitt: string; felder: Feld[] }[] = [
  {
    abschnitt: 'location',
    felder: [
      {
        pfad: ['location', 'latitude'],
        label: 'Breitengrad',
        art: 'zahl',
        platzhalter: '47.13844',
        hinweis: 'Für Sonnenauf- und -untergang in Abläufen.',
      },
      { pfad: ['location', 'longitude'], label: 'Längengrad', art: 'zahl', platzhalter: '7.92059' },
      {
        pfad: ['location', 'address'],
        label: 'Hausadresse',
        platzhalter: 'Musterweg 3, 6144 Zell LU',
        hinweis:
          'Steht gross auf dem Notfall- und Babysitter-Blatt. Wer 144 wählt, muss als Erstes sagen, wo er ist.',
      },
      {
        pfad: ['location', 'address_note'],
        label: 'Hinweis zur Adresse',
        platzhalter: 'Eingang hinten, Klingel «Gross»',
      },
    ],
  },
  {
    abschnitt: 'api',
    felder: [
      { pfad: ['api', 'host'], label: 'Adresse', platzhalter: '0.0.0.0' },
      { pfad: ['api', 'port'], label: 'Port', art: 'zahl', platzhalter: '8123' },
      {
        pfad: ['api', 'token'],
        label: 'Hub-Token',
        geheim: true,
        hinweis: 'Der Generalschlüssel. Ändern heisst: jedes Gerät neu koppeln.',
      },
    ],
  },
  {
    abschnitt: 'energy',
    felder: [
      { pfad: ['energy', 'price_per_kwh'], label: 'Strompreis je kWh', art: 'zahl', platzhalter: '0.32' },
      { pfad: ['energy', 'currency'], label: 'Währung', platzhalter: 'CHF' },
    ],
  },
  {
    abschnitt: 'guest_wifi',
    felder: [
      { pfad: ['guest_wifi', 'ssid'], label: 'Netzname' },
      { pfad: ['guest_wifi', 'password'], label: 'Passwort', geheim: true },
    ],
  },
  {
    abschnitt: 'push',
    felder: [
      {
        pfad: ['push', 'public_url'],
        label: 'Adresse von aussen',
        platzhalter: 'https://haus.example.ch',
        hinweis: 'Nur damit kann eine Alarm-Nachricht das Kamerabild mitbringen.',
      },
      {
        pfad: ['push', 'person_fenster'],
        label: 'Auf Person warten (Sekunden)',
        art: 'zahl',
        platzhalter: '10',
        hinweis:
          'Bei Kameras mit Personenerkennung: So lange wartet der Hub auf ein ' +
          'Bild, auf dem wirklich jemand steht. Die Nachricht selbst kommt ' +
          'sofort. 0 schaltet es ab.',
      },
    ],
  },
  {
    abschnitt: 'heartbeat',
    felder: [
      { pfad: ['heartbeat', 'url'], label: 'Lebenszeichen an', platzhalter: 'https://hc-ping.com/…' },
      { pfad: ['heartbeat', 'minutes'], label: 'Alle … Minuten', art: 'zahl', platzhalter: '5' },
    ],
  },
];

/**
 * Feldnamen, die in der Übersicht nichts im Klartext zu suchen haben.
 *
 * Die Übersicht sieht man beim Vorzeigen der App; das Token liest dann
 * jemand mit. Im Textmodus steht weiterhin alles – wer es braucht, kommt
 * dort heran.
 */
export const GEHEIM = new Set([
  'token',
  'password',
  'secret',
  'key',
  'app_key',
  'api_key',
  'anon_key',
  'client_secret',
  'portal_password',
]);

/** Einen Wert aus den gelesenen Daten holen (rein, testbar). */
export function wertVon(daten: Daten, pfad: string[]): unknown {
  let stelle: unknown = daten;
  for (const schritt of pfad) {
    if (stelle == null || typeof stelle !== 'object') return undefined;
    stelle = (stelle as Daten)[schritt];
  }
  return stelle;
}

/** Wie ein Wert im Feld steht (rein, testbar). */
export function alsText(wert: unknown): string {
  if (wert == null) return '';
  if (typeof wert === 'boolean') return wert ? 'ja' : 'nein';
  return String(wert);
}

/**
 * Ein Geheimnis andeuten, statt es hinzuschreiben (rein, testbar).
 *
 * Der Texteditor zeigt weiterhin alles – wer das Token braucht, kommt
 * dort heran. In der Übersicht hat es nichts zu suchen: Die sieht man
 * beim Vorzeigen der App, das Token liest dann jemand mit.
 */
export function maskiert(wert: unknown): string {
  const text = alsText(wert);
  if (!text) return '';
  if (text.length <= 6) return '••••';
  return `${text.slice(0, 3)}••••${text.slice(-2)}`;
}

/**
 * Eine Zeile, die sagt, was in diesem Abschnitt steht (rein, testbar).
 *
 * Der Zweck der ganzen Übersicht: sehen, was da ist, ohne es zu lesen.
 */
export function zusammenfassung(key: string, daten: Daten): string {
  const wert = daten?.[key];
  if (wert == null) return 'nicht eingerichtet';
  if (Array.isArray(wert)) {
    if (key === 'integrations') {
      const namen = wert
        .map((eintrag) => String((eintrag as Daten)?.integration ?? ''))
        .filter(Boolean);
      return namen.length === 0 ? 'keine' : `${namen.length}: ${namen.slice(0, 4).join(', ')}${namen.length > 4 ? ' …' : ''}`;
    }
    if (key === 'users') {
      const namen = wert.map((eintrag) => String((eintrag as Daten)?.name ?? '')).filter(Boolean);
      return namen.join(', ') || `${wert.length} Einträge`;
    }
    return wert.length === 1 ? '1 Eintrag' : `${wert.length} Einträge`;
  }
  if (typeof wert === 'object') {
    if (key === 'rooms') {
      const namen = Object.keys(wert);
      return namen.length === 0
        ? 'keine'
        : `${namen.length}: ${namen.slice(0, 4).join(', ')}${namen.length > 4 ? ' …' : ''}`;
    }
    if (key === 'location') {
      const adresse = String((wert as Daten).address ?? '').trim();
      if (adresse) return adresse;
      const lat = (wert as Daten).latitude;
      const lon = (wert as Daten).longitude;
      return lat != null && lon != null ? `${lat}, ${lon}` : 'ohne Koordinaten';
    }
    if (key === 'api') {
      const host = alsText((wert as Daten).host) || '0.0.0.0';
      const port = alsText((wert as Daten).port) || '8123';
      return `${host}:${port}`;
    }
    // Sonst die ersten Werte statt der blossen Schlüsselnamen: «ssid,
    // password» sagt weniger als «Familie Gross Gast, ••••».
    const paare = Object.entries(wert)
      .filter(([, inhalt]) => inhalt != null && typeof inhalt !== 'object')
      .slice(0, 3)
      .map(([name, inhalt]) => (GEHEIM.has(name) ? maskiert(inhalt) : alsText(inhalt)));
    if (paare.length > 0) return paare.join(' · ');
    const schluessel = Object.keys(wert);
    return schluessel.length === 0 ? 'leer' : schluessel.join(', ');
  }
  return alsText(wert);
}

/**
 * Wie viele Zeilen ein Abschnitt hat (rein, testbar).
 *
 * Steht neben dem Namen, damit man weiss, worauf man sich einlässt,
 * bevor man «Als Text bearbeiten» tippt.
 */
export function zeilen(abschnitt: Abschnitt): number {
  return Math.max(0, abschnitt.end - abschnitt.start);
}

/** Die Felder eines Abschnitts, sofern es welche gibt (rein). */
export function feldergruppe(key: string): Feld[] {
  return FELDER.find((gruppe) => gruppe.abschnitt === key)?.felder ?? [];
}

/**
 * Was ein Feld an den Hub schickt (rein, testbar).
 *
 * Ein leeres Feld nimmt die Angabe zurück, statt einen leeren Text
 * einzutragen – sonst stünde in der Datei `address: ""`, und das ist
 * etwas anderes als «keine Adresse hinterlegt».
 */
export function eingabeWert(
  feld: Feld,
  eingabe: string
): { remove: true } | { value: string | number | boolean } {
  const text = eingabe.trim();
  if (!text) return { remove: true };
  if (feld.art === 'zahl') {
    const zahl = Number(text.replace(',', '.'));
    if (Number.isFinite(zahl)) return { value: zahl };
  }
  if (feld.art === 'schalter') return { value: text === 'ja' || text === 'true' };
  return { value: text };
}
