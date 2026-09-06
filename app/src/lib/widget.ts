import { kann } from './plattform';

import { Entity, HubSettings } from '../api/types';
import { ablageDiagnose } from './huelle';
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

/** Das native Ablage-Modul, über Expos eigenen Auflöser.
 *
 *  Das JavaScript des Pakets (@bacons/apple-targets) sieht nur an einer
 *  einzigen Stelle nach - `globalThis.expo.modules.ExtensionStorage`,
 *  einmal beim Import - und fällt sonst still auf Attrappen zurück.
 *  Expo selbst kennt beim Auflösen nativer Module drei Wege: dieses
 *  Global, den Bridge-Proxy und das TurboModule-Register
 *  (expo-modules-core, requireOptionalNativeModule). Genau an diesem
 *  Unterschied hing zuletzt «Hülle zu alt», während nachweislich der
 *  frisch gebaute Build lief: Die Frage gehört an den Auflöser mit
 *  allen drei Wegen - und die Schreib- und Lesezugriffe gleich mit,
 *  darum unten der eigene Griff statt der Klasse des Pakets. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
function nativesModul(): any | null {
  if (!kann.widgets) return null;
  try {
    // Erst zur Laufzeit laden: Im Web-Bau soll der Import oben nichts
    // anfassen müssen, was es nur nativ gibt.
    const { requireOptionalNativeModule } = require('expo-modules-core');
    return requireOptionalNativeModule('ExtensionStorage') ?? null;
  } catch {
    return null;
  }
}

function modulDa(): boolean {
  return nativesModul() != null;
}

/** Lesen und Schreiben direkt am nativen Modul.
 *
 *  Alles, was die App ablegt, ist Text - setString genügt. Die
 *  Signaturen stehen in ExtensionStorageModule.swift des Pakets fest:
 *  (key, value, suite) fürs Schreiben, (key, suite) fürs Lesen. */
function storage(): {
  set: (key: string, wert: string) => void;
  get: (key: string) => string | null;
  remove: (key: string) => void;
  neuZeichnen: () => void;
} | null {
  const modul = nativesModul();
  if (modul == null) return null;
  return {
    set: (key, wert) => modul.setString(key, wert, APP_GROUP),
    get: (key) => modul.get(key, APP_GROUP) ?? null,
    remove: (key) => modul.remove(key, APP_GROUP),
    neuZeichnen: () => modul.reloadWidget(null),
  };
}

/** Wie viele Knöpfe wirklich in der Ablage liegen - zurückgelesen,
 *  nicht geglaubt. Null, wenn dort nichts (Lesbares) liegt. */
export function abgelegteKnoepfe(): number | null {
  const store = storage();
  if (store === null) return null;
  try {
    const roh = store.get('buttons');
    if (!roh) return null;
    const liste = JSON.parse(roh);
    return Array.isArray(liste) ? liste.length : null;
  } catch {
    return null;
  }
}

/** Die Lesespur des Widgets: Unix-Sekunden seines letzten Laufs.
 *
 *  Das Zurücklesen in syncWidget beweist nur, dass *dieser* Prozess
 *  seine eigene Ablage sieht. Ob der Widget-Prozess dieselben Daten
 *  bekommt, war bisher unbeweisbar - genau dort trennt sich «App-Gruppe
 *  funktioniert» von «jeder schreibt in seinen eigenen Topf» (etwa,
 *  wenn das Signierprofil die Gruppe nicht trägt). Deshalb hinterlässt
 *  das Widget bei jedem Zeitplan-Lauf einen Zeitstempel in der Ablage
 *  (index.swift); liegt er da, ist der Weg in beide Richtungen belegt.
 *  Ältere Builds schreiben ihn nie - dann bleibt es bei null, was
 *  ehrlich «kein Nachweis» heisst, nicht «kaputt». */
export function widgetSpur(): number | null {
  const store = storage();
  if (store === null) return null;
  try {
    const roh = store.get('widgetZuletztGelesen');
    const zahl = roh ? Number(roh) : NaN;
    return Number.isFinite(zahl) && zahl > 0 ? zahl : null;
  } catch {
    return null;
  }
}

/** Die Innenansicht für die Warnung: was die Hülle wirklich meldet.
 *
 *  Solange «Hülle zu alt» dastand, obwohl der neuste Build lief, war
 *  von aussen nicht zu unterscheiden, ob das Modul im Build fehlt oder
 *  nur die Suche danach ins Leere greift. Diese Zeile beantwortet das
 *  auf dem Bildschirmfoto selbst (ablageDiagnose). */
export function ablageEinblick(): string {
  if (!kann.widgets) return '';
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const expoGlobal = (globalThis as any).expo;
  let namen: string[] = [];
  try {
    namen = Object.keys(expoGlobal?.modules ?? {});
  } catch {
    namen = [];
  }
  return ablageDiagnose(expoGlobal != null, namen, modulDa());
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
    store.neuZeichnen();
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
