import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { Activity, CommandData, Entity, EntityState, Scene, ServerMessage, User } from '../api/types';
import { failed, tapped, triggered } from '../lib/haptics';
import { UndoOffer, undoCommand, undoLabel } from '../lib/rueckgaengig';
import { QueuedCommand, enqueue, stillFresh } from '../lib/warteschlange';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const ACTIVITY_LIMIT = 20;
const CACHE_KEY = 'homepilot.snapshot';
// Benutzer und Raumreihenfolge gehören dazu: Ohne sie stünde beim Start
// ohne Verbindung zwar die Geräteliste, aber ohne Navigation und Räume.
const CACHE_META_KEY = 'homepilot.snapshot.meta';
/** So lange gilt eine Kachel nach dem Tippen als „wird geschaltet“. */
const PENDING_TIMEOUT = 6000;
// Befehle, die naturgemäss länger dauern: Eine schlafende Spotify-Box wird
// erst geweckt und angemeldet – bevor die Playlist startet ebenso wie
// bevor die laufende Musik auf sie umzieht.
const SLOW_COMMAND_TIMEOUT = 45000;
const SLOW_COMMANDS = new Set(['play_playlist', 'play_on']);
/** So lange steht das Angebot, eine Schaltung zurückzunehmen. */
const UNDO_TIMEOUT = 8000;
/** Kurzfassung einer Änderung für die Liste „Zuletzt passiert“.
 *
 *  `null`, wenn sich am Zustand nichts geändert hat: Der Hub meldet auch
 *  dann eine Änderung, wenn nur ein Stern, ein Name oder eine Gruppe
 *  gesetzt wurde - damit jedes Gerät es sofort sieht. In «Zuletzt
 *  passiert» stünde sonst «eingeschaltet», weil das Licht ohnehin an
 *  war, und die Liste behauptete etwas, das niemand getan hat. */
function describe(
  entity: Entity,
  newState: EntityState,
  oldState: EntityState
): string | null {
  if (JSON.stringify(newState) === JSON.stringify(oldState)) return null;
  const value = newState.state;
  if (value === 'on') return 'eingeschaltet';
  if (value === 'off') return 'ausgeschaltet';
  if (value === 'running') return 'gestartet';
  if (value === 'idle') return 'fertig';
  if (entity.kind === 'sensor' && typeof value === 'number') {
    return `${Math.round(value * 10) / 10}${entity.state.unit ? ' ' + entity.state.unit : ''}`;
  }
  if (entity.kind === 'alert') {
    return `${newState.count ?? 0} Warnungen`;
  }
  return null;
}

/** Wie der Zustand nach einem Kommando aussehen sollte – für sofortige Rückmeldung. */
function expectedState(
  entity: Entity,
  command: string,
  data?: CommandData
): EntityState | null {
  const state = { ...entity.state };
  if (command === 'turn_on') state.state = 'on';
  else if (command === 'turn_off') state.state = 'off';
  else if (command === 'toggle') state.state = state.state === 'on' ? 'off' : 'on';
  else if (command === 'set_brightness') {
    state.brightness = Math.max(0, Math.min(100, Number(data?.brightness ?? 100)));
    state.state = state.brightness > 0 ? 'on' : 'off';
  } else {
    return null;
  }
  if (command === 'turn_on' && data?.brightness != null) {
    state.brightness = data.brightness;
  }
  return state;
}

export function useHub(url: string | null, token: string | null) {
  const [entityMap, setEntityMap] = useState<Record<string, Entity>>({});
  const [activity, setActivity] = useState<Activity[]>([]);
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const [user, setUser] = useState<User | null>(null);
  /** Raum-Reihenfolge aus der config.yaml des Hubs. */
  const [roomOrder, setRoomOrder] = useState<string[]>([]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [energy, setEnergy] = useState<{
    price_per_kwh?: number;
    currency?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  /** true, solange die Daten aus dem Zwischenspeicher stammen. */
  const [stale, setStale] = useState(true);
  // Wann der gezeigte Stand entstanden ist – ohne Verbindung sagt die App
  // damit, wie alt das ist, was da steht.
  const [cachedAt, setCachedAt] = useState<number | null>(null);
  const [undo, setUndo] = useState<UndoOffer | null>(null);
  // Befehle, die getippt wurden, während die Verbindung weg war. Sie
  // gehen raus, sobald sie wieder da ist – siehe enqueue() oben.
  const [queued, setQueued] = useState<QueuedCommand[]>([]);
  // Zeitstempel der letzten Familien-Änderung vom Hub. Wer die Listen
  // zeigt, lädt neu, wenn sich dieser Wert ändert – statt im Minutentakt
  // zu fragen, ob sich etwas geändert haben könnte.
  const [familyChangedAt, setFamilyChangedAt] = useState(0);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Der Zustand von vor dem Tippen – nur zum Nachschlagen, nicht zum
  // Anzeigen, deshalb ein Ref und kein zweiter State.
  const entitiesRef = useRef<Record<string, Entity>>({});

  // Beim Öffnen sofort den letzten bekannten Stand zeigen, statt auf die
  // Verbindung zu warten – der Start fühlt sich dadurch augenblicklich an.
  useEffect(() => {
    let cancelled = false;
    AsyncStorage.getItem(CACHE_KEY)
      .then((raw) => {
        if (raw && !cancelled) {
          const cached: Entity[] = JSON.parse(raw);
          setEntityMap((prev) =>
            Object.keys(prev).length > 0
              ? prev
              : Object.fromEntries(cached.map((entity) => [entity.id, entity]))
          );
        }
      })
      // Kein Zwischenspeicher ist kein Fehler - dann kommt alles frisch.
      .catch(() => {});
    AsyncStorage.getItem(CACHE_META_KEY)
      .then((raw) => {
        if (!raw || cancelled) return;
        const meta = JSON.parse(raw);
        setUser((prev) => prev ?? meta.user ?? null);
        setRoomOrder((prev) => (prev.length > 0 ? prev : meta.rooms ?? []));
        if (typeof meta.at === 'number') setCachedAt(meta.at);
      })
      // Wie oben: fehlende Metadaten füllen sich mit dem Schnappschuss.
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    entitiesRef.current = entityMap;
  }, [entityMap]);

  // Das Angebot verfällt von selbst. Sonst nimmt ein Tippen Minuten später
  // etwas zurück, an das sich niemand mehr erinnert.
  useEffect(() => {
    if (!undo) return;
    const timer = setTimeout(() => setUndo(null), UNDO_TIMEOUT);
    return () => clearTimeout(timer);
  }, [undo]);

  const clearPending = useCallback((entityId: string) => {
    const timer = timersRef.current[entityId];
    if (timer) {
      clearTimeout(timer);
      delete timersRef.current[entityId];
    }
    setPending((prev) => {
      if (!prev[entityId]) return prev;
      const next = { ...prev };
      delete next[entityId];
      return next;
    });
  }, []);

  useEffect(() => {
    if (!url) {
      return;
    }
    let disposed = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const base = url.replace(/\/+$/, '').replace(/^http/, 'ws');
      const wsUrl = base + '/ws' + (token ? `?token=${encodeURIComponent(token)}` : '');
      setStatus('connecting');
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        setStatus('connected');
      };

      ws.onmessage = (event) => {
        const message: ServerMessage = JSON.parse(String(event.data));
        if (message.type === 'snapshot') {
          const entities = Object.fromEntries(
            message.entities.map((entity) => [entity.id, entity])
          );
          setEntityMap(entities);
          setUser(message.user ?? null);
          setRoomOrder(message.rooms ?? []);
          setStale(false);
          const at = Date.now();
          setCachedAt(at);
          AsyncStorage.setItem(CACHE_KEY, JSON.stringify(message.entities)).catch(
            () => {}
          );
          AsyncStorage.setItem(
            CACHE_META_KEY,
            JSON.stringify({ user: message.user ?? null, rooms: message.rooms ?? [], at })
            // Ein nicht geschriebener Zwischenspeicher kostet nur den
            // schnellen Start beim nächsten Öffnen.
          ).catch(() => {});
        } else if (
          message.type === 'state_changed' ||
          message.type === 'entity_added'
        ) {
          clearPending(message.entity.id);
          setEntityMap((prev) => ({ ...prev, [message.entity.id]: message.entity }));
          if (message.type === 'state_changed') {
            const summary = describe(
              message.entity,
              message.new_state,
              message.old_state
            );
            if (summary) {
              setActivity((prev) =>
                [
                  {
                    id: `${message.entity_id}-${Date.now()}`,
                    name: message.entity.name,
                    summary,
                    source: message.source?.label ?? null,
                    sourceKind: message.source?.kind ?? null,
                    at: Date.now(),
                  },
                  ...prev,
                ].slice(0, ACTIVITY_LIMIT)
              );
            }
          }
        } else if (message.type === 'family_changed') {
          setFamilyChangedAt(Date.now());
        } else if (message.type === 'entity_removed') {
          setEntityMap((prev) => {
            const next = { ...prev };
            delete next[message.entity_id];
            return next;
          });
        } else if (message.type === 'result') {
          if (message.entity_id) {
            clearPending(message.entity_id);
          }
          // Fehlgeschlagene Kommandos nicht verschlucken – sonst tippt man
          // ins Leere und erfährt nie, warum nichts passiert ist.
          if (!message.ok) {
            setError(message.error ?? 'Der Befehl ist fehlgeschlagen');
            failed();
          }
        }
      };

      ws.onclose = () => {
        if (disposed) return;
        setStatus('disconnected');
        setStale(true);
        const delay = Math.min(15000, 1000 * 2 ** attemptRef.current);
        attemptRef.current += 1;
        retryTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => ws?.close();
    };

    connect();

    // Rückkehr aus dem Hintergrund: Das Betriebssystem friert die Verbindung
    // ein, ohne dass zwingend onclose feuert. Der Socket sieht danach offen
    // aus, liefert aber nichts mehr – die App zeigt dann den Stand von vor
    // dem Sperren. Genau das passiert, wenn eine Push-Nachricht meldet, dass
    // die Wäsche fertig ist: Beim Öffnen läuft sie auf dem Bildschirm noch.
    //
    // Deshalb beim Aktivieren neu verbinden. Die erste Antwort des Hubs ist
    // ein vollständiger Schnappschuss, damit stimmt alles wieder.
    const appState = AppState.addEventListener('change', (next) => {
      if (next !== 'active' || disposed) return;
      if (retryTimer) clearTimeout(retryTimer);
      attemptRef.current = 0;
      if (ws === null || ws.readyState === WebSocket.CLOSED) {
        connect();
      } else if (ws.readyState === WebSocket.OPEN) {
        // Schliessen statt prüfen: Ob die Verbindung noch trägt, weiss man
        // erst, wenn nichts mehr ankommt – und dann ist es zu spät. Der
        // onclose-Zweig verbindet gleich neu.
        ws.close();
      }
      // Bei CONNECTING/CLOSING ist ohnehin schon etwas unterwegs.
    });

    return () => {
      disposed = true;
      appState.remove();
      if (retryTimer) clearTimeout(retryTimer);
      ws?.close();
      wsRef.current = null;
    };
  }, [url, token, clearPending]);

  // Nach dem Anlegen oder Ändern einer Szene ruft der Editor das erneut auf.
  const reloadScenes = useCallback(() => {
    if (!url) return;
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    fetch(`${url}/api/scenes`, { headers })
      .then((response) => (response.ok ? response.json() : []))
      .then(setScenes)
      .catch(() => setScenes([]));
  }, [url, token]);

  // Szenen und Strompreis kommen über REST – sie ändern sich nicht laufend.
  useEffect(() => {
    if (!url || status !== 'connected') return;
    reloadScenes();

    // Gäste dürfen den Systemzustand nicht abrufen – dann bleibt es einfach
    // bei der Anzeige ohne Kosten.
    const headers: Record<string, string> = token
      ? { Authorization: `Bearer ${token}` }
      : {};
    fetch(`${url}/api/system/status`, { headers })
      .then((response) => (response.ok ? response.json() : null))
      .then((data) => setEnergy(data?.energy ?? null))
      .catch(() => setEnergy(null));
  }, [url, token, status, reloadScenes]);

  const send = useCallback(
    (entityId: string, command: string, data?: CommandData) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        // Vorher lief der Tipp ins Leere und hinterliess nur «keine
        // Verbindung». Jetzt wartet er – und man sieht, worauf.
        const wartet = { entityId, command, data, at: Date.now() };
        setQueued((prev) => enqueue(prev, wartet));
        setError('Keine Verbindung – der Befehl geht raus, sobald der Hub wieder da ist');
        return false;
      }

      // Sofort den erwarteten Zustand zeigen. Meldet der Hub etwas anderes,
      // überschreibt seine Antwort diese Annahme – aber die Kachel reagiert
      // augenblicklich statt erst nach der Antwort des Geräts.
      setEntityMap((prev) => {
        const entity = prev[entityId];
        if (!entity) return prev;
        const next = expectedState(entity, command, data);
        return next ? { ...prev, [entityId]: { ...entity, state: next } } : prev;
      });
      setPending((prev) => ({ ...prev, [entityId]: true }));
      timersRef.current[entityId] = setTimeout(
        () => {
          clearPending(entityId);
          setError('Das Gerät antwortet nicht');
        },
        SLOW_COMMANDS.has(command) ? SLOW_COMMAND_TIMEOUT : PENDING_TIMEOUT
      );

      ws.send(
        JSON.stringify({ type: 'command', entity_id: entityId, command, data: data ?? {} })
      );
      // Beim Ziehen eines Reglers bewusst nicht – das wäre ein Dauerbrummen.
      if (command !== 'set_brightness') tapped();
      return true;
    },
    [clearPending]
  );

  const sendCommand = useCallback(
    (entityId: string, command: string, data?: CommandData) => {
      const entity = entitiesRef.current[entityId];
      const before = entity ? { ...entity.state } : null;
      if (!send(entityId, command, data)) return;
      // Erst nach dem erfolgreichen Absenden anbieten – ein Befehl, der die
      // Verbindung gar nicht verlassen hat, braucht kein Zurück.
      const back = before ? undoCommand(before, command) : null;
      const after = entity && before ? expectedState(entity, command, data) : null;
      if (back && after && entity) {
        setUndo({
          entityId,
          name: entity.name,
          label: undoLabel(before!, after),
          command: back.command,
          data: back.data,
        });
      } else {
        setUndo(null);
      }
    },
    [send]
  );

  /**
   * Wartende Befehle abschicken, sobald die Verbindung wieder steht.
   *
   * Bewusst hier und nicht im ``onopen`` der Verbindung: Dort gäbe es
   * ``send`` noch nicht, und die Schlange müsste als Ref an der
   * Verbindungsschleife hängen, die sich bei jedem Neuaufbau erneuert.
   *
   * Der Hub bekommt zuerst seinen Schnappschuss und schickt ihn zurück;
   * die kleine Verzögerung sorgt dafür, dass unsere Befehle danach
   * kommen und nicht von der Bestandsaufnahme überschrieben werden.
   */
  useEffect(() => {
    if (status !== 'connected' || queued.length === 0) return;
    const timer = setTimeout(() => {
      const jetzt = Date.now();
      const raus = stillFresh(queued, jetzt);
      setQueued([]);
      if (raus.length < queued.length) {
        setError(
          `${queued.length - raus.length} Befehl(e) waren zu alt und wurden ` +
            'nicht mehr geschickt'
        );
      }
      for (const eintrag of raus) {
        send(eintrag.entityId, eintrag.command, eintrag.data);
      }
    }, 400);
    return () => clearTimeout(timer);
  }, [status, queued, send]);

  const undoLast = useCallback(() => {
    if (!undo) return;
    setUndo(null);
    send(undo.entityId, undo.command, undo.data);
  }, [undo, send]);

  /**
   * Eine Szene auslösen – oder zurücknehmen, wenn sie gerade gilt.
   *
   * Der Hub entscheidet, welches von beidem. Entschiede es die App,
   * entschiede sie es anhand eines Standes, der Sekunden alt sein kann –
   * und löste die Szene ein zweites Mal aus, statt sie zurückzunehmen.
   */
  const activateScene = useCallback(
    async (sceneId: string) => {
      if (!url) return;
      triggered();
      try {
        const response = await fetch(`${url}/api/scenes/${sceneId}/toggle`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          throw new Error(`Hub antwortet mit ${response.status}`);
        }
        const result = await response.json();
        // Sofort umschalten, damit der Knopf nicht eine Sekunde lang
        // lügt - und kurz darauf beim Hub nachfragen, der es genau
        // weiss. Ein Gerät, das nicht reagiert hat, korrigiert sich so
        // von selbst.
        setScenes((liste) =>
          liste.map((scene) =>
            scene.id === sceneId
              ? {
                  ...scene,
                  active: !result.reverted,
                  revertable: !result.reverted,
                }
              : scene
          )
        );
        setTimeout(() => reloadScenes(), 1200);
        if (result.failed?.length) {
          failed();
          setError(
            `${result.failed.length} Gerät(e) haben nicht reagiert: ` +
              result.failed.map((item: { entity_id: string }) => item.entity_id).join(', ')
          );
        }
      } catch (err) {
        failed();
        setError(`Szene fehlgeschlagen: ${err instanceof Error ? err.message : err}`);
      }
    },
    [url, token, reloadScenes]
  );

  // Raumzuordnung einer Kachel setzen (im Anpassen-Modus). Der Hub meldet
  // die Änderung über den Eventstream zurück; optimistisch ziehen wir sie
  // sofort nach, damit die Kachel augenblicklich in den Raum wandert.
  const setEntityRoom = useCallback(
    async (entityId: string, room: string | null) => {
      setEntityMap((prev) => {
        const entity = prev[entityId];
        return entity ? { ...prev, [entityId]: { ...entity, room } } : prev;
      });
      try {
        const response = await fetch(`${url}/api/entities/${encodeURIComponent(entityId)}/room`, {
          method: 'PUT',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ room }),
        });
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      } catch (err) {
        setError(`Raum konnte nicht gesetzt werden: ${err instanceof Error ? err.message : err}`);
      }
    },
    [url, token]
  );

  // Anzeigename, Favorit oder Gruppe einer Kachel setzen. Nur die
  // übergebenen Felder ändern sich; optimistisch sofort nachziehen.
  const setEntityMeta = useCallback(
    async (
      entityId: string,
      meta: { name?: string | null; favorite?: boolean; group?: string | null }
    ) => {
      setEntityMap((prev) => {
        const entity = prev[entityId];
        if (!entity) return prev;
        const next = { ...entity };
        if (meta.name !== undefined) next.name = meta.name || entity.name;
        if (meta.favorite !== undefined) next.favorite = meta.favorite;
        if (meta.group !== undefined) next.group = meta.group;
        return { ...prev, [entityId]: next };
      });
      try {
        const response = await fetch(
          `${url}/api/entities/${encodeURIComponent(entityId)}/meta`,
          {
            method: 'PUT',
            headers: {
              ...(token ? { Authorization: `Bearer ${token}` } : {}),
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(meta),
          }
        );
        if (!response.ok) throw new Error(`Hub antwortet mit ${response.status}`);
      } catch (err) {
        setError(`Änderung konnte nicht gespeichert werden: ${err instanceof Error ? err.message : err}`);
      }
    },
    [url, token]
  );

  const entities = Object.values(entityMap).sort((a, b) => a.name.localeCompare(b.name));

  return {
    entities,
    activity,
    scenes,
    energy,
    roomOrder,
    status,
    user,
    error,
    pending,
    // Wie viele Befehle darauf warten, dass der Hub wieder da ist.
    queued: queued.length,
    stale,
    cachedAt,
    familyChangedAt,
    undo,
    undoLast,
    dismissUndo: () => setUndo(null),
    sendCommand,
    activateScene,
    setEntityRoom,
    setEntityMeta,
    reloadScenes,
    dismissError: () => setError(null),
  };
}
