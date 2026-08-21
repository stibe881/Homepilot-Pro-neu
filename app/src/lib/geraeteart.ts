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
 * Unterschieden wird an den Befehlen, nicht am Hersteller: Was ein
 * Steuerkreuz oder einen App-Start kennt, ist ein Fernseher – das gilt
 * auch für den nächsten, der nicht von Nvidia kommt. Ein Chromecast am
 * Fernseher bleibt dabei eine Box: Er kann nur Ton abspielen, und genau
 * dafür wird er hier gebraucht.
 */
export function isTelevision(entity: Entity): boolean {
  if (entity.kind !== 'media_player') return false;
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
      // ob jemand zuhause ist, nicht ob sich etwas bewegt.
      if (entity.integration === 'geofence') return 'Anwesenheit (Standort)';
      if (entity.integration === 'unifi') return 'Anwesenheit (WLAN)';
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
      if (entity.integration === 'geofence' || entity.integration === 'unifi') {
        return 'people-outline';
      }
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

/** Welcher Player gehört auf die Startseite? (rein, testbar)
 *
 * Spielt irgendwo Musik, ist es dieser; sonst Spotify mit Playlists und
 * Boxenwahl vor einer stillen Cast-Box. Spielen mehrere dasselbe (Spotify
 * über eine Cast-Box: beide melden «playing»), gewinnt Spotify - nur dort
 * gibt es Zufall, Wiederholen und den Sprung zurück. Mit der blossen Box
 * fehlten diese Knöpfe ausgerechnet dann, wenn Musik lief. */
export function pickPlayer(entities: Entity[]): Entity | undefined {
  const players = entities.filter(istMusikbox);
  return (
    players.find(
      (entity) =>
        entity.state.state === 'playing' && entity.commands.includes('play_playlist')
    ) ??
    players.find((entity) => entity.state.state === 'playing') ??
    players.find((entity) => entity.commands.includes('play_playlist')) ??
    players[0]
  );
}
