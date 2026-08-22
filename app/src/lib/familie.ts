/**
 * Das Rechnen hinter den Familien-Modulen – ohne Bildschirm, ohne Netz.
 *
 * Kontakte, Notfallblatt, Medikamente, Wochenplan: Vier Module, die sich
 * gegenseitig lesen. Genau dort entstehen die Fehler, die man erst
 * bemerkt, wenn es darauf ankommt – etwa die Nummer, die auf der
 * Babysitter-Seite fehlte, weil zwei Stellen sie unter verschiedenen
 * Namen suchten. Deshalb steht hier alles an einem Ort und ist geprüft.
 */

/** Ein Eintrag einer Familienliste, so offen wie der Hub ihn speichert. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export type Eintrag = Record<string, any>;

// ── Kontakte ────────────────────────────────────────────────────────────

/** Wofür ein Kontakt da ist. Die Rolle entscheidet, wo er auftaucht –
 *  ein Babysitter braucht die Kinderärztin, nicht den Gartenbauer. */
export const ROLLEN = [
  { key: 'notfall', label: 'Notfall', icon: 'alert-circle-outline' },
  { key: 'arzt', label: 'Arzt', icon: 'medkit-outline' },
  { key: 'schule', label: 'Schule/Hort', icon: 'school-outline' },
  { key: 'familie', label: 'Familie', icon: 'people-outline' },
  { key: 'handwerk', label: 'Handwerk', icon: 'construct-outline' },
] as const;

export type RollenKey = (typeof ROLLEN)[number]['key'];

/** Die Rollen eines Kontakts – robust gegen alles, was da stehen kann. */
export function rollenVon(contact: Eintrag): string[] {
  const roh = contact?.roles;
  if (!Array.isArray(roh)) return [];
  const erlaubt = ROLLEN.map((rolle) => rolle.key);
  return roh.map(String).filter((key) => erlaubt.includes(key as RollenKey));
}

/** Eine Rolle an- oder abwählen (rein, testbar). */
export function toggleRolle(current: string[], rolle: string): string[] {
  return current.includes(rolle)
    ? current.filter((key) => key !== rolle)
    : [...current, rolle];
}

/**
 * Alle Nummern eines Kontakts, in der Reihenfolge, in der man sie wählt.
 *
 * Historisch gab es genau ein Feld `phone`. Eine zweite Nummer (Arbeit,
 * Partner) kommt als `phone2` dazu – wer nur eine hat, merkt nichts.
 */
export function nummernVon(contact: Eintrag): { label: string; nummer: string }[] {
  const roh: [string, unknown][] = [
    ['Mobil', contact?.phone],
    ['Weitere', contact?.phone2],
  ];
  return roh
    .map(([label, wert]) => ({ label, nummer: String(wert ?? '').trim() }))
    .filter((eintrag) => eintrag.nummer.length > 0);
}

/**
 * Wählbare Form einer Nummer (rein, testbar).
 *
 * «079 123 45 67» ist für Menschen geschrieben und für `tel:` unbrauchbar
 * – Leerzeichen und Schrägstriche fliegen raus, das Pluszeichen bleibt.
 */
export function waehlbar(nummer: unknown): string {
  return String(nummer ?? '').replace(/[^+\d]/g, '');
}

/** Kontakte einer Rolle. Ohne Rolle: alle – sonst verschwänden beim
 *  Einführen der Rollen sämtliche bestehenden Einträge. */
export function mitRolle(contacts: Eintrag[], rolle: string): Eintrag[] {
  return (contacts ?? []).filter((contact) => {
    const rollen = rollenVon(contact);
    return rollen.length === 0 ? false : rollen.includes(rolle);
  });
}

/**
 * Wen der Babysitter sehen soll (rein, testbar).
 *
 * Notfall, Arzt und Schule – und wenn niemand eine Rolle trägt, lieber
 * alle als niemand: Eine leere Nummernliste ist auf dieser Seite der
 * schlechtestmögliche Ausgang.
 */
export function fuerBabysitter(contacts: Eintrag[]): Eintrag[] {
  const wichtig = ['notfall', 'arzt', 'schule'];
  const gewaehlt = (contacts ?? []).filter((contact) =>
    rollenVon(contact).some((rolle) => wichtig.includes(rolle))
  );
  const hatRollen = (contacts ?? []).some((contact) => rollenVon(contact).length > 0);
  return hatRollen ? gewaehlt : contacts ?? [];
}

// ── Notfallblatt ────────────────────────────────────────────────────────

/**
 * Die Angaben, nach denen im Ernstfall gefragt wird.
 *
 * Feste Felder statt freier Zettel: Ein Blatt, das man ausfüllt, ist
 * etwas anderes als eines, das man erfinden muss – und im Notfall sucht
 * niemand, sondern liest der Reihe nach.
 */
export const NOTFALL_FELDER = [
  { key: 'blood', label: 'Blutgruppe', placeholder: 'z.B. A+' },
  { key: 'allergies', label: 'Allergien', placeholder: 'z.B. Nüsse, Penicillin' },
  { key: 'meds', label: 'Dauermedikation', placeholder: 'z.B. Ventolin bei Bedarf' },
  { key: 'insurance', label: 'Versicherung / Vers.-Nr.', placeholder: 'z.B. CSS, 123.4567' },
  { key: 'doctor', label: 'Hausarzt / Kinderärztin', placeholder: 'Name und Nummer' },
  { key: 'tetanus', label: 'Tetanus geimpft', placeholder: 'z.B. 2023' },
] as const;

/** Die ausgefüllten Angaben eines Eintrags, in fester Reihenfolge. */
export function notfallZeilen(eintrag: Eintrag): { label: string; wert: string }[] {
  return NOTFALL_FELDER.map((feld) => ({
    label: feld.label,
    wert: String(eintrag?.[feld.key] ?? '').trim(),
  })).filter((zeile) => zeile.wert.length > 0);
}

/** Schweizer Notrufnummern – die braucht niemand zu pflegen. */
export const NOTRUFE = [
  { label: 'Sanität', nummer: '144' },
  { label: 'Vergiftung (Tox)', nummer: '145' },
  { label: 'Polizei', nummer: '117' },
  { label: 'Feuerwehr', nummer: '118' },
  { label: 'Rega', nummer: '1414' },
  { label: 'Ärztlicher Notfall LU', nummer: '0900 11 14 14' },
];

/**
 * Wie lange ist die letzte Prüfung her? (rein, testbar)
 *
 * `null` heisst «nie geprüft». Ein Blatt von vorletztem Jahr ist
 * gefährlicher als keines: Man verlässt sich darauf, und die Nummer der
 * Kinderärztin stimmt nicht mehr.
 */
export function geprueftVor(checked: unknown, heute: Date): number | null {
  const text = String(checked ?? '').slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) return null;
  const datum = new Date(`${text}T00:00:00`);
  if (Number.isNaN(datum.getTime())) return null;
  return Math.max(0, Math.round((heute.getTime() - datum.getTime()) / 86400000));
}

export function notfallUeberfaellig(checked: unknown, heute: Date): boolean {
  const tage = geprueftVor(checked, heute);
  return tage === null || tage >= 365;
}

/** Das Notfallblatt als Text zum Teilen oder Ausdrucken (rein, testbar). */
export function notfallText(eintraege: Eintrag[], haus?: string): string {
  const zeilen: string[] = [`NOTFALLBLATT${haus ? ` – ${haus}` : ''}`, ''];
  for (const eintrag of eintraege ?? []) {
    zeilen.push(String(eintrag.text ?? '').trim() || 'Ohne Namen');
    for (const zeile of notfallZeilen(eintrag)) {
      zeilen.push(`  ${zeile.label}: ${zeile.wert}`);
    }
    const frei = String(eintrag.body ?? '').trim();
    if (frei) zeilen.push(`  ${frei}`);
    zeilen.push('');
  }
  zeilen.push('Notruf: ' + NOTRUFE.map((n) => `${n.label} ${n.nummer}`).join(' · '));
  return zeilen.join('\n');
}

// ── Babysitter ──────────────────────────────────────────────────────────

/**
 * Die Angaben, die es sonst nirgends gibt.
 *
 * Alles andere auf der Babysitter-Seite ist aus anderen Modulen
 * zusammengetragen. Das hier sind die Fragen, die am Türrahmen kommen –
 * und die einzigen, für die man noch etwas eintippen muss.
 */
export const ABEND_FELDER = [
  { key: 'bed', label: 'Ins Bett um', placeholder: 'z.B. Levin 20:00, Lina 19:30' },
  { key: 'food', label: 'Zu essen gibt es', placeholder: 'z.B. Nudeln, steht im Kühlschrank' },
  { key: 'back', label: 'Wir sind zurück', placeholder: 'z.B. gegen 23 Uhr' },
  { key: 'wifi', label: 'WLAN', placeholder: 'Netz und Passwort' },
  { key: 'notes', label: 'Sonst noch', placeholder: 'z.B. Hund nicht in die Küche' },
] as const;

// ── Medikamente ─────────────────────────────────────────────────────────

/** Die Tageszeiten einer Kur – dieselben wie im Hub (core/familie.py). */
export const GABEN = [
  { key: 'morgens', label: 'morgens', ab: 8 },
  { key: 'mittags', label: 'mittags', ab: 12 },
  { key: 'abends', label: 'abends', ab: 18 },
  { key: 'nachts', label: 'nachts', ab: 22 },
] as const;

const GABEN_KEYS = GABEN.map((gabe) => gabe.key) as string[];

/** Zu welchen Tageszeiten diese Kur ansteht (rein, testbar). */
export function gabenVon(med: Eintrag): string[] {
  const roh = med?.times;
  if (!Array.isArray(roh)) return ['morgens'];
  const gewaehlt = roh.map(String).filter((key) => GABEN_KEYS.includes(key));
  const einmalig = [...new Set(gewaehlt)];
  einmalig.sort((a, b) => GABEN_KEYS.indexOf(a) - GABEN_KEYS.indexOf(b));
  return einmalig.length > 0 ? einmalig : ['morgens'];
}

/**
 * Was wann genommen wurde, in einer Form (rein, testbar).
 *
 * Früher war `taken` eine Liste von Tagen – ein Haken je Tag. Solche
 * Einträge gibt es noch, und sie sollen weiter stimmen: Ein abgehakter
 * Tag von damals gilt als vollständig genommen, sonst stünde eine
 * beendete Kur plötzlich wieder offen da.
 */
export function genommenMap(med: Eintrag): Record<string, string[]> {
  const roh = med?.taken;
  if (roh && !Array.isArray(roh) && typeof roh === 'object') {
    const sauber: Record<string, string[]> = {};
    for (const [tag, werte] of Object.entries(roh as Record<string, unknown>)) {
      if (Array.isArray(werte)) {
        sauber[tag] = werte.map(String).filter((key) => GABEN_KEYS.includes(key));
      }
    }
    return sauber;
  }
  if (Array.isArray(roh)) {
    const alle = gabenVon(med);
    return Object.fromEntries(roh.map((tag) => [String(tag), [...alle]]));
  }
  return {};
}

/** Vollständig erledigte Tage (rein, testbar). */
export function tageErledigt(med: Eintrag): number {
  const noetig = gabenVon(med);
  return Object.values(genommenMap(med)).filter((genommen) =>
    noetig.every((gabe) => genommen.includes(gabe))
  ).length;
}

export function kurFertig(med: Eintrag): boolean {
  if (med?.done) return true;
  const tage = Number(med?.days) || 0;
  return tage > 0 && tageErledigt(med) >= tage;
}

/** Eine Gabe an- oder abhaken – und zurückgeben, was zu speichern ist. */
export function hakeGabe(
  med: Eintrag,
  tag: string,
  gabe: string
): { taken: Record<string, string[]>; done: boolean } {
  const karte = genommenMap(med);
  const heute = karte[tag] ?? [];
  const neu = heute.includes(gabe)
    ? heute.filter((key) => key !== gabe)
    : [...heute, gabe];
  const naechste = { ...karte, [tag]: neu };
  if (neu.length === 0) delete naechste[tag];
  const tage = Number(med?.days) || 0;
  const noetig = gabenVon(med);
  const fertig = Object.values(naechste).filter((werte) =>
    noetig.every((eintrag) => werte.includes(eintrag))
  ).length;
  return { taken: naechste, done: tage > 0 && fertig >= tage };
}

/** Was heute noch aussteht – und ob es schon Zeit dafür ist. */
export function offeneGaben(med: Eintrag, tag: string, stunde: number): string[] {
  if (kurFertig(med)) return [];
  const genommen = genommenMap(med)[tag] ?? [];
  return GABEN.filter(
    (gabe) =>
      gabenVon(med).includes(gabe.key) &&
      !genommen.includes(gabe.key) &&
      stunde >= gabe.ab
  ).map((gabe) => gabe.key);
}

/** Die Zeile unter dem Namen einer Kur (rein, testbar). */
export function medZeile(med: Eintrag, tag: string): string {
  const teile: string[] = [];
  if (med?.dose) teile.push(String(med.dose));
  if (med?.member) teile.push(`für ${med.member}`);
  const tage = Number(med?.days) || 0;
  if (tage > 0) teile.push(`Tag ${Math.min(tageErledigt(med) + 1, tage)} von ${tage}`);
  if (kurFertig(med)) {
    teile.push('Kur beendet');
  } else {
    const genommen = genommenMap(med)[tag] ?? [];
    const offen = gabenVon(med).filter((gabe) => !genommen.includes(gabe));
    teile.push(offen.length === 0 ? 'heute erledigt' : `heute offen: ${offen.join(', ')}`);
  }
  return teile.join(' · ');
}

// ── Kalender ────────────────────────────────────────────────────────────

/**
 * Farben je Kalender, in der Reihenfolge der Konfiguration.
 *
 * Bei mehreren Kalendern sieht man sonst nicht, wessen Termin es ist –
 * und «Elternabend» im Geschäftskalender heisst etwas anderes als im
 * Familienkalender.
 */
export const KALENDER_FARBEN = ['#2F6BF6', '#34C759', '#F5A524', '#AF52DE', '#FF6B6B'];

// ── Wochenplan ──────────────────────────────────────────────────────────

/** Der Montag der Woche, in der dieses Datum liegt (rein, testbar). */
export function montagVon(datum: Date): Date {
  const montag = new Date(datum);
  montag.setHours(0, 0, 0, 0);
  montag.setDate(montag.getDate() - ((montag.getDay() + 6) % 7));
  return montag;
}

/** «JJJJ-MM-TT» ohne Zeitzonen-Überraschung (rein, testbar).
 *
 *  toISOString() rechnet nach UTC um – und macht aus einem Montagabend
 *  in Zürich einen Montag, aus einem Sonntagabend im Winter aber schon
 *  den Montag. Deshalb von Hand. */
export function isoTag(datum: Date): string {
  const monat = String(datum.getMonth() + 1).padStart(2, '0');
  const tag = String(datum.getDate()).padStart(2, '0');
  return `${datum.getFullYear()}-${monat}-${tag}`;
}

/** Verschiebt ein Datum um ganze Wochen (rein, testbar). */
export function plusWochen(datum: Date, wochen: number): Date {
  const neu = new Date(datum);
  neu.setDate(neu.getDate() + wochen * 7);
  return neu;
}

/** «21.8.» – kurz, wie man es auf einen Plan schreibt. */
export function kurzDatum(datum: Date): string {
  return `${datum.getDate()}.${datum.getMonth() + 1}.`;
}
