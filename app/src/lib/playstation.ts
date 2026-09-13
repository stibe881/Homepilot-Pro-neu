/**
 * Die PlayStation 5 in der App – Punkt 643 der Werkbank.
 *
 * Für den Hub ist die Konsole ein `media_player` mit Bildschirm, genau
 * wie der Android TV: Sie meldet an/aus, was gerade läuft, und kennt
 * ein Steuerkreuz. Deshalb greifen Kachel, Fernbedienung und die Karte
 * auf dem Sperrbildschirm von selbst - und genau das ist die Falle:
 * Was an einem Fernseher richtig ist, ist an einer Konsole halb falsch.
 *
 * - Ein Fernseher hat OK, Zurück und Home. Eine PlayStation hat Kreuz,
 *   Kreis, Dreieck und Viereck, dazu Share, PS und Options. Der Hub
 *   führt `ok`/`back`/`home` als Aliasse, damit die bestehende
 *   Fernbedienung nichts Falsches schickt - aber wer vor der Konsole
 *   sitzt, sucht das Kreuz und nicht «OK».
 * - Ein Fernseher wird mit einem Code vom Bildschirm gekoppelt. Die
 *   Konsole braucht zwei Schritte: erst das PSN-Konto im Browser, dann
 *   einen achtstelligen Code aus ihren Einstellungen.
 * - Auf einer Konsole «läuft» kein Sender und keine App, sondern ein
 *   Spiel.
 *
 * Hier steht, was davon entscheidbar ist - ohne React, damit es sich
 * prüfen lässt. Der Vertrag mit dem Hub (Felder, Befehle, Routen) steht
 * in `hub/homepilot/integrations/playstation.py`.
 */
import type { Entity } from '../api/types';
import type { Symbolname } from './symbole';

/**
 * Ist das eine PlayStation? (rein, testbar)
 *
 * Zwei Wege, wie bei `isTelevision`: Die Integration sagt es - oder die
 * Befehle verraten es. `cross` kennt sonst kein Gerät im Haus; so
 * erkennt die App auch eine Konsole, deren Hub-Fassung das Feld
 * `integration` anders nennt.
 */
export function istPlaystation(entity: Entity | null | undefined): boolean {
  if (!entity) return false;
  if (entity.integration === 'playstation') return true;
  return Array.isArray(entity.commands) && entity.commands.includes('cross');
}

/** Eine Taste der Konsolen-Fernbedienung: Befehl, Zeichen, Beschriftung. */
export interface PsTaste {
  command: string;
  icon: Symbolname;
  label: string;
}

/**
 * Die vier Symboltasten, in der Anordnung des Controllers (rein, Daten).
 *
 * Dreieck oben, Viereck links, Kreis rechts, Kreuz unten - so liegen
 * sie unter dem rechten Daumen, und so sucht man sie auch auf dem
 * Telefon. Als Ionicons-Zeichen, nicht als Schriftzeichen ✕○△□: Die
 * sähen je nach Schrift auf iPhone, iPad und im Browser anders aus,
 * und das Kreuz wäre auf manchem Gerät ein Rechenzeichen. Keines der
 * Zeichen steht in GLEICHBEDEUTEND (lib/symbole.ts); ein Test hält das
 * fest.
 */
export const PS_SYMBOLTASTEN: {
  oben: PsTaste;
  links: PsTaste;
  rechts: PsTaste;
  unten: PsTaste;
} = {
  oben: { command: 'triangle', icon: 'triangle-outline', label: 'Dreieck' },
  links: { command: 'square', icon: 'square-outline', label: 'Viereck' },
  rechts: { command: 'circle', icon: 'ellipse-outline', label: 'Kreis' },
  unten: { command: 'cross', icon: 'close', label: 'Kreuz' },
};

/**
 * Die Reihe unter den Symboltasten: Share · PS · Options (rein, Daten).
 *
 * In der Reihenfolge des Controllers - Share links vom Touchpad, Options
 * rechts, die PS-Taste in der Mitte. Options bekommt die drei Striche,
 * die auch auf der Taste stehen, nicht die Schieberegler von
 * «einstellen»: Es öffnet das Spielmenü, keine Einstellungen.
 */
export const PS_REIHE: readonly PsTaste[] = [
  { command: 'share', icon: 'share-outline', label: 'Share' },
  { command: 'ps', icon: 'logo-playstation', label: 'PS' },
  { command: 'options', icon: 'menu-outline', label: 'Options' },
];

/** Alle Tasten der Konsolen-Fernbedienung, für Tests und Übersichten. */
export function psTasten(): PsTaste[] {
  const { oben, links, rechts, unten } = PS_SYMBOLTASTEN;
  return [oben, links, rechts, unten, ...PS_REIHE];
}

/**
 * Was oben auf der Fernbedienung steht (rein, testbar).
 *
 * Der Name der Konsole gross, darunter das laufende Spiel - oder, wenn
 * keines läuft, der Zustand. «Standby» ist dabei eine eigene Auskunft
 * und nicht «Aus»: Aus dem Standby lässt sich die Konsole aufwecken,
 * aus dem Aus nicht - wer das Blatt öffnet und «Aus» liest, drückt die
 * Ein-Taste vergebens.
 */
export function psKopf(entity: Entity): { titel: string; unter: string } {
  const titel = String(entity.name ?? '').trim() || 'PlayStation';
  return { titel, unter: psZustand(entity) };
}

/**
 * Der Zustand der Konsole in einem Wort (rein, testbar): das Spiel,
 * «Eingeschaltet», «Standby» oder «Aus».
 */
export function psZustand(entity: Entity): string {
  const an = String(entity.state?.state ?? '') === 'on';
  const app = entity.state?.app ? String(entity.state.app) : null;
  if (an && app) return app;
  if (an) return 'Eingeschaltet';
  return entity.state?.standby === true ? 'Standby' : 'Aus';
}

// ── Kopplung ────────────────────────────────────────────────────────────

/** Was der Hub über die Kopplung sagt (`GET /api/playstation/{id}/pair`). */
export interface KopplungsStand {
  /** Das PSN-Konto liegt vor (Schritt 1). */
  account: boolean;
  /** Konto und Registrierung liegen vor (Schritt 2). */
  paired: boolean;
  /** Der Anzeigename des Kontos, wenn eines da ist. */
  online_id: string | null;
  /** Ob der Hub die Remote-Play-Bibliothek hat. Ohne sie gibt es
   *  Zustand und Aufwecken, aber weder Tasten noch Kopplung. */
  remote_play: boolean;
}

/**
 * Welcher Schritt der Kopplung dran ist.
 *
 * - `ohne_bibliothek`: Der Hub hat kein Remote Play - koppeln geht
 *   nicht, und ein Knopf dafür wäre eine Sackgasse.
 * - `konto`: Erst im Browser beim PSN anmelden und die Adresse der
 *   Rückkehr-Seite einfügen.
 * - `code`: Konto da; jetzt den achtstelligen Code von der Konsole.
 * - `gekoppelt`: beides da.
 */
export type KopplungsSchritt = 'ohne_bibliothek' | 'konto' | 'code' | 'gekoppelt';

/**
 * Welcher Schritt dran ist (rein, testbar).
 *
 * Die Bibliothek zuerst: Ohne sie kommt auch die PSN-Anmeldung nicht
 * zustande (sie ist Teil derselben Bibliothek), und der Benutzer stünde
 * nach dem Anmelden vor einer Absage, die schon vorher feststand.
 */
export function kopplungsSchritt(
  stand: Partial<KopplungsStand> | null | undefined
): KopplungsSchritt {
  if (stand?.remote_play === false) return 'ohne_bibliothek';
  if (stand?.account !== true) return 'konto';
  if (stand?.paired !== true) return 'code';
  return 'gekoppelt';
}

/** So viele Ziffern zeigt die Konsole unter «Gerät verbinden». */
export const PIN_LAENGE = 8;

/**
 * Was von der Tastatur als Code übrig bleibt (rein, testbar).
 *
 * Die Konsole zeigt acht Ziffern, gern als «1234 5678»; getippt wird
 * auf einem Telefon, und die Zifferntastatur setzt keine Lücken. Nur
 * Ziffern - anders als beim Fernseher, dessen Code auch Buchstaben hat.
 */
export function pinSauber(text: string): string {
  return String(text ?? '')
    .replace(/[^0-9]/g, '')
    .slice(0, PIN_LAENGE);
}

/** Darf der Knopf «Koppeln» drücken? (rein, testbar) */
export function pinVollstaendig(text: string): boolean {
  return pinSauber(text).length === PIN_LAENGE;
}

/**
 * Die Rückkehr-Adresse, wie sie zum Hub geht (rein, testbar).
 *
 * Aus der Adresszeile des Browsers kopiert man sie mit Zeilenumbruch
 * und Leerzeichen drumherum - die gehören nicht dazu.
 */
export function adresseSauber(text: string): string {
  return String(text ?? '').trim();
}

/**
 * Sieht das nach der Rückkehr-Seite aus? (rein, testbar)
 *
 * Nach der PSN-Anmeldung landet der Browser auf einer Seite, die «Diese
 * Seite kann nicht angezeigt werden» sagt - und genau ihre Adresse
 * braucht der Hub, denn darin steckt der Code (`code=`). Der naheliegende
 * Fehler ist, stattdessen die Adresse der Anmeldeseite zu kopieren; die
 * hat keinen Code, und der Hub könnte nur «ging nicht» sagen. Hier steht
 * die Absage schon, bevor etwas losgeht.
 */
export function adresseBrauchbar(text: string): boolean {
  const adresse = adresseSauber(text);
  return /^https?:\/\//i.test(adresse) && adresse.includes('code=');
}

/** Wortlaut zu jedem Schritt - an einer Stelle, damit Kachel und Test
 *  dasselbe sagen (rein, Daten). */
export const KOPPLUNGS_TEXTE: Record<KopplungsSchritt, { kopf: string; hinweis: string }> =
  {
    ohne_bibliothek: {
      kopf: 'Koppeln nicht möglich',
      hinweis:
        'Dem Hub fehlt die Remote-Play-Bibliothek. Zustand und Aufwecken gehen trotzdem; Tasten und Standby brauchen sie.',
    },
    konto: {
      kopf: 'Schritt 1 von 2: PSN-Konto',
      hinweis:
        'Zuerst im Browser beim PlayStation Network anmelden. Danach zeigt der Browser eine Seite, die sich nicht öffnen lässt - ihre Adresse hier einfügen.',
    },
    code: {
      kopf: 'Schritt 2 von 2: Code von der Konsole',
      hinweis:
        'Auf der PS5: Einstellungen → System → Remote Play → Gerät verbinden. Dort steht ein achtstelliger Code - die Konsole muss dabei an sein.',
    },
    gekoppelt: {
      kopf: 'Gekoppelt',
      hinweis: 'Fernbedienung, Standby und Aufwecken gehorchen der App.',
    },
  };
