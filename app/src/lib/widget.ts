import { kann } from './plattform';

import { Entity, HubSettings } from '../api/types';
import { WidgetButton } from './widgetButtons';
import { watchKontext } from './watchkontext';

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
 *
 * «huelle-alt» ist der zweite stumme Fall, und er sah bis jetzt genauso
 * aus: Das native Ablage-Modul steckt nicht in der installierten Hülle
 * (der Build ist älter als die Widget-Ablage). Das JavaScript-Paket
 * fällt dann lautlos auf Attrappen zurück - jedes Schreiben tut nichts,
 * und kein OTA-Update kann das nachliefern, nur ein TestFlight-Build.
 * Zwei Ursachen, zwei Abhilfen - eine Anzeige, die sie zusammenwarf,
 * schickte einen ins Apple-Portal, wenn ein Build fällig war.
 */
export type Ablage = 'kein-widget' | 'ok' | 'fehlt' | 'huelle-alt';

/** Welcher der Fälle vorliegt (rein, testbar). */
export function ablageBefund(modulDa: boolean, zurueckgelesen: boolean): Ablage {
  if (!modulDa) return 'huelle-alt';
  return zurueckgelesen ? 'ok' : 'fehlt';
}

/** Steckt das native Ablage-Modul in dieser Hülle?
 *
 *  Nachgesehen wird exakt dort, wo das Paket selbst entscheidet, ob es
 *  echt schreibt oder still auf Attrappen zurückfällt
 *  (@bacons/apple-targets, ExtensionStorage.js: `expo.modules
 *  .ExtensionStorage`). Vorher lief die Frage über
 *  requireOptionalNativeModule aus dem expo-Paket - ein zweiter Weg zur
 *  selben Antwort, nur mit eigenen Fehlerquellen. Zwei Stellen, die
 *  dieselbe Frage verschieden beantworten können, sind eine zu viel:
 *  Genau hier hing «Hülle zu alt», während der neuste Build installiert
 *  war. */
function modulDa(): boolean {
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    return (globalThis as any).expo?.modules?.ExtensionStorage != null;
  } catch {
    return false;
  }
}

// Das Modul wird erst zur Laufzeit geladen (unten) - einen Typ gibt es
// deshalb hier nicht.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
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
    // Aufräumen: Hier lagen einmal die «eigenen Karten» - eine zweite
    // Liste für eine eigene Widget-Art, die niemand fand. Die Knöpfe
    // sind jetzt die eine Liste; der Schlüssel soll nicht als Altlast
    // liegen bleiben.
    store.remove('karten');
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
    // Zurücklesen, statt dem Schreiben zu glauben - und die beiden
    // stummen Fälle auseinanderhalten (ablageBefund).
    return ablageBefund(modulDa(), !!store.get('buttons'));
  } catch {
    // Ein Widget, das nicht aktualisiert, ist kein Grund, die App zu
    // stören.
    return ablageBefund(modulDa(), false);
  }
}

/** Die Schlüssel des Türknopfs in der App-Gruppe - eigene, getrennt vom
 *  Hausstand: Wer den Hausstand aus hat, hat damit nur über das *Widget*
 *  entschieden, nicht über den Türknopf, und umgekehrt. */
export const TUERKNOPF_SCHLUESSEL = [
  'tuerKnopf',
  'tuerUrl',
  'tuerToken',
  'tuerPfad',
  'tuerBefehl',
] as const;

/**
 * Was der Öffnen-Knopf auf der Sperrbildschirm-Karte braucht (rein,
 * testbar) - oder null, wenn es (noch) nichts zu hinterlegen gibt.
 *
 * Dieselbe Türwahl wie überall (lib/watchkontext.ts): Der Knopf im
 * Widget-Prozess soll exakt die Türe öffnen, die auch App und Watch
 * meinen - zwei Meinungen darüber wären eine zu viel.
 */
export function tuerKnopfWerte(
  settings: Pick<HubSettings, 'url' | 'token'>,
  entities: Entity[]
): Record<string, string> | null {
  const kontext = watchKontext(settings, entities);
  if (!kontext || !kontext.doorPath) return null;
  return {
    tuerKnopf: '1',
    tuerUrl: kontext.hubUrl,
    tuerToken: kontext.token,
    tuerPfad: kontext.doorPath,
    tuerBefehl: kontext.doorBody,
  };
}

/**
 * Den Türknopf in der App-Gruppe hinterlegen oder wegräumen.
 *
 * `werte === null` räumt ALLE Schlüssel weg - der Aus-Schalter muss
 * auch das Token entfernen, nicht nur die Flagge: Ein Token, das
 * niemand mehr braucht, hat im Widget-Prozess nichts verloren.
 */
export function schreibeTuerKnopf(werte: Record<string, string> | null): void {
  const store = storage();
  if (store === null) return;
  try {
    if (werte) {
      for (const [name, wert] of Object.entries(werte)) store.set(name, wert);
    } else {
      for (const name of TUERKNOPF_SCHLUESSEL) store.remove(name);
    }
  } catch {
    // Wie beim Widget: kein Grund, die Bedienung zu stören.
  }
}
