/**
 * Der offene Gesamtwert der Gutscheine, für die Kachel auf der Übersicht
 * (Punkt 687 der Werkbank).
 *
 * Ein eigener, schlanker Abruf statt der grösseren Ablage der
 * Familienseite (screens/family/ablage.ts): Hier zählt nur die eine
 * Zahl, nicht die Warteschlange und der Zwischenspeicher, die eine
 * bearbeitbare Liste braucht.
 */
import { useEffect, useState } from 'react';

import { hubClient } from '../api/client';
import { HubSettings } from '../api/types';
import { alsGutschein, summenText } from '../lib/gutscheine';

/** So oft wird nachgefragt, solange die Kachel zu sehen ist - kein
 *  Wert, der sich sekundengenau ändert. */
const INTERVALL_MS = 5 * 60 * 1000;

export function useGutscheinSumme(settings: HubSettings, connected: boolean): string {
  const [text, setText] = useState('');

  useEffect(() => {
    if (!connected || !settings.url || !settings.token) return;
    let abgebrochen = false;
    const laden = () => {
      hubClient(settings.url, settings.token)
        .get<Record<string, unknown>[]>('/api/family/vouchers', { still: true, fallback: [] })
        .then((rohe) => {
          if (abgebrochen) return;
          const gutscheine = (rohe ?? []).map(alsGutschein);
          setText(summenText(gutscheine, new Date()));
        })
        .catch(() => {});
    };
    laden();
    const timer = setInterval(laden, INTERVALL_MS);
    return () => {
      abgebrochen = true;
      clearInterval(timer);
    };
  }, [connected, settings.url, settings.token]);

  return text;
}
