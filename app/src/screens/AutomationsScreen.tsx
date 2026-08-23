import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, ScrollView, Text, View } from 'react-native';

import { Entity, HubSettings, Scene, User } from '../api/types';
import { Card } from '../components/Card';
import { PushRules } from '../components/PushRules';
import { Fehlschlag, Laedt } from '../components/Zustand';
import { useColors } from '../theme';
import { HubFehler, hubClient } from '../api/client';
import { datumKurz, uhr } from '../lib/format';
import { istPushKategorie } from '../lib/pushablaeufe';
import {
  RueckwegBefehl,
  musikBefehl,
  richtungBefehl,
  sceneActionsToDraft,
  szenenRueckweg,
} from '../lib/szenen';
import { BabysitterStand, LEERER_BABYSITTER, istFreigegeben, modusSatz, seitText } from '../lib/babysitter';
import { Editor, Fassung } from './automations/editor';
import { Automation, Draft, DryRun, EMPTY, Run, StepDraft, TriggerHealth, buildConditions, describe, groupByCategory, lastRunText, newTrigger, runLine, search, stepToActions, stepsToActions, symbolFuerNamen, szenenSymbol, toDraft, triggerIcon, triggerToConfig, usedCategories, zeitpunktLabel } from './automations/entwurf';
import { Groups, SearchBox } from './automations/felder';
import { makeStyles } from './automations/stil';
import { SCENE_ICONS, SceneDraft, SceneEditor } from './automations/szenen-editor';
import { EigeneVorlage, buildTemplates, mischeVorlagen } from './automations/vorlagen';

/** Ein gegensätzlich geschaltetes Gerät aus /api/automations/conflicts. */
interface Konflikt {
  entity_id: string;
  commands: string[];
  automations: { id: string; alias: string }[];
  /** Kennung der Zeile – damit lässt sie sich abhaken (core/konflikte.py). */
  key?: string;
  /** Nur bei den bereits quittierten: wer und wann. */
  ack?: { by?: string; at?: number | null };
}

/** Ein Eintrag des Tagesbands aus /api/automations/agenda (Punkt 163). */
interface AgendaEintrag {
  automation_id: string;
  alias: string;
  at: number;
  art: string;
}

/** Eine Zeile des Papierkorbs aus /api/trash. */
interface PapierkorbZeile {
  kind: string;
  id: string;
  name: string;
  at: number;
  by: string;
}

export function AutomationsScreen({
  settings,
  user,
  entities,
  scenes,
  onScenesChanged,
  onNote,
}: {
  settings: HubSettings;
  user: User | null;
  entities: Entity[];
  scenes: Scene[];
  onScenesChanged?: () => void;
  /** Kurze Bestätigung nach oben melden – dort hängt die Einblendung
   *  am Bildschirm statt an der mitscrollenden Liste. */
  onNote?: (text: string) => void;
}) {
  const colors = useColors();
  const styles = useMemo(() => makeStyles(colors), [colors]);
  const [automations, setAutomations] = useState<Automation[] | null>(null);
  // Babysitter-Modus: Wer im Haus ist, weiss die Anwesenheit nicht immer.
  // Solange er läuft, ruhen alle Abläufe ausser den angehakten.
  const [babysitter, setBabysitter] = useState<BabysitterStand>(LEERER_BABYSITTER);
  // Bis wann alle Abläufe ruhen (ISO-Zeit), null = sie laufen.
  const [pausiertBis, setPausiertBis] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null);
  // Je Abschnitt ein eigenes Suchfeld – die Listen sind unabhängig.
  const [autoQuery, setAutoQuery] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  // Abläufe, die dasselbe Gerät gegensätzlich schalten – kein Fehler,
  // aber die erste Frage, wenn nachts das Licht von selbst angeht.
  const [conflicts, setConflicts] = useState<Konflikt[]>([]);
  // Eigene Vorlagen vom Hub und die ausgeblendeten eingebauten.
  const [eigeneVorlagen, setEigeneVorlagen] = useState<EigeneVorlage[]>([]);
  const [versteckteVorlagen, setVersteckteVorlagen] = useState<string[]>([]);
  // Eingeklappt: Die Vorlagen sind ein Anfang für den seltenen Fall
  // «neuer Ablauf», nicht die Liste, die man täglich liest.
  const [vorlagenOffen, setVorlagenOffen] = useState(false);
  // Bereits abgehakte Widersprüche - eingeklappt hinter «3 quittiert».
  const [quittiert, setQuittiert] = useState<Konflikt[]>([]);
  const [zeigeQuittierte, setZeigeQuittierte] = useState(false);
  const [trash, setTrash] = useState<PapierkorbZeile[]>([]);
  const [trashOpen, setTrashOpen] = useState(false);
  const [hueScenes, setHueScenes] = useState<string[]>([]);
  const [sceneQuery, setSceneQuery] = useState('');
  // Aufgeklappte Kategorien, getrennt je Abschnitt. Standard ist
  // zugeklappt: Wer Kategorien vergibt, will zuerst die Übersicht sehen
  // und nicht wieder die ganze Liste.
  const [openAuto, setOpenAuto] = useState<string[]>([]);
  const [openScenes, setOpenScenes] = useState<string[]>([]);
  // Ablauf, dessen Lauf-Verlauf gerade aufgeklappt ist.
  const [runsFor, setRunsFor] = useState<string | null>(null);
  // Die Auskunft «warum schweigt der?» je Ablauf – erst auf Wunsch geholt,
  // denn sie kostet einen eigenen Aufruf und interessiert nur, wenn etwas
  // nicht stimmt.
  const [diagnose, setDiagnose] = useState<Record<string, TriggerHealth[]>>({});
  // Mögliche Nachricht-Empfänger für den Editor (Punkt 158).
  const [empfaenger, setEmpfaenger] = useState<string[]>([]);
  // Das Tagesband (Punkt 163): was das Haus heute vorhat.
  const [agenda, setAgenda] = useState<AgendaEintrag[]>([]);
  const templates = useMemo(() => buildTemplates(entities, scenes), [entities, scenes]);
  const alleVorlagen = useMemo(
    () => mischeVorlagen(templates, eigeneVorlagen, versteckteVorlagen),
    [templates, eigeneVorlagen, versteckteVorlagen]
  );

  const mayEdit = !!user?.capabilities?.includes('edit_automations');
  // Denselben Eingriff wie das Pausieren - Abläufe ruhen lassen -,
  // nur gezielter. Deshalb dieselbe Berechtigung.
  const mayPause = !!user?.capabilities?.includes('pause_automations');
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  /** Einen Ablauf für den Babysitter-Modus frei- oder zurückgeben. */
  const babysitterFrei = async (id: string, allow: boolean) => {
    try {
      const antwort = await hub.put<{ babysitter?: BabysitterStand }>(
        `/api/automations/${encodeURIComponent(id)}/babysitter`,
        { allow },
        { still: true }
      );
      setBabysitter(antwort?.babysitter ?? LEERER_BABYSITTER);
    } catch (err) {
      setError(err instanceof HubFehler ? err.message : String(err));
    }
  };

  /** Den Modus als Ganzes ein- oder ausschalten. */
  const quittieren = async (key: string | undefined, on: boolean) => {
    if (!key) return;
    const antwort = await hub.post<{
      conflicts?: Konflikt[];
      acknowledged?: Konflikt[];
    } | null>('/api/automations/conflicts/ack', { key, on }, { fallback: null });
    if (!antwort) {
      onNote?.('Quittieren fehlgeschlagen – Hub nicht erreichbar');
      return;
    }
    setConflicts(antwort.conflicts ?? []);
    setQuittiert(antwort.acknowledged ?? []);
  };

  const pausieren = async (seconds: number) => {
    // Danach frisch laden: Steht die Pause nicht da, sieht man das
    // Scheitern am Zustand statt an einer Meldung, die man wegtippt.
    await hub.post('/api/automations/pause', { seconds }, { fallback: null, still: true });
    load();
  };

  const babysitterModus = async (active: boolean) => {
    try {
      const antwort = await hub.post<{ babysitter?: BabysitterStand }>(
        '/api/automations/babysitter',
        { active },
        { still: true }
      );
      setBabysitter(antwort?.babysitter ?? LEERER_BABYSITTER);
      onNote?.(active ? 'Babysitter-Modus läuft' : 'Babysitter-Modus aus');
    } catch (err) {
      setError(err instanceof HubFehler ? err.message : String(err));
    }
  };

  const load = useCallback(() => {
    // Der Bildschirm hat seine eigene Fehleranzeige - deshalb «still».
    hub
      .get<{
        automations?: Automation[];
        babysitter?: BabysitterStand;
        paused_until?: string | null;
      }>('/api/automations', { still: true })
      .then((data) => {
        setAutomations(data.automations ?? []);
        setBabysitter(data.babysitter ?? LEERER_BABYSITTER);
        setPausiertBis(data.paused_until ?? null);
      })
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));

    // Die Beikost (Konflikte, Papierkorb, Verlauf, Hue-Szenen) darf
    // fehlen, ohne dass die Seite meckert.
    hub
      .get<{ conflicts?: Konflikt[]; acknowledged?: Konflikt[] } | null>(
        '/api/automations/conflicts',
        { fallback: null, still: true }
      )
      .then((data) => {
        setConflicts(data?.conflicts ?? []);
        setQuittiert(data?.acknowledged ?? []);
      });
    hub
      .get<{ templates?: EigeneVorlage[]; hidden?: string[] } | null>(
        '/api/automations/templates',
        { fallback: null, still: true }
      )
      .then((data) => {
        setEigeneVorlagen(data?.templates ?? []);
        setVersteckteVorlagen(data?.hidden ?? []);
      });
    hub
      .get<{ trash?: PapierkorbZeile[] } | null>('/api/trash', { fallback: null, still: true })
      .then((data) => setTrash(data?.trash ?? []));
    hub
      .get<{ runs?: Run[] } | null>('/api/automations/runs', {
        fallback: null,
        still: true,
      })
      .then((data) => setRuns(data?.runs ?? []));
    hub
      .get<{ scenes?: string[] } | null>('/api/hue/scenes', {
        fallback: null,
        still: true,
      })
      .then((data) => setHueScenes(data?.scenes ?? []));
    hub
      .get<{ names?: string[] } | null>('/api/push/targets', {
        fallback: null,
        still: true,
      })
      .then((data) => setEmpfaenger(data?.names ?? []));
    hub
      .get<{ agenda?: AgendaEintrag[] } | null>('/api/automations/agenda', {
        fallback: null,
        still: true,
      })
      .then((data) => setAgenda(data?.agenda ?? []));
  }, [hub]);

  useEffect(load, [load]);

  /** Vorlagen: sichern, löschen, ein- und ausblenden. */
  const vorlagenAntwort = (
    antwort: { templates?: EigeneVorlage[]; hidden?: string[] } | null
  ) => {
    if (!antwort) {
      onNote?.('Vorlage nicht gespeichert – Hub nicht erreichbar');
      return false;
    }
    setEigeneVorlagen(antwort.templates ?? []);
    setVersteckteVorlagen(antwort.hidden ?? []);
    return true;
  };

  const vorlageSichern = async (entwurf: Draft) => {
    const antwort = await hub.post<{
      templates?: EigeneVorlage[];
      hidden?: string[];
    } | null>(
      '/api/automations/templates',
      {
        // «neu» ist kein Ziel, sondern die Absicht - der Hub vergibt die
        // Kennung.
        id: entwurf.templateId === 'neu' ? null : entwurf.templateId,
        draft: entwurf,
        icon: symbolFuerNamen(entwurf.alias) ?? 'flash-outline',
      },
      { fallback: null }
    );
    if (!vorlagenAntwort(antwort)) return;
    // Aus einer eingebauten wurde eine eigene: Die eingebaute
    // verschwindet, sonst stehen zwei fast gleiche nebeneinander.
    if (entwurf.templateHides) {
      vorlagenAntwort(
        await hub.post<{ templates?: EigeneVorlage[]; hidden?: string[] } | null>(
          '/api/automations/templates/hidden',
          { label: entwurf.templateHides, on: true },
          { fallback: null }
        )
      );
    }
    onNote?.(`Vorlage «${entwurf.alias || 'Ohne Namen'}» gesichert`);
    setDraft(null);
  };

  const vorlageLoeschen = async (id: string) => {
    vorlagenAntwort(
      await hub.del<{ templates?: EigeneVorlage[]; hidden?: string[] } | null>(
        `/api/automations/templates/${encodeURIComponent(id)}`,
        { fallback: null }
      )
    );
  };

  const vorlageAusblenden = async (label: string, on: boolean) => {
    vorlagenAntwort(
      await hub.post<{ templates?: EigeneVorlage[]; hidden?: string[] } | null>(
        '/api/automations/templates/hidden',
        { label, on },
        { fallback: null }
      )
    );
  };

  const save = async () => {
    if (!draft) return;
    // Eine Vorlage schaltet nichts - sie wird gesichert, nicht angelegt.
    if (draft.templateId) {
      await vorlageSichern(draft);
      return;
    }
    const body = {
      alias: draft.alias || 'Ohne Namen',
      trigger: draft.triggers.map(triggerToConfig),
      condition: buildConditions(draft),
      action: stepsToActions(draft.steps),
      otherwise: stepsToActions(draft.elseSteps),
      mode: draft.mode,
      cooldown: Math.max(0, Number(draft.cooldownMinutes) || 0) * 60,
      match: draft.match,
      enabled: draft.enabled,
      category: draft.category.trim() || null,
    };
    try {
      if (draft.id) {
        await hub.put(`/api/automations/${draft.id}`, body, { still: true });
      } else {
        await hub.post('/api/automations', body, { still: true });
      }
      onNote?.(draft.id ? `«${body.alias}» gespeichert` : `«${body.alias}» angelegt`);
      setDraft(null);
      load();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  /** Kopie anlegen – sechs fast gleiche Taster-Abläufe tippt niemand. */
  /** Kopie anlegen – auch von einem, der aus der config.yaml stammt. */
  const duplicate = async (id: string) => {
    const quelle = automations?.find((entry) => entry.id === id);
    const antwort = await hub.post<{ ok?: boolean } | null>(
      `/api/automations/${id}/duplicate`,
      undefined,
      { fallback: null, still: true }
    );
    if (!antwort) {
      // Kein stummes Scheitern: Sonst steht «Kopie angelegt» da, und es
      // gibt keine.
      onNote?.('Kopie fehlgeschlagen – der Hub war nicht erreichbar');
      return;
    }
    // Bei einem aus der Datei ist der Hinweis der Punkt: Die Kopie liegt
    // jetzt in der App, ist aber aus – sonst liefe derselbe Ablauf zweimal.
    onNote?.(
      quelle && !quelle.editable
        ? `«${quelle.alias}» als Kopie übernommen – noch ausgeschaltet`
        : 'Kopie angelegt'
    );
    load();
  };

  /** Einen Ablauf ein- oder ausschalten, ohne den Editor zu öffnen.
   *
   * Für die Push-Liste: Dort steht ein Ablauf neben den eingebauten
   * Nachrichten, und die haben ihren Schalter direkt auf der Karte.
   * «Bearbeiten → Haken → Speichern» wäre für dieselbe Handlung drei
   * Schritte statt einem.
   *
   * Der Hub kennt keine Teil-Änderung: Ein PUT trägt den ganzen Ablauf.
   * Deshalb geht er hier unverändert zurück – nur `enabled` ist neu. */
  const setEnabled = async (automation: Automation, enabled: boolean) => {
    // Sofort anzeigen, damit der Haken nicht hakt; der nachfolgende
    // load() setzt den Stand des Hubs darüber.
    setAutomations((prev) =>
      (prev ?? []).map((entry) =>
        entry.id === automation.id ? { ...entry, enabled } : entry
      )
    );
    const ok = await hub.put(
      `/api/automations/${automation.id}`,
      {
        alias: automation.alias,
        trigger: automation.triggers,
        condition: automation.conditions,
        action: automation.actions,
        otherwise: automation.otherwise ?? [],
        mode: automation.mode ?? 'single',
        match: automation.match ?? 'all',
        cooldown: automation.cooldown ?? 0,
        category: automation.category ?? null,
        quiet_until: automation.quiet_until ?? null,
        enabled,
      },
      { fallback: null, still: true }
    );
    if (ok === null) {
      onNote?.('Nicht gespeichert – der Hub war nicht erreichbar');
    } else {
      onNote?.(
        enabled
          ? `«${automation.alias}» meldet wieder`
          : `«${automation.alias}» meldet nichts mehr`
      );
    }
    load();
  };

  /** «Aus bis morgen früh» (Punkt 159): Statt den Ablauf auszuschalten
   *  und ihn drei Wochen später im Dunkeln zu vermissen, ruht er bis
   *  06:00 und meldet sich selbst zurück. */
  const snooze = async (automation: Automation, wecken: boolean) => {
    const morgen = new Date();
    morgen.setDate(morgen.getDate() + 1);
    morgen.setHours(6, 0, 0, 0);
    const ok = await hub.post(
      `/api/automations/${automation.id}/snooze`,
      { until: wecken ? null : morgen.getTime() / 1000 },
      { fallback: null, still: true }
    );
    if (ok === null) {
      onNote?.('Nicht gespeichert – der Hub war nicht erreichbar');
      return;
    }
    onNote?.(
      wecken
        ? `«${automation.alias}» ist wieder wach`
        : `«${automation.alias}» ruht bis morgen 06:00`
    );
    load();
  };

  /** Genau einen Schritt ausführen (Punkt 164) – so, wie er gerade im
   *  Editor steht, auch ungespeichert. */
  const probeStep = async (step: StepDraft): Promise<boolean> => {
    const actions = stepToActions(step);
    if (actions.length === 0) {
      onNote?.('Der Schritt ist noch leer – zuerst etwas auswählen');
      return false;
    }
    for (const action of actions) {
      const ok = await hub.post('/api/automations/probestep', { action }, {
        fallback: null,
        still: true,
      });
      if (ok === null) {
        onNote?.('Schritt fehlgeschlagen – Näheres steht im Hub-Log');
        return false;
      }
    }
    return true;
  };

  /** Den gespeicherten Ablauf einmal sofort ausführen – der «Testen»-Knopf. */
  const test = async (id: string) => {
    try {
      await hub.post(`/api/automations/${id}/trigger`, undefined, { still: true });
      onNote?.('Ablauf einmal ausgeführt');
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  /** Zeigt, was der Ablauf jetzt täte – ohne dass etwas passiert. */
  const dryRun = async (id: string): Promise<DryRun | null> => {
    try {
      return await hub.get<DryRun>(`/api/automations/${id}/dryrun`, { still: true });
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      return null;
    }
  };

  /** Frühere Fassungen eines Ablaufs laden – stabil über useCallback, weil
   *  der Editor bei jedem Tastendruck neu rendert und die Liste sonst bei
   *  jedem Buchstaben neu vom Hub geholt würde. */
  const loadAutomationVersions = useCallback(async (): Promise<Fassung[]> => {
    if (!draft?.id) return [];
    // Ohne Fassungen zeigt der Editor schlicht keinen Abschnitt.
    const body = await hub.get<{ versions?: Fassung[] } | null>(
      `/api/edit-history/automation/${draft.id}`,
      { fallback: null, still: true }
    );
    return body?.versions ?? [];
  }, [draft?.id, hub]);

  const loadSceneVersions = useCallback(async (): Promise<Fassung[]> => {
    if (!sceneDraft?.id) return [];
    const body = await hub.get<{ versions?: Fassung[] } | null>(
      `/api/edit-history/scene/${sceneDraft.id}`,
      { fallback: null, still: true }
    );
    return body?.versions ?? [];
  }, [sceneDraft?.id, hub]);

  /** Eine frühere Fassung zurückholen; der Editor schliesst, weil sein
   *  Entwurf danach veraltet wäre. */
  const restoreVersion = async (
    kind: 'automation' | 'scene',
    id: string,
    at: number
  ): Promise<boolean> => {
    try {
      const { restored } = await hub.post<{ restored: string }>(
        `/api/edit-history/${kind}/${id}/restore`,
        { at },
        { still: true }
      );
      onNote?.(`Frühere Fassung von «${restored}» zurückgeholt`);
      setDraft(null);
      setSceneDraft(null);
      load();
      return true;
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
      return false;
    }
  };

  const remove = async (id: string) => {
    const name = automations?.find((item) => item.id === id)?.alias ?? 'Ablauf';
    const ok = await hub
      .del(`/api/automations/${id}`, { still: true })
      .then(() => true)
      .catch(() => false);
    // Der Papierkorb ist der eigentliche Rückweg – der Hinweis sagt, dass
    // es ihn gibt. Und wenn das Löschen scheiterte, muss genau das
    // dastehen, nicht die halbe Wahrheit.
    onNote?.(
      ok
        ? `«${name}» in den Papierkorb gelegt`
        : `«${name}» konnte nicht gelöscht werden – Hub nicht erreichbar`
    );
    setDraft(null);
    load();
  };

  const saveScene = async () => {
    if (!sceneDraft) return;
    const body = {
      name: sceneDraft.name || 'Ohne Namen',
      icon: sceneDraft.icon,
      room: sceneDraft.room || null,
      on_start: !!sceneDraft.onStart,
      transition: Math.max(0, Number(sceneDraft.transition) || 0),
      toggles: sceneDraft.toggles !== false,
      category: sceneDraft.category?.trim() || null,
      actions: sceneDraft.actions
        .filter((action) => action.entity_id)
        // flatMap, weil aus einem Eintrag zwei Aktionen werden können:
        // Helligkeit und Farbe sind zwei Befehle an dasselbe Licht.
        .flatMap(
          ({
            entity_id,
            command,
            rooms,
            position,
            brightness,
            color,
            transition,
            volume,
            playlist,
            app,
            device,
            shuffle,
          }) => {
          // Kamera und Lautsprecher kennen je einen Befehl, dessen
          // Richtung in unsichtbaren Zusatzdaten steckt. In der Auswahl
          // sind es zwei Chips.
          const richtung = richtungBefehl(command);
          if (richtung) {
            return [{ entity_id, command: richtung.command, data: richtung.data }];
          }
          if (command === 'set_volume') {
            return [{ entity_id, command, data: { volume: volume ?? 30 } }];
          }
          // «Musik an» mit gewählter Playlist wird zu play_playlist: Der
          // Hub sucht sie über ihren Namen, weckt die Ziel-Box notfalls
          // über das Cast-Protokoll und stellt die Reihenfolge ein.
          const musik = musikBefehl(command, { playlist, device, shuffle });
          if (musik) {
            return [{ entity_id, command: musik.command, data: musik.data }];
          }
          if (command === 'launch_app') {
            return [{ entity_id, command, data: { app: app ?? '' } }];
          }
          if (command === 'clean_rooms') {
            return [{ entity_id, command, data: { rooms: rooms ?? [] } }];
          }
          if (command === 'set_position') {
            return [{ entity_id, command, data: { position: position ?? 50 } }];
          }
          if (command === 'set_brightness') {
            return [
              {
                entity_id,
                command,
                data: {
                  brightness: brightness ?? 50,
                  ...(transition !== undefined ? { transition } : {}),
                },
              },
              ...(color ? [{ entity_id, command: 'set_color', data: { color } }] : []),
            ];
          }
          return [{ entity_id, command }];
        }
        ),
    };
    try {
      if (sceneDraft.id) {
        await hub.put(`/api/scenes/${sceneDraft.id}`, body, { still: true });
      } else {
        await hub.post('/api/scenes', body, { still: true });
      }
      onNote?.(sceneDraft.id ? `Szene «${body.name}» gespeichert` : `Szene «${body.name}» angelegt`);
      setSceneDraft(null);
      onScenesChanged?.();
    } catch (err) {
      setError(String(err instanceof Error ? err.message : err));
    }
  };

  /**
   * Eine gespeicherte Szene ausprobieren – mit Rückweg.
   *
   * Vorher hiess Szenenbauen: speichern, ins Zimmer gehen, schauen,
   * zurückkommen, ändern. Jetzt: Ausprobieren, und wenn es nicht passt,
   * «Doch nicht» – der Zustand von vorher kommt zurück (soweit er sich
   * gefahrlos wiederherstellen lässt, siehe lib/szenen.ts).
   */
  const testScene = async (id: string): Promise<RueckwegBefehl[]> => {
    const scene = scenes.find((entry) => entry.id === id);
    const rueckweg = szenenRueckweg(entities, scene?.entity_ids ?? []);
    try {
      await hub.post(`/api/scenes/${id}/activate`, undefined, { still: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return [];
    }
    return rueckweg;
  };

  const revertScene = async (befehle: RueckwegBefehl[]) => {
    let daneben = 0;
    for (const befehl of befehle) {
      const gut = await hub
        .post(
          `/api/entities/${encodeURIComponent(befehl.entity_id)}/command`,
          { command: befehl.command, data: befehl.data ?? {} },
          { still: true }
        )
        .then(() => true)
        .catch(() => false);
      if (!gut) daneben += 1;
    }
    onNote?.(
      daneben === 0
        ? 'Zustand von vorher wiederhergestellt'
        : `Zustand von vorher wiederhergestellt – ${daneben} Gerät(e) haben nicht reagiert`
    );
  };

  const removeScene = async (id: string) => {
    const ok = await hub
      .del(`/api/scenes/${id}`, { still: true })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      onNote?.('Szene konnte nicht gelöscht werden – Hub nicht erreichbar');
    }
    setSceneDraft(null);
    onScenesChanged?.();
  };

  if (error) {
    return <Fehlschlag text={`Abläufe nicht abrufbar: ${error}`} onRetry={load} />;
  }
  if (!automations) {
    return <Laedt was="Abläufe" />;
  }

  const restore = async (kind: string, id: string) => {
    const ok = await hub
      .post(`/api/trash/${kind}/${id}/restore`, undefined, { still: true })
      .then(() => true)
      .catch(() => false);
    if (!ok) {
      onNote?.('Zurückholen fehlgeschlagen – vielleicht gibt es den Eintrag schon wieder');
    }
    load();
  };

  return (
    <View style={styles.list}>
      <Text style={[styles.sectionTitle, { marginTop: 0 }]}>Abläufe</Text>

      {/* «Alles mal ruhen lassen» stand unter System, zwischen
          Speicherplatz und Protokoll - drei Ecken entfernt von der Seite,
          auf der die Abläufe stehen. Hier ist es eine Zeile: die Zahl,
          der Zustand, zwei kleine Knöpfe. Keine Karte, denn im Alltag
          liest man sie nur, wenn etwas ruhen soll. */}
      {mayPause && automations.length > 0 ? (
        <View style={styles.pausenZeile}>
          <Text
            style={[
              styles.pausenText,
              pausiertBis || babysitter.active ? { color: colors.warn } : null,
            ]}
          >
            {automations.length} Abläufe ·{' '}
            {babysitter.active
              ? `Babysitter-Modus${seitText(babysitter.since)}`
              : pausiertBis
                ? `pausiert bis ${uhr(new Date(pausiertBis))}`
                : 'aktiv'}
          </Text>
          {/* Die beiden Knöpfe als ein Stück: Auf dem Telefon rutscht
              sonst «Bis morgen» allein in die nächste Zeile. */}
          <View style={styles.pausenKnoepfe}>
            {pausiertBis ? (
              <Pressable
                onPress={() => pausieren(0)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
              >
                <Text style={styles.templateText}>Wieder aktivieren</Text>
              </Pressable>
            ) : (
              <>
                <Pressable
                  onPress={() => pausieren(3600)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
                >
                  <Text style={styles.templateText}>1 Stunde pausieren</Text>
                </Pressable>
                <Pressable
                  onPress={() => pausieren(12 * 3600)}
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
                >
                  <Text style={styles.templateText}>Bis morgen</Text>
                </Pressable>
              </>
            )}
            {/* Der Babysitter gehört hierher und nicht in einen eigenen
                Kasten weiter unten: Es ist dieselbe Frage - «alles mal
                ruhen lassen» -, nur gezielter. Pausieren gilt für eine
                Stunde und für alle; der Babysitter gilt, bis jemand ihn
                beendet, und lässt die freigegebenen laufen. */}
            <Pressable
              onPress={() => babysitterModus(!babysitter.active)}
              accessibilityRole="switch"
              accessibilityState={{ checked: babysitter.active }}
              accessibilityLabel={
                babysitter.active
                  ? 'Babysitter-Modus beenden'
                  : 'Babysitter-Modus einschalten'
              }
              style={({ pressed }) => [
                styles.template,
                babysitter.active && { backgroundColor: colors.warn, borderColor: colors.warn },
                pressed && { opacity: 0.75 },
              ]}
            >
              <Ionicons
                name={babysitter.active ? 'happy' : 'happy-outline'}
                size={14}
                color={babysitter.active ? '#FFFFFF' : colors.inkSoft}
              />
              <Text
                style={[
                  styles.templateText,
                  babysitter.active && { color: '#FFFFFF' },
                ]}
              >
                {babysitter.active ? 'Babysitter beenden' : 'Babysitter'}
              </Text>
            </Pressable>
          </View>
        </View>
      ) : null}

      {/* Was der Modus bedeutet, steht *vor* dem Drücken da - danach
          wäre die Auskunft wertlos, dann sind die Storen schon unten.
          Läuft er, bleibt der Satz stehen und sagt zusätzlich, wie man
          einen Ablauf davon ausnimmt. */}
      {mayPause && automations.length > 0 ? (
        <Text style={[styles.triggerNote, babysitter.active && { color: colors.warn }]}>
          {babysitter.active
            ? `${modusSatz(babysitter, automations.length)} Freigegeben wird je Ablauf – das Schild neben dem Stift. Melder für Wasser und Rauch, die Alarmanlage selbst und die Meldungen des Wächters laufen unabhängig davon weiter.`
            : modusSatz(babysitter, automations.length)}
        </Text>
      ) : null}

      {agenda.length > 0 ? (
        // Das Tagesband (Punkt 163): «was macht das Haus heute noch?» -
        // Vergangenes mit Haken, Kommendes mit Uhrzeit, ohne jeden
        // Ablauf einzeln zu öffnen.
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={{ flexGrow: 0 }}
          contentContainerStyle={styles.agendaBand}
        >
          {agenda.map((eintrag, index) => {
            const vorbei = eintrag.at * 1000 < Date.now();
            return (
              <View
                key={`${eintrag.automation_id}-${index}`}
                style={[styles.agendaChip, vorbei && { opacity: 0.55 }]}
              >
                <Ionicons
                  name={vorbei ? 'checkmark-circle' : eintrag.art === 'sun' ? 'sunny-outline' : 'time-outline'}
                  size={13}
                  color={vorbei ? colors.on : colors.inkSoft}
                />
                <Text style={styles.agendaZeit}>
                  {new Date(eintrag.at * 1000).toLocaleTimeString('de-CH', {
                    hour: '2-digit',
                    minute: '2-digit',
                  })}
                </Text>
                <Text style={styles.agendaName} numberOfLines={1}>
                  {eintrag.alias}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      ) : null}

      {/* Ist alles abgehakt, bleibt keine Karte stehen - nur die schmale
          Zeile unten, über die man die Quittungen wieder zurücknehmen
          kann. «Nicht mehr anzeigen» heisst nicht anzeigen. */}
      {conflicts.length > 0 ? (
        <Card style={styles.card}>
          <View style={styles.cardHead}>
            <Ionicons name="git-compare-outline" size={18} color={colors.warn} />
            <Text style={[styles.title, { flex: 1 }]}>
              {conflicts.length === 1
                ? 'Ein Gerät wird gegensätzlich geschaltet'
                : `${conflicts.length} Geräte werden gegensätzlich geschaltet`}
            </Text>
          </View>
          {/* Abhaken statt wegschauen: Acht gewollte Widersprüche
              verdeckten den einen, der es nicht ist. Die Quittung gilt
              fürs Haus - wer prüft, prüft für alle -, und sie kommt
              zurück, sobald jemand einen der beiden Abläufe umbaut. */}
          {conflicts.map((conflict, index) => (
            <View key={conflict.key ?? index} style={styles.konfliktZeile}>
              <Text style={[styles.detail, { flex: 1 }]}>
                {entities.find((entity) => entity.id === conflict.entity_id)?.name ??
                  conflict.entity_id}
                : «{conflict.automations[0].alias}» und «{conflict.automations[1].alias}»
              </Text>
              {mayEdit ? (
                <Pressable
                  onPress={() => quittieren(conflict.key, true)}
                  accessibilityRole="button"
                  accessibilityLabel={`«${conflict.automations[0].alias}» und «${conflict.automations[1].alias}»: geprüft, nicht mehr anzeigen`}
                  hitSlop={8}
                  style={({ pressed }) => [
                    styles.quittungKnopf,
                    pressed && { opacity: 0.7 },
                  ]}
                >
                  <Ionicons name="checkmark" size={15} color={colors.inkSoft} />
                  <Text style={styles.quittungText}>Geprüft</Text>
                </Pressable>
              ) : null}
            </View>
          ))}
          <Text style={styles.triggerNote}>
            Kein Fehler – oft ist genau das gewollt (der eine schaltet ein, der
            andere später aus). Geht aber nachts das Licht von selbst an,
            steht die Ursache hier. «Geprüft» nimmt eine Zeile aus der Liste.
          </Text>
        </Card>
      ) : null}

      {quittiert.length > 0 ? (
        <View style={conflicts.length > 0 ? styles.quittungBlock : styles.quittungAllein}>
              <Pressable
                onPress={() => setZeigeQuittierte((offen) => !offen)}
                accessibilityRole="button"
                style={({ pressed }) => [styles.quittungZeile, pressed && { opacity: 0.7 }]}
              >
                <Ionicons
                  name={zeigeQuittierte ? 'chevron-down' : 'chevron-forward'}
                  size={14}
                  color={colors.inkSoft}
                />
                <Text style={styles.quittungText}>
                  {quittiert.length === 1 ? '1 quittiert' : `${quittiert.length} quittiert`}
                </Text>
              </Pressable>
              {zeigeQuittierte
                ? quittiert.map((conflict, index) => (
                    <View key={conflict.key ?? index} style={styles.konfliktZeile}>
                      <Text style={[styles.detail, { flex: 1, opacity: 0.7 }]}>
                        {entities.find((entity) => entity.id === conflict.entity_id)
                          ?.name ?? conflict.entity_id}
                        : «{conflict.automations[0].alias}» und «
                        {conflict.automations[1].alias}»
                        {conflict.ack?.by ? ` · ${conflict.ack.by}` : ''}
                      </Text>
                      {mayEdit ? (
                        <Pressable
                          onPress={() => quittieren(conflict.key, false)}
                          accessibilityRole="button"
                          accessibilityLabel="Quittung zurücknehmen"
                          hitSlop={8}
                          style={({ pressed }) => [
                            styles.quittungKnopf,
                            pressed && { opacity: 0.7 },
                          ]}
                        >
                          <Ionicons
                            name="arrow-undo-outline"
                            size={15}
                            color={colors.inkSoft}
                          />
                          <Text style={styles.quittungText}>Zurück</Text>
                        </Pressable>
                      ) : null}
                    </View>
                  ))
                : null}
        </View>
      ) : null}
      {mayEdit ? (
        <Pressable
          onPress={() =>
            setDraft({
              ...EMPTY,
              triggers: [newTrigger(entities[0])],
            })
          }
          accessibilityRole="button"
          style={({ pressed }) => [styles.newButton, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="add" size={20} color={colors.ink} />
          <Text style={styles.newText}>Neuer Ablauf</Text>
        </Pressable>
      ) : null}

      {/* Eingeklappt: Die Vorlagen sind der Anfang für den seltenen Fall
          «neuer Ablauf» und standen trotzdem jedes Mal aufgeklappt über
          der Liste, die man wirklich liest. Aufgeklappt stehen sie
          untereinander - mit Stift und Kreuz, denn eine Liste, die nur
          wächst, wird nicht nützlicher.

          Eingebaute lassen sich nicht löschen (sie stehen im Code und
          entstehen aus dem Gerätebestand), aber ausblenden. Wer eine
          bearbeitet, bekommt eine eigene Kopie, und die eingebaute
          verschwindet - sonst stünden zwei fast gleiche nebeneinander. */}
      {mayEdit && (alleVorlagen.length > 0 || versteckteVorlagen.length > 0) ? (
        <View style={styles.templates}>
          <Pressable
            onPress={() => setVorlagenOffen((offen) => !offen)}
            accessibilityRole="button"
            accessibilityState={{ expanded: vorlagenOffen }}
            style={({ pressed }) => [styles.vorlagenKopf, pressed && { opacity: 0.7 }]}
          >
            <Ionicons
              name={vorlagenOffen ? 'chevron-down' : 'chevron-forward'}
              size={14}
              color={colors.onGradientSoft}
            />
            <Text style={styles.templatesLabel}>Vorlagen</Text>
            <Text style={styles.groupCount}>{alleVorlagen.length}</Text>
          </Pressable>

          {vorlagenOffen ? (
            <>
              {alleVorlagen.map((vorlage) => (
                <View key={vorlage.key} style={styles.vorlagenZeile}>
                  <Pressable
                    onPress={() => setDraft({ ...EMPTY, ...vorlage.draft })}
                    accessibilityRole="button"
                    accessibilityLabel={`Neuer Ablauf aus «${vorlage.label}»`}
                    style={({ pressed }) => [
                      styles.template,
                      { flex: 1 },
                      pressed && { opacity: 0.75 },
                    ]}
                  >
                    <Ionicons
                      name={vorlage.icon as keyof typeof Ionicons.glyphMap}
                      size={14}
                      color={colors.inkSoft}
                    />
                    <Text style={styles.templateText} numberOfLines={1}>
                      {vorlage.label}
                    </Text>
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      setDraft({
                        ...EMPTY,
                        ...vorlage.draft,
                        // Der Ablauf-Teil bekommt nie die Kennung einer
                        // Vorlage - hier ist es umgekehrt gewollt.
                        id: undefined,
                        alias: vorlage.label,
                        templateId: vorlage.eigen ? vorlage.id : 'neu',
                        templateHides: vorlage.eigen ? undefined : vorlage.label,
                      })
                    }
                    accessibilityRole="button"
                    accessibilityLabel={`Vorlage «${vorlage.label}» bearbeiten`}
                    hitSlop={8}
                    style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons name="create-outline" size={18} color={colors.inkSoft} />
                  </Pressable>
                  <Pressable
                    onPress={() =>
                      vorlage.eigen
                        ? vorlageLoeschen(vorlage.id)
                        : vorlageAusblenden(vorlage.label, true)
                    }
                    accessibilityRole="button"
                    accessibilityLabel={
                      vorlage.eigen
                        ? `Vorlage «${vorlage.label}» löschen`
                        : `Vorlage «${vorlage.label}» ausblenden`
                    }
                    hitSlop={8}
                    style={({ pressed }) => [styles.iconButton, pressed && { opacity: 0.7 }]}
                  >
                    <Ionicons
                      name={vorlage.eigen ? 'trash-outline' : 'eye-off-outline'}
                      size={18}
                      color={colors.inkSoft}
                    />
                  </Pressable>
                </View>
              ))}

              <View style={styles.choices}>
                <Pressable
                  onPress={() =>
                    setDraft({ ...EMPTY, templateId: 'neu', triggers: [newTrigger(entities[0])] })
                  }
                  accessibilityRole="button"
                  style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
                >
                  <Ionicons name="add" size={14} color={colors.inkSoft} />
                  <Text style={styles.templateText}>Neue Vorlage</Text>
                </Pressable>
                {versteckteVorlagen.map((label) => (
                  <Pressable
                    key={label}
                    onPress={() => vorlageAusblenden(label, false)}
                    accessibilityRole="button"
                    accessibilityLabel={`«${label}» wieder anzeigen`}
                    style={({ pressed }) => [
                      styles.template,
                      { opacity: 0.6 },
                      pressed && { opacity: 0.4 },
                    ]}
                  >
                    <Ionicons name="eye-outline" size={14} color={colors.inkSoft} />
                    <Text style={styles.templateText} numberOfLines={1}>
                      {label}
                    </Text>
                  </Pressable>
                ))}
              </View>
              <Text style={styles.triggerNote}>
                Antippen öffnet einen vorbefüllten Entwurf. Eingebaute Vorlagen
                entstehen aus den Geräten im Haus; ausgeblendete stehen hier
                blass und kommen mit einem Tipp zurück.
              </Text>
            </>
          ) : null}
        </View>
      ) : null}

      {automations.length === 0 ? (
        <Text style={styles.note}>
          Noch keine Abläufe. Sie entstehen hier oder im Abschnitt „automations“
          der config.yaml des Hubs.
        </Text>
      ) : (
        <>
          {automations.length > 5 ? (
            <SearchBox
              value={autoQuery}
              onChange={setAutoQuery}
              placeholder="Ablauf oder Kategorie suchen …"
            />
          ) : null}
          <Groups
            groups={groupByCategory(
              // Eine selbst vergebene Kategorie «Push» stünde als zweite,
              // gleichlautende Überschrift neben dem Push-Bereich weiter
              // unten – dieselben Abläufe, zweimal. Sie stehen dort, der
              // Bereich nimmt sie ausdrücklich auf.
              search(automations, autoQuery, (entry) =>
                `${entry.alias} ${entry.category ?? ''}`
              //
              // Beim Suchen aber nicht: Wer «push» eintippt und «Nichts
              // gefunden» liest, während der Bereich darunter genau diese
              // Abläufe zeigt, hält die Suche für kaputt. Eine doppelte
              // Überschrift ist dann das kleinere Übel – und man hat ja
              // ausdrücklich danach gesucht.
              ).filter(
                (entry) => !!autoQuery.trim() || !istPushKategorie(entry.category)
              )
            )}
            open={openAuto}
            openAll={!!autoQuery}
            onToggle={(category) =>
              setOpenAuto((prev) =>
                prev.includes(category)
                  ? prev.filter((entry) => entry !== category)
                  : [...prev, category]
              )
            }
            empty="Nichts gefunden."
            renderItem={(automation) => (
              <Card key={automation.id} style={styles.card}>
                <View style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <View style={{ flexDirection: 'row', alignItems: 'center', gap: 6 }}>
                      {/* Worauf hört er? Uhr, Sonne, Bewegung, Termin -
                          das Symbol sagt es, ohne die Zeile zu lesen. */}
                      <Ionicons
                        name={triggerIcon(automation) as keyof typeof Ionicons.glyphMap}
                        size={15}
                        color={
                          automation.enabled === false ? colors.inkFaint : colors.inkSoft
                        }
                      />
                      <Text
                        style={[
                          styles.title,
                          { flexShrink: 1 },
                          automation.enabled === false && { color: colors.inkFaint },
                        ]}
                      >
                        {automation.alias}
                        {automation.enabled === false ? ' · aus' : ''}
                      </Text>
                    </View>
                    <Text style={styles.detail}>{describe(automation)}</Text>
                    {/* «heute 21:12» statt Kopfrechnen über Sonnenuntergang
                        plus Versatz (Punkt 161) - nur bei Zeit/Sonne, ein
                        Bewegungsmelder hat keinen Kalender. */}
                    {automation.enabled !== false && automation.next_run ? (
                      <Text style={styles.detail}>
                        Nächste Ausführung: {zeitpunktLabel(automation.next_run)}
                      </Text>
                    ) : null}
                    {automation.quiet_until &&
                    automation.quiet_until * 1000 > Date.now() ? (
                      <Text style={[styles.detail, { color: colors.warn }]}>
                        Ruht bis {zeitpunktLabel(automation.quiet_until)}
                      </Text>
                    ) : null}
                    {/* Antippbar: die letzten Läufe samt Begründung. «Warum
                        lief das nicht?» steht dann da - z.B. «übersprungen:
                        nur wenn dunkel» - statt nur des letzten Laufs. */}
                    <Pressable
                      onPress={() => {
                        const auf = runsFor === automation.id;
                        setRunsFor(auf ? null : automation.id);
                        // Beim Aufklappen gleich nachfragen, ob der
                        // Auslöser überhaupt ankommt - der Lauf-Verlauf
                        // allein beantwortet das nicht.
                        if (!auf && !diagnose[automation.id]) {
                          // Ohne Diagnose bleibt die Zeile leer – der
                          // Rest der Liste funktioniert weiter.
                          hub
                            .get<{ triggers?: TriggerHealth[] } | null>(
                              `/api/automations/${automation.id}/diagnose`,
                              { fallback: null, still: true }
                            )
                            .then((d) => {
                              const zeilen = d?.triggers;
                              if (zeilen) {
                                setDiagnose((v) => ({ ...v, [automation.id]: zeilen }));
                              }
                            });
                        }
                      }}
                      accessibilityRole="button"
                      accessibilityState={{ expanded: runsFor === automation.id }}
                    >
                      <Text style={styles.detail}>
                        {lastRunText(runs, automation.id)}
                        {runs.some((run) => run.automation_id === automation.id)
                          ? runsFor === automation.id
                            ? ' ▾'
                            : ' ▸'
                          : ''}
                      </Text>
                    </Pressable>
                    {runsFor === automation.id ? (
                      <View style={{ marginTop: 4, gap: 2 }}>
                        {runs
                          .filter((run) => run.automation_id === automation.id)
                          .slice(0, 8)
                          .map((run, index) => (
                            <View key={index}>
                              <Text style={styles.triggerNote}>{runLine(run)}</Text>
                              {/* Die Schritt-Spur (Punkt 160): beim
                                  neuesten Lauf und bei Fehlläufen - dort
                                  steht, WELCHER Schritt hing. */}
                              {(index === 0 || run.error) &&
                                (run.steps ?? []).map((schritt, sIndex) => (
                                  <Text
                                    key={sIndex}
                                    style={[
                                      styles.runStep,
                                      schritt.error ? { color: colors.danger } : null,
                                    ]}
                                  >
                                    {schritt.after > 0.5
                                      ? `+${Math.round(schritt.after)}s · `
                                      : '· '}
                                    {schritt.label}
                                    {schritt.note ? ` – ${schritt.note}` : ''}
                                    {schritt.error ? ` – ${schritt.error}` : ''}
                                  </Text>
                                ))}
                            </View>
                          ))}
                        <Text style={styles.triggerNote}>
                          «Übersprungen» heisst: ausgelöst, aber eine Bedingung
                          war nicht erfüllt - sie steht dahinter.
                        </Text>
                        {/* Und die andere Hälfte der Antwort: Kam der
                            Auslöser überhaupt? Ein Melder mit leerer
                            Batterie hinterlässt im Lauf-Verlauf nichts. */}
                        {(diagnose[automation.id] ?? [])
                          .filter((t) => !t.ok)
                          .map((t, index) => (
                            <Text
                              key={`d${index}`}
                              style={[styles.triggerNote, { color: colors.warn }]}
                            >
                              {t.hinweis}
                            </Text>
                          ))}
                      </View>
                    ) : null}
                  </View>
                  {automation.editable && mayEdit ? (
                    <>
                      {automation.enabled !== false ? (
                        // Punkt 159: «aus bis morgen» statt aus - den
                        // wieder einzuschalten vergisst man drei Wochen.
                        <Pressable
                          onPress={() =>
                            snooze(
                              automation,
                              !!(
                                automation.quiet_until &&
                                automation.quiet_until * 1000 > Date.now()
                              )
                            )
                          }
                          accessibilityLabel={
                            automation.quiet_until &&
                            automation.quiet_until * 1000 > Date.now()
                              ? `${automation.alias} wieder wecken`
                              : `${automation.alias} bis morgen früh ruhen lassen`
                          }
                          style={styles.iconButton}
                        >
                          <Ionicons
                            name={
                              automation.quiet_until &&
                              automation.quiet_until * 1000 > Date.now()
                                ? 'sunny-outline'
                                : 'moon-outline'
                            }
                            size={20}
                            color={colors.inkSoft}
                          />
                        </Pressable>
                      ) : null}
                      <Pressable
                        onPress={() => duplicate(automation.id)}
                        accessibilityLabel={`${automation.alias} kopieren`}
                        style={styles.iconButton}
                      >
                        <Ionicons name="copy-outline" size={20} color={colors.inkSoft} />
                      </Pressable>
                      <Pressable
                        onPress={() => setDraft(toDraft(automation))}
                        accessibilityLabel={`${automation.alias} bearbeiten`}
                        style={styles.iconButton}
                      >
                        <Ionicons name="create-outline" size={20} color={colors.inkSoft} />
                      </Pressable>
                    </>
                  ) : null}
                  {/* Läuft dieser Ablauf, wenn der Babysitter da ist?
                      Bewusst auch bei Abläufen aus der config.yaml: Die
                      Freigabe liegt neben den Abläufen, nicht in ihnen -
                      sonst müsste man für einen Haken die Datei
                      anfassen. */}
                  {mayPause ? (
                    <Pressable
                      onPress={() =>
                        babysitterFrei(
                          automation.id,
                          !istFreigegeben(babysitter, automation.id)
                        )
                      }
                      accessibilityRole="checkbox"
                      accessibilityState={{
                        checked: istFreigegeben(babysitter, automation.id),
                      }}
                      accessibilityLabel={
                        istFreigegeben(babysitter, automation.id)
                          ? `${automation.alias} läuft im Babysitter-Modus – abwählen`
                          : `${automation.alias} im Babysitter-Modus laufen lassen`
                      }
                      style={styles.iconButton}
                    >
                      <Ionicons
                        name={
                          istFreigegeben(babysitter, automation.id)
                            ? 'shield-checkmark'
                            : 'shield-outline'
                        }
                        size={20}
                        color={
                          istFreigegeben(babysitter, automation.id)
                            ? colors.warn
                            : colors.inkFaint
                        }
                      />
                    </Pressable>
                  ) : null}
                  {!(automation.editable && mayEdit) ? (
                    <>
                      {/* Der fehlende Weg von der Datei zur Bedienbarkeit:
                          Das Original bleibt unangetastet, die Kopie liegt
                          in der App und ist änderbar. Sie kommt
                          ausgeschaltet – sonst liefe derselbe Ablauf ab
                          sofort zweimal. */}
                      {mayEdit ? (
                        <Pressable
                          onPress={() => duplicate(automation.id)}
                          accessibilityRole="button"
                          accessibilityLabel={`${automation.alias} als Kopie in die App übernehmen`}
                          style={styles.iconButton}
                        >
                          <Ionicons
                            name="download-outline"
                            size={20}
                            color={colors.inkSoft}
                          />
                        </Pressable>
                      ) : null}
                      <Text style={styles.badge}>aus config.yaml</Text>
                    </>
                  ) : null}
                </View>
              </Card>
            )}
          />
        </>
      )}

      {/* Alles, was aufs Telefon geht, als eigene Kategorie «Push»: die
          eingebauten Wächter-Nachrichten (Regeln mit Schalter und
          Schwelle, keine gespeicherten Abläufe) und darunter die eigenen
          Abläufe, die eine Nachricht verschicken. Beide bleiben dort
          bearbeitbar. */}
      <PushRules
        settings={settings}
        mayEdit={mayEdit}
        automations={automations}
        onEdit={(automation) => setDraft(toDraft(automation))}
        onToggle={setEnabled}
      />

      <Text style={styles.sectionTitle}>Szenen</Text>
      {mayEdit ? (
        <Pressable
          onPress={() =>
            setSceneDraft({
              name: '',
              icon: SCENE_ICONS[0],
              onStart: false,
              transition: 0,
              toggles: true,
              actions: [],
            })
          }
          accessibilityRole="button"
          style={({ pressed }) => [styles.newButton, pressed && { opacity: 0.75 }]}
        >
          <Ionicons name="add" size={20} color={colors.ink} />
          <Text style={styles.newText}>Neue Szene</Text>
        </Pressable>
      ) : null}

      {scenes.length === 0 ? (
        <Text style={styles.note}>
          Noch keine Szenen. Eine Szene schaltet mehrere Geräte mit einem Tippen.
        </Text>
      ) : (
        <>
          {scenes.length > 5 ? (
            <SearchBox
              value={sceneQuery}
              onChange={setSceneQuery}
              placeholder="Szene oder Kategorie suchen …"
            />
          ) : null}
          <Groups
            groups={groupByCategory(
              search(scenes, sceneQuery, (entry) =>
                `${entry.name} ${entry.category ?? ''} ${entry.room ?? ''}`
              )
            )}
            open={openScenes}
            openAll={!!sceneQuery}
            onToggle={(category) =>
              setOpenScenes((prev) =>
                prev.includes(category)
                  ? prev.filter((entry) => entry !== category)
                  : [...prev, category]
              )
            }
            empty="Nichts gefunden."
            renderItem={(scene) => (
              <Card key={scene.id} style={styles.card}>
                <View style={styles.cardHead}>
                  {/* Wer beim Anlegen kein Symbol gewählt hat, bekam das
                      allgemeine Funkeln - auch «Babysitter-Modus». Steht
                      noch die Voreinstellung da und sagt der Name etwas,
                      zeigen wir das. Gespeichert wird nichts: Ein selbst
                      gewähltes Funkeln bleibt ein Funkeln, sobald es
                      einmal angetippt wurde. */}
                  <Ionicons
                    name={
                      szenenSymbol(scene) as keyof typeof Ionicons.glyphMap
                    }
                    size={20}
                    color={colors.inkSoft}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={styles.title}>{scene.name}</Text>
                    <Text style={styles.detail}>
                      {(scene.actions?.length ?? scene.entity_ids.length)} Aktion(en)
                    </Text>
                  </View>
                  {scene.editable && mayEdit ? (
                    <Pressable
                      onPress={() =>
                        setSceneDraft({
                          id: scene.id,
                          name: scene.name,
                          icon: scene.icon,
                          room: scene.room ?? undefined,
                          onStart: !!scene.on_start,
                          transition: Number(scene.transition) || 0,
                          // Fehlt das Feld, gilt «bleibt aktiv» - so
                          // verhalten sich die Szenen, die es schon gab.
                          toggles: scene.toggles !== false,
                          category: scene.category ?? undefined,
                          actions: sceneActionsToDraft(scene.actions ?? []),
                        })
                      }
                      accessibilityLabel={`${scene.name} bearbeiten`}
                      style={styles.iconButton}
                    >
                      <Ionicons name="create-outline" size={20} color={colors.inkSoft} />
                    </Pressable>
                  ) : (
                    <Text style={styles.badge}>aus config.yaml</Text>
                  )}
                </View>
              </Card>
            )}
          />
        </>
      )}

      {mayEdit && trash.length > 0 ? (
        <Card style={styles.card}>
          <Pressable
            onPress={() => setTrashOpen((open) => !open)}
            accessibilityRole="button"
            style={styles.cardHead}
          >
            <Ionicons name="trash-outline" size={18} color={colors.inkSoft} />
            <Text style={[styles.title, { flex: 1 }]}>
              Papierkorb ({trash.length})
            </Text>
            <Ionicons
              name={trashOpen ? 'chevron-up' : 'chevron-down'}
              size={20}
              color={colors.inkSoft}
            />
          </Pressable>
          {trashOpen ? (
            <>
              {trash.map((row) => (
                <View key={`${row.kind}:${row.id}`} style={styles.cardHead}>
                  <View style={{ flex: 1 }}>
                    <Text style={styles.detail}>{row.name}</Text>
                    <Text style={styles.triggerNote}>
                      {row.kind === 'scene' ? 'Szene' : 'Ablauf'} · gelöscht am{' '}
                      {datumKurz(row.at * 1000)}
                      {row.by && row.by !== '?' ? ` von ${row.by}` : ''}
                    </Text>
                  </View>
                  <Pressable
                    onPress={() => restore(row.kind, row.id)}
                    accessibilityRole="button"
                    style={({ pressed }) => [styles.newButton, pressed && { opacity: 0.75 }]}
                  >
                    <Ionicons name="arrow-undo-outline" size={16} color={colors.ink} />
                    <Text style={styles.newText}>Zurückholen</Text>
                  </Pressable>
                </View>
              ))}
              <Text style={styles.triggerNote}>
                Gelöschtes bleibt 30 Tage liegen und verschwindet danach von
                selbst.
              </Text>
            </>
          ) : null}
        </Card>
      ) : null}

      <Editor
        draft={draft}
        entities={entities}
        scenes={scenes}
        categories={usedCategories(automations)}
        hueScenes={hueScenes}
        empfaenger={empfaenger}
        onProbeStep={mayEdit ? probeStep : undefined}
        onChange={setDraft}
        onSave={save}
        onDelete={draft?.id ? () => remove(draft.id!) : undefined}
        onTest={draft?.id ? () => test(draft.id!) : undefined}
        onDryRun={draft?.id ? () => dryRun(draft.id!) : undefined}
        onVersions={draft?.id ? loadAutomationVersions : undefined}
        onRestoreVersion={
          draft?.id ? (at) => restoreVersion('automation', draft.id!, at) : undefined
        }
        onCancel={() => setDraft(null)}
      />
      <SceneEditor
        draft={sceneDraft}
        entities={entities}
        categories={usedCategories(scenes)}
        onChange={setSceneDraft}
        onSave={saveScene}
        onDelete={sceneDraft?.id ? () => removeScene(sceneDraft.id!) : undefined}
        onCancel={() => setSceneDraft(null)}
        onTest={sceneDraft?.id ? () => testScene(sceneDraft.id!) : undefined}
        onRevert={revertScene}
        onVersions={sceneDraft?.id ? loadSceneVersions : undefined}
        onRestoreVersion={
          sceneDraft?.id
            ? (at) => restoreVersion('scene', sceneDraft.id!, at)
            : undefined
        }
      />
    </View>
  );
}

/** Kategorie eintippen oder eine vorhandene antippen.
 *
 * Kein eigener Verwaltungsdialog: Eine neue Kategorie entsteht dadurch,
 * dass jemand ihren Namen tippt, und verschwindet, wenn nichts mehr darin
 * liegt. Eine Liste leerer Kategorien müsste man sonst pflegen. */
