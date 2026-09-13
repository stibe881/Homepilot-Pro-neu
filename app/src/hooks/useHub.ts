import AsyncStorage from '@react-native-async-storage/async-storage';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState } from 'react-native';

import { onHubFehler } from '../api/client';
import { Activity, CommandData, Entity, EntityState, Scene, ServerMessage, User } from '../api/types';
import { failed, tapped, triggered } from '../lib/haptics';
import { absageSatz, zurueckgesetzt } from '../lib/kachelstand';
import { UndoOffer, undoCommand, undoLabel } from '../lib/rueckgaengig';
import {
  CODE_ABGEMELDET,
  CODE_FENSTER_ZU,
  NachSchliessen,
  PING_INTERVALL_MS,
  PONG_FRIST_MS,
  nachSchliessen,
  pongAusgeblieben,
} from '../lib/verbindungsstand';
import { QueuedCommand, enqueue, stillFresh } from '../lib/warteschlange';
import { useTakt } from './useTakt';

/**
 * `signed_out`: Der Hub hat das Token abgewiesen (Punkt 579 der
 * Werkbank) - kein Wiederverbinden, der Balken bietet «Neu anmelden».
 * Vorher hiess das «getrennt» und die App klopfte im Sekundentakt
 * weiter an, obwohl der Hub erreichbar war.
 *
 * `paused`: Das Token gilt, aber das Zeitfenster ist zu (Punkt 624) -
 * die App verbindet erst wieder, wenn es aufgeht, und sagt bis dahin
 * «Gute Nacht» statt «keine Verbindung».
 */
export type ConnectionStatus =
  | 'connecting'
  | 'connected'
  | 'disconnected'
  | 'signed_out'
  | 'paused';

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
  // «Eingeschaltet» nur, wenn wirklich geschaltet wurde. Sonst meldete
  // jede Nebensache am brennenden Licht - eine neue Helligkeit, die
  // Restzeit eines Ablaufs (lib/abschaltung.ts) - ein Einschalten, das
  // gar nicht stattfand, und «Zuletzt passiert» füllte sich mit
  // Ereignissen, die niemand ausgelöst hat.
  if (value === oldState.state) return null;
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
  // Bis wann die Pause ausserhalb des Zeitfensters dauert (Punkt 624
  // der Werkbank) - der Balken nennt die Uhrzeit.
  const [pausiertBis, setPausiertBis] = useState<number | null>(null);

  const wsRef = useRef<WebSocket | null>(null);
  const attemptRef = useRef(0);
  // Der Zustand auch als Ref: Der AppState-Horcher und der Fehlerkanal
  // des Clients laufen ausserhalb des Render-Zyklus und dürfen ein
  // abgemeldetes Gerät nicht wieder anklopfen lassen.
  const statusRef = useRef<ConnectionStatus>('disconnected');
  // Die Verbindung bewusst anhalten (abgemeldet) - gesetzt von der
  // Verbindungsschleife, gerufen vom Fehlerkanal des HTTP-Clients.
  const anhaltenRef = useRef<((schritt: NachSchliessen) => void) | null>(null);
  // Einen Ping schicken (Punkt 592 der Werkbank) - gesetzt von der
  // Verbindungsschleife, gerufen vom Takt und nach einem Zeitlimit.
  const pingRef = useRef<(() => void) | null>(null);
  const timersRef = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  // Der Zustand von vor dem Tippen – nur zum Nachschlagen, nicht zum
  // Anzeigen, deshalb ein Ref und kein zweiter State.
  const entitiesRef = useRef<Record<string, Entity>>({});
  // Je pendentem Befehl der Zustand, den der Hub zuletzt wirklich
  // gemeldet hat (Punkt 580 der Werkbank). Bleibt die Antwort aus oder
  // sagt der Hub ab, kommt er auf die Kachel zurück - vorher blieb der
  // Wunschzustand stehen, und der Hub schickt nach einem gescheiterten
  // Befehl keinen echten nach.
  const vorherRef = useRef<Record<string, EntityState>>({});

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

  // Zustands-Meldungen gesammelt statt einzeln anwenden.
  //
  // Jede WebSocket-Meldung löste sofort ein setEntityMap aus - und damit
  // ein Neuzeichnen der ganzen Startseite. In einem Haus mit vielen
  // Fühlern (Leistung, Temperatur, Bewegung) ist der JS-Faden damit
  // dauerbeschäftigt, und ein Tipp, der während eines Neuzeichnens
  // ankommt, geht verloren: «Ich muss oft zweimal drücken.» Gesammelt
  // über 120 ms wird aus einem Schwall ein einziges Neuzeichnen; die
  // Verzögerung liegt unter dem, was ein Daumen bemerkt.
  const meldungsPuffer = useRef<Record<string, Entity>>({});
  const aktivitaetsPuffer = useRef<Activity[]>([]);
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const flush = useCallback(() => {
    flushTimer.current = null;
    const staende = meldungsPuffer.current;
    if (Object.keys(staende).length > 0) {
      meldungsPuffer.current = {};
      setEntityMap((prev) => ({ ...prev, ...staende }));
    }
    const eintraege = aktivitaetsPuffer.current;
    if (eintraege.length > 0) {
      aktivitaetsPuffer.current = [];
      setActivity((prev) => [...eintraege, ...prev].slice(0, ACTIVITY_LIMIT));
    }
  }, []);
  const flushPlanen = useCallback(() => {
    if (flushTimer.current == null) {
      flushTimer.current = setTimeout(flush, 120);
    }
  }, [flush]);

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

  /**
   * Eine Absage verarbeiten (Punkt 580 der Werkbank): Die Kachel
   * bekommt den Stand von vorher zurück und die Marke «unbestätigt»,
   * die Einblendung nennt das Gerät.
   */
  const absagen = useCallback((entityId: string, grund: string | null) => {
    const vorher = vorherRef.current[entityId];
    delete vorherRef.current[entityId];
    setEntityMap((prev) => {
      const entity = prev[entityId];
      return entity ? { ...prev, [entityId]: zurueckgesetzt(entity, vorher) } : prev;
    });
    setError(absageSatz(entitiesRef.current[entityId]?.name, grund));
  }, []);

  useEffect(() => {
    if (!url) {
      return;
    }
    let disposed = false;
    let ws: WebSocket | null = null;
    let retryTimer: ReturnType<typeof setTimeout> | undefined;
    // Bewusst angehalten: Dann verbindet onclose nicht neu. Sonst
    // machte das Schliessen eines abgemeldeten Sockets genau die
    // Schleife wieder auf, die es beenden soll.
    let halt = false;

    const setzeStatus = (next: ConnectionStatus) => {
      statusRef.current = next;
      setStatus(next);
    };

    /**
     * Was nach dem Ende einer Verbindung geschieht - ob der Hub sie
     * geschlossen hat oder die App sie aufgibt (Punkt 579 der
     * Werkbank). Die Entscheidung trifft lib/verbindungsstand.ts; hier
     * wird sie nur ausgeführt.
     */
    const weiterNach = (schritt: NachSchliessen) => {
      if (retryTimer) clearTimeout(retryTimer);
      retryTimer = undefined;
      setzeStatus(schritt.status);
      setStale(true);
      setPausiertBis(schritt.status === 'paused' ? schritt.wiederAb : null);
      if (schritt.status === 'signed_out') {
        // Ohne Benutzer öffnet die Konto-Seite ihre Verbindungsfelder
        // von selbst - dort steht der Weg zurück (QR-Code oder Token).
        setUser(null);
      }
      if (schritt.wiederAb !== null) {
        retryTimer = setTimeout(connect, Math.max(0, schritt.wiederAb - Date.now()));
      }
    };

    // Ping und Pong (Punkt 592 der Werkbank): Ein Socket, der nach einem
    // Neustart des Accesspoints halboffen ist, sieht von hier aus offen
    // aus und liefert nie mehr etwas. Nur eine Frage, die beantwortet
    // werden muss, deckt das auf.
    let pongTimer: ReturnType<typeof setTimeout> | null = null;
    let pongAt: number | null = null;
    const pongTimerRaeumen = () => {
      if (pongTimer !== null) {
        clearTimeout(pongTimer);
        pongTimer = null;
      }
    };

    const pingen = () => {
      const socket = ws;
      // Ein Ping ist schon unterwegs - erst seine Antwort abwarten.
      if (!socket || socket.readyState !== WebSocket.OPEN || pongTimer !== null) return;
      socket.send(JSON.stringify({ type: 'ping' }));
      const gesendet = Date.now();
      pongTimer = setTimeout(() => {
        pongTimer = null;
        // Inzwischen neu verbunden - die alte Frage gilt nicht mehr.
        if (socket !== ws || !pongAusgeblieben(gesendet, pongAt)) return;
        // Nicht auf das onclose des toten Sockets warten: Bei einem
        // halboffenen kommt es erst nach dem TCP-Zeitlimit, Minuten
        // später. Die Schleife geht sofort weiter, der Socket wird
        // stumm geschaltet und zugemacht.
        socket.onclose = null;
        socket.onmessage = null;
        socket.onerror = null;
        socket.close();
        attemptRef.current = 0;
        weiterNach(nachSchliessen(undefined, undefined, 0, Date.now()));
      }, PONG_FRIST_MS);
    };
    pingRef.current = pingen;

    const connect = () => {
      const base = url.replace(/\/+$/, '').replace(/^http/, 'ws');
      const wsUrl = base + '/ws' + (token ? `?token=${encodeURIComponent(token)}` : '');
      halt = false;
      pongTimerRaeumen();
      setzeStatus('connecting');
      ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.onopen = () => {
        attemptRef.current = 0;
        // «Verbunden» erst nach dem ersten Pong: Ein offener Socket
        // beweist nur den Handschlag, nicht dass beide Richtungen
        // tragen. Der Pong kommt in Millisekunden, der Schnappschuss
        // davor wird ohnehin angewendet.
        pingen();
      };

      ws.onmessage = (event) => {
        const message: ServerMessage = JSON.parse(String(event.data));
        if (message.type === 'snapshot') {
          // Was noch im Puffer liegt, ist älter als der Schnappschuss.
          meldungsPuffer.current = {};
          vorherRef.current = {};
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
          // Ein echter Zustand des Hubs - was vor dem Tippen war, zählt
          // nicht mehr, und die Marke «unbestätigt» geht mit dem
          // ersetzten Objekt von selbst.
          delete vorherRef.current[message.entity.id];
          meldungsPuffer.current[message.entity.id] = message.entity;
          if (message.type === 'state_changed') {
            const summary = describe(
              message.entity,
              message.new_state,
              message.old_state
            );
            if (summary) {
              aktivitaetsPuffer.current = [
                {
                  id: `${message.entity_id}-${Date.now()}`,
                  name: message.entity.name,
                  summary,
                  source: message.source?.label ?? null,
                  sourceKind: message.source?.kind ?? null,
                  at: Date.now(),
                },
                ...aktivitaetsPuffer.current,
              ].slice(0, ACTIVITY_LIMIT);
            }
          }
          flushPlanen();
        } else if (message.type === 'family_changed') {
          setFamilyChangedAt(Date.now());
        } else if (message.type === 'pong') {
          pongAt = Date.now();
          pongTimerRaeumen();
          // Der erste Pong nach dem Öffnen macht die Verbindung zu einer.
          if (statusRef.current === 'connecting') setzeStatus('connected');
        } else if (message.type === 'entity_removed') {
          delete meldungsPuffer.current[message.entity_id];
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
          // ins Leere und erfährt nie, warum nichts passiert ist. Und der
          // Wunschzustand kommt von der Kachel (Punkt 580 der Werkbank):
          // Der Hub schickt nach einer Absage keinen echten nach.
          if (!message.ok) {
            if (message.entity_id) {
              absagen(message.entity_id, message.error ?? 'Der Befehl ist fehlgeschlagen');
            } else {
              setError(message.error ?? 'Der Befehl ist fehlgeschlagen');
            }
            failed();
          } else if (message.entity_id) {
            delete vorherRef.current[message.entity_id];
          }
        }
      };

      ws.onclose = (event) => {
        pongTimerRaeumen();
        if (disposed || halt) return;
        // Der Code sagt, warum: 4401 heisst abgemeldet, und dann ist
        // jeder weitere Versuch vergeblich (Punkt 579 der Werkbank);
        // 4403 heisst Pause bis zur Zeit im Grund (Punkt 624).
        const schritt = nachSchliessen(
          event.code,
          event.reason,
          attemptRef.current,
          Date.now()
        );
        attemptRef.current += 1;
        weiterNach(schritt);
      };

      ws.onerror = () => ws?.close();
    };

    // Von aussen anhalten - ein 401 des HTTP-Clients sagt dasselbe wie
    // ein 4401 am Socket: Das Token ist tot. Der Socket wird zugemacht,
    // ohne dass sein onclose die Schleife wieder anwirft.
    anhaltenRef.current = (schritt) => {
      if (disposed) return;
      halt = true;
      weiterNach(schritt);
      if (ws && ws.readyState !== WebSocket.CLOSED) ws.close();
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
      // Ein abgemeldetes Gerät klopft auch nach dem Aufwachen nicht an:
      // Die Antwort wäre dieselbe, und der Balken sagt schon, was zu
      // tun ist.
      if (statusRef.current === 'signed_out') return;
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
      anhaltenRef.current = null;
      pingRef.current = null;
      pongTimerRaeumen();
      appState.remove();
      if (retryTimer) clearTimeout(retryTimer);
      if (flushTimer.current != null) {
        clearTimeout(flushTimer.current);
        flushTimer.current = null;
      }
      ws?.close();
      wsRef.current = null;
    };
  }, [url, token, clearPending, flushPlanen, absagen]);

  // Der Ping im Takt (Punkt 592 der Werkbank) - über den gemeinsamen
  // Takt, der im Hintergrund schweigt: Ein Telefon in der Tasche muss
  // nicht alle 30 Sekunden fragen, ob der Hub noch da ist; das iPad im
  // Flur schon, denn es geht nie in den Hintergrund.
  useTakt(() => pingRef.current?.(), status === 'connected' ? PING_INTERVALL_MS : null);

  // Ein 401 des HTTP-Clients heisst dasselbe wie ein 4401 am Socket:
  // Das Token gilt nicht mehr (Punkt 579 der Werkbank). Der Socket
  // erfährt es sonst erst beim nächsten Neuaufbau - und bis dahin
  // meldete jede Abfrage «fehlt die Berechtigung», während die
  // Kopfzeile «verbunden» sagte. Ein 403 mit `gilt_ab` ist der 4403
  // des Sockets: Zeitfenster zu, Pause bis dahin (Punkt 624).
  useEffect(
    () =>
      onHubFehler((fehler) => {
        const jetzt = Date.now();
        if (fehler.status === 401 && statusRef.current !== 'signed_out') {
          anhaltenRef.current?.(nachSchliessen(CODE_ABGEMELDET, undefined, 0, jetzt));
        } else if (fehler.status === 403 && fehler.giltAb && statusRef.current !== 'paused') {
          anhaltenRef.current?.(nachSchliessen(CODE_FENSTER_ZU, fehler.giltAb, 0, jetzt));
        }
      }),
    []
  );

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
      //
      // Den Stand von vorher dabei festhalten (Punkt 580 der Werkbank) -
      // den ersten, nicht den jüngsten: Beim Ziehen eines Reglers ist
      // der zweite «vorher» schon der Wunsch des ersten Tippens.
      const bekannt = entitiesRef.current[entityId];
      if (bekannt && !(entityId in vorherRef.current) && expectedState(bekannt, command, data)) {
        vorherRef.current[entityId] = { ...bekannt.state };
      }
      setEntityMap((prev) => {
        const entity = prev[entityId];
        if (!entity) return prev;
        const next = expectedState(entity, command, data);
        return next ? { ...prev, [entityId]: { ...entity, state: next } } : prev;
      });
      setPending((prev) => ({ ...prev, [entityId]: true }));
      // Das alte Zeitlimit desselben Geräts räumen: Sonst meldete der
      // erste Tipp «antwortet nicht», während der zweite noch unterwegs war.
      const alt = timersRef.current[entityId];
      if (alt) clearTimeout(alt);
      timersRef.current[entityId] = setTimeout(
        () => {
          clearPending(entityId);
          absagen(entityId, null);
          // Keine Antwort kann auch heissen, dass der Socket halboffen
          // ist (Punkt 592 der Werkbank): nachfragen, statt auf den
          // nächsten Takt zu warten - bleibt der Pong aus, wird neu
          // verbunden.
          pingRef.current?.();
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
    [clearPending, absagen]
  );

  /**
   * Den eigenen Benutzer neu holen.
   *
   * Der Hub schickt ihn nur einmal, mit dem ersten Schnappschuss. Wer
   * sich umbenennt, sah deshalb im Profil weiter den alten Namen - genau
   * dort, wo er gerade den neuen eingetippt hatte. Der Hub war längst
   * umbenannt; nur die App wusste es nicht.
   */
  const benutzerNeuLaden = useCallback(async () => {
    if (!url) return;
    try {
      const antwort = await fetch(`${url.replace(/\/+$/, '')}/api/me`, {
        headers: token ? { Authorization: `Bearer ${token}` } : {},
      });
      if (!antwort.ok) return;
      setUser((await antwort.json()) as User);
    } catch {
      // Ein misslungener Abruf lässt den alten Stand stehen. Schlimmer
      // wäre, den Benutzer auf null zu setzen: Dann sperrt sich die App
      // wegen einer Kleinigkeit selbst aus.
    }
  }, [url, token]);

  const sendCommand = useCallback(
    (entityId: string, command: string, data?: CommandData) => {
      const entity = entitiesRef.current[entityId];
      const before = entity ? { ...entity.state } : null;
      if (!send(entityId, command, data)) return;
      // Erst nach dem erfolgreichen Absenden anbieten – ein Befehl, der die
      // Verbindung gar nicht verlassen hat, braucht kein Zurück.
      const back =
        before && entity ? undoCommand(before, command, entity.kind, entity.commands) : null;
      if (back && entity && before) {
        setUndo({
          entityId,
          name: entity.name,
          label: undoLabel(before, command, data, entity.kind),
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
  // Ein Gerät darf in mehreren Zimmern zählen (Punkt 539). Der erste
  // Raum ist sein Standort - dort liegt die Kachel, daher kommt der
  // Namensvorschlag; die weiteren zählen bloss mit.
  const setEntityRoom = useCallback(
    async (entityId: string, rooms: string[] | null) => {
      const liste = rooms ?? [];
      const room = liste[0] ?? null;
      setEntityMap((prev) => {
        const entity = prev[entityId];
        return entity ? { ...prev, [entityId]: { ...entity, room, rooms: liste } } : prev;
      });
      try {
        const response = await fetch(`${url}/api/entities/${encodeURIComponent(entityId)}/room`, {
          method: 'PUT',
          headers: {
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ room, rooms: liste }),
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
      meta: {
        name?: string | null;
        favorite?: boolean;
        group?: string | null;
        /** Nur Szenen einer Integration: Bleibt sie aktiv, nimmt der
         *  zweite Druck sie zurück (Hub: core/scenes.py). */
        scene_toggles?: boolean;
        /** Nur Klimafühler: Der Wert zählt nur für seinen Raum. */
        room_only?: boolean;
        /** Nur Fenster- und Türkontakte: «window» oder «door». */
        contact_kind?: 'window' | 'door' | null;
      }
    ) => {
      setEntityMap((prev) => {
        const entity = prev[entityId];
        if (!entity) return prev;
        const next = { ...entity };
        if (meta.name !== undefined) next.name = meta.name || entity.name;
        if (meta.favorite !== undefined) next.favorite = meta.favorite;
        if (meta.group !== undefined) next.group = meta.group;
        if (meta.scene_toggles !== undefined) next.scene_toggles = meta.scene_toggles;
        if (meta.room_only !== undefined) next.room_only = meta.room_only;
        if (meta.contact_kind !== undefined) next.contact_kind = meta.contact_kind;
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
    benutzerNeuLaden,
    error,
    pending,
    // Wie viele Befehle darauf warten, dass der Hub wieder da ist.
    queued: queued.length,
    stale,
    cachedAt,
    familyChangedAt,
    pausiertBis,
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
