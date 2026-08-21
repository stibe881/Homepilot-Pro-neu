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
      if (entity.integration === 'androidtv') return 'Fernseher';
      // Ein Gerät, das Sender kennt, ist ein Fernseher; eines, das nur
      // spielt und pausiert, eine Box.
      if (entity.commands.includes('launch_app')) return 'Fernseher';
      return 'Lautsprecher';

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
      return entity.integration === 'androidtv' ? 'tv-outline' : 'musical-notes-outline';
    default:
      return 'ellipse-outline';
  }
}
