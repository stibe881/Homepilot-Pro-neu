import { Entity } from '../api/types';
import { timerZeile } from '../lib/fernsehtimer';
import { zustandsText } from '../lib/haushalt';
import { zustandWort } from '../lib/saugerkarte';
import { aktiveVorgabe } from '../lib/storenvorgaben';

/**
 * Ein Gerät in einer Zeile: sein Zustand in einem Wort.
 *
 * Hier stand die Raum-Kachel der Seite «Räume» – eine Liste der Geräte
 * mit Schaltknopf je Zeile. Sie ist der Kachel mit Kopfbild gewichen
 * (components/RoomCard.tsx); übrig bleibt die Übersetzung, die mit ihr
 * nichts zu tun hatte und anderswo weiterlebt: in den kleinen
 * Raumfliesen der Startseite.
 *
 * Das Sinnbild zur Geräteart stand bis Punkt 611 der Werkbank ebenfalls
 * hier (`KIND_ICONS`) - als zweite Tabelle neben `deviceKindIcon` in
 * lib/geraeteart.ts, und die beiden widersprachen sich. Jetzt gibt es
 * nur noch die eine.
 *
 * Der Dateiname bleibt, damit die Verweise darauf nicht wandern müssen.
 */

/** Kurzer Zustand für die rechte Spalte – nur für nicht schaltbare Geräte. */
export function shortState(entity: Entity): string {
  const state = entity.state.state;
  switch (entity.kind) {
    case 'cover': {
      const position = entity.state.position;
      const tilt = entity.state.tilt;
      // Dieselben Worte wie die Stellungs-Chips der Gerätekachel
      // (lib/storenvorgaben.ts): «0 % offen» war für eine Store in
      // Beschattung die halbe Wahrheit - unten stimmt, aber durch die
      // offenen Lamellen kommt Licht. Von der Höhe allein ist genau
      // das nicht abzulesen.
      const stellung = aktiveVorgabe(
        typeof position === 'number' ? position : null,
        typeof tilt === 'number' ? tilt : null,
        entity.commands.includes('set_tilt')
      );
      if (stellung === 'schatten') return 'Beschattung';
      if (stellung === 'zu') return 'Zu';
      if (stellung === 'auf') return 'Offen';
      if (typeof position === 'number') return `${position}% offen`;
      return state === 'closed' ? 'Zu' : state === 'open' ? 'Offen' : '–';
    }
    case 'sensor':
      return `${state ?? '–'}${entity.state.unit ?? ''}`;
    case 'binary_sensor':
      return state === 'on' ? 'Aktiv' : 'Ruhig';
    case 'button':
      // Was zuletzt gedrückt wurde – ein Taster hat keinen Zustand.
      return state === 'long' ? 'Lang' : state === 'short' ? 'Kurz' : 'Bereit';
    case 'media_player':
      return state === 'playing' ? 'Spielt' : 'Still';
    case 'timer':
      // «Läuft» beantwortet die Frage nicht, die man an einen Timer hat:
      // wie lange noch. Siehe lib/fernsehtimer.
      return timerZeile(entity, Date.now());
    case 'lock':
      return state === 'locked' ? 'Zu' : 'Offen';
    case 'vacuum':
      // Über die gemeinsame Übersetzung: «segment_cleaning» ist auch
      // Reinigen, und ein Bezeichner gehört auf keine Kachel
      // (lib/saugerkarte.ts).
      return zustandWort(state);
    case 'appliance':
      // Nicht «sonst Bereit»: Ein Gerät im Standby oder ohne je gehörte
      // Meldung ist nicht bereit, es schweigt nur.
      return zustandsText(state);
    case 'scene':
      // «Gilt», solange die Lampen so stehen, wie die Szene sie gesetzt
      // hat. Die Bridge meldet es; wer eine Lampe von Hand verstellt,
      // hat die Szene verlassen.
      return state === 'active' ? 'Gilt' : 'Bereit';
    default:
      return String(state ?? '–');
  }
}
