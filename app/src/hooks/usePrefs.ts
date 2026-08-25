import { useCallback, useEffect, useRef, useState } from 'react';

import { HubSettings } from '../api/types';
import { hubClient } from '../api/client';

/**
 * Einstellungen der Oberfläche – zwei Ablagen, ein Muster.
 *
 * **Haushaltsweit** (`/api/houseprefs`): wie das Haus aussieht.
 * Ausgeblendete und gesperrte Geräte, Kachel-Reihenfolgen, die Knöpfe im
 * Widget, die Face-ID-Hürde. Wer das anpasst, passt es für alle an – auf
 * dem Wandpanel wie auf dem Telefon, bei Stefan wie bei Livia. Das ist
 * der ausdrückliche Wunsch: Eine Wohnung, die bei jedem anders aussieht,
 * ist keine eingerichtete Wohnung.
 *
 * **Persönlich** (`/api/prefs`): was nur einen selbst angeht. Übrig
 * geblieben ist die Lesemarke der «Was ist neu»-Karte – und die gehört
 * dorthin: Sie ist keine Einstellung, sondern ein «gelesen». Wäre sie
 * haushaltsweit, nähme der Erste sie allen anderen weg.
 *
 * Beides liegt auf dem Hub, nicht im Speicher der App: Sonst hält es
 * genau so lange wie die Installation auf diesem einen Telefon.
 */

/** Wie das Haus für alle aussieht. */
export interface HousePrefs {
  /** Kachel-Reihenfolgen je Ansicht: Schlüssel wie «devices», «light»,
   *  «covers», «room:Küche», «favorites», «family». */
  order?: Record<string, string[]>;
  /** Geräte, die auf der Startseite nicht erscheinen. */
  hidden?: string[];
  /** Gesperrte Geräte: schalten nur nach ausdrücklicher Rückfrage. */
  locked?: string[];
  /** Vor heiklen Aktionen – Türe öffnen, Alarm entschärfen – erst Face ID
   *  bzw. Fingerabdruck verlangen. */
  bioLock?: boolean;
  /** Fragt die Türe vor dem Öffnen nach («Wirklich öffnen?»)? Fehlt der
   *  Wert, gilt ja – das bisherige Verhalten. Siehe lib/tuerbestaetigung. */
  doorConfirm?: boolean;
  /** Das Homescreen-Widget mit Daten aus dem Haus versorgen. Aus heisst:
   *  Es zeigt nur die Knöpfe, und in der App-Gruppe liegt kein Token. */
  widgetData?: boolean;
  /** Welche Knöpfe im Widget liegen – Schlüssel wie «door», «scene:kino»,
   *  «entity:light.kueche». Ohne Eintrag die drei, mit denen jeder
   *  anfängt. */
  widgetButtons?: string[];
  /** Schlüssel der Knöpfe, die direkt schalten statt die App zu öffnen.
   *  Nur für Szenen und Lichter erlaubt – nie für Tür oder Alarm. */
  widgetDirect?: string[];
}

/** Was nur einen selbst angeht. */
export interface UserPrefs {
  /** Bis zu welchem Stand die «Was ist neu»-Karte weggeklickt wurde –
   *  je Person, damit Livia sie trotzdem noch sieht. */
  seenChanges?: string;
  /** Kameras nach Betrieb sortieren statt fest: was gerade meldet, steht
   *  oben. Bewusst persönlich – am Wandpanel im Flur will man etwas
   *  anderes als auf dem Telefon in der Hosentasche. */
  kameraDynamisch?: boolean;
  /** Die eigenen Favoriten. Lange stand der Stern am Gerät selbst und
   *  galt damit für alle – aber griffbereit ist eine persönliche Frage:
   *  Was Stefan jeden Abend braucht, ist für Livia nur eine Kachel im
   *  Weg. Fehlt die Liste noch (undefined), gelten die alten Sterne am
   *  Gerät als Startbestand; der erste eigene Stern schreibt sie fest. */
  favorites?: string[];
  /** Die selbst gezogene Reihenfolge der eigenen Favoriten. */
  favoriteOrder?: string[];
}

/**
 * Die gemeinsame Mechanik beider Ablagen: laden, halten, zurückschreiben.
 *
 * Der Setzer setzt immer auf der neuesten Fassung auf – ohne die Ref
 * überschriebe ein schneller zweiter Zug den ersten mit veralteten Daten.
 */
function useStore<T extends object>(
  settings: HubSettings,
  connected: boolean,
  pfad: string
): { werte: T; geladen: boolean; setzen: (next: T) => void } {
  const [werte, setWerte] = useState<T>({} as T);
  const [geladen, setGeladen] = useState(false);
  const latest = useRef<T>({} as T);
  latest.current = werte;

  useEffect(() => {
    if (!connected || !settings.url || !settings.token) return;
    let cancelled = false;
    hubClient(settings.url, settings.token)
      .get<{ prefs?: T } | null>(pfad, { fallback: null, still: true })
      .then((body) => {
        if (cancelled) return;
        if (body && typeof body.prefs === 'object' && body.prefs) {
          setWerte(body.prefs);
        }
        // Auch eine leere Antwort ist eine Antwort: Erst danach darf die
        // Übernahme alter Einstellungen entscheiden, ob dort schon etwas
        // steht – sonst überschriebe sie beim ersten Zeichnen fleissig
        // Werte, die gerade noch unterwegs sind.
        setGeladen(true);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [connected, settings.url, settings.token, pfad]);

  const setzen = useCallback(
    (next: T) => {
      setWerte(next);
      latest.current = next;
      if (!settings.url || !settings.token) return;
      // Nicht gespeichert heisst: gilt nur auf diesem Gerät, bis die
      // Verbindung zurück ist – kein Grund, die Bedienung zu stören.
      hubClient(settings.url, settings.token).put(
        pfad,
        { prefs: next },
        {
          fallback: null,
          still: true,
        }
      );
    },

    [settings.url, settings.token, pfad]
  );

  return { werte, geladen, setzen };
}

export function usePrefs(settings: HubSettings, connected: boolean) {
  const haus = useStore<HousePrefs>(settings, connected, '/api/houseprefs');
  const eigen = useStore<UserPrefs>(settings, connected, '/api/prefs');
  // Über die Ref, damit die Setzer stabil bleiben: Hingen sie am Wert,
  // bekäme jedes Ziehen einer Kachel eine neue Funktion und alles, was
  // davon abhängt, zeichnete neu.
  const hausJetzt = useRef<HousePrefs>({});
  hausJetzt.current = haus.werte;
  const eigenJetzt = useRef<UserPrefs>({});
  eigenJetzt.current = eigen.werte;

  const setzeHaus = haus.setzen;
  const setzeEigen = eigen.setzen;

  const setOrder = useCallback(
    (scope: string, ids: string[]) => {
      setzeHaus({
        ...hausJetzt.current,
        order: { ...(hausJetzt.current.order ?? {}), [scope]: ids },
      });
    },
    [setzeHaus]
  );

  const setHidden = useCallback(
    (ids: string[]) => setzeHaus({ ...hausJetzt.current, hidden: ids }),
    [setzeHaus]
  );

  const setLocked = useCallback(
    (ids: string[]) => setzeHaus({ ...hausJetzt.current, locked: ids }),
    [setzeHaus]
  );

  const setBioLock = useCallback(
    (on: boolean) => setzeHaus({ ...hausJetzt.current, bioLock: on }),
    [setzeHaus]
  );

  const setDoorConfirm = useCallback(
    (on: boolean) => setzeHaus({ ...hausJetzt.current, doorConfirm: on }),
    [setzeHaus]
  );

  const setWidgetData = useCallback(
    (on: boolean) => setzeHaus({ ...hausJetzt.current, widgetData: on }),
    [setzeHaus]
  );

  const setWidgetButtons = useCallback(
    (keys: string[]) => setzeHaus({ ...hausJetzt.current, widgetButtons: keys }),
    [setzeHaus]
  );

  const setWidgetDirect = useCallback(
    (keys: string[]) => setzeHaus({ ...hausJetzt.current, widgetDirect: keys }),
    [setzeHaus]
  );

  const setSeenChanges = useCallback(
    (commit: string) => setzeEigen({ ...eigenJetzt.current, seenChanges: commit }),
    [setzeEigen]
  );

  const setKameraDynamisch = useCallback(
    (on: boolean) => setzeEigen({ ...eigenJetzt.current, kameraDynamisch: on }),
    [setzeEigen]
  );

  const setFavorites = useCallback(
    (ids: string[]) => setzeEigen({ ...eigenJetzt.current, favorites: ids }),
    [setzeEigen]
  );

  const setFavoriteOrder = useCallback(
    (ids: string[]) => setzeEigen({ ...eigenJetzt.current, favoriteOrder: ids }),
    [setzeEigen]
  );

  return {
    prefs: haus.werte,
    hausGeladen: haus.geladen,
    /** Alles auf einmal setzen – für die Übernahme alter Einstellungen. */
    setHausPrefs: setzeHaus,
    eigenePrefs: eigen.werte,
    setOrder,
    setHidden,
    setLocked,
    setBioLock,
    setDoorConfirm,
    setWidgetData,
    setWidgetButtons,
    setWidgetDirect,
    setSeenChanges,
    setKameraDynamisch,
    setFavorites,
    setFavoriteOrder,
  };
}
