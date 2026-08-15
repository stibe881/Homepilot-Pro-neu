import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';

import { Activity, Entity, Scene, ServerMessage, User } from '../api/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

const ACTIVITY_LIMIT = 20;
const CACHE_KEY = 'homepilot.snapshot';
/** So lange gilt eine Kachel nach dem Tippen als „wird geschaltet“. */
const PENDING_TIMEOUT = 6000;

/** Kurzfassung einer Änderung für die Liste „Zuletzt passiert“. */
function describe(entity: Entity, newState: Record<string, any>): string | null {
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
  data?: Record<string, any>
): Record<string, any> | null {
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
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [energy, setEnergy] = useState<{
    price_per_kwh?: number;
    currency?: string;
  } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<Record<string, boolean>>({});
  /** true, solange die Daten aus dem Zwischenspeicher stammen. */
  const [stale, setStale] = useState(true);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});

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
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

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
          setStale(false);
          AsyncStorage.setItem(CACHE_KEY, JSON.stringify(message.entities)).catch(
            () => {}
          );
        } else if (
          message.type === 'state_changed' ||
          message.type === 'entity_added'
        ) {
          clearPending(message.entity.id);
          setEntityMap((prev) => ({ ...prev, [message.entity.id]: message.entity }));
          if (message.type === 'state_changed') {
            const summary = describe(message.entity, message.new_state);
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
    return () => {
      disposed = true;
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

  const sendCommand = useCallback(
    (entityId: string, command: string, data?: Record<string, any>) => {
      const ws = wsRef.current;
      if (!ws || ws.readyState !== WebSocket.OPEN) {
        setError('Keine Verbindung zum Hub');
        return;
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
      timersRef.current[entityId] = setTimeout(() => {
        clearPending(entityId);
        setError('Das Gerät antwortet nicht');
      }, PENDING_TIMEOUT);

      ws.send(
        JSON.stringify({ type: 'command', entity_id: entityId, command, data: data ?? {} })
      );
    },
    [clearPending]
  );

  const activateScene = useCallback(
    async (sceneId: string) => {
      if (!url) return;
      try {
        const response = await fetch(`${url}/api/scenes/${sceneId}/activate`, {
          method: 'POST',
          headers: token ? { Authorization: `Bearer ${token}` } : {},
        });
        if (!response.ok) {
          throw new Error(`Hub antwortet mit ${response.status}`);
        }
        const result = await response.json();
        if (result.failed?.length) {
          setError(
            `${result.failed.length} Gerät(e) haben nicht reagiert: ` +
              result.failed.map((item: any) => item.entity_id).join(', ')
          );
        }
      } catch (err: any) {
        setError(`Szene fehlgeschlagen: ${err.message ?? err}`);
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
    status,
    user,
    error,
    pending,
    stale,
    sendCommand,
    activateScene,
    reloadScenes,
    dismissError: () => setError(null),
  };
}
