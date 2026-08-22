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

/**
 * Öffnungszeiten eines Kontakts – für «jetzt geöffnet» (Punkt 210).
 *
 * Bewusst ein einfaches Textfeld je Wochentag statt einer Anbindung an
 * irgendein Verzeichnis: Was man einmal einträgt, stimmt für die fünf
 * Nummern, die zählen – die Praxis, die Apotheke, der Coiffeur.
 *
 * Erlaubt ist «08:00-12:00, 14:00-18:30» oder «geschlossen».
 */
export const WOCHENTAGE = ['Mo', 'Di', 'Mi', 'Do', 'Fr', 'Sa', 'So'] as const;

function fensterVon(text: string): [number, number][] {
  const fenster: [number, number][] = [];
  for (const teil of String(text ?? '').split(',')) {
    const treffer = /(\d{1,2}):(\d{2})\s*[-–]\s*(\d{1,2}):(\d{2})/.exec(teil);
    if (!treffer) continue;
    const von = Number(treffer[1]) * 60 + Number(treffer[2]);
    const bis = Number(treffer[3]) * 60 + Number(treffer[4]);
    if (bis > von) fenster.push([von, bis]);
  }
  return fenster;
}

function alsUhrzeit(minuten: number): string {
  const stunde = Math.floor(minuten / 60);
  return `${String(stunde).padStart(2, '0')}:${String(minuten % 60).padStart(2, '0')}`;
}

/**
 * «jetzt geöffnet · bis 18:30» oder «öffnet Mo 08:00» (rein, testbar).
 *
 * Bei der Praxis ruft man an – und landet mittwochs auf dem Band. Ohne
 * hinterlegte Zeiten kommt `null` zurück und die App zeigt gar nichts:
 * Eine falsche Auskunft wäre schlimmer als keine.
 */
export function oeffnungsStatus(
  hours: Eintrag | undefined,
  jetzt: Date
): { offen: boolean; text: string } | null {
  if (!hours || typeof hours !== 'object') return null;
  const belegt = WOCHENTAGE.some((tag) => fensterVon(String(hours[tag] ?? '')).length > 0);
  if (!belegt) return null;
  const heuteIndex = (jetzt.getDay() + 6) % 7;
  const minute = jetzt.getHours() * 60 + jetzt.getMinutes();
  for (const [von, bis] of fensterVon(String(hours[WOCHENTAGE[heuteIndex]] ?? ''))) {
    if (minute >= von && minute < bis) {
      return { offen: true, text: `jetzt geöffnet · bis ${alsUhrzeit(bis)}` };
    }
  }
  // Nichts offen: die nächste Öffnung suchen, heute zuerst.
  for (let versatz = 0; versatz < 7; versatz += 1) {
    const tag = WOCHENTAGE[(heuteIndex + versatz) % 7];
    for (const [von] of fensterVon(String(hours[tag] ?? ''))) {
      if (versatz === 0 && von <= minute) continue;
      const wann = versatz === 0 ? `heute ${alsUhrzeit(von)}` : `${tag} ${alsUhrzeit(von)}`;
      return { offen: false, text: `öffnet ${wann}` };
    }
  }
  return { offen: false, text: 'geschlossen' };
}

/**
 * Wie lange ist der letzte Anruf her? (rein, testbar)
 *
 * Punkt 182 fragt «stimmt die Nummer noch?» – die halbe Antwort kennt
 * die App selbst (Punkt 211): Wer auf Anrufen tippt, hat den Kontakt
 * benutzt. Was oft gebraucht wird, gilt als gepflegt.
 */
export function kontaktAlter(contact: Eintrag, heute: Date): number | null {
  const roh = contact?.last_used ?? contact?.checked ?? contact?.created;
  return geprueftVor(roh, heute);
}

/** Ist dieser Kontakt so lange unangetastet, dass man fragen sollte?
 *  (rein, testbar) */
export function kontaktVeraltet(contact: Eintrag, heute: Date, tage = 730): boolean {
  const alter = kontaktAlter(contact, heute);
  return alter !== null && alter >= tage;
}

/**
 * Die Schnellwahl-Reihe: gesternte Kontakte mit Nummer (Punkt 212).
 *
 * Die Liste sortiert nach Rollen – angerufen werden immer dieselben
 * drei. Ohne Sterne springt die Reihe für die zuletzt Angerufenen ein:
 * eine leere Reihe wäre nur ein Streifen Platz.
 */
export function schnellwahl(contacts: Eintrag[], limit = 4): Eintrag[] {
  const mitNummer = (contacts ?? []).filter((c) => nummernVon(c).length > 0);
  const gesternt = mitNummer.filter((c) => c.favorite);
  if (gesternt.length > 0) return gesternt.slice(0, limit);
  return [...mitNummer]
    .filter((c) => c.last_used)
    .sort((a, b) => String(b.last_used).localeCompare(String(a.last_used)))
    .slice(0, limit);
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

export interface Notrufnummer {
  label: string;
  nummer: string;
  /** Beratung statt Notruf: Die Opferhilfe sagt ausdrücklich, dass 142
   *  keine Notrufnummer ist – bei akuter Gefahr gilt 117 oder 144.
   *  Deshalb steht sie in der Liste, aber nicht unter «Notruf». */
  beratung?: boolean;
  /** Eine Zeile, die sagt, wofür die Nummer da ist. */
  hinweis?: string;
}

/** Schweizer Notruf- und Beratungsnummern – die braucht niemand zu pflegen. */
export const NOTRUFE: Notrufnummer[] = [
  { label: 'Sanität', nummer: '144' },
  { label: 'Vergiftung (Tox)', nummer: '145' },
  { label: 'Polizei', nummer: '117' },
  { label: 'Feuerwehr', nummer: '118' },
  { label: 'Rega', nummer: '1414' },
  { label: 'Ärztlicher Notfall LU', nummer: '0900 11 14 14' },
  {
    label: 'Opferhilfe',
    nummer: '142',
    beratung: true,
    hinweis: 'Nach Gewalt – rund um die Uhr, kostenlos, vertraulich',
  },
];

/** Die echten Notrufe (rein). */
export const NOTFALLNUMMERN = NOTRUFE.filter((n) => !n.beratung);

/** Beratungsnummern – kein Ersatz für den Notruf (rein). */
export const BERATUNGSNUMMERN = NOTRUFE.filter((n) => n.beratung);

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

/** Das Notfallblatt als Text zum Teilen oder Ausdrucken (rein, testbar).
 *
 *  `adresse` steht zuoberst und nicht irgendwo (Punkt 213): Wer 144
 *  wählt, muss als Erstes sagen, WO er ist – und genau das weiss eine
 *  fremde Person im Haus nicht auswendig. */
export function notfallText(eintraege: Eintrag[], haus?: string, adresse?: string): string {
  const zeilen: string[] = [`NOTFALLBLATT${haus ? ` – ${haus}` : ''}`, ''];
  const wo = String(adresse ?? '').trim();
  if (wo) zeilen.push(`Wir sind hier: ${wo}`, '');
  for (const eintrag of eintraege ?? []) {
    zeilen.push(String(eintrag.text ?? '').trim() || 'Ohne Namen');
    for (const zeile of notfallZeilen(eintrag)) {
      zeilen.push(`  ${zeile.label}: ${zeile.wert}`);
    }
    const frei = String(eintrag.body ?? '').trim();
    if (frei) zeilen.push(`  ${frei}`);
    zeilen.push('');
  }
  zeilen.push(
    'Notruf: ' + NOTFALLNUMMERN.map((n) => `${n.label} ${n.nummer}`).join(' · ')
  );
  // Getrennt aufgeführt, weil es etwas anderes ist: Wer auf dem Blatt
  // «Notruf» liest, soll in akuter Gefahr nicht bei einer Beratungsstelle
  // landen - und wer Beratung sucht, findet sie trotzdem.
  if (BERATUNGSNUMMERN.length > 0) {
    zeilen.push(
      'Beratung: ' + BERATUNGSNUMMERN.map((n) => `${n.label} ${n.nummer}`).join(' · ')
    );
  }
  return zeilen.join('\n');
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

/** Der Benutzer, den der Babysitter-Zugang anlegt und wiederverwendet. */
export const BABYSITTER_USER = 'Babysitter';

/**
 * Der Kontoname für eine bestimmte Person (rein, testbar).
 *
 * Es gab genau einen Benutzer «Babysitter», den sich alle teilten
 * (Punkt 187). Solange es eine Person ist, geht das; bei Nachbarin,
 * Göttikind und Grosseltern steht im Zugriffsprotokoll dieselbe Zeile
 * für drei Menschen. Mit dem Namen im Konto sieht man auch, wer wann da
 * war.
 */
export function babysitterKonto(name?: string): string {
  const sauber = String(name ?? '').trim().replace(/\s+/g, ' ');
  return sauber ? `${BABYSITTER_USER} ${sauber}` : BABYSITTER_USER;
}

/** Gehört dieser Benutzer zu einem Babysitter-Zugang? (rein, testbar) */
export function istBabysitterKonto(user: Eintrag): boolean {
  const name = String(user?.name ?? '');
  return name === BABYSITTER_USER || name.startsWith(`${BABYSITTER_USER} `);
}

/** Der blosse Vorname aus einem Kontonamen (rein, testbar). */
export function babysitterVorname(user: Eintrag): string {
  const name = String(user?.name ?? '');
  return name.startsWith(`${BABYSITTER_USER} `)
    ? name.slice(BABYSITTER_USER.length + 1)
    : '';
}

/**
 * Was auf dem Blatt fehlt (rein, testbar).
 *
 * «Vorschau: so sieht es der Babysitter» macht die Lücken vorher
 * sichtbar (Punkt 184) – der Zugang gibt Licht und Familie frei, ob das
 * Blatt am Abend wirklich vollständig ist, merkte man sonst erst, wenn
 * angerufen wird.
 */
export function abendLuecken(
  abend: Eintrag,
  kontakte: Eintrag[],
  adresse?: string
): string[] {
  const luecken: string[] = [];
  if (!String(adresse ?? '').trim()) {
    luecken.push('Die Hausadresse fehlt – wer 144 wählt, muss sagen, wo er ist.');
  }
  const mitNummer = (kontakte ?? []).filter((k) => nummernVon(k).length > 0);
  if (mitNummer.length === 0) luecken.push('Keine einzige Nummer hinterlegt.');
  const eltern = (kontakte ?? []).filter((k) => rollenVon(k).includes('notfall'));
  if (eltern.length === 0) luecken.push('Niemand ist als Notfallkontakt markiert.');
  for (const feld of ABEND_FELDER) {
    if (!String(abend?.[feld.key] ?? '').trim()) {
      luecken.push(`«${feld.label}» ist leer.`);
    }
  }
  return luecken;
}

/**
 * Vorgefertigte Zeilen fürs Abendprotokoll (Punkt 186).
 *
 * «Wann ist sie eingeschlafen? Hat er gegessen?» wird am Türrahmen
 * gefragt und halb vergessen. Drei Tipper statt eines Aufsatzes.
 */
export const PROTOKOLL_ZEILEN = [
  'Znacht gegessen ✓',
  'eingeschlafen um',
  'einmal aufgewacht',
  'alles ruhig',
  'Zähne geputzt ✓',
] as const;

/** Eine Zeile ans Protokoll hängen, mit Uhrzeit (rein, testbar). */
export function protokollZeile(bisher: string, zeile: string, jetzt: Date): string {
  const uhr = `${String(jetzt.getHours()).padStart(2, '0')}:${String(
    jetzt.getMinutes()
  ).padStart(2, '0')}`;
  const neu = zeile.endsWith('um') ? `${zeile} ${uhr}` : `${uhr} ${zeile}`;
  return [String(bisher ?? '').trim(), neu].filter(Boolean).join('\n');
}

/**
 * Die Bereiche, die ein Babysitter braucht – und nur die.
 *
 * Licht, damit er das Kinderzimmer dunkel machen kann. Familie, damit er
 * diese Seite sieht. Klingel, damit er beim Läuten sieht, wer da ist –
 * sehen ist Sicherheit, öffnen bleibt Sache der Familie (Punkt 215).
 * Keine Türen, kein Alarm, keine anderen Kameras: Was man nicht
 * freigibt, muss man später nicht bereuen.
 */
export const BABYSITTER_FEATURES = ['licht', 'familie', 'klingel'];

/**
 * Bis wann der Zugang gilt (rein, testbar).
 *
 * Zurück gegeben wird beides, was der Hub kennt: das Ablaufdatum und das
 * Zeitfenster. Endet der Abend nach Mitternacht, gilt das Datum von
 * morgen – sonst wäre der Zugang genau dann weg, wenn man ihn noch
 * braucht.
 */
export function babysitterZugang(
  jetzt: Date,
  bis: string
): { expires: string; hours: { from: string; to: string } } {
  const [stunde] = bis.split(':').map(Number);
  const ende = new Date(jetzt);
  if (stunde < jetzt.getHours()) ende.setDate(ende.getDate() + 1);
  const von = `${String(jetzt.getHours()).padStart(2, '0')}:${String(
    jetzt.getMinutes()
  ).padStart(2, '0')}`;
  return { expires: isoTag(ende), hours: { from: von, to: bis } };
}

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
