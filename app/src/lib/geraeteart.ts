/**
 * Wofür ein Gerät steht, in einem Wort.
 *
 * In den Abläufen standen bisher nur Namen: «Flur», «Flur 2», «Sensor
 * Flur». Welches davon das Licht ist und welches der Melder, wusste nur,
 * wer die Anlage eingerichtet hat – und auch der nicht mehr nach einem
 * halben Jahr. Die Art danebenzuschreiben kostet eine Zeile und erspart
 * das Raten.
 *
 * Bewusst die Sprache der Wohnung und nicht die des Hubs: «Saugroboter»,
 * nicht «vacuum»; «Leuchte», nicht «group». Wo die Art nicht eindeutig
 * ist, steht lieber das Allgemeine («Melder») als eine falsche
 * Behauptung.
 *
 * Rein und ohne React – deshalb hier und nicht im Bildschirm, und
 * deshalb von überall verwendbar.
 */
import type { Entity } from '../api/types';

/** Melderarten, wie der Hub sie als `device_class` mitschickt. */
const MELDER: Record<string, string> = {
  motion: 'Bewegungsmelder',
  presence: 'Präsenzmelder',
  contact: 'Fenster-/Türkontakt',
  smoke: 'Rauchmelder',
  moisture: 'Wassermelder',
};

/** Messwertarten – am `device_class`, sonst an der Einheit erkannt. */
const MESSWERT: Record<string, string> = {
  temperature: 'Temperaturfühler',
  humidity: 'Feuchtefühler',
  illuminance: 'Helligkeitsfühler',
  power: 'Verbrauchsmessung',
  energy: 'Verbrauchsmessung',
  battery: 'Batteriestand',
};

const NACH_EINHEIT: Record<string, string> = {
  '°C': 'Temperaturfühler',
  '%': 'Messwert',
  W: 'Verbrauchsmessung',
  kWh: 'Verbrauchsmessung',
  lx: 'Helligkeitsfühler',
};

/**
 * Ist das ein Fernseher? (rein, testbar)
 *
 * Beides sind für den Hub «media_player», im Haushalt aber zwei ganz
 * verschiedene Dinge: Auf einer Box läuft Musik, ein Fernseher hat ein
 * Bild, Apps und eine Fernbedienung. Wo es um Musik geht – der Player
 * auf der Startseite, eine Durchsage – hat er nichts verloren.
 *
 * Zwei Wege, ihn zu erkennen, und beide werden gebraucht:
 *
 * 1. **Das Gerät sagt es** (`has_screen`). Ein Cast-fähiger Fernseher
 *    meldet sich bei Google als Videogerät, kennt aber weder Steuerkreuz
 *    noch App-Start – für den Hub sah er aus wie eine Box. Genau daran
 *    hing der Fehler: Er stand in der Boxenwahl der Startseite, und lief
 *    abends ein Film, war er dort die gezeigte Karte.
 * 2. **Die Befehle verraten es.** Was ein Steuerkreuz oder einen
 *    App-Start kennt, ist ein Fernseher – auch der nächste, der von
 *    seiner Integration kein `has_screen` mitbekommt.
 *
 * Ein Chromecast-Stick am Fernseher zählt als Fernseher: Er meldet sich
 * als Videogerät, und den Ton macht ohnehin das Gerät, an dem er hängt.
 */
export function isTelevision(entity: Entity): boolean {
  if (entity.kind !== 'media_player') return false;
  if (entity.state?.has_screen === true) return true;
  // Wehrhaft gegen Einträge ohne Befehlsliste: Diese Prüfung läuft über
  // jedes Medien-Gerät, und ein einziger Ausrutscher darüber nähme den
  // ganzen Player von der Startseite – Playlists inbegriffen. Im Zweifel
  // also keine Behauptung, es sei ein Fernseher.
  if (!Array.isArray(entity.commands)) return false;
  return entity.commands.some(
    (command) => command === 'dpad_up' || command === 'launch_app'
  );
}

export function deviceKindLabel(entity: Entity): string {
  const deviceClass = String(entity.state?.device_class ?? '');

  switch (entity.kind) {
    case 'light':
      // Eine zusammengefasste Leuchte ist kein weiteres Licht, sondern
      // die Fernbedienung für fünf – das muss man sehen, sonst schaltet
      // ein Ablauf einen einzelnen Spot statt der Deckenlampe.
      if (entity.integration === 'group') return 'Leuchte (mehrere Lampen)';
      if (entity.combined_into) return 'Licht (Teil einer Leuchte)';
      return 'Licht';

    case 'switch':
      if (entity.integration === 'group') return 'Gruppe (Schalter)';
      // Merker der Helfer-Integration: kein Gerät, sondern ein Schalter
      // ohne Draht, den Abläufe untereinander benutzen.
      if (entity.integration === 'helpers') return 'Merker';
      return 'Schalter / Steckdose';

    case 'binary_sensor':
      // Anwesenheit sieht wie ein Melder aus, ist aber keiner: Sie sagt,
      // ob jemand zuhause ist, nicht ob sich etwas bewegt. Und nur der
      // Geofence sagt das – UniFi weiss, welches Gerät im Netz hängt,
      // was etwas anderes ist und darum auch anders heisst.
      if (entity.integration === 'geofence') return 'Anwesenheit';
      if (entity.integration === 'unifi') return 'Gerät im WLAN';
      return MELDER[deviceClass] ?? 'Melder';

    case 'sensor':
      return (
        MESSWERT[deviceClass] ??
        NACH_EINHEIT[String(entity.state?.unit ?? '')] ??
        'Messwert'
      );

    case 'cover':
      return 'Store / Rollladen';
    case 'lock':
      return 'Schloss / Türöffner';
    case 'vacuum':
      return 'Saugroboter';
    case 'camera':
      return 'Kamera';
    case 'button':
      return 'Taster';
    case 'alarm':
      return 'Alarmanlage';
    // «Lichtszene» und nicht «Szene»: Die Szenen des Hubs stehen in der
    // App an anderer Stelle, und zwei Dinge desselben Namens nebeneinander
    // sind eines zu viel.
    case 'scene':
      return 'Lichtszene';
    case 'alert':
      return 'Warnung';
    case 'appliance':
      return 'Haushaltsgerät';
    case 'weather':
      return 'Wetter';
    case 'calendar':
      return 'Kalender';

    case 'media_player':
      return isTelevision(entity) ? 'Fernseher' : 'Lautsprecher';

    // Der Einschlaf-Timer des Fernsehers als eigene Kachel.
    case 'timer':
      return 'Timer';

    default:
      return 'Gerät';
  }
}

/** Das Symbol zur Art – dasselbe Vokabular wie die Kacheln. */
export function deviceKindIcon(entity: Entity): string {
  const deviceClass = String(entity.state?.device_class ?? '');
  switch (entity.kind) {
    case 'light':
      return entity.integration === 'group' ? 'bulb' : 'bulb-outline';
    case 'switch':
      return entity.integration === 'helpers' ? 'flag-outline' : 'flash-outline';
    case 'binary_sensor':
      if (deviceClass === 'motion' || deviceClass === 'presence') return 'walk-outline';
      if (deviceClass === 'smoke') return 'flame-outline';
      if (deviceClass === 'moisture') return 'water-outline';
      if (deviceClass === 'contact') return 'log-in-outline';
      if (entity.integration === 'geofence') return 'people-outline';
      // Ein WLAN-Fühler bekommt das Netz-Sinnbild, keine Leute: Er zählt
      // Geräte, nicht Menschen.
      if (entity.integration === 'unifi') return 'wifi-outline';
      return 'ellipse-outline';
    case 'sensor':
      return 'speedometer-outline';
    case 'cover':
      return 'browsers-outline';
    case 'lock':
      return 'lock-closed-outline';
    case 'vacuum':
      return 'sparkles-outline';
    case 'camera':
      return 'videocam-outline';
    case 'button':
      return 'radio-button-on-outline';
    case 'alarm':
      return 'shield-outline';
    case 'scene':
      return 'color-palette-outline';
    case 'alert':
      return 'warning-outline';
    case 'appliance':
      return 'cube-outline';
    case 'weather':
      return 'partly-sunny-outline';
    case 'calendar':
      return 'calendar-outline';
    case 'media_player':
      return isTelevision(entity) ? 'tv-outline' : 'musical-notes-outline';
    case 'timer':
      return 'moon-outline';
    default:
      return 'ellipse-outline';
  }
}

/** Musikbox oder Fernseher? (rein, testbar)
 *
 * Beide sind für den Hub «media_player» – bedienen möchte man sie aber an
 * verschiedenen Orten. Der Player auf der Startseite ist die Stelle für
 * «was läuft gerade und mach lauter»; ein Fernseher gehört dort nicht hin,
 * seine Karte im Raum kann ohnehin mehr (Apps, Einschlaf-Timer, Tasten).
 *
 * Unterschieden wird an den Befehlen, nicht am Hersteller: Was ein
 * Steuerkreuz oder einen App-Start kennt, ist ein Fernseher. Das gilt auch
 * für den nächsten, der nicht von Nvidia kommt.
 */
export function istMusikbox(entity: Entity): boolean {
  // Die Regel selbst steht in lib/geraeteart.ts – dieselbe, an der auch
  // die Geräteauswahl der Abläufe «Fernseher» oder «Lautsprecher»
  // anschreibt. Zwei Definitionen liefen früher oder später auseinander,
  // und dann hiesse dasselbe Gerät an zwei Orten Verschiedenes.
  return entity.kind === 'media_player' && !isTelevision(entity);
}

/** Die Musikboxen eines Raums (rein, testbar).
 *
 * Für die Spalte rechts: Steht man im Wohnzimmer, gehört dorthin die Box
 * des Wohnzimmers – auch wenn oben in der Spalte gerade die Küchenbox
 * läuft. Ohne Raum («Alle») gibt es keine solche Box, dann bleibt die
 * Liste leer. */
export function musikboxenImRaum(
  entities: Entity[],
  room: string | null | undefined
): Entity[] {
  if (!room) return [];
  return entities.filter((entity) => istMusikbox(entity) && entity.room === room);
}

/** Bringt dieser Player eine eigene Auswahl mit? (rein, testbar)
 *
 * Spotify seine Playlists, das Radio seine Sender. Beide spielen über
 * eine Box, und beide melden dann dasselbe «playing» wie sie – aber nur
 * auf ihrer Karte steht, *was* da läuft und wie man etwas anderes
 * wählt. */
export function hatEigeneAuswahl(entity: Entity): boolean {
  return (
    entity.commands.includes('play_playlist') || entity.commands.includes('play_radio')
  );
}

/** Das Symbol einer Quelle (rein, testbar).
 *
 * Spotify und Radio stehen im Player nebeneinander zur Wahl. Zwei Chips
 * mit blossem Namen sähen aus wie zwei Boxen – das Sinnbild sagt in
 * einem Blick, dass hier etwas anderes gewählt wird als ein Zimmer. */
export function quellenSymbol(entity: Entity): string {
  if (entity.commands.includes('play_radio')) return 'radio';
  if (entity.commands.includes('play_playlist')) return 'musical-notes';
  return 'volume-medium-outline';
}

/** Welcher Player gehört auf die Startseite? (rein, testbar)
 *
 * Spielt irgendwo Musik, ist es dieser; sonst Spotify mit Playlists und
 * Boxenwahl vor einer stillen Cast-Box. Spielen mehrere dasselbe (Spotify
 * oder Radio über eine Cast-Box: beide melden «playing»), gewinnt der mit
 * der eigenen Auswahl - nur dort gibt es Playlists, Sender, Zufall und
 * den Sprung zurück. Mit der blossen Box fehlten diese Knöpfe
 * ausgerechnet dann, wenn Musik lief. */
export function pickPlayer(entities: Entity[]): Entity | undefined {
  const players = entities.filter(istMusikbox);
  return (
    players.find((entity) => entity.state.state === 'playing' && hatEigeneAuswahl(entity)) ??
    players.find((entity) => entity.state.state === 'playing') ??
    players.find((entity) => entity.commands.includes('play_playlist')) ??
    players.find(hatEigeneAuswahl) ??
    players[0]
  );
}

/** Lesbarer Name einer Integration - für den Untertitel im Wähler. */
const INTEGRATION_NAMEN: Record<string, string> = {
  google_cast: 'Chromecast',
  androidtv: 'Android TV',
  spotify: 'Spotify',
  tunein: 'Radio',
};

/**
 * Der Untertitel eines Geräts im Wähler (rein, testbar).
 *
 * Meist nur die Art («Fernseher»). Gibt es aber einen Namensvetter
 * derselben Art - der Fernseher im Wohnzimmer steht als Android TV
 * *und* als Chromecast da, beide «Fernseher» -, kommt die Herkunft
 * dazu: «Fernseher · Chromecast». Sonst wählt man zweimal dasselbe
 * Wort und weiss nicht, welches die Musik kann und welches die Apps.
 */
export function geraeteUntertitel(entity: Entity, alle: Entity[]): string {
  const art = deviceKindLabel(entity);
  const eigener = entity.name.trim().toLowerCase().replace(/\s+/g, ' ');
  const vetter = alle.some(
    (anderes) =>
      anderes.id !== entity.id &&
      anderes.kind === entity.kind &&
      deviceKindLabel(anderes) === art &&
      // «Fernseher Wohnzimmer» und «Fernseher im Wohnzimmer» meinen
      // dasselbe Gerät - die Füllwörter zählen nicht.
      anderes.name.trim().toLowerCase().replace(/\s+/g, ' ').replace(/\bim\b ?/g, '') ===
        eigener.replace(/\bim\b ?/g, '')
  );
  if (!vetter) return art;
  const herkunft = INTEGRATION_NAMEN[entity.integration] ?? entity.integration;
  return `${art} · ${herkunft}`;
}

