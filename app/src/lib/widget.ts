import { kann } from './plattform';

import { HubSettings } from '../api/types';
import { WidgetButton } from './widgetButtons';

/**
 * Das Homescreen-Widget mit Daten versorgen.
 *
 * Das Widget ist ein eigener Prozess und kennt die App-Einstellungen
 * nicht. Was es zeigen soll, muss also jemand hinterlegen – die App legt
 * es in der geteilten App-Gruppe ab.
 *
 * Zweierlei landet dort, und sie hängen an verschiedenen Bedingungen:
 *
 * - Die **Knöpfe** immer. Sie sind eine Liste von Titeln, Symbolen und
 *   homepilot://-Adressen – nichts davon ist ein Geheimnis, und ohne sie
 *   hätte das Widget gar keinen Inhalt.
 * - **Adresse und Token** nur, wenn der Hausstand eingeschaltet ist. Ein
 *   Token im Widget-Prozess ist eine Angriffsfläche mehr. Für eine
 *   blosse Knopfleiste wäre sie den Preis nicht wert; für ein Widget,
 *   das «Türe offen» zeigt, ist die Rechnung eine andere. Wer sie anders
 *   sieht, schaltet es aus – dann steht dort kein Token, und das Widget
 *   zeigt nur noch die Knöpfe.
 *
 * Auf Android und im Web passiert hier nichts: Es gibt kein Widget.
 */

/** Muss zur App-Gruppe in app.json und im Widget (index.swift) passen. */
const APP_GROUP = 'group.me.stibe.homepilot';

/**
 * Ob die Ablage überhaupt funktioniert.
 *
 * «fehlt» ist kein theoretischer Fall: Die App-Gruppe muss im
 * Apple-Portal angelegt und beiden Kennungen zugewiesen sein. Ist sie es
 * nicht, schluckt iOS jedes Schreiben stillschweigend – die App meldet
 * Erfolg, das Widget liest nichts und zeigt bis in alle Ewigkeit, es sei
 * nicht eingeschaltet. Deshalb wird nach dem Schreiben zurückgelesen.
 */
export type Ablage = 'kein-widget' | 'ok' | 'fehlt';

function storage(): any | null {
  if (!kann.widgets) return null;
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
 * Knöpfe, Adresse und Token für das Widget hinterlegen.
 *
 * Wird bei jeder Änderung aufgerufen: andere Verbindung, anderer
 * Schalterstand, andere Knopfliste.
 */
export function syncWidget(
  settings: HubSettings,
  enabled: boolean,
  buttons: WidgetButton[]
): Ablage {
  const store = storage();
  if (store === null) return 'kein-widget';
  try {
    // Ohne Knöpfe nichts schreiben: Beim Start steht die Geräteliste
    // noch aus, und eine leere Liste hiesse für das Widget «keine
    // Knöpfe» – es stünde für einen Moment leer da.
    if (buttons.length > 0) {
      store.set('buttons', JSON.stringify(buttons));
    }
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
    // Zurücklesen, statt dem Schreiben zu glauben.
    return store.get('buttons') ? 'ok' : 'fehlt';
  } catch {
    // Ein Widget, das nicht aktualisiert, ist kein Grund, die App zu
    // stören.
    return 'fehlt';
  }
}
