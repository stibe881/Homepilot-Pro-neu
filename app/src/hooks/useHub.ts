import { useCallback, useEffect, useRef, useState } from 'react';

import { Entity, ServerMessage } from '../api/types';

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

/**
 * Hält eine WebSocket-Verbindung zum Hub: Snapshot beim Verbinden,
 * danach Live-Updates. Reconnect mit exponentiellem Backoff.
 */
export function useHub(url: string | null, token: string | null) {
  const [entityMap, setEntityMap] = useState<Record<string, Entity>>({});
  const [status, setStatus] = useState<ConnectionStatus>('disconnected');
  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!url) {
      return;
    }
    let disposed = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;

    const connect = () => {
      const base = url.replace(/\/+$/, '').replace(/^http/, 'ws');
      const wsUrl =
        base + '/ws' + (token ? `?token=${encodeURIComponent(token)}` : '');
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
          setEntityMap(
            Object.fromEntries(message.entities.map((e) => [e.id, e]))
          );
        } else if (
          message.type === 'state_changed' ||
          message.type === 'entity_added'
        ) {
          setEntityMap((prev) => ({
            ...prev,
            [message.entity.id]: message.entity,
          }));
        } else if (message.type === 'entity_removed') {
          setEntityMap((prev) => {
            const next = { ...prev };
            delete next[message.entity_id];
            return next;
          });
        }
      };

      ws.onclose = () => {
        if (disposed) {
          return;
        }
        setStatus('disconnected');
        const delay = Math.min(15000, 1000 * 2 ** attemptRef.current);
        attemptRef.current += 1;
        retryTimer = setTimeout(connect, delay);
      };

      ws.onerror = () => {
        ws?.close();
      };
    };

    connect();
    return () => {
      disposed = true;
      if (retryTimer) {
        clearTimeout(retryTimer);
      }
      ws?.close();
      wsRef.current = null;
    };
  }, [url, token]);

  const sendCommand = useCallback(
    (entityId: string, command: string, data?: Record<string, any>) => {
      const ws = wsRef.current;
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(
          JSON.stringify({
            type: 'command',
            entity_id: entityId,
            command,
            data: data ?? {},
          })
        );
      }
    },
    []
  );

  const entities = Object.values(entityMap).sort((a, b) =>
    a.name.localeCompare(b.name)
  );

  return { entities, status, sendCommand };
}
