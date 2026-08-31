/**
 * Die Ablage der Familienseite: Stand, Warteschlange, Änderungen.
 *
 * Alles, was die Seite ohne Netz lesbar hält und ein Häkchen aufhebt,
 * bis der Hub wieder da ist. Es steht hier und nicht im Bildschirm,
 * weil es mit dem Zeichnen nichts zu tun hat - und weil der Bildschirm
 * sonst ein weiteres Dutzend Zustände trägt, an denen beim Lesen jeder
 * vorbeimuss.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

import { HubClient, HubFehler } from '../../api/client';
import {
  Vorgemerkt,
  abgelehnt,
  anwenden,
  frisch,
  istVorlaeufig,
  merke,
  vorlaeufigeId,
} from '../../lib/familiecache';
import { Rueckeintrag, eintragName } from '../../lib/rueckband';
import { FamilyData, FamilyItem } from './bausteine';

const CACHE_KEY = 'homepilot.family.cache';
const QUEUE_KEY = 'homepilot.family.queue';

export function useFamilienablage({
  hub,
  changedAt,
  onGeloescht,
}: {
  hub: HubClient;
  /** Zählt hoch, wenn ein anderes Gerät etwas geändert hat. */
  changedAt: unknown;
  /** Was gerade gelöscht wurde - für das Band mit «Rückgängig». */
  onGeloescht: (eintrag: Rueckeintrag) => void;
}) {
  const [error, setError] = useState<string | null>(null);
  // Der Stand, wie der Hub ihn kennt …
  const [serverData, setServerData] = useState<FamilyData>({});
  // ── Ohne Netz lesbar bleiben (Punkte 165 und 172) ──────────────────────
  //
  // Der Geräte-Bildschirm legt seinen Stand längst im Gerät ab; die
  // Familienseite tat es nicht. Wer im Ladenkeller die Einkaufsliste
  // öffnete, sah nichts - und ein Häkchen dort lief ins Leere, ohne dass
  // es jemand merkte.
  const [stand, setStand] = useState<number | null>(null);
  const [verbunden, setVerbunden] = useState(true);
  const [offen, setOffen] = useState<Vorgemerkt[]>([]);
  // Die Warteschlange auch zum Nachlesen, ohne den Effekt neu zu binden.
  const offenRef = useRef<Vorgemerkt[]>([]);
  offenRef.current = offen;

  // Beim Öffnen sofort den letzten bekannten Stand zeigen, statt auf die
  // Verbindung zu warten - derselbe Handel wie in useHub.
  useEffect(() => {
    let abgebrochen = false;
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => {
        if (!raw || abgebrochen) return;
        const gespeichert = JSON.parse(raw);
        setServerData((vorher) => (Object.keys(vorher).length > 0 ? vorher : gespeichert.data ?? {}));
        if (typeof gespeichert.at === 'number') setStand((v) => v ?? gespeichert.at);
      })
      // Kein Zwischenspeicher ist kein Fehler - dann kommt alles frisch.
      .catch(() => {});
    AsyncStorage.getItem(QUEUE_KEY)
      .then((raw) => {
        if (!raw || abgebrochen) return;
        setOffen(frisch(JSON.parse(raw), Date.now()));
      })
      .catch(() => {});
    return () => {
      abgebrochen = true;
    };
  }, []);

  const load = useCallback(() => {
    // Der Bildschirm zeigt Fehler selbst an - deshalb «still».
    hub
      .get<FamilyData>('/api/family', { still: true })
      .then((payload) => {
        setServerData(payload);
        setError(null);
        setVerbunden(true);
        const jetzt = Date.now();
        setStand(jetzt);
        AsyncStorage.setItem(
          CACHE_KEY,
          JSON.stringify({ data: payload, at: jetzt })
        ).catch(() => {});
      })
      .catch((err) => {
        setVerbunden(false);
        setError(
          `Familiendaten nicht abrufbar (${err instanceof HubFehler ? err.message : err})`
        );
      });
  }, [hub]);

  useEffect(load, [load]);

  // … und der Stand, den man sieht: Server plus das, was noch wartet.
  // Ohne diese Überlagerung springt das Häkchen zurück, und man tippt es
  // ein zweites Mal.
  const data = useMemo(() => anwenden(serverData, offen), [serverData, offen]);

  // Was wartet, wird gespeichert: Die App darf zwischendurch beendet
  // werden, ohne dass ein Häkchen verlorengeht.
  useEffect(() => {
    AsyncStorage.setItem(QUEUE_KEY, JSON.stringify(offen)).catch(() => {});
  }, [offen]);

  /**
   * Eine Änderung an den Hub - und wenn er nicht da ist, in die Warteschlange.
   *
   * Drei Ausgänge, nicht zwei: gespeichert, keine Verbindung - oder vom
   * Hub abgewiesen. Der dritte fehlte lange, und das war der Fehler,
   * durch den der Stundenplan Einträge verlor: Eine 4xx-Antwort (etwa
   * von einem Hub, der die Liste noch nicht kennt) landete als
   * «keine Verbindung» in der Schlange, sah dort gespeichert aus und
   * verfiel nach 24 Stunden wortlos. Abgewiesenes gehört nicht in die
   * Schlange - es wird beim Wiederholen nicht richtiger.
   */
  const senden = useCallback(
    async (eintrag: Vorgemerkt): Promise<{ ok: boolean; abgewiesen: string | null }> => {
      try {
        if (eintrag.kind === 'add') {
          await hub.post(`/api/family/${eintrag.collection}`, eintrag.body ?? {}, {
            still: true,
          });
        } else if (eintrag.kind === 'update') {
          await hub.put(
            `/api/family/${eintrag.collection}/${eintrag.id}`,
            eintrag.body ?? {},
            { still: true }
          );
        } else {
          await hub.del(`/api/family/${eintrag.collection}/${eintrag.id}`, {
            still: true,
          });
        }
        return { ok: true, abgewiesen: null };
      } catch (err) {
        if (err instanceof HubFehler && abgelehnt(err.status)) {
          return { ok: false, abgewiesen: err.message };
        }
        return { ok: false, abgewiesen: null };
      }
    },
    [hub]
  );

  // Sobald die Verbindung wieder steht, geht die Warteschlange raus -
  // in der Reihenfolge, in der getippt wurde.
  useEffect(() => {
    if (!verbunden || offen.length === 0) return;
    let abgebrochen = false;
    (async () => {
      const rest: Vorgemerkt[] = [];
      let abgewiesen: string | null = null;
      for (const eintrag of offenRef.current) {
        // Ein lokal angelegter Eintrag wird als Neuzugang geschickt; seine
        // vorläufige Kennung kennt der Hub nicht.
        const ergebnis = await senden(
          istVorlaeufig(eintrag.id) && eintrag.kind !== 'add'
            ? { ...eintrag, kind: 'add' }
            : eintrag
        );
        if (ergebnis.ok) continue;
        if (ergebnis.abgewiesen) {
          // Fällt aus der Schlange: Der Hub hat entschieden, nicht das
          // Netz. Stumm behalten hiesse ewig «wartet» - und nach einem
          // Tag wortlos weg.
          abgewiesen = ergebnis.abgewiesen;
          continue;
        }
        rest.push(eintrag);
      }
      if (abgebrochen) return;
      if (abgewiesen) setError(`Nicht gespeichert: ${abgewiesen}`);
      setOffen(rest);
      if (rest.length === 0) load();
    })();
    return () => {
      abgebrochen = true;
    };
    // Absichtlich nur an `verbunden` und der Länge: Der Lauf soll einmal
    // je Wiederverbindung starten, nicht bei jedem Zwischenstand.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [verbunden, offen.length]);

  // Änderungen anderer Geräte kommen als Fingerzeig über den WebSocket –
  // was Livia abhakt, steht bei Stefan sofort, ohne Minutentakt-Abfrage.
  useEffect(() => {
    if (changedAt) load();
  }, [changedAt, load]);

  // ── Änderungen an den Hub ──────────────────────────────────────────────

  const add = useCallback(
    async (collection: string, item: FamilyItem) => {
      const eintrag: Vorgemerkt = {
        kind: 'add',
        collection,
        id: vorlaeufigeId(Date.now()),
        body: item,
        at: Date.now(),
      };
      const ergebnis = await senden(eintrag);
      if (ergebnis.ok) {
        load();
        return;
      }
      if (ergebnis.abgewiesen) {
        // Sichtbar scheitern lassen: Der Eintrag erscheint nicht, und die
        // Zeile sagt warum - statt «wartend» dazustehen und nie anzukommen.
        setError(`Nicht gespeichert: ${ergebnis.abgewiesen}`);
        return;
      }
      // Kein Netz: vormerken statt schweigend verlieren.
      setVerbunden(false);
      setOffen((vorher) => merke(vorher, eintrag));
    },
    [senden, load]
  );

  const update = useCallback(
    async (collection: string, id: string, patch: FamilyItem) => {
      const eintrag: Vorgemerkt = {
        kind: 'update',
        collection,
        id,
        body: patch,
        at: Date.now(),
      };
      const ergebnis = await senden(eintrag);
      if (ergebnis.ok) {
        load();
        return;
      }
      if (ergebnis.abgewiesen) {
        setError(`Nicht gespeichert: ${ergebnis.abgewiesen}`);
        return;
      }
      setVerbunden(false);
      setOffen((vorher) => merke(vorher, eintrag));
    },
    [senden, load]
  );

  const remove = useCallback(
    async (collection: string, id: string) => {
      // Den Namen jetzt holen, nicht nachher: Nach dem Löschen steht er
      // nirgends mehr, und «Eintrag gelöscht» ist keine Auskunft.
      const zeile = ((data as Record<string, unknown>)[collection] as
        | { id?: string; text?: string; name?: string }[]
        | undefined)?.find((posten) => posten.id === id);
      const eintrag: Vorgemerkt = {
        kind: 'remove',
        collection,
        id,
        at: Date.now(),
      };
      const ergebnis = await senden(eintrag);
      if (!ergebnis.ok && ergebnis.abgewiesen) {
        // Nichts wurde gelöscht - dann auch kein Band mit «Rückgängig»,
        // das etwas behauptet, was nicht passiert ist.
        setError(`Nicht gespeichert: ${ergebnis.abgewiesen}`);
        return;
      }
      onGeloescht({
        name: eintragName(zeile ?? null),
        label: 'gelöscht',
        at: Date.now(),
        collection,
        id,
      });
      if (ergebnis.ok) {
        load();
        return;
      }
      setVerbunden(false);
      setOffen((vorher) => merke(vorher, eintrag));
    },
    [senden, load, data, onGeloescht]
  );

  return { data, stand, verbunden, offen, error, setError, load, add, update, remove };
}
