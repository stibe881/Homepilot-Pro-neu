import { useCallback, useEffect, useRef, useState } from 'react';

import { HubSettings } from '../api/types';

/**
 * Persönliche Oberflächen-Einstellungen – je Benutzer auf dem Hub abgelegt.
 *
 * Anders als die HubSettings (die dem Gerät gehören: Adresse, Token,
 * Panel-Modus) gehören diese Einstellungen der Person: Wer auf dem iPad
 * die Kacheln umsortiert, sieht dieselbe Reihenfolge auch auf dem Telefon.
 * Der Hub speichert sie unter dem angemeldeten Benutzer (/api/prefs).
 */
export interface UserPrefs {
  /** Kachel-Reihenfolgen je Ansicht: Schlüssel wie «devices», «light»,
   *  «covers», «room:Küche», «family». */
  order?: Record<string, string[]>;
  /** Bis zu welchem Stand die «Was ist neu»-Karte weggeklickt wurde –
   *  je Person, damit Livia sie trotzdem noch sieht. */
  seenChanges?: string;
  /** Vor heiklen Aktionen – Türe öffnen, Alarm entschärfen – erst Face ID
   *  bzw. Fingerabdruck verlangen. Gehört zur Person und nicht zum Gerät:
   *  Wer es einschaltet, meint es überall. */
  bioLock?: boolean;
  /** Das Homescreen-Widget mit Daten aus dem Haus versorgen. Aus heisst:
   *  Es zeigt nur die Knöpfe, und in der App-Gruppe liegt kein Token. */
  widgetData?: boolean;
  /** Welche Knöpfe im Widget liegen – Schlüssel wie «door»,
   *  «scene:kino», «entity:light.kueche». Ohne Eintrag die drei, mit
   *  denen jeder anfängt. */
  widgetButtons?: string[];
}

export function usePrefs(settings: HubSettings, connected: boolean) {
  const [prefs, setPrefs] = useState<UserPrefs>({});
  // Die jeweils neueste Fassung für den Speicher-Aufruf – ohne Ref würde
  // ein schneller zweiter Zug den ersten mit veralteten Daten überschreiben.
  const latest = useRef<UserPrefs>({});
  latest.current = prefs;

  const headers: Record<string, string> = settings.token
    ? { Authorization: `Bearer ${settings.token}`, 'Content-Type': 'application/json' }
    : { 'Content-Type': 'application/json' };

  useEffect(() => {
    if (!connected || !settings.url || !settings.token) return;
    let cancelled = false;
    fetch(`${settings.url}/api/prefs`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((body) => {
        if (!cancelled && body && typeof body.prefs === 'object' && body.prefs) {
          setPrefs(body.prefs);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected, settings.url, settings.token]);

  const save = useCallback(
    (next: UserPrefs) => {
      setPrefs(next);
      latest.current = next;
      if (!settings.url || !settings.token) return;
      fetch(`${settings.url}/api/prefs`, {
        method: 'PUT',
        headers,
        body: JSON.stringify({ prefs: next }),
      }).catch(() => {
        // Nicht gespeichert heisst: gilt nur auf diesem Gerät, bis die
        // Verbindung zurück ist – kein Grund, die Bedienung zu stören.
      });
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [settings.url, settings.token]
  );

  const setOrder = useCallback(
    (scope: string, ids: string[]) => {
      save({
        ...latest.current,
        order: { ...(latest.current.order ?? {}), [scope]: ids },
      });
    },
    [save]
  );

  const setSeenChanges = useCallback(
    (commit: string) => {
      save({ ...latest.current, seenChanges: commit });
    },
    [save]
  );

  const setBioLock = useCallback(
    (on: boolean) => {
      save({ ...latest.current, bioLock: on });
    },
    [save]
  );

  const setWidgetData = useCallback(
    (on: boolean) => {
      save({ ...latest.current, widgetData: on });
    },
    [save]
  );

  const setWidgetButtons = useCallback(
    (keys: string[]) => {
      save({ ...latest.current, widgetButtons: keys });
    },
    [save]
  );

  return {
    prefs,
    setOrder,
    setSeenChanges,
    setBioLock,
    setWidgetData,
    setWidgetButtons,
  };
}
