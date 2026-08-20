import { Platform } from 'react-native';

import { HubSettings } from '../api/types';

/**
 * Das Homescreen-Widget mit Daten versorgen.
 *
 * Das Widget ist ein eigener Prozess und kennt die App-Einstellungen
 * nicht. Damit es «Türe offen» zeigen kann, braucht es Adresse und
 * Token – die legt die App in der geteilten App-Gruppe ab.
 *
 * Das ist eine bewusste Abwägung, keine Nebensache: Ein Token im
 * Widget-Prozess ist eine Angriffsfläche mehr. Für eine blosse
 * Knopfleiste wäre sie den Preis nicht wert; für ein Widget, das den
 * Türstatus zeigt, ist die Rechnung eine andere. Wer sie anders sieht,
 * schaltet es aus – dann steht in der App-Gruppe nichts, und das Widget
 * zeigt wieder nur die drei Abkürzungen.
 *
 * Auf Android und im Web passiert hier nichts: Es gibt kein Widget.
 */

/** Muss zur App-Gruppe in app.json und im Widget (index.swift) passen. */
const APP_GROUP = 'group.me.stibe.homepilot';

function storage(): any | null {
  if (Platform.OS !== 'ios') return null;
  try {
    // Erst zur Laufzeit laden: Auf Android und im Web gibt es das Modul
    // gar nicht, und ein Import oben würde den Start zerlegen.
    const { ExtensionStorage } = require('@bacons/apple-targets');
    return new ExtensionStorage(APP_GROUP);
  } catch {
    return null;
  }
}

/**
 * Adresse und Token für das Widget hinterlegen – oder löschen.
 *
 * Wird bei jeder Änderung der Verbindung aufgerufen. Ohne `enabled`
 * bleibt die App-Gruppe leer.
 */
export function syncWidget(settings: HubSettings, enabled: boolean): void {
  const store = storage();
  if (store === null) return;
  try {
    if (enabled && settings.url && settings.token) {
      store.set('hubUrl', settings.url.replace(/\/+$/, ''));
      store.set('hubToken', settings.token);
    } else {
      store.remove('hubUrl');
      store.remove('hubToken');
    }
    // Sofort neu zeichnen, sonst zeigt das Widget bis zur nächsten
    // Viertelstunde den alten Stand - oder gar nichts, obwohl man es
    // gerade eingeschaltet hat.
    const { ExtensionStorage } = require('@bacons/apple-targets');
    ExtensionStorage.reloadWidget();
  } catch {
    // Ein Widget, das nicht aktualisiert, ist kein Grund, die App zu
    // stören.
  }
}
