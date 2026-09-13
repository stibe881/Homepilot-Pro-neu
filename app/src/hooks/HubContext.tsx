import React, { createContext, useCallback, useContext, useMemo, useState } from 'react';

import { Entity, HubSettings, User } from '../api/types';
import { Blatt, dazu, haeltWach as stapelHaeltWach, ohne } from '../lib/blattstapel';

/**
 * Zugangsdaten und Gerätebestand für alle, per Context statt Schleppe.
 *
 * `settings` und `entities` wanderten bisher als Props durch jede Ebene –
 * DashboardScreen → Screen → Karte → Zeile –, auch durch Komponenten, die
 * beides nur weiterreichen. Jede neue Zwischenebene musste die Schleppe
 * mittragen, und jede Signatur wurde um zwei Standard-Props länger.
 *
 * Der Provider liegt einmal um den Dashboard-Inhalt; wer die Daten
 * braucht, holt sie mit `useHubKontext()` (oder gezielt `useSettings()` /
 * `useEntities()`) dort ab, wo er sie verwendet.
 *
 * Bestehende Props verschwinden nicht auf einen Schlag – neue Komponenten
 * greifen zum Context, bestehende ziehen nach, wenn man sie ohnehin
 * anfasst (Punkt 61 der Werkbank).
 */

interface HubKontext {
  settings: HubSettings;
  entities: Entity[];
  user: User | null;
}

const Kontext = createContext<HubKontext | null>(null);

export function HubProvider({
  settings,
  entities,
  user,
  children,
}: HubKontext & { children: React.ReactNode }) {
  // Ein stabiles Objekt, damit nicht jede Elternzeichnung alle Verbraucher
  // neu zeichnet, obwohl sich nichts geändert hat.
  const wert = useMemo(() => ({ settings, entities, user }), [settings, entities, user]);
  return <Kontext.Provider value={wert}>{children}</Kontext.Provider>;
}

export function useHubKontext(): HubKontext {
  const wert = useContext(Kontext);
  if (!wert) {
    // Laut statt leise: Ein Verbraucher ausserhalb des Providers bekäme
    // sonst undefined-Zugangsdaten und scheiterte erst beim ersten Abruf.
    throw new Error('useHubKontext braucht einen <HubProvider> darüber.');
  }
  return wert;
}

export function useSettings(): HubSettings {
  return useHubKontext().settings;
}

export function useEntities(): Entity[] {
  return useHubKontext().entities;
}

/**
 * Die Meldungen der Startseite - und wer sie gerade zeigen darf.
 *
 * Punkt 581 der Werkbank: Fehler, Bestätigung und «Rückgängig» lagen
 * als drei Einblendungen im Wurzel-View, und ein natives Modal deckte
 * sie zu. Die Fernbedienung bekam die Absage deshalb als Prop - als
 * Einzige. Jetzt liegen die Meldungen einmal im Context, und das
 * `<Meldungsband/>` (components/Toast.tsx) zeichnet sie dort, wo man
 * gerade hinschaut: im obersten offenen Blatt (components/Blatt.tsx),
 * sonst im Wurzel-View. Welches Blatt oben liegt, sagt der Stapel
 * (lib/blattstapel.ts).
 *
 * Dazu `beruehrt()` (Punkt 582): Die Drei-Minuten-Rückkehr des
 * Wandpanels zählte nur Tipps im Wurzel-View - Tipps in einem Modal
 * kamen dort nie an, und mitten im Rezept sprang das Panel auf die
 * Startseite. Jedes Blatt meldet seine Berührungen hierher.
 */
export interface Meldungen {
  /** Die letzte Absage des Hubs oder ein fehlgeschlagener Abruf. */
  fehler: string | null;
  fehlerWeg: () => void;
  /** Die kurze Bestätigung, dass etwas geklappt hat. */
  note: string | null;
  noteWeg: () => void;
  /** Das Angebot, das Letzte zurückzunehmen (lib/rueckgriff.ts). */
  rueck: {
    what: { name: string; label: string };
    onUndo: () => void;
    onDismiss: () => void;
  } | null;
}

export interface Blattstapel {
  stapel: Blatt[];
  anmelden: (blatt: Blatt) => void;
  abmelden: (kennung: number) => void;
  /** Hält gerade ein offenes Blatt das Gerät wach? */
  haeltWach: boolean;
}

interface BlattKontext extends Blattstapel {
  meldungen: Meldungen;
  /** Eine Berührung irgendwo - auch in einem Blatt. */
  beruehrt: () => void;
}

const Blattkontext = createContext<BlattKontext | null>(null);

/** Der Stapel der offenen Blätter, gehalten von der Startseite - sie
 *  braucht `haeltWach` selbst, für die Rückkehr. */
export function useBlattstapel(): Blattstapel {
  const [stapel, setStapel] = useState<Blatt[]>([]);
  const anmelden = useCallback((blatt: Blatt) => setStapel((alt) => dazu(alt, blatt)), []);
  const abmelden = useCallback((kennung: number) => setStapel((alt) => ohne(alt, kennung)), []);
  return useMemo(
    () => ({ stapel, anmelden, abmelden, haeltWach: stapelHaeltWach(stapel) }),
    [stapel, anmelden, abmelden]
  );
}

export function MeldungsProvider({
  meldungen,
  blaetter,
  beruehrt,
  children,
}: {
  meldungen: Meldungen;
  blaetter: Blattstapel;
  beruehrt: () => void;
  children: React.ReactNode;
}) {
  const wert = useMemo(
    () => ({ ...blaetter, meldungen, beruehrt }),
    [blaetter, meldungen, beruehrt]
  );
  return <Blattkontext.Provider value={wert}>{children}</Blattkontext.Provider>;
}

/** Leise statt laut, anders als `useHubKontext`: Ein Blatt ausserhalb
 *  des Providers (Kinder-Ansicht, Tests) soll weiterhin aufgehen - es
 *  zeigt dann bloss keine Meldungen, wie bisher. */
export function useBlattKontext(): BlattKontext | null {
  return useContext(Blattkontext);
}

export function useMeldung(): Meldungen | null {
  return useContext(Blattkontext)?.meldungen ?? null;
}
