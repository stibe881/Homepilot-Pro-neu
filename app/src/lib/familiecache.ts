/**
 * Die Familienseite ohne Netz: zeigen, was zuletzt da war – und merken,
 * was man getippt hat.
 *
 * Der Geräte-Bildschirm legt seinen Stand längst im Gerät ab; die
 * Familienseite tat es nicht. Wer im Ladenkeller, im Zug oder bei
 * schwachem WLAN die Einkaufsliste öffnete, sah nichts (Punkt 165). Und
 * schlimmer: Jedes Häkchen war ein sofortiger Aufruf an den Hub – ohne
 * Netz passierte nichts, aber es sah aus, als wäre es passiert
 * (Punkt 172).
 *
 * Hier steht nur das Rechnen: was in die Warteschlange kommt, wie sie auf
 * den zwischengespeicherten Stand angewendet wird und wann sie verfällt.
 * Wer speichert und sendet, ist der Bildschirm.
 */

/** Eine Familienliste, so offen wie der Hub sie speichert. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Zeile = Record<string, any>;
export type FamilyData = Record<string, Zeile[]>;

/** Was jemand getan hat, während der Hub weg war. */
export interface Vorgemerkt {
  kind: 'add' | 'update' | 'remove';
  collection: string;
  /** Bei add die vorläufige Kennung, sonst die echte. */
  id: string;
  body?: Zeile;
  at: number;
}

/**
 * So lange wird eine Änderung nachgetragen.
 *
 * Ein Tag, nicht zwei Minuten wie bei den Schaltbefehlen: Ein Häkchen auf
 * der Einkaufsliste bleibt richtig, auch wenn man erst am Abend wieder
 * Empfang hat. Ein Licht, das nachträglich angeht, wäre ein Spuk – eine
 * Aufgabe, die nachträglich als erledigt gilt, ist einfach wahr.
 */
export const MAX_AGE = 24 * 3600 * 1000;
/** So viele wartende Änderungen höchstens. */
export const LIMIT = 200;

/** Vorläufige Kennung für etwas, das der Hub noch nie gesehen hat. */
export function vorlaeufigeId(at: number, zufall = Math.random()): string {
  return `lokal-${at.toString(36)}-${Math.floor(zufall * 1e6).toString(36)}`;
}

export function istVorlaeufig(id: unknown): boolean {
  return String(id ?? '').startsWith('lokal-');
}

/**
 * Eine Änderung vormerken (rein, testbar).
 *
 * Zwei Regeln:
 *
 * **Je Eintrag bleibt der letzte Stand.** Wer dreimal auf dasselbe
 * Häkchen tippt, hat einmal etwas entschieden; drei Aufrufe an den Hub
 * wären nur langsamer.
 *
 * **Was lokal angelegt und wieder gelöscht wurde, verschwindet ganz.**
 * Es dem Hub erst zu schicken und dann zurückzunehmen, wäre eine
 * Zeile Verlauf für nichts.
 */
export function merke(offen: Vorgemerkt[], neu: Vorgemerkt): Vorgemerkt[] {
  const rest = offen.filter(
    (eintrag) => !(eintrag.collection === neu.collection && eintrag.id === neu.id)
  );
  const vorher = offen.find(
    (eintrag) => eintrag.collection === neu.collection && eintrag.id === neu.id
  );
  if (neu.kind === 'remove' && vorher?.kind === 'add') return rest;
  if (neu.kind === 'update' && vorher?.kind === 'add') {
    // Ein noch nicht gesendeter Neuzugang wird geändert, nicht ergänzt.
    return [...rest, { ...vorher, body: { ...(vorher.body ?? {}), ...(neu.body ?? {}) }, at: neu.at }];
  }
  if (neu.kind === 'update' && vorher?.kind === 'update') {
    return [...rest, { ...neu, body: { ...(vorher.body ?? {}), ...(neu.body ?? {}) } }];
  }
  return [...rest, neu].slice(-LIMIT);
}

/** Abgelaufene Änderungen wegwerfen (rein, testbar). */
export function frisch(offen: Vorgemerkt[], jetzt: number): Vorgemerkt[] {
  return (offen ?? []).filter((eintrag) => jetzt - eintrag.at < MAX_AGE);
}

/**
 * Hat der Hub die Änderung endgültig abgewiesen? (rein, testbar)
 *
 * Der Unterschied entscheidet, was mit ihr passiert. Ohne Antwort (kein
 * Netz) oder bei einem Schluckauf des Hubs (5xx) wartet sie in der
 * Schlange und geht später raus. Eine 4xx-Antwort dagegen bleibt falsch,
 * so oft man sie schickt: Ein Hub, der die Liste «lessons» nicht kennt,
 * kennt sie auch beim zehnten Versuch nicht.
 *
 * Solche Einträge trotzdem einzureihen war der Fehler, durch den der
 * Stundenplan seine Einträge verlor: Sie standen als «wartend» da, sahen
 * gespeichert aus und verschwanden nach 24 Stunden wortlos - für den, der
 * sie getippt hatte, «bei jedem Server-Update». Abgewiesenes muss sofort
 * sichtbar scheitern statt später stumm.
 *
 * 408 (Zeitüberschreitung) und 429 (zu viele Anfragen) sind die zwei
 * 4xx, die ein zweiter Versuch heilen kann - sie zählen als vorübergehend.
 */
export function abgelehnt(status: number | null): boolean {
  if (status === null || status === 408 || status === 429) return false;
  return status >= 400 && status < 500;
}

/**
 * Den zwischengespeicherten Stand mit dem überlagern, was noch wartet
 * (rein, testbar).
 *
 * Damit sieht der Bildschirm sofort so aus, wie er nach dem Senden
 * aussehen wird – sonst springt das Häkchen zurück, und man tippt es
 * ein zweites Mal.
 */
export function anwenden(data: FamilyData, offen: Vorgemerkt[]): FamilyData {
  const ergebnis: FamilyData = { ...(data ?? {}) };
  for (const eintrag of offen ?? []) {
    const liste = [...(ergebnis[eintrag.collection] ?? [])];
    if (eintrag.kind === 'add') {
      liste.push({ ...(eintrag.body ?? {}), id: eintrag.id, pending: true });
    } else if (eintrag.kind === 'remove') {
      ergebnis[eintrag.collection] = liste.filter((row) => row.id !== eintrag.id);
      continue;
    } else {
      const index = liste.findIndex((row) => row.id === eintrag.id);
      if (index >= 0) liste[index] = { ...liste[index], ...(eintrag.body ?? {}), pending: true };
    }
    ergebnis[eintrag.collection] = liste;
  }
  return ergebnis;
}

/**
 * Die ehrliche Zeile über der Liste (rein, testbar).
 *
 * «Stand von 14:12, keine Verbindung» – wer das liest, weiss, woran er
 * ist. Ohne diese Zeile sieht ein alter Stand aus wie ein aktueller, und
 * das ist der eigentliche Schaden.
 */
export function standText(
  stand: number | null,
  verbunden: boolean,
  wartend: number,
  jetzt: Date = new Date()
): string | null {
  if (verbunden && wartend === 0) return null;
  const teile: string[] = [];
  if (stand) {
    const zeit = new Date(stand);
    const gleicherTag = zeit.toDateString() === jetzt.toDateString();
    const uhr = `${String(zeit.getHours()).padStart(2, '0')}:${String(
      zeit.getMinutes()
    ).padStart(2, '0')}`;
    teile.push(gleicherTag ? `Stand von ${uhr}` : `Stand vom ${zeit.getDate()}.${zeit.getMonth() + 1}., ${uhr}`);
  }
  if (!verbunden) teile.push('keine Verbindung');
  if (wartend > 0) {
    teile.push(wartend === 1 ? '1 Änderung wartet' : `${wartend} Änderungen warten`);
  }
  return teile.join(' · ') || null;
}
