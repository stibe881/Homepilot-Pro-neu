import { Ionicons } from '@expo/vector-icons';
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Pressable, Text, View } from 'react-native';

import { Entity, HubSettings, Scene, User } from '../api/types';
import { Card } from '../components/Card';
import { PushRules } from '../components/PushRules';
import { Fehlschlag, Laedt } from '../components/Zustand';
import { useColors } from '../theme';
import { HubFehler, hubClient } from '../api/client';
import { datumKurz } from '../lib/format';
import { RueckwegBefehl, sceneActionsToDraft, szenenRueckweg } from '../lib/szenen';
import { Editor, Fassung } from './automations/editor';
import { Automation, Draft, DryRun, EMPTY, Run, TriggerHealth, buildConditions, describe, groupByCategory, lastRunText, newTrigger, runLine, search, stepsToActions, toDraft, triggerToConfig, usedCategories } from './automations/entwurf';
import { Groups, SearchBox } from './automations/felder';
import { makeStyles } from './automations/stil';
import { SCENE_ICONS, SceneDraft, SceneEditor } from './automations/szenen-editor';
import { buildTemplates } from './automations/vorlagen';

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
  const [error, setError] = useState<string | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [sceneDraft, setSceneDraft] = useState<SceneDraft | null>(null);
  // Je Abschnitt ein eigenes Suchfeld – die Listen sind unabhängig.
  const [autoQuery, setAutoQuery] = useState('');
  const [runs, setRuns] = useState<Run[]>([]);
  // Abläufe, die dasselbe Gerät gegensätzlich schalten – kein Fehler,
  // aber die erste Frage, wenn nachts das Licht von selbst angeht.
  const [conflicts, setConflicts] = useState<
    { entity_id: string; commands: string[]; automations: { id: string; alias: string }[] }[]
  >([]);
  const [trash, setTrash] = useState<
    { kind: string; id: string; name: string; at: number; by: string }[]
  >([]);
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
  const templates = useMemo(() => buildTemplates(entities, scenes), [entities, scenes]);

  const mayEdit = !!user?.capabilities?.includes('edit_automations');
  const hub = useMemo(
    () => hubClient(settings.url, settings.token),
    [settings.url, settings.token]
  );

  const load = useCallback(() => {
    // Der Bildschirm hat seine eigene Fehleranzeige - deshalb «still».
    hub
      .get<{ automations?: Automation[] }>('/api/automations', { still: true })
      .then((data) => setAutomations(data.automations ?? []))
      .catch((err) => setError(err instanceof HubFehler ? err.message : String(err)));

    // Die Beikost (Konflikte, Papierkorb, Verlauf, Hue-Szenen) darf
    // fehlen, ohne dass die Seite meckert.
    hub
      .get<{ conflicts?: any[] } | null>('/api/automations/conflicts', {
        fallback: null,
        still: true,
      })
      .then((data) => setConflicts(data?.conflicts ?? []));
    hub
      .get<{ trash?: any[] } | null>('/api/trash', { fallback: null, still: true })
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
  }, [hub]);

  useEffect(load, [load]);

  const save = async () => {
    if (!draft) return;
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
      category: sceneDraft.category?.trim() || null,
      actions: sceneDraft.actions
        .filter((action) => action.entity_id)
        // flatMap, weil aus einem Eintrag zwei Aktionen werden können:
        // Helligkeit und Farbe sind zwei Befehle an dasselbe Licht.
        .flatMap(({ entity_id, command, rooms, position, brightness, color, transition }) => {
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
        }),
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
          {conflicts.map((conflict, index) => (
            <Text key={index} style={styles.detail}>
              {entities.find((entity) => entity.id === conflict.entity_id)?.name ??
                conflict.entity_id}
              : «{conflict.automations[0].alias}» und «{conflict.automations[1].alias}»
            </Text>
          ))}
          <Text style={styles.triggerNote}>
            Kein Fehler – oft ist genau das gewollt (der eine schaltet ein, der
            andere später aus). Geht aber nachts das Licht von selbst an,
            steht die Ursache hier.
          </Text>
        </Card>
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

      {mayEdit && templates.length > 0 ? (
        <View style={styles.templates}>
          <Text style={styles.templatesLabel}>Vorlagen</Text>
          <View style={styles.choices}>
            {templates.map((template) => (
              <Pressable
                key={template.label}
                onPress={() => setDraft({ ...template.draft })}
                accessibilityRole="button"
                style={({ pressed }) => [styles.template, pressed && { opacity: 0.75 }]}
              >
                <Ionicons name={template.icon} size={14} color={colors.inkSoft} />
                <Text style={styles.templateText}>{template.label}</Text>
              </Pressable>
            ))}
          </View>
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
              search(automations, autoQuery, (entry) =>
                `${entry.alias} ${entry.category ?? ''}`
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
                    <Text
                      style={[
                        styles.title,
                        automation.enabled === false && { color: colors.inkFaint },
                      ]}
                    >
                      {automation.alias}
                      {automation.enabled === false ? ' · aus' : ''}
                    </Text>
                    <Text style={styles.detail}>{describe(automation)}</Text>
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
                            <Text key={index} style={styles.triggerNote}>
                              {runLine(run)}
                            </Text>
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
                  ) : (
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
                  )}
                </View>
              </Card>
            )}
          />
        </>
      )}

      {/* Die eingebauten Wächter-Nachrichten als eigene Kategorie «Push»:
          Sie gehören zu den Abläufen - der Hub tut hier etwas von sich
          aus -, sind aber keine gespeicherten Automationen, sondern
          Regeln mit Schalter und Schwelle. */}
      <PushRules settings={settings} mayEdit={mayEdit} />

      <Text style={styles.sectionTitle}>Szenen</Text>
      {mayEdit ? (
        <Pressable
          onPress={() =>
            setSceneDraft({
              name: '',
              icon: SCENE_ICONS[0],
              onStart: false,
              transition: 0,
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
                  <Ionicons name={scene.icon as any} size={20} color={colors.inkSoft} />
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
