import { kann } from './plattform';

import { Entity, HubSettings } from '../api/types';
import { WidgetButton } from './widgetButtons';
import { WidgetKarte } from './widgetKarten';
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
 * - Die **Karten** ebenso: die selbst zusammengestellten Widgets, je
 *   eines für ein Gerät oder eine Szene. Auch sie sind nur Namen und
 *   Adressen; den Zustand holt sich das Widget selbst – und nur, wenn
 *   der Hausstand an ist.
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
  buttons: WidgetButton[],
  karten: WidgetKarte[] = []
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
    // Die Karten dagegen dürfen leer sein, und dann muss die Ablage auch
    // leer werden: Wer seine letzte Karte entfernt, soll sie nicht als
    // Auswahl weiterstehen sehen, wenn er ein Widget anlegt. Nur beim
    // allerersten Zeichnen wird nichts geschrieben - dort ist «leer»
    // bloss «noch nicht geladen».
    if (buttons.length > 0 || karten.length > 0) {
      store.set('karten', JSON.stringify(karten));
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
