import { useCallback, useEffect, useRef, useState } from 'react';

import { HubSettings } from '../api/types';
import { hubClient } from '../api/client';
import { LernEintrag } from '../lib/ladenlernen';

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
 * **Persönlich** (`/api/prefs`): was nur einen selbst angeht. Die eigenen
 * Favoriten, die Durchsage-Sätze, der gewählte Anblick, die Lesemarke der
 * «Was ist neu»-Karte. Haushaltsweit nähme der Erste sie allen anderen
 * weg.
 *
 * Beides liegt auf dem Hub, nicht im Speicher der App: Sonst hält es
 * genau so lange wie die Installation auf diesem einen Telefon.
 *
 * Nicht alles Persönliche läuft über diesen Haken. Was tief in einer
 * Kachel sitzt - die Playlist-Reihenfolge, die Vorlese-Box im Kochbuch,
 * der Anblick im Profil - setzt einzelne Schlüssel über
 * `lib/persoenlich.ts`. Beide Wege vertragen sich, weil der Hub
 * zusammenführt statt zu ersetzen (core/einstellungen.py) und hier
 * ebenfalls nur das Geänderte geschickt wird.
 */

/** Wie das Haus für alle aussieht. */
export interface HousePrefs {
  /** Kachel-Reihenfolgen je Ansicht: Schlüssel wie «devices», «light»,
   *  «covers», «room:Küche», «favorites», «family». */
  order?: Record<string, string[]>;
  /** Geräte, die auf der Startseite nicht erscheinen. */
  hidden?: string[];
  /** Familien-Kacheln, die nicht erscheinen. Sie lagen bis zuletzt im
   *  Speicher der App - und waren damit nach jedem neuen Build weg und
   *  auf dem Wandpanel nie da. Genau der Fall, für den es diese Ablage
   *  gibt. */
  familyHidden?: string[];
  /** Gesperrte Geräte: schalten nur nach ausdrücklicher Rückfrage. */
  locked?: string[];
  /** Geräte, die in der «3 an» der Kopfzeile nicht mitzählen – der
   *  Kühlschrank, die Umwälzpumpe, ein Grow-Licht. Sie bleiben auf der
   *  Startseite: Ausblenden wäre die andere Liste (siehe lib/zaehlung). */
  ungezaehlt?: string[];
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
  /** Welche Knöpfe auf der Raumkachel liegen - je Raum die Liste der
   *  Aktionen («licht», «storen», «musik»). Ohne Eintrag alle, die der
   *  Raum hergibt; eine leere Liste heisst bewusst: keine. */
  raumKnoepfe?: Record<string, string[]>;
  /** Schlüssel der Knöpfe, die direkt schalten statt die App zu öffnen.
   *  Nur für Szenen und Lichter erlaubt – nie für Tür oder Alarm. */
  widgetDirect?: string[];
  /** Die selbst zusammengestellten Widgets: je eines für ein Gerät oder
   *  eine Szene, in derselben Schlüsselsprache wie die Knöpfe. Sie
   *  stehen für alle im Haus, wie die Knöpfe auch – wer eines anlegt,
   *  legt es auf jedem Telefon zur Auswahl. */
  widgetKarten?: string[];
  /** Das Abhak-Protokoll der Einkaufsliste: aus ihm lernt die App die
   *  Gang-Reihenfolge je Laden (lib/ladenlernen.ts). Haushaltsweit,
   *  weil der Laden für alle derselbe ist – was Livia abhakt, sortiert
   *  auch Stefans Liste. */
  einkaufLernen?: LernEintrag[];
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
  /** Kacheln nach Tageszeit sortieren: morgens Storen, abends Licht.
   *  Aus, bis jemand sie einschaltet – eine Wohnung, die sich von selbst
   *  umsortiert, ohne dass man es bestellt hat, ist keine eingerichtete
   *  Wohnung, sondern eine, in der man morgens sucht. Persönlich, weil
   *  es Gewohnheit ist: Wer um sechs aufsteht, meint mit «Morgen» etwas
   *  anderes als wer um neun anfängt. */
  tageszeit?: boolean;
  /** Räume nach Nutzung sortieren: der meistbediente zuoberst. Persönlich
   *  wie die Tageszeit - und gezählt wird je Gerät (lib/raumnutzung),
   *  denn am Wandpanel bedient man anderes als auf dem Telefon. */
  raumNutzung?: boolean;
  /** Die Doppeltipp-Aktion je Gerät: «zweimal tippen = mein 40 %».
   *  Persönlich, weil Lieblingshelligkeit persönlich ist - was Stefan
   *  abends mag, blendet Bine. */
  doppeltipp?: Record<string, Doppeltippaktion>;
  /** Live-Aktivitäten auf dem Sperrbildschirm. Fehlt der Wert, gilt
   *  an - abgeschaltet wird je Person, wie die Benachrichtigungen. Den
   *  Schalter liest auch der Hub (core/liveaktivitaet.py). */
  liveTuer?: boolean;
  /** Abbestellte Kartenarten («timer», «grill», «tuer», …) - die
   *  Feinregelung unter dem grossen Schalter. Bewusst als Abbestellen:
   *  Eine neue Kartenart kommt erst einmal an, statt unbemerkt zu
   *  fehlen. Auch das setzt der Hub durch (core/livekarten.py). */
  liveAus?: string[];
  /** Der Öffnen-Knopf auf der Haustür-Karte, der OHNE Entsperren
   *  funktioniert. Standard aus, und das mit Bedacht: An heisst, jeder
   *  mit dem Telefon in der Hand kann die Türe öffnen - Face ID und
   *  Rückfrage laufen dort nicht (targets/widget, TuerOeffnenIntent).
   *  Persönlich, weil es die Abwägung jedes Einzelnen ist. */
  tuerKnopf?: boolean;
  /** Die eigenen Favoriten. Lange stand der Stern am Gerät selbst und
   *  galt damit für alle – aber griffbereit ist eine persönliche Frage:
   *  Was Stefan jeden Abend braucht, ist für Livia nur eine Kachel im
   *  Weg. Fehlt die Liste noch (undefined), gelten die alten Sterne am
   *  Gerät als Startbestand; der erste eigene Stern schreibt sie fest. */
  favorites?: string[];
  /** Die selbst gezogene Reihenfolge der eigenen Favoriten. */
  favoriteOrder?: string[];
  /** Die selbst gezogene Reihenfolge der Schnellaktionen ganz oben:
   *  Szenen-Kennungen und die zwei Storen-Knöpfe (lib/schnellordnung.ts).
   *  Persönlich wie die Favoriten - welche Szene man zuerst braucht, ist
   *  eine persönliche Frage, und die Storen sind es erst recht. */
  schnellOrder?: string[];
  /** Weitere persönliche Schlüssel liegen in derselben Ablage, werden
   *  aber nicht von hier aus gesetzt (siehe lib/persoenlich.ts):
   *  `theme` (der gewählte Anblick), `playlisten` (Reihenfolge und
   *  Ausgeblendetes je Musikkarte), `vorleseziel` (welche Box das Rezept
   *  vorliest) und `portionen` (für wie viele je Rezept gekocht wird).
   *  Sie stehen hier nicht als Feld, weil dieser Haken sie weder liest
   *  noch schreibt - aber sie stehen hier, damit niemand sie sucht. */

  /** Die Durchsage-Kachel auf der Startseite: zuletzt gewählte Box und
   *  die selbst getippten Sätze. Persönlich, weil beides es ist - wer
   *  vom Büro aus ruft, meint eine andere Box als wer in der Küche
   *  steht, und «Der Znüni steht bereit» sagt nicht jeder. */
  durchsage?: DurchsagePrefs;
}

/** Was ein Doppeltipp auf die Kachel auslöst (siehe lib/doppeltipp.ts). */
export interface Doppeltippaktion {
  command: string;
  data?: Record<string, number>;
  wort: string;
}

export interface DurchsagePrefs {
  /** Kennung der Box; fehlt sie oder ist sie «alle», gehen alle. */
  ziel?: string;
  /** Die Sätze des Fensters - eine Liste, in der alles gleich behandelt
   *  wird: hinzufügen, bearbeiten, löschen. `undefined` heisst «noch nie
   *  angefasst», dann gilt der mitgelieferte Startbestand; eine leere
   *  Liste heisst «bewusst leer» und bleibt leer. */
  texte?: string[];
  /** Aus älteren Fassungen: der zuletzt getippte Satz, der sich von
   *  selbst merkte und den man nicht löschen konnte. Er wird beim ersten
   *  Handgriff in `texte` gefaltet und danach nicht mehr geschrieben. */
  letzter?: string;
}

/**
 * Die gemeinsame Mechanik beider Ablagen: laden, halten, zurückschreiben.
 *
 * Der Setzer setzt immer auf der neuesten Fassung auf – ohne die Ref
 * überschriebe ein schneller zweiter Zug den ersten mit veralteten Daten.
 *
 * Geschickt wird nur, was sich ändert, nicht der ganze Bestand: Der Hub
 * führt zusammen (core/einstellungen.py). Das ist kein Sparen an
 * Bytes - es gibt auch anderswo Stellen, die eine einzelne Einstellung
 * setzen (lib/persoenlich.ts: der Anblick im Profil, die Vorlese-Box im
 * Kochbuch). Wer den ganzen Bestand schickte, überschriebe deren Werte
 * mit dem Stand vom Laden dieses Bildschirms.
 */
function useStore<T extends object>(
  settings: HubSettings,
  connected: boolean,
  pfad: string
): { werte: T; geladen: boolean; setzen: (patch: Partial<T>) => void } {
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
    (patch: Partial<T>) => {
      const next = { ...latest.current, ...patch };
      setWerte(next);
      latest.current = next;
      if (!settings.url || !settings.token) return;
      // Nicht gespeichert heisst: gilt nur auf diesem Gerät, bis die
      // Verbindung zurück ist – kein Grund, die Bedienung zu stören.
      hubClient(settings.url, settings.token).put(
        pfad,
        { prefs: patch },
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
  // Nur noch die Reihenfolgen brauchen den bisherigen Stand: Sie liegen
  // als ein Objekt je Ansicht beieinander, und wer eine davon setzt, muss
  // die anderen mitschicken. Über die Ref, damit der Setzer stabil
  // bleibt - hinge er am Wert, bekäme jedes Ziehen einer Kachel eine neue
  // Funktion und alles, was davon abhängt, zeichnete neu.
  const hausJetzt = useRef<HousePrefs>({});
  hausJetzt.current = haus.werte;

  const setzeHaus = haus.setzen;
  const setzeEigen = eigen.setzen;

  const setOrder = useCallback(
    (scope: string, ids: string[]) => {
      setzeHaus({
        order: { ...(hausJetzt.current.order ?? {}), [scope]: ids },
      });
    },
    [setzeHaus]
  );

  const setHidden = useCallback(
    (ids: string[]) => setzeHaus({ hidden: ids }),
    [setzeHaus]
  );

  const setFamilyHidden = useCallback(
    (keys: string[]) => setzeHaus({ familyHidden: keys }),
    [setzeHaus]
  );

  const setLocked = useCallback(
    (ids: string[]) => setzeHaus({ locked: ids }),
    [setzeHaus]
  );

  const setUngezaehlt = useCallback(
    (ids: string[]) => setzeHaus({ ungezaehlt: ids }),
    [setzeHaus]
  );

  const setBioLock = useCallback(
    (on: boolean) => setzeHaus({ bioLock: on }),
    [setzeHaus]
  );

  const setDoorConfirm = useCallback(
    (on: boolean) => setzeHaus({ doorConfirm: on }),
    [setzeHaus]
  );

  const setWidgetData = useCallback(
    (on: boolean) => setzeHaus({ widgetData: on }),
    [setzeHaus]
  );

  const setWidgetButtons = useCallback(
    (keys: string[]) => setzeHaus({ widgetButtons: keys }),
    [setzeHaus]
  );

  const setRaumKnoepfe = useCallback(
    (raum: string, arts: string[]) => {
      setzeHaus({
        raumKnoepfe: { ...(hausJetzt.current.raumKnoepfe ?? {}), [raum]: arts },
      });
    },
    [setzeHaus]
  );

  const setWidgetDirect = useCallback(
    (keys: string[]) => setzeHaus({ widgetDirect: keys }),
    [setzeHaus]
  );

  const setWidgetKarten = useCallback(
    (keys: string[]) => setzeHaus({ widgetKarten: keys }),
    [setzeHaus]
  );

  const setEinkaufLernen = useCallback(
    (log: LernEintrag[]) => setzeHaus({ einkaufLernen: log }),
    [setzeHaus]
  );

  const setSeenChanges = useCallback(
    (commit: string) => setzeEigen({ seenChanges: commit }),
    [setzeEigen]
  );

  const setKameraDynamisch = useCallback(
    (on: boolean) => setzeEigen({ kameraDynamisch: on }),
    [setzeEigen]
  );

  const setTageszeit = useCallback(
    (on: boolean) => setzeEigen({ tageszeit: on }),
    [setzeEigen]
  );

  const setRaumNutzung = useCallback(
    (on: boolean) => setzeEigen({ raumNutzung: on }),
    [setzeEigen]
  );

  const setDoppeltipp = useCallback(
    (entityId: string, aktion: Doppeltippaktion | null) =>
      setzeEigen({
        doppeltipp: (() => {
          const bisher = { ...(eigen.werte.doppeltipp ?? {}) };
          if (aktion) bisher[entityId] = aktion;
          else delete bisher[entityId];
          return bisher;
        })(),
      }),
    [setzeEigen, eigen.werte.doppeltipp]
  );

  const setLiveTuer = useCallback(
    (on: boolean) => setzeEigen({ liveTuer: on }),
    [setzeEigen]
  );

  const setLiveAus = useCallback(
    (keys: string[]) => setzeEigen({ liveAus: keys }),
    [setzeEigen]
  );

  const setTuerKnopf = useCallback(
    (on: boolean) => setzeEigen({ tuerKnopf: on }),
    [setzeEigen]
  );

  const setFavorites = useCallback(
    (ids: string[]) => setzeEigen({ favorites: ids }),
    [setzeEigen]
  );

  const setFavoriteOrder = useCallback(
    (ids: string[]) => setzeEigen({ favoriteOrder: ids }),
    [setzeEigen]
  );

  const setSchnellOrder = useCallback(
    (ids: string[]) => setzeEigen({ schnellOrder: ids }),
    [setzeEigen]
  );

  const setDurchsage = useCallback(
    (durchsage: DurchsagePrefs) =>
      setzeEigen({ durchsage }),
    [setzeEigen]
  );

  return {
    prefs: haus.werte,
    hausGeladen: haus.geladen,
    /** Mehrere auf einmal setzen – für die Übernahme alter Einstellungen. */
    setHausPrefs: setzeHaus,
    eigenePrefs: eigen.werte,
    /** Ob die persönlichen Einstellungen schon vom Hub da sind - der
     *  Türknopf-Haken wartet darauf, statt beim Start kurz zu löschen. */
    eigenGeladen: eigen.geladen,
    setOrder,
    setHidden,
    setFamilyHidden,
    setLocked,
    setUngezaehlt,
    setBioLock,
    setDoorConfirm,
    setWidgetData,
    setWidgetButtons,
    setRaumKnoepfe,
    setWidgetDirect,
    setWidgetKarten,
    setEinkaufLernen,
    setSeenChanges,
    setKameraDynamisch,
    setTageszeit,
    setRaumNutzung,
    setDoppeltipp,
    setLiveTuer,
    setLiveAus,
    setTuerKnopf,
    setFavorites,
    setFavoriteOrder,
    setSchnellOrder,
    setDurchsage,
  };
}
