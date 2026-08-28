/**
 * Die Ladenreihenfolge aus dem Abhaken lernen.
 *
 * Die Gänge eines Ladens kann man unter «Läden» von Hand ordnen – nur
 * tut das kaum jemand für alle neun Kategorien. Dabei verrät jeder
 * Einkauf die Reihenfolge von selbst: Abgehakt wird vor dem Regal, also
 * in der Reihenfolge, in der man durch den Laden geht. Wer zweimal im
 * selben Laden zuerst die Getränke und dann das Gemüse abhakt, hat die
 * Reihenfolge damit gesagt, ohne sie einzustellen.
 *
 * Bewusst reine Funktionen ohne React: Ob aus drei Einkäufen «Getränke
 * vor Gemüse» folgt, ist genau die Sorte Entscheidung, die man nur
 * prüfen kann, wenn sie für sich steht.
 *
 * Die Handarbeit gewinnt: Wer die Reihenfolge unter «Läden» selbst
 * geordnet hat, hat sie gewählt – das Gelernte greift nur dort, wo noch
 * niemand etwas eingestellt hat. Eine Liste, die sich gegen den
 * erklärten Willen umsortiert, ist keine eingerichtete Liste.
 */

import { SHOP_CATEGORIES, Shop } from './einkauf';

/** Ein Abhaken: in welchem Laden, welcher Gang, wann (Epoch-ms). */
export interface LernEintrag {
  shop: string;
  kategorie: string;
  at: number;
}

/** Mehr braucht es nicht: ~400 Abhaken sind Monate an Einkäufen, und
 *  das Protokoll liegt in den Haus-Einstellungen, die jedes Gerät beim
 *  Verbinden lädt – es soll dort kein Ballast werden. */
export const LOG_MAX = 400;

/** Ab dieser Pause ist es ein neuer Einkauf. 45 Minuten: länger steht
 *  niemand im selben Laden zwischen zwei Regalen. */
export const SITZUNGS_LUECKE = 45 * 60 * 1000;

/** So viele Abhaken braucht ein Einkauf, damit er zählt – wer nur die
 *  Milch holt, sagt nichts über die Reihenfolge der Gänge. */
export const MIN_JE_SITZUNG = 3;

/** In so vielen Einkäufen muss ein Gang vorkommen, bevor seine gelernte
 *  Position gilt – ein einzelner Umweg soll die Liste nicht umsortieren. */
export const MIN_SITZUNGEN = 2;

const bekannteKategorie = (name: string): string =>
  SHOP_CATEGORIES.includes(name) ? name : 'Sonstiges';

/**
 * Ein Abhaken merken (rein, testbar).
 *
 * Ohne Laden gibt es nichts zu lernen: Wer die Liste ungefiltert
 * («Allgemein») abarbeitet, steht in irgendeinem Laden – dessen
 * Reihenfolge einem anderen Laden zuzuschreiben wäre schlimmer als
 * nichts zu wissen.
 */
export function merken(
  log: LernEintrag[],
  shop: string | null | undefined,
  kategorie: string,
  at: number
): LernEintrag[] {
  const kennung = String(shop ?? '').trim();
  if (!kennung || kennung === 'allgemein') return log;
  const neu = [...log, { shop: kennung, kategorie: bekannteKategorie(kategorie), at }];
  // Nach Zeit, nicht nach Ankunft: Zwei Telefone schreiben abwechselnd,
  // und die Sitzungs-Erkennung verlässt sich auf die Reihenfolge.
  neu.sort((a, b) => a.at - b.at);
  return neu.slice(Math.max(0, neu.length - LOG_MAX));
}

/**
 * Ein Abhaken zurücknehmen (rein, testbar).
 *
 * Der Daumen trifft neben das Häkchen, man hakt gleich wieder ab – so
 * ein Fehlgriff soll nicht als «dieser Gang kommt jetzt» im Protokoll
 * stehen. Entfernt wird nur der jüngste passende Eintrag, und nur, wenn
 * er frisch ist: Ein Abhaken von letzter Woche zurückzunehmen ist kein
 * Fehlgriff, sondern «doch nicht gekauft».
 */
export function vergessen(
  log: LernEintrag[],
  shop: string | null | undefined,
  kategorie: string,
  at: number,
  frist = 2 * 60 * 1000
): LernEintrag[] {
  const kennung = String(shop ?? '').trim();
  const gesucht = bekannteKategorie(kategorie);
  for (let i = log.length - 1; i >= 0; i -= 1) {
    const eintrag = log[i];
    if (
      eintrag.shop === kennung &&
      eintrag.kategorie === gesucht &&
      at - eintrag.at <= frist
    ) {
      return [...log.slice(0, i), ...log.slice(i + 1)];
    }
  }
  return log;
}

/** Die Abhaken eines Ladens, in Einkäufe zerlegt (rein, testbar). */
export function sitzungen(log: LernEintrag[], shop: string): LernEintrag[][] {
  const eigene = log
    .filter((eintrag) => eintrag.shop === shop)
    .sort((a, b) => a.at - b.at);
  const ergebnis: LernEintrag[][] = [];
  for (const eintrag of eigene) {
    const letzte = ergebnis[ergebnis.length - 1];
    if (letzte && eintrag.at - letzte[letzte.length - 1].at <= SITZUNGS_LUECKE) {
      letzte.push(eintrag);
    } else {
      ergebnis.push([eintrag]);
    }
  }
  return ergebnis;
}

/**
 * Die gelernte Gang-Reihenfolge eines Ladens (rein, testbar).
 *
 * Je Einkauf zählt, als wievielter Gang eine Kategorie *zuerst* dran
 * war – normiert auf 0…1, damit ein kurzer Einkauf mit drei Gängen und
 * ein grosser mit acht gleich viel Gewicht haben. Über die Einkäufe
 * gemittelt ergibt das die Laufreihenfolge; bei Gleichstand entscheidet
 * die Standardreihenfolge, damit das Ergebnis nicht flattert.
 *
 * Leer, solange es nicht mindestens zwei brauchbare Einkäufe gibt: Aus
 * einem einzigen zu «lernen» hiesse, jeden Umweg für die Regel zu halten.
 */
export function gelernteReihenfolge(log: LernEintrag[], shop: string): string[] {
  const positionen = new Map<string, number[]>();
  for (const einkauf of sitzungen(log, shop)) {
    if (einkauf.length < MIN_JE_SITZUNG) continue;
    const gesehen: string[] = [];
    for (const eintrag of einkauf) {
      if (!gesehen.includes(eintrag.kategorie)) gesehen.push(eintrag.kategorie);
    }
    if (gesehen.length < 2) continue;
    gesehen.forEach((kategorie, index) => {
      const platz = index / (gesehen.length - 1);
      const liste = positionen.get(kategorie);
      if (liste) liste.push(platz);
      else positionen.set(kategorie, [platz]);
    });
  }
  const gemittelt = [...positionen.entries()]
    .filter(([, plaetze]) => plaetze.length >= MIN_SITZUNGEN)
    .map(([kategorie, plaetze]) => ({
      kategorie,
      platz: plaetze.reduce((summe, wert) => summe + wert, 0) / plaetze.length,
    }));
  if (gemittelt.length < 2) return [];
  return gemittelt
    .sort(
      (a, b) =>
        a.platz - b.platz ||
        SHOP_CATEGORIES.indexOf(a.kategorie) - SHOP_CATEGORIES.indexOf(b.kategorie)
    )
    .map((eintrag) => eintrag.kategorie);
}

/**
 * Einen Laden um das Gelernte ergänzen (rein, testbar).
 *
 * Liefert einen Laden, dessen `categories` die wirksame Laufreihenfolge
 * tragen – damit können `shopOrder` und `groupForShop` bleiben, wie sie
 * sind. Von Hand Geordnetes bleibt unangetastet; gelernt wird nur dort,
 * wo die Reihenfolge sonst die Standardliste wäre.
 */
export function mitLernen<S extends Shop | null | undefined>(
  shop: S,
  log: LernEintrag[]
): S {
  if (!shop || shop.id === 'allgemein') return shop;
  const eigene = (shop.categories ?? []).filter((name) =>
    SHOP_CATEGORIES.includes(name)
  );
  if (eigene.length > 0) return shop;
  const gelernt = gelernteReihenfolge(log, shop.id);
  if (gelernt.length < 2) return shop;
  return { ...shop, categories: gelernt };
}

/** Ob die Reihenfolge dieses Ladens gerade gelernt ist statt eingestellt
 *  oder Standard – für den Hinweis unter der Liste. */
export function istGelernt(
  shop: Shop | null | undefined,
  log: LernEintrag[]
): boolean {
  if (!shop || shop.id === 'allgemein') return false;
  return mitLernen(shop, log) !== shop;
}
