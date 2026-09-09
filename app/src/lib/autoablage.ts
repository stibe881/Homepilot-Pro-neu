import { HubSettings } from '../api/types';
import { Autoknopf, autoKnoepfe } from './auto';
import { WidgetButton } from './widgetButtons';

/**
 * Was das Auto zu sehen bekommt - hinterlegt, wo es beide Seiten lesen.
 *
 * Der Bildschirm im Auto läuft in einem eigenen Dienst, der startet,
 * wenn jemand den Stecker einsteckt - oft ohne dass die App je offen
 * war. Er kann deshalb nichts fragen: Alles, was er braucht (Adresse,
 * Token, Knöpfe), muss schon dastehen. Dieselbe Bauart wie beim
 * Sperrbildschirm-Widget (lib/widget.ts), nur ein anderer Topf:
 * SharedPreferences statt App-Gruppe.
 *
 * Das native Modul ist bewusst *optional* gesucht: Wer eine Hülle ohne
 * es hat - jedes Telefon vor dem nächsten Bau -, soll keine Abstürze
 * bekommen, sondern schlicht kein Auto-Bild. Genau diesen Fall hat die
 * Widget-Ablage einmal falsch gemacht.
 */

export type Autostand =
  /** Hinterlegt, das Auto findet Knöpfe. */
  | 'ok'
  /** Diese Hülle kennt die Ablage noch nicht - ein Bau steht aus. */
  | 'huelle-alt'
  /** Kein Knopf schaltet selbst; im Auto gäbe es nichts zu tippen. */
  | 'keine-knoepfe';

/** Wie der Topf heisst - dieselbe Zeichenkette steht im Kotlin. Wer sie
 *  hier ändert, muss sie dort ändern, sonst schreiben zwei Seiten
 *  aneinander vorbei. */
export const ABLAGE = 'homepilot_auto';

function modul(): {
  setzen: (schluessel: string, wert: string) => void;
  entfernen: (schluessel: string) => void;
} | null {
  try {
    // Erst zur Laufzeit laden: Im Web-Bau soll der Import oben nichts
    // anfassen müssen, was es nur nativ gibt.
    const { requireOptionalNativeModule } = require('expo-modules-core');
    return requireOptionalNativeModule('AutoAblage') ?? null;
  } catch {
    return null;
  }
}

/**
 * Adresse, Token und Knöpfe fürs Auto hinterlegen.
 *
 * Wird bei jeder Änderung aufgerufen - andere Verbindung, andere
 * Knopfliste -, genau wie `syncWidget`.
 */
export function syncAuto(
  settings: HubSettings,
  buttons: WidgetButton[]
): Autostand {
  const ablage = modul();
  if (ablage === null) return 'huelle-alt';
  const knoepfe: Autoknopf[] = autoKnoepfe(buttons);
  try {
    if (knoepfe.length === 0) {
      // Nichts schreiben, sondern leeren: Sonst stünde im Auto die
      // Liste von gestern, während die App längst eine andere zeigt.
      ablage.entfernen('knoepfe');
    } else {
      ablage.setzen('knoepfe', JSON.stringify(knoepfe));
    }
    if (settings.url && settings.token) {
      ablage.setzen('hubUrl', settings.url.replace(/\/+$/, ''));
      ablage.setzen('hubToken', settings.token);
    } else {
      ablage.entfernen('hubUrl');
      ablage.entfernen('hubToken');
    }
  } catch {
    // Ein Topf, der nicht schreibt, ist kein Grund, die App
    // anzuhalten - das Auto bleibt dann eben leer.
    return 'huelle-alt';
  }
  return knoepfe.length > 0 ? 'ok' : 'keine-knoepfe';
}
