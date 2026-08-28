/**
 * Die Familienlisten auf der Startseite: Einkauf, Läden und Erinnerungen.
 *
 * Sie hängen an einer gemeinsamen Abfrage - deshalb stehen sie in einem
 * Haken und nicht in dreien. Der Bildschirm bekommt am Ende Listen und
 * Handgriffe, nicht ein Dutzend Zustände.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { HubClient } from '../api/client';
import { HubSettings } from '../api/types';
import {
  EinkaufZeile,
  Shop,
  findeArtikel,
  mengeUndName,
  mitMenge,
  shopCategory,
} from '../lib/einkauf';
import {
  Erinnerung,
  anzuzeigende,
  bestaetigung,
  naechsteAt,
  quittiertVon,
} from '../lib/erinnerungen';
import { LernEintrag, merken, vergessen } from '../lib/ladenlernen';
import { useTakt } from './useTakt';

export function useFamilienlisten({
  hub,
  settings,
  familyChangedAt,
  aufStartseite,
  benutzer,
  melde,
}: {
  hub: HubClient;
  settings: HubSettings;
  /** Zählt hoch, wenn der Hub eine Änderung an den Familienlisten meldet. */
  familyChangedAt: unknown;
  /** Ob die Startseite gerade sichtbar ist - dann wird frisch geladen. */
  aufStartseite: boolean;
  /** Wer gerade angemeldet ist. Ohne Namen kein «erledigt bei mir». */
  benutzer?: { name?: string } | null;
  /** Kurze Rückmeldung an den Rahmen, etwa nach einem Rückgriff. */
  melde: (text: string) => void;
}) {

  // Einkaufsliste und Läden für die Kopfzeile. Dieselbe Quelle wie unter
  // Familie - nur die offenen Einträge, denn oben zählt, was noch fehlt.
  const [einkauf, setEinkauf] = useState<EinkaufZeile[]>([]);
  // Dieselbe Liste als Ref: Die Rückrufe unten hängen sonst an jeder
  // Änderung der Liste und bauen sich bei jedem Tippen neu auf – und die
  // Kopfzeile mit ihnen.
  const einkaufRef = useRef<EinkaufZeile[]>([]);
  einkaufRef.current = einkauf;
  // Das Abhak-Protokoll für die gelernte Gang-Reihenfolge
  // (lib/ladenlernen.ts). Über eine Ref, weil der Haken vor usePrefs
  // läuft - der Bildschirm füllt sie, sobald die Haus-Einstellungen da
  // sind.
  const lernRef = useRef<{
    log: LernEintrag[];
    schreiben: (log: LernEintrag[]) => void;
  }>({ log: [], schreiben: () => {} });
  // Was gerade abgehakt wurde, für einen Moment aufgehoben.
  const [einkaufUndo, setEinkaufUndo] = useState<{
    id: string;
    text: string;
    laden?: string;
    kategorie?: string;
  } | null>(null);
  // Der letzte grosse Griff («Alles aus»), solange er sich zurücknehmen
  // lässt. Die Kennung gehört dem Hub: Er hat den Stand von vorher
  // aufgenommen, die App kennt nur den Zettel dazu.
  const [griffUndo, setGriffUndo] = useState<{ id: string; count: number } | null>(null);
  const [laeden, setLaeden] = useState<Shop[]>([]);
  // Schon einmal eingekaufte Artikel – die Vervollständigung im Fenster
  // der Kopfzeile lebt davon. Kommt aus dem Hub, nicht vom Gerät: Was
  // Livia einträgt, soll Stefan vorgeschlagen bekommen.
  const [bekannt, setBekannt] = useState<string[]>([]);
  // Die Erinnerungen des Haushalts - fürs Vollbild zur eingestellten
  // Zeit. Geladen auf denselben Wegen wie die Einkaufsliste: sofortige
  // Meldung über den WebSocket, Viertelstunde als Rückfalltakt.
  const [erinnerungen, setErinnerungen] = useState<Erinnerung[]>([]);
  const ladeEinkauf = useCallback(() => {
    if (!settings.url || !settings.token) return;
    // «still»: Das hier läuft jede Minute. Eine Einblendung je Minute wäre
    // schlimmer als der Fehler – dass etwas klemmt, sieht man am
    // Verbindungspunkt in der Kopfzeile.
    const leise = { fallback: [] as EinkaufZeile[], still: true };
    hub
      .get<EinkaufZeile[]>('/api/family/shopping', leise)
      .then((rows) =>
        setEinkauf(Array.isArray(rows) ? rows.filter((row) => !row.done) : [])
      );
    hub
      .get<Shop[]>('/api/family/shops', leise as { fallback: Shop[]; still: true })
      .then((rows) => setLaeden(Array.isArray(rows) ? rows : []));
    hub
      .get<string[]>('/api/shopping/known', { fallback: [], still: true })
      .then((rows) => setBekannt(Array.isArray(rows) ? rows.map(String) : []));
    hub
      .get<Erinnerung[]>('/api/family/reminders', {
        fallback: [] as Erinnerung[],
        still: true,
      })
      .then((rows) => setErinnerungen(Array.isArray(rows) ? rows : []));
  }, [hub, settings.url, settings.token]);
  useEffect(ladeEinkauf, [ladeEinkauf]);
  // Nur noch als Rückfalltakt: Änderungen kommen über den WebSocket
  // (family_changed, unten). Die Viertelstunde fängt verpasste
  // Ereignisse ab - etwa wenn die Verbindung kurz weg war.
  useTakt(ladeEinkauf, 15 * 60000);
  // Der Hub meldet jede Änderung an den Familienlisten sofort - so steht
  // das Abgehakte des einen beim anderen ohne Minute Wartezeit.
  useEffect(() => {
    if (familyChangedAt) ladeEinkauf();
  }, [familyChangedAt, ladeEinkauf]);
  // Und immer dann, wenn die Startseite wieder erscheint: Wer gerade
  // unter Familie etwas eingetragen hat, will es oben sofort sehen und
  // nicht bis zur nächsten Minute warten.
  useEffect(() => {
    if (aufStartseite) ladeEinkauf();
  }, [aufStartseite, ladeEinkauf]);

  // Ob eine Erinnerung fällig ist, entscheidet die Uhr dieses Geräts -
  // der Halbminutentakt läuft nur, solange überhaupt eine offen ist.
  // So erscheint das Vollbild auch auf dem Wandpanel pünktlich, ohne
  // dass der Hub einen Wecker bräuchte.
  const [jetztErinnerung, setJetztErinnerung] = useState(() => Date.now());
  useTakt(
    () => setJetztErinnerung(Date.now()),
    naechsteAt(erinnerungen) !== null ? 30000 : null
  );
  // Frische Liste, frische Uhr: Kommt eine weitere Erinnerung an,
  // während das Vollbild schon steht, wurde ihre Fälligkeit sonst gegen
  // den letzten Takt gerechnet - und die neue Karte erschien erst bis
  // zu eine halbe Minute später, obwohl man vor dem Schirm steht.
  useEffect(() => {
    setJetztErinnerung(Date.now());
  }, [erinnerungen]);
  // «Erledigt» (nur für mich) auf diesem Gerät - zusätzlich zur Liste
  // beim Hub, damit das Vollbild auch dann sofort und dauerhaft weg ist,
  // wenn der Name des Benutzers gerade (noch) nicht bekannt ist.
  const [selbstQuittiert, setSelbstQuittiert] = useState<string[]>([]);
  // Der Rückhalt gilt der jetzigen Ausgabe, nicht der Erinnerung an
  // sich: Eine wiederkehrende behält ihre id, wenn sie auf den
  // nächsten Termin weitergestellt wird - bliebe die id hier stehen,
  // wäre die nächste Ausgabe auf diesem Gerät für immer stumm.
  useEffect(() => {
    setSelbstQuittiert((ids) =>
      ids.filter((id) => {
        const eintrag = erinnerungen.find((zeile) => zeile.id === id);
        if (!eintrag || eintrag.done) return false;
        const at = Number(eintrag.at);
        // Noch fällig: Rückhalt behalten - vielleicht hat der Hub das
        // Quittieren (noch) nicht gespeichert.
        return !(Number.isFinite(at) && at > Date.now());
      })
    );
  }, [erinnerungen]);
  const faelligeErinnerungen = useMemo(
    () =>
      anzuzeigende(erinnerungen, jetztErinnerung, benutzer?.name).filter(
        (eintrag) => !selbstQuittiert.includes(eintrag.id)
      ),
    [erinnerungen, jetztErinnerung, benutzer?.name, selbstQuittiert]
  );
  const bestaetigeErinnerung = useCallback(
    (id: string) => {
      // Sofort aus dem Bild, dann zum Hub: Wer bestätigt, will das
      // Vollbild los sein - nicht auf die Antwort warten. Scheitert der
      // Abruf, holt der Rückfalltakt die Erinnerung zurück, und man
      // sieht, dass sie noch offen ist. Wiederkehrende werden dabei
      // nicht erledigt, sondern auf den nächsten Termin weitergestellt.
      const eintrag = erinnerungen.find((zeile) => zeile.id === id);
      const patch = eintrag ? bestaetigung(eintrag, Date.now()) : { done: true };
      setErinnerungen((liste) =>
        liste.map((zeile) => (zeile.id === id ? { ...zeile, ...patch } : zeile))
      );
      hub
        .put(`/api/family/reminders/${encodeURIComponent(id)}`, patch, {
          fallback: null,
        })
        .catch(() => {});
    },
    [hub, erinnerungen]
  );
  const quittiereErinnerung = useCallback(
    (id: string) => {
      // «Erledigt» ohne «für alle»: nur bei mir weg, die anderen sehen
      // die Erinnerung weiter, bis jemand für alle bestätigt. Der Name
      // wandert in die geteilte Ablage - so bleibt es auch nach einem
      // Neustart der App bei «schon gesehen», und die eigenen anderen
      // Geräte ziehen mit.
      setSelbstQuittiert((ids) => (ids.includes(id) ? ids : [...ids, id]));
      const name = benutzer?.name;
      if (!name) return;
      const eintrag = erinnerungen.find((zeile) => zeile.id === id);
      const bisher = eintrag ? quittiertVon(eintrag) : [];
      if (bisher.includes(name)) return;
      hub
        .put(
          `/api/family/reminders/${encodeURIComponent(id)}`,
          { quittiert: [...bisher, name] },
          { fallback: null }
        )
        .catch(() => {});
    },
    [hub, benutzer?.name, erinnerungen]
  );

  /** Einen Eintrag im Laden abhaken - er verschwindet sofort aus der
   *  Kopfzeile, statt bis zum nächsten Abruf stehen zu bleiben. */
  const hakeAb = useCallback(
    (id: string, laden?: string) => {
      // Vor dem Wegnehmen merken, was da stand: Im Laden tippt man daneben,
      // und dann steht man vor dem Regal und weiss nicht mehr, was es war.
      const weg = einkaufRef.current.find((eintrag) => eintrag.id === id);
      const kategorie = String(weg?.category ?? '');
      if (weg) setEinkaufUndo({ id, text: String(weg.text ?? ''), laden, kategorie });
      // Aus dem Abhaken die Gang-Reihenfolge lernen (lib/ladenlernen.ts) -
      // aber nur mit gewähltem Laden; ungefiltert weiss niemand, wo man steht.
      if (weg && laden) {
        const lern = lernRef.current;
        const neu = merken(lern.log, laden, kategorie, Date.now());
        if (neu !== lern.log) lern.schreiben(neu);
      }
      setEinkauf((liste) => liste.filter((eintrag) => eintrag.id !== id));
      // Nicht still: Wer im Laden abhakt und dabei ins Leere greift, soll
      // es erfahren – sonst kauft er es nicht und denkt, er habe es.
      hub
        .put(
          `/api/family/shopping/${encodeURIComponent(id)}`,
          { done: true },
          {
            fallback: null,
          }
        )
        .finally(ladeEinkauf);
    },
    [hub, ladeEinkauf]
  );

  /**
   * Einen Posten wegnehmen, ohne ihn gekauft zu haben.
   *
   * Abhaken heisst «habe ich» – das ist etwas anderes als «war ein
   * Vertipper». Vorher ging Letzteres nur unter Familie, also genau dort
   * nicht, wo man steht, wenn es auffällt.
   */
  const entferneEinkauf = useCallback(
    (id: string) => {
      setEinkauf((liste) => liste.filter((eintrag) => eintrag.id !== id));
      hub
        .del(`/api/family/shopping/${encodeURIComponent(id)}`, { fallback: null })
        .finally(ladeEinkauf);
    },
    [hub, ladeEinkauf]
  );

  /**
   * Die Stückzahl eines Postens ändern.
   *
   * Die Menge steht im Text und nicht in einem eigenen Feld: «2× Milch»
   * ist auch für den lesbar, der die Liste unter Familie oder im
   * Rohzustand ansieht, und der Hub muss nichts davon wissen. Fällt sie
   * unter eins, ist der Posten weg – ein «0× Milch» will niemand sehen.
   */
  const setzeMenge = useCallback(
    (id: string, menge: number) => {
      const eintrag = einkaufRef.current.find((row) => row.id === id);
      if (!eintrag) return;
      const { name } = mengeUndName(String(eintrag.text ?? ''));
      if (menge < 1) {
        entferneEinkauf(id);
        return;
      }
      const text = mitMenge(name, Math.min(99, menge));
      setEinkauf((liste) => liste.map((row) => (row.id === id ? { ...row, text } : row)));
      hub
        .put(`/api/family/shopping/${encodeURIComponent(id)}`, { text }, { fallback: null })
        .finally(ladeEinkauf);
    },
    [hub, ladeEinkauf, entferneEinkauf]
  );

  /** Ein Abhaken zurücknehmen – der Posten steht wieder offen auf der Liste. */
  const nimmAbhakenZurueck = useCallback(() => {
    const zurueck = einkaufUndo;
    if (!zurueck) return;
    setEinkaufUndo(null);
    // Der Fehlgriff soll auch nicht als «dieser Gang kommt jetzt» im
    // Lern-Protokoll stehen bleiben (lib/ladenlernen.ts).
    if (zurueck.laden) {
      const lern = lernRef.current;
      const neu = vergessen(lern.log, zurueck.laden, zurueck.kategorie ?? '', Date.now());
      if (neu !== lern.log) lern.schreiben(neu);
    }
    setEinkauf((liste) => [...liste, { id: zurueck.id, text: zurueck.text }]);
    hub
      .put(
        `/api/family/shopping/${encodeURIComponent(zurueck.id)}`,
        { done: false },
        {
          fallback: null,
        }
      )
      .finally(ladeEinkauf);
  }, [einkaufUndo, hub, ladeEinkauf]);

  /**
   * Den Rückweg zu einem grossen Griff beim Hub hinterlegen.
   *
   * Der einzelne Befehl hat sein Zurück in useHub; bei zwanzig Geräten
   * auf einmal hilft das nicht. Der Hub rechnet aus dem Stand von vorher
   * aus, was zurückzuschalten wäre – und lässt Geräte weg, an denen der
   * Griff nichts geändert hat (hub/core/rueckgriff.py).
   */
  const merkeGriff = useCallback(
    async (titel: string, entityIds: string[]) => {
      setGriffUndo(null);
      if (entityIds.length === 0) return;
      const antwort = await hub.post<{ undo: { id: string } | null }>(
        '/api/undo',
        { title: titel, entity_ids: entityIds },
        { fallback: { undo: null }, still: true }
      );
      // Gezählt wird, was der Griff schaltet, nicht was sich davon
      // zurückholen lässt: Der Satz auf der Einblendung berichtet, was
      // gerade passiert ist. Dass ein Saugroboter nicht mit zurückkommt,
      // steht in hub/core/szenenrueckweg.py (OHNE_RUECKWEG).
      if (antwort.undo) setGriffUndo({ id: antwort.undo.id, count: entityIds.length });
    },
    [hub]
  );

  /** Den letzten grossen Griff zurücknehmen. */
  const nimmGriffZurueck = useCallback(() => {
    const zurueck = griffUndo;
    if (!zurueck) return;
    setGriffUndo(null);
    hub
      .post<{ restored?: string[] }>(`/api/undo/${zurueck.id}/run`, undefined, {
        fallback: {},
      })
      .then((antwort) => {
        const zahl = antwort.restored?.length ?? 0;
        if (zahl > 0) melde(`${zahl} Gerät${zahl === 1 ? '' : 'e'} zurückgeschaltet`);
      });
  }, [griffUndo, hub, melde]);

  /** Einen Artikel auf die Liste setzen – aus dem Fenster der Kopfzeile.
   *
   *  Der Eintrag erscheint sofort, mit einer vorläufigen Kennung: Wer
   *  drei Sachen hintereinander eintippt, soll nicht nach jeder auf den
   *  Hub warten. Der Abruf danach ersetzt ihn durch den echten. */
  const kaufeEin = useCallback(
    async (text: string) => {
      const name = text.trim();
      if (!name || !settings.url) return;
      // Schon drauf? Dann meint «Milch» den vorhandenen Posten und nicht
      // einen zweiten. Wer zwei Einträge «Milch» auf der Liste hat, kauft
      // im Zweifel beide.
      const schonDa = findeArtikel(einkaufRef.current, name);
      if (schonDa) {
        const jetzt = mengeUndName(String(schonDa.text ?? ''));
        setzeMenge(String(schonDa.id), jetzt.menge + mengeUndName(name).menge);
        return;
      }
      setEinkauf((liste) => [...liste, { id: `neu-${name}`, text: name }]);
      setBekannt((liste) => [name, ...liste.filter((entry) => entry !== name)]);
      // Der Gang wird hier bestimmt und nicht im Hub: Dieselbe Zuordnung
      // sortiert die Liste, und sie steht in lib/einkauf.ts.
      // Schlägt es fehl, sagt es die Einblendung, und der Abruf gleich
      // darauf räumt den vorläufigen Eintrag wieder weg.
      await hub.post(
        '/api/family/shopping',
        { text: name, category: shopCategory(name) },
        { fallback: null }
      );
      ladeEinkauf();
    },
    [hub, settings.url, ladeEinkauf, setzeMenge]
  );

  return {
    lernRef,
    einkauf,
    laeden,
    bekannt,
    einkaufUndo,
    setEinkaufUndo,
    griffUndo,
    setGriffUndo,
    kaufeEin,
    hakeAb,
    entferneEinkauf,
    setzeMenge,
    nimmAbhakenZurueck,
    merkeGriff,
    nimmGriffZurueck,
    faelligeErinnerungen,
    bestaetigeErinnerung,
    quittiereErinnerung,
  };
}
