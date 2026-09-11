/**
 * Gutscheine (Punkt 264): Texte, Reihenfolge, der Abzug.
 *
 * Der Fall: Ein Brack-Gutschein über 100 Franken, von dem 20 gebraucht
 * sind, und die Frage «wie viel ist noch drauf, und bis wann?».
 */
import {
  Gutschein,
  ablaufSatz,
  archivieren,
  archivListe,
  bilanzSatz,
  buchungSatz,
  gebunden,
  istArchiviert,
  nachLaden,
  restHinweis,
  schonStorniert,
  stornieren,
  stornoPruefen,
  uebergeben,
  verfallen,
  verfuegbar,
  wartetAufAnnahme,
  wiederherstellen,
  ablaufStufe,
  abziehen,
  abzugPruefen,
  alsGutschein,
  anteil,
  aufgeteilt,
  betragLesen,
  datumLesen,
  datumText,
  DATEI_MAX_BYTES,
  alsDatei,
  dateiErlaubt,
  dateiGroesse,
  dateiPruefen,
  dateiSatz,
  anhaenge,
  anhaengeSatz,
  alsDateien,
  dateiSymbol,
  formularPruefen,
  MITNEHMEN,
  formularVon,
  mimeVon,
  mitMimeTyp,
  gefiltert,
  kachelText,
  kategorien,
  kopfText,
  leeresFormular,
  passtSuche,
  restText,
  sortiert,
  summe,
  teilText,
  Transaktion,
  verlauf,
  vorlageFuerLaden,
  ladenAnfrage,
  betragText,
  codeStand,
  codeVerbrauchen,
  codesLesen,
  doppelte,
  doppelteSatz,
  einheitText,
  fastLeer,
  naechsterCode,
  offeneCodes,
  summen,
  summenText,
} from './gutscheine';

const HEUTE = '2026-09-07';

const brack: Gutschein = {
  id: 'v1',
  author: 'Stibe',
  shop: 'Brack.ch',
  title: 'Gutschein',
  unit: 'chf',
  total: 100,
  left: 80,
  number: '57412469',
  pin: '1234',
  expires: '2030-06-30',
  category: 'Shopping',
  shared: 'privat',
  url: 'https://brack.ch',
  transactions: [{ at: '2026-08-01T10:00:00.000Z', amount: 20, by: 'Stibe' }],
};

const kino: Gutschein = {
  id: 'v2',
  shop: 'Kinder Paradies',
  title: 'Geschenk',
  unit: 'stk',
  total: 1,
  left: 1,
  expires: null,
  shared: 'familie',
};

const bald: Gutschein = {
  id: 'v3',
  shop: 'Zalando',
  unit: 'chf',
  total: 50,
  left: 50,
  expires: '2026-09-20',
  shared: 'familie',
  category: 'Shopping',
};

const vorbei: Gutschein = {
  id: 'v4',
  shop: 'Aldi',
  unit: 'chf',
  total: 30,
  left: 30,
  expires: '2026-01-31',
  shared: 'familie',
};

const leer: Gutschein = { id: 'v5', shop: 'Coop', unit: 'chf', total: 20, left: 0, expires: null, shared: 'familie' };

describe('restText', () => {
  test('CHF mit zwei Stellen, Stück ganz', () => {
    expect(restText(brack)).toBe('80.00 CHF');
    expect(restText(kino)).toBe('1 Stk.');
    expect(restText({ left: 12.5, unit: 'chf' })).toBe('12.50 CHF');
  });
});

describe('ablaufStufe', () => {
  test('ohne Datum unbegrenzt', () => {
    expect(ablaufStufe(null, HEUTE)).toBe('unbegrenzt');
  });
  test('weit weg ist ok, innert dreissig Tagen bald', () => {
    expect(ablaufStufe('2030-06-30', HEUTE)).toBe('ok');
    expect(ablaufStufe('2026-10-07', HEUTE)).toBe('bald');
    expect(ablaufStufe('2026-10-08', HEUTE)).toBe('ok');
  });
  test('der letzte Tag zählt noch – abgelaufen ist erst der Tag danach', () => {
    // «Gültig bis 30.06.» heisst am 30.06. noch gültig.
    expect(ablaufStufe('2026-09-07', HEUTE)).toBe('bald');
    expect(ablaufStufe('2026-09-06', HEUTE)).toBe('abgelaufen');
  });
  test('nimmt auch ein Date als heute', () => {
    expect(ablaufStufe('2026-09-06', new Date(2026, 8, 7, 12))).toBe('abgelaufen');
  });
});

describe('ablaufSatz', () => {
  test('sagt es, wie man es liest', () => {
    expect(ablaufSatz('2030-06-30', HEUTE)).toBe('Gültig bis 30.06.2030');
    expect(ablaufSatz(null, HEUTE)).toBe('Unbegrenzt');
    expect(ablaufSatz('2026-01-31', HEUTE)).toBe('Abgelaufen am 31.01.2026');
    expect(ablaufSatz('2026-09-20', HEUTE)).toBe('Läuft in 13 Tagen ab');
    expect(ablaufSatz('2026-09-07', HEUTE)).toBe('Läuft heute ab');
    expect(ablaufSatz('2026-09-08', HEUTE)).toBe('Läuft morgen ab');
  });
});

describe('datum', () => {
  test('hin und zurück', () => {
    expect(datumText('2030-06-30')).toBe('30.06.2030');
    expect(datumLesen('30.6.2030')).toBe('2030-06-30');
    expect(datumLesen('30.06.30')).toBe('2030-06-30');
    expect(datumLesen('2030-06-30')).toBe('2030-06-30');
  });
  test('ein unlesbares Datum ist null, nicht «unbegrenzt»', () => {
    expect(datumLesen('bald')).toBeNull();
    expect(datumLesen('31.02.2030')).toBeNull();
    expect(datumLesen('')).toBeNull();
  });
});

describe('sortiert', () => {
  test('bald ablaufende zuerst, dann nach Laden, Abgelaufene zuletzt', () => {
    const liste = sortiert([vorbei, kino, brack, bald], HEUTE);
    expect(liste.map((e) => e.shop)).toEqual(['Zalando', 'Brack.ch', 'Kinder Paradies', 'Aldi']);
  });
  test('unter den bald ablaufenden das Nächste zuoberst', () => {
    const spaeter: Gutschein = { ...bald, id: 'v9', shop: 'Aaa', expires: '2026-09-30' };
    const liste = sortiert([spaeter, bald], HEUTE);
    expect(liste[0].id).toBe('v3');
  });
});

describe('aufgeteilt', () => {
  test('Aufgebrauchte kommen in die eigene Gruppe', () => {
    const { offen, leer: leere } = aufgeteilt([brack, leer, kino], HEUTE);
    expect(offen.map((e) => e.id)).toEqual(['v1', 'v2']);
    expect(leere.map((e) => e.id)).toEqual(['v5']);
  });
});

describe('summe', () => {
  test('zählt nur CHF, nur offene, nur nicht abgelaufene', () => {
    expect(summe([brack, kino, bald, vorbei, leer], HEUTE)).toBe(130);
  });
  test('Kopf und Kachel', () => {
    expect(kopfText([brack, kino, leer])).toBe('2 verfügbar');
    expect(kachelText([brack, kino, leer], HEUTE)).toBe('2 verfügbar · 80.00 CHF');
    expect(kachelText([], HEUTE)).toBe('Noch keiner erfasst');
    // Nur Stück-Gutscheine: keine Summe, die nichts sagt.
    expect(kachelText([kino], HEUTE)).toBe('1 verfügbar');
  });
});

describe('Suche und Filter', () => {
  test('passtSuche über Laden, Titel, Kategorie und Nummer', () => {
    expect(passtSuche(brack, 'brack')).toBe(true);
    expect(passtSuche(brack, 'shopp')).toBe(true);
    expect(passtSuche(brack, '5741')).toBe(true);
    expect(passtSuche(brack, 'migros')).toBe(false);
    expect(passtSuche(brack, '')).toBe(true);
  });
  test('gefiltert nach Kategorie, Geteilt und «bald»', () => {
    const alle = [brack, kino, bald, vorbei];
    expect(gefiltert(alle, '', { kategorie: 'Shopping' }, HEUTE).map((e) => e.id)).toEqual(['v1', 'v3']);
    expect(gefiltert(alle, '', { geteilt: 'privat' }, HEUTE).map((e) => e.id)).toEqual(['v1']);
    expect(gefiltert(alle, '', { bald: true }, HEUTE).map((e) => e.id)).toEqual(['v3']);
    expect(gefiltert(alle, 'zal', { bald: true }, HEUTE)).toHaveLength(1);
  });
  test('kategorien kennt die Vorschläge und die eigenen', () => {
    const liste = kategorien([{ ...brack, category: 'Zoo' }]);
    expect(liste).toContain('Zoo');
    expect(liste).toContain('Shopping');
    expect(new Set(liste).size).toBe(liste.length);
  });
});

describe('abziehen', () => {
  const jetzt = new Date('2026-09-07T14:00:00.000Z');

  test('senkt den Rest und hält fest, wer es war', () => {
    const neu = abziehen(brack, 30, 'Sandra', jetzt);
    expect(neu.left).toBe(50);
    expect(neu.transactions).toHaveLength(2);
    expect(neu.transactions?.[1]).toEqual({
      at: jetzt.toISOString(),
      amount: 30,
      by: 'Sandra',
      // Seit Punkt 302 trägt jede Buchung ihre Art - ohne sie liesse
      // sich ein Abzug nicht von seiner Rücknahme unterscheiden.
      art: 'abzug',
    });
    // Das Original bleibt, wie es war.
    expect(brack.left).toBe(80);
  });

  test('klemmt bei null statt negativ zu werden', () => {
    const neu = abziehen(brack, 500, 'Livia', jetzt);
    expect(neu.left).toBe(0);
    expect(neu.transactions?.[1].amount).toBe(80);
  });

  test('Rappen bleiben Rappen', () => {
    const neu = abziehen({ ...brack, left: 10 }, 0.1 + 0.2, 'x', jetzt);
    expect(neu.left).toBe(9.7);
  });

  test('bei Stück ganze Zahlen', () => {
    expect(abziehen(kino, 1, 'Stibe', jetzt).left).toBe(0);
  });

  test('der Verlauf steht mit dem Jüngsten zuoberst', () => {
    const neu = abziehen(brack, 5, 'Sandra', jetzt);
    expect(verlauf(neu)[0].by).toBe('Sandra');
  });
});

describe('abzugPruefen', () => {
  test('sagt, was fehlt, statt abzustürzen', () => {
    expect(abzugPruefen(brack, null)).toMatch(/Betrag/);
    expect(abzugPruefen(kino, null)).toMatch(/ganze Zahl/);
    expect(abzugPruefen(brack, 0)).toMatch(/grösser als null/);
    expect(abzugPruefen(brack, 80.01)).toBe('Es sind nur noch 80.00 CHF drauf.');
    expect(abzugPruefen(brack, 80)).toBeNull();
    expect(abzugPruefen(brack, 12.5)).toBeNull();
  });
});

describe('betragLesen', () => {
  test('Komma und Punkt sind dasselbe', () => {
    expect(betragLesen('12,50', 'chf')).toBe(12.5);
    expect(betragLesen('12.5', 'chf')).toBe(12.5);
    expect(betragLesen('20', 'chf')).toBe(20);
  });
  test('Stück nur ganz', () => {
    expect(betragLesen('2', 'stk')).toBe(2);
    expect(betragLesen('1.5', 'stk')).toBeNull();
  });
  test('Unlesbares ist null', () => {
    expect(betragLesen('', 'chf')).toBeNull();
    expect(betragLesen('viel', 'chf')).toBeNull();
    expect(betragLesen('1.234', 'chf')).toBeNull();
  });
});

describe('teilText', () => {
  test('alles, was man im Laden eintippt', () => {
    expect(teilText(brack)).toBe(
      'Brack.ch – Gutschein\nNummer: 57412469\nPIN: 1234\nRest: 80.00 CHF von 100.00 CHF\n' +
        'Gültig bis 30.06.2030\nhttps://brack.ch'
    );
  });
  test('leere Felder bleiben weg', () => {
    expect(teilText(kino)).toBe('Kinder Paradies – Geschenk\nRest: 1 Stk. von 1 Stk.\nUnbegrenzt gültig');
  });
});

describe('Formular', () => {
  test('Laden und Wert sind Pflicht', () => {
    expect(formularPruefen({ ...leeresFormular(), total: '50' }, null).fehler).toMatch(/Laden/);
    expect(formularPruefen({ ...leeresFormular(), shop: 'Coop' }, null).fehler).toMatch(/Wert/);
    expect(
      formularPruefen({ ...leeresFormular(), shop: 'Kino', unit: 'stk' }, null).fehler
    ).toMatch(/Anzahl/);
  });

  test('ein neuer Gutschein ist voll und unbegrenzt, wenn nichts anderes steht', () => {
    const { eintrag } = formularPruefen({ ...leeresFormular(), shop: 'Coop', total: '50' }, null);
    expect(eintrag?.left).toBe(50);
    expect(eintrag?.expires).toBeNull();
    expect(eintrag?.transactions).toEqual([]);
  });

  test('ein falsches Datum wird nicht still zu «unbegrenzt»', () => {
    const form = { ...leeresFormular(), shop: 'Coop', total: '50', expires: 'irgendwann' };
    expect(formularPruefen(form, null).fehler).toMatch(/TT\.MM\.JJJJ/);
  });

  test('ein Link ohne Schema bekommt https', () => {
    const form = { ...leeresFormular(), shop: 'Coop', total: '50', url: 'coop.ch' };
    expect(formularPruefen(form, null).eintrag?.url).toBe('https://coop.ch');
  });

  test('beim Bearbeiten wandert der Rest mit dem Gesamtwert, der Verlauf bleibt', () => {
    const form = { ...formularVon(brack), total: '120' };
    const { eintrag } = formularPruefen(form, brack);
    expect(eintrag?.left).toBe(100);
    expect(eintrag?.transactions).toHaveLength(1);
    // Was schon abgezogen ist, bleibt abgezogen: 20 von neu 10 ist leer,
    // nicht negativ.
    const kleiner = formularPruefen({ ...formularVon(brack), total: '10' }, brack);
    expect(kleiner.eintrag?.left).toBe(0);
    // Und ein Rest über dem Gesamtwert kommt nicht vor.
    const unberuehrt = formularPruefen({ ...formularVon(kino), total: '3' }, kino);
    expect(unberuehrt.eintrag?.left).toBe(3);
  });

  test('formularVon zeigt das Datum, wie man es tippt', () => {
    expect(formularVon(brack).expires).toBe('30.06.2030');
    expect(formularVon(kino).expires).toBe('');
    expect(formularVon(kino).total).toBe('1');
  });
});

describe('alsGutschein', () => {
  test('nimmt, was vom Hub kommt, und füllt auf', () => {
    const e = alsGutschein({ id: 'x', shop: 'Coop', total: '20' });
    expect(e.unit).toBe('chf');
    expect(e.left).toBe(20);
    expect(e.shared).toBe('familie');
    expect(alsGutschein({ shop: 'x', total: 1, shared: 'privat' }).shared).toBe('privat');
    expect(e.expires).toBeNull();
    expect(e.transactions).toEqual([]);
  });
  test('ein Rest über dem Gesamtwert wird gekappt, ein negativer auf null', () => {
    expect(alsGutschein({ shop: 'x', total: 10, left: 12 }).left).toBe(10);
    expect(alsGutschein({ shop: 'x', total: 10, left: -3 }).left).toBe(0);
  });
  test('der Balken', () => {
    expect(anteil(brack)).toBe(0.8);
    expect(anteil(leer)).toBe(0);
    expect(anteil({ left: 5, total: 0 })).toBe(0);
  });
});

// ── Die Datei am Gutschein (Punkt 266) ───────────────────────────────────

describe('Datei am Gutschein', () => {
  const beleg = {
    url: '/api/family/vouchers/v1/datei?v=abc',
    name: 'Gutschein Brack.pdf',
    type: 'application/pdf',
    bytes: 182913,
  };

  test('dateiGroesse rundet, wie man es liest', () => {
    expect(dateiGroesse(182913)).toBe('179 KB');
    expect(dateiGroesse(1258291)).toBe('1.2 MB');
    expect(dateiGroesse(1024 * 1024)).toBe('1 MB');
    expect(dateiGroesse(DATEI_MAX_BYTES)).toBe('10 MB');
    expect(dateiGroesse(812)).toBe('812 B');
    expect(dateiGroesse(1024)).toBe('1 KB');
    // Keine Angabe heisst keine Zeile - nicht «0 B».
    expect(dateiGroesse(undefined)).toBe('');
    expect(dateiGroesse(null)).toBe('');
    expect(dateiGroesse(-5)).toBe('');
  });

  test('dateiSymbol unterscheidet PDF, Bild, Tabelle und Text', () => {
    expect(dateiSymbol('application/pdf')).toBe('document-text-outline');
    expect(dateiSymbol('image/jpeg')).toBe('image-outline');
    expect(dateiSymbol('text/plain')).toBe('document-outline');
    expect(dateiSymbol('text/csv')).toBe('grid-outline');
    expect(dateiSymbol('application/vnd.ms-excel')).toBe('grid-outline');
    expect(dateiSymbol('application/zip')).toBe('archive-outline');
    expect(dateiSymbol('application/msword')).toBe('document-attach-outline');
    expect(dateiSymbol(undefined)).toBe('document-attach-outline');
    // Ein Bild ist nie dasselbe Symbol wie ein PDF - darum geht es.
    expect(dateiSymbol('image/png')).not.toBe(dateiSymbol('application/pdf'));
  });

  test('mimeVon nimmt die Endung, wenn das Gerät nichts sagt', () => {
    expect(mimeVon('Beleg.pdf', 'application/pdf')).toBe('application/pdf');
    expect(mimeVon('Beleg.pdf', 'application/octet-stream')).toBe('application/pdf');
    expect(mimeVon('Beleg.PDF', undefined)).toBe('application/pdf');
    expect(mimeVon('Tabelle.xlsx', null)).toBe(
      'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    );
    expect(mimeVon('ohnepunkt', undefined)).toBe('');
    // Was der Hub nicht kennt, bekommt auch keinen Typ angedichtet.
    expect(mimeVon('Foto.heic', undefined)).toBe('');
  });

  test('dateiErlaubt lässt genau durch, was der Hub ablegt', () => {
    expect(dateiErlaubt('application/pdf')).toBe(true);
    expect(dateiErlaubt('image/jpeg')).toBe(true);
    expect(dateiErlaubt('text/plain')).toBe(true);
    expect(dateiErlaubt('application/msword')).toBe(true);
    expect(dateiErlaubt('application/zip')).toBe(true);
    expect(dateiErlaubt('APPLICATION/PDF ')).toBe(true);
    expect(dateiErlaubt('application/x-msdownload')).toBe(false);
    expect(dateiErlaubt('')).toBe(false);
    // Dieselbe Liste wie beim Hub: kein image/*, kein text/*. SVG und
    // HTML dürfen Skripte tragen und liefen unter der Adresse des Hubs.
    expect(dateiErlaubt('image/svg+xml')).toBe(false);
    expect(dateiErlaubt('text/html')).toBe(false);
    expect(dateiErlaubt('image/heic')).toBe(false);
  });

  test('dateiPruefen sagt vor dem Hochladen, was nicht geht', () => {
    expect(dateiPruefen({ name: 'Gutschein Brack.pdf', size: 182913, mimeType: 'application/pdf' })).toBeNull();
    // Zu gross: Die Meldung nennt beide Zahlen und sagt, was zu tun ist.
    const gross = dateiPruefen({ name: 'Film.pdf', size: 40 * 1024 * 1024, mimeType: 'application/pdf' });
    expect(gross).toContain('40 MB');
    expect(gross).toContain('10 MB');
    expect(gross).toContain('kleinere');
    // Genau an der Grenze geht noch.
    expect(dateiPruefen({ name: 'Rand.pdf', size: DATEI_MAX_BYTES, mimeType: 'application/pdf' })).toBeNull();
    expect(dateiPruefen({ name: 'Virus.exe', size: 100, mimeType: 'application/x-msdownload' })).toContain(
      'PDF'
    );
    expect(dateiPruefen({ name: 'Seite.html', size: 100, mimeType: 'text/html' })).toContain('Format');
    expect(dateiPruefen({ name: 'leer.pdf', size: 0, mimeType: 'application/pdf' })).toContain('leer');
    expect(dateiPruefen({ name: '', size: 10 })).toContain('keinen Namen');
    // Ohne Grössenangabe (manche Android-Anbieter melden keine) darf sie durch.
    expect(dateiPruefen({ name: 'Beleg.pdf' })).toBeNull();
  });

  test('dateiSatz ist das Vorlesezeichen', () => {
    expect(dateiSatz(beleg)).toBe('Gutschein Brack.pdf, 179 KB');
    expect(dateiSatz({ name: 'Beleg.pdf' })).toBe('Beleg.pdf');
    expect(dateiSatz(null)).toBe('');
  });

  test('alsDatei nimmt den Block vom Hub - und nichts Leeres', () => {
    expect(alsDatei(beleg)).toEqual(beleg);
    expect(alsDatei({ data: 'data:application/pdf;base64,AAA', name: 'Neu.pdf' })).toEqual({
      data: 'data:application/pdf;base64,AAA',
      name: 'Neu.pdf',
    });
    expect(alsDatei(null)).toBeNull();
    expect(alsDatei({})).toBeNull();
    expect(alsDatei({ name: 'nur ein Name' })).toBeNull();
    expect(alsDatei({ url: '/x' })?.name).toBe('Datei');
  });

  test('mitMimeTyp setzt nur nach, was fehlt', () => {
    expect(mitMimeTyp('data:application/octet-stream;base64,AAA', 'application/pdf')).toBe(
      'data:application/pdf;base64,AAA'
    );
    expect(mitMimeTyp('data:;base64,AAA', 'application/pdf')).toBe('data:application/pdf;base64,AAA');
    // Ein sinnvoller Typ bleibt, wie er ist.
    expect(mitMimeTyp('data:image/png;base64,AAA', 'application/pdf')).toBe('data:image/png;base64,AAA');
    expect(mitMimeTyp('nichts', 'application/pdf')).toBe('nichts');
  });

  test('alsGutschein liest die Datei mit', () => {
    expect(alsGutschein({ shop: 'Brack', total: 100, file: beleg }).file).toEqual(beleg);
    expect(alsGutschein({ shop: 'Brack', total: 100 }).file).toBeNull();
    expect(alsGutschein({ shop: 'Brack', total: 100, file: null }).file).toBeNull();
  });

  test('beim Bearbeiten bleibt die Datei dran', () => {
    // Der übliche Fehler bei so einem Feld: Wer nur den Betrag
    // korrigiert, verliert den Beleg. Der Block geht unverändert
    // hinaus - mit url, ohne data.
    const mitDatei: Gutschein = { ...brack, file: beleg };
    const form = { ...formularVon(mitDatei), total: '120' };
    const { eintrag } = formularPruefen(form, mitDatei);
    expect(eintrag?.file).toEqual(beleg);
    expect(eintrag?.file?.data).toBeUndefined();
  });

  test('eine neue Datei geht als data-URI hinaus, «entfernen» als null', () => {
    const neu = { data: 'data:application/pdf;base64,AAA', name: 'Neu.pdf' };
    const angehaengt = formularPruefen({ ...formularVon(brack), files: [neu] }, brack);
    expect(angehaengt.eintrag?.file).toEqual(neu);
    // Entfernen heisst null, nicht «Feld weglassen» - sonst behält der
    // Hub die alte Datei. Seit Punkt 431 zählt die Liste; `file` folgt ihr.
    const weg = formularPruefen({ ...formularVon({ ...brack, file: beleg }), files: [] }, brack);
    expect(weg.eintrag?.file).toBeNull();
    // Und wer nie eine anhängt, schickt auch null.
    expect(formularPruefen(leeresFormular2(), null).eintrag?.file).toBeNull();
  });
});

/** Ein gültiges leeres Formular – der Laden und der Wert sind Pflicht. */
function leeresFormular2() {
  return { ...leeresFormular(), shop: 'Coop', total: '20' };
}

// ── Karte mitbringen (Punkt 267) ─────────────────────────────────────────

describe('Karte mitbringen', () => {
  test('ein Eintrag ohne das Feld verlangt nichts - alte Gutscheine bleiben, wie sie waren', () => {
    expect(alsGutschein({ shop: 'Coop', total: 20 }).physical).toBe(false);
    // Nur das ausdrückliche true zählt: «ja» oder 1 aus einer
    // Hand-Eingabe sind kein Beschluss, sondern ein Zufall.
    expect(alsGutschein({ shop: 'Coop', total: 20, physical: 'ja' }).physical).toBe(false);
    expect(alsGutschein({ shop: 'Coop', total: 20, physical: true }).physical).toBe(true);
  });

  test('das Formular merkt sich die Wahl und gibt sie beim Bearbeiten wieder her', () => {
    const { eintrag } = formularPruefen(
      { ...leeresFormular(), shop: 'Migros', total: '50', physical: true },
      null
    );
    expect(eintrag?.physical).toBe(true);
    expect(formularVon(eintrag as Gutschein).physical).toBe(true);
    // Und zurückgestellt bleibt zurückgestellt - nicht «einmal true,
    // immer true», wie es passiert, wenn man nur auf Wahrheit prüft.
    const zurueck = formularPruefen(
      { ...formularVon(eintrag as Gutschein), physical: false },
      eintrag as Gutschein
    );
    expect(zurueck.eintrag?.physical).toBe(false);
  });

  test('wer den Gutschein weitergibt, gibt den Hinweis mit', () => {
    expect(teilText({ ...kino, physical: true })).toContain(MITNEHMEN);
    expect(teilText(kino)).not.toContain(MITNEHMEN);
  });

  test('ein neuer Gutschein verlangt die Karte nicht von selbst', () => {
    expect(leeresFormular().physical).toBe(false);
  });
});

describe('Buchung zurücknehmen (Punkt 302)', () => {
  const heute = new Date('2026-09-10T12:00:00Z');
  // Zwei Zeitpunkte: `verlauf` sortiert nach `at`, und bei gleichem
  // Zeitstempel wäre «die jüngste Buchung» eine Münze.
  const spaeter = new Date('2026-09-10T12:05:00Z');
  const basis = (): Gutschein =>
    alsGutschein({
      shop: 'Brack',
      unit: 'chf',
      total: 100,
      left: 100,
      expires: null,
      shared: 'familie',
    });

  it('bucht zurück, statt die Zeile zu löschen', () => {
    // Der Verlauf ist die Antwort auf «wer hat den Gutschein
    // gebraucht?» - einer, aus dem Zeilen verschwinden, beantwortet sie
    // nicht mehr.
    const abgezogen = abziehen(basis(), 30, 'Stefan', heute);
    const buchung = verlauf(abgezogen)[0];
    expect(stornoPruefen(abgezogen, buchung)).toBeNull();
    const zurueck = stornieren(abgezogen, buchung, 'Stefan', spaeter);
    expect(zurueck.left).toBe(100);
    expect(zurueck.transactions).toHaveLength(2);
    expect(buchungSatz(zurueck, verlauf(zurueck)[0])).toBe('30.00 CHF zurückgebucht');
  });

  it('lässt denselben Abzug nicht zweimal zurücknehmen', () => {
    const abgezogen = abziehen(basis(), 30, 'Stefan', heute);
    const buchung = verlauf(abgezogen)[0];
    const zurueck = stornieren(abgezogen, buchung, 'Stefan', spaeter);
    expect(stornoPruefen(zurueck, buchung)).toBe('Dieser Abzug ist schon zurückgenommen.');
  });

  it('nimmt keine Rücknahme zurück', () => {
    const abgezogen = abziehen(basis(), 30, 'Stefan', heute);
    const zurueck = stornieren(abgezogen, verlauf(abgezogen)[0], 'Stefan', spaeter);
    expect(stornoPruefen(zurueck, verlauf(zurueck)[0])).toBe(
      'Eine Rücknahme lässt sich nicht zurücknehmen.'
    );
  });
});

describe('Übergeben (Punkt 306, Annahme seit Punkt 377)', () => {
  it('schlägt nur vor - der Besitzer wechselt noch nicht', () => {
    // Geteilt heisst «alle sehen ihn», übergeben heisst «er gehört
    // jetzt dir» - bei einem privaten Gutschein der einzige Weg. Der
    // Hub verlangt seit Punkt 377 eine Annahme, bevor es so weit ist.
    const eintrag = alsGutschein({
      shop: 'Kino',
      unit: 'chf',
      total: 50,
      left: 50,
      expires: null,
      shared: 'privat',
      author: 'Stefan',
    });
    const neu = uebergeben(eintrag, 'Bine');
    expect(neu.author).toBe('Stefan');
    expect(neu.pending_transfer_to).toBe('Bine');
    expect(wartetAufAnnahme(neu)).toBe(true);
    expect(wartetAufAnnahme(eintrag)).toBe(false);
  });

  it('ein leerer Name schlägt nichts vor', () => {
    const eintrag = alsGutschein({ shop: 'Kino', total: 50, left: 50 });
    expect(uebergeben(eintrag, '  ')).toBe(eintrag);
  });

  it('buchungSatz unterscheidet Vorschlag und vollzogene Übergabe', () => {
    const vorschlag: Transaktion = { at: 't', amount: 0, by: 'Stefan', art: 'uebergabe_vorschlag', note: 'an Bine' };
    const vollzogen: Transaktion = { at: 't', amount: 0, by: 'Bine', art: 'uebergabe', note: 'angenommen' };
    expect(buchungSatz(alsGutschein({ shop: 'x', total: 1 }), vorschlag)).toBe(
      'Übergabe vorgeschlagen an Bine'
    );
    expect(buchungSatz(alsGutschein({ shop: 'x', total: 1 }), vollzogen)).toBe(
      'Übergeben angenommen'
    );
  });
});

describe('Restwert und Läden (Punkt 303, 305)', () => {
  it('sagt beim kleinen Rest, dass sich die Fahrt nicht lohnt', () => {
    expect(restHinweis({ left: 3.2, total: 100, unit: 'chf' })).toBe(
      'Kleiner Rest – beim nächsten Einkauf mitnehmen'
    );
    expect(restHinweis({ left: 60, total: 100, unit: 'chf' })).toBe('');
    // Bei kleinen Gutscheinen wäre ein Zehntel zu wenig - fünf Franken
    // sind die Untergrenze.
    expect(restHinweis({ left: 4, total: 20, unit: 'chf' })).toBe(
      'Kleiner Rest – beim nächsten Einkauf mitnehmen'
    );
    expect(restHinweis({ left: 0, total: 20, unit: 'chf' })).toBe('');
  });

  it('fasst je Laden zusammen, das meiste Guthaben zuerst', () => {
    const heute = '2026-09-10';
    const mach = (shop: string, left: number, unit: 'chf' | 'stk' = 'chf') =>
      alsGutschein({ shop, unit, total: left, left, expires: null, shared: 'familie' });
    const gruppen = nachLaden(
      [mach('Coop', 20), mach('Coop', 30), mach('Kino', 100), mach('Bad', 5, 'stk')],
      heute
    );
    expect(gruppen.map((gruppe) => [gruppe.shop, gruppe.summe])).toEqual([
      ['Kino', 100],
      ['Coop', 50],
      // Fünf Eintritte plus nichts sind keine fünf Franken.
      ['Bad', 0],
    ]);
  });
});

describe('Kennzahlen (Punkt 307)', () => {
  const mach = (left: number, expires: string | null) =>
    alsGutschein({ shop: 'X', unit: 'chf', total: left, left, expires, shared: 'familie' });

  it('zählt, was bereitliegt - ohne das Verfallene', () => {
    const heute = '2026-09-10';
    const liste = [mach(100, null), mach(50, '2027-01-01'), mach(30, '2026-01-01')];
    expect(gebunden(liste, heute)).toBe(150);
    expect(verfallen(liste, heute)).toEqual({
      summe: 30,
      anzahl: 1,
      jeWaehrung: { chf: 30 },
    });
  });

  it('nennt die unangenehme Zahl nur, wenn es sie gibt', () => {
    const heute = '2026-09-10';
    expect(bilanzSatz([mach(100, null)], heute)).toBe('100.00 CHF liegen bereit');
    expect(bilanzSatz([mach(100, null), mach(30, '2026-01-01')], heute)).toBe(
      '100.00 CHF liegen bereit · 30.00 CHF verfallen'
    );
  });
});

// ── Archiv (Punkt 372) ────────────────────────────────────────────────────

describe('Archiv', () => {
  const aktiv = alsGutschein({ shop: 'Aktiv', total: 50, left: 50 });
  const archiviert = alsGutschein({ shop: 'Erledigt', total: 20, left: 0, archived: true });
  const trotzRestArchiviert = alsGutschein({
    shop: 'Verfallen',
    total: 40,
    left: 40,
    archived: true,
  });

  test('istArchiviert', () => {
    expect(istArchiviert(aktiv)).toBe(false);
    expect(istArchiviert(archiviert)).toBe(true);
  });

  test('verfuegbar lässt Archiviertes weg, auch mit Restwert', () => {
    expect(verfuegbar([aktiv, archiviert, trotzRestArchiviert])).toEqual([aktiv]);
  });

  test('aufgeteilt zeigt Archiviertes weder offen noch in der leeren Gruppe', () => {
    const { offen, leer: leere } = aufgeteilt([aktiv, archiviert, trotzRestArchiviert], HEUTE);
    expect(offen).toEqual([aktiv]);
    expect(leere).toEqual([]);
  });

  test('archivListe zeigt nur Archiviertes, jüngste Buchung zuerst', () => {
    const alt = alsGutschein({
      shop: 'Alt',
      total: 10,
      left: 0,
      archived: true,
      transactions: [{ at: '2026-01-01T10:00:00.000Z', amount: 10, by: 'Stibe' }],
    });
    const neu = alsGutschein({
      shop: 'Neu',
      total: 10,
      left: 0,
      archived: true,
      transactions: [{ at: '2026-06-01T10:00:00.000Z', amount: 10, by: 'Stibe' }],
    });
    expect(archivListe([aktiv, alt, neu]).map((e) => e.shop)).toEqual(['Neu', 'Alt']);
  });

  test('archivieren und wiederherstellen setzen nur das eine Feld', () => {
    expect(archivieren(aktiv).archived).toBe(true);
    expect(archivieren(aktiv).left).toBe(50);
    expect(wiederherstellen(archiviert).archived).toBe(false);
  });
});

describe('alsGutschein behält art und storniert der Buchungen', () => {
  test('ohne das wäre eine Rücknahme nach dem Neuladen nicht mehr erkennbar', () => {
    const e = alsGutschein({
      shop: 'X',
      total: 100,
      left: 100,
      transactions: [
        { at: '10:00', amount: 40, by: 'A' },
        { at: '11:00', amount: -40, by: 'A', art: 'storno', storniert: '10:00' },
        { at: '12:00', amount: 0, by: 'A', art: 'uebergabe', note: 'an B' },
      ],
    });
    expect(e.transactions?.[0].art).toBe('abzug');
    expect(e.transactions?.[1].art).toBe('storno');
    expect(e.transactions?.[1].storniert).toBe('10:00');
    expect(e.transactions?.[2].art).toBe('uebergabe');
    // Damit erkennt schonStorniert() die Rücknahme auch nach einem
    // Neuladen wieder - genau der Fehler, den es hier zu vermeiden galt.
    expect(schonStorniert(e, e.transactions![0])).toBe(true);
  });
});

describe('vorlageFuerLaden (Punkt 375)', () => {
  const alt = alsGutschein({
    shop: 'Coop',
    total: 20,
    left: 20,
    category: 'Essen',
    unit: 'chf',
    physical: false,
    created: '2026-01-01T10:00:00.000Z',
  });
  const neu = alsGutschein({
    shop: 'Coop',
    total: 30,
    left: 30,
    category: 'Shopping',
    unit: 'chf',
    physical: true,
    created: '2026-06-01T10:00:00.000Z',
  });

  test('nimmt den jüngsten Treffer desselben Ladens', () => {
    expect(vorlageFuerLaden([alt, neu], 'coop')).toEqual({
      category: 'Shopping',
      unit: 'chf',
      physical: true,
    });
  });

  test('ohne Treffer oder leeren Laden: null', () => {
    expect(vorlageFuerLaden([alt, neu], 'Digitec')).toBeNull();
    expect(vorlageFuerLaden([alt, neu], '  ')).toBeNull();
  });
});

// ── Der Code auf der Karte (Punkt 420) ───────────────────────────────────

describe('Code auf der Karte', () => {
  test('nur die beiden bekannten Wörter kommen vom Hub durch', () => {
    expect(alsGutschein({ shop: 'x', total: 1, code: 'qr' }).code).toBe('qr');
    expect(alsGutschein({ shop: 'x', total: 1, code: 'strich' }).code).toBe('strich');
    // Alles andere heisst «nicht gesagt» - und dann rechnet es die App
    // aus der Nummer aus, statt einen Strichcode zu behaupten.
    expect(alsGutschein({ shop: 'x', total: 1, code: 'aztec' }).code).toBeUndefined();
    expect(alsGutschein({ shop: 'x', total: 1 }).code).toBeUndefined();
  });

  test('das Formular hält die Wahl fest', () => {
    const { eintrag } = formularPruefen(
      { ...leeresFormular(), shop: 'Migros', total: '50', number: 'AB12', code: 'qr' },
      null
    );
    expect(eintrag?.code).toBe('qr');
    expect(formularVon(eintrag as Gutschein).code).toBe('qr');
  });

  test('ein alter Gutschein mit Adresse zeigt im Formular, was an der Kasse wirklich käme', () => {
    // Ohne Angabe stünde sonst «Strichcode» im Formular, während der
    // Gutschein längst als QR angezeigt wird - und wer dann speichert,
    // schriebe die falsche Angabe fest.
    const alt: Gutschein = { ...kino, number: 'https://brack.ch/gc/AB12CD34', code: undefined };
    expect(formularVon(alt).code).toBe('qr');
    expect(formularVon({ ...kino, number: '7612345678900' }).code).toBe('strich');
  });

  test('ein neuer Gutschein steht auf Strichcode', () => {
    expect(leeresFormular().code).toBe('strich');
  });
});

// ── Währung (Punkt 451) ────────────────────────────────────────────────────

describe('Währungen bleiben getrennt', () => {
  const eur: Gutschein = {
    shop: 'Media Markt',
    unit: 'eur',
    total: 40,
    left: 40,
    expires: null,
    shared: 'familie',
  };
  const chf: Gutschein = { ...eur, shop: 'Coop', unit: 'chf', total: 60, left: 60 };

  it('schreibt die Währung an den Betrag', () => {
    expect(betragText(40, 'eur')).toBe('40.00 EUR');
    expect(betragText(40, 'chf')).toBe('40.00 CHF');
    expect(einheitText('eur')).toBe('EUR');
  });

  it('zählt Euro nie zu Franken', () => {
    expect(summen([eur, chf], '2026-01-01')).toEqual({ eur: 40, chf: 60 });
    // `summe` bleibt die Franken-Zahl - daran hängen Kachel und Rückblick.
    expect(summe([eur, chf], '2026-01-01')).toBe(60);
    expect(summenText([eur, chf], '2026-01-01')).toBe('60.00 CHF · 40.00 EUR');
  });

  it('nennt auf der Kachel beide Währungen', () => {
    expect(kachelText([eur, chf], '2026-01-01')).toBe('2 verfügbar · 60.00 CHF · 40.00 EUR');
  });

  it('liest «eur» vom Hub und erfindet sonst nichts', () => {
    expect(alsGutschein({ shop: 'X', unit: 'eur', total: 10 }).unit).toBe('eur');
    expect(alsGutschein({ shop: 'X', unit: 'dollar', total: 10 }).unit).toBe('chf');
  });
});

// ── Mehrere Nummern (Punkt 452) ────────────────────────────────────────────

describe('Ein Gutschein mit zehn Nummern', () => {
  const karte: Gutschein = {
    shop: 'Hallenbad',
    unit: 'stk',
    total: 3,
    left: 3,
    expires: null,
    shared: 'familie',
    number: 'A',
    codes: [{ value: 'A', used: '2030-01-01T10:00:00Z' }, { value: 'B' }, { value: 'C' }],
  };

  it('zeigt an der Kasse die erste unbenutzte', () => {
    expect(naechsterCode(karte)).toBe('B');
    expect(offeneCodes(karte)).toEqual(['B', 'C']);
    expect(codeStand(karte)).toBe('Nummer 2 von 3');
  });

  it('zeigt die letzte, wenn alle gebraucht sind - nie gar nichts', () => {
    const leer = { ...karte, codes: karte.codes!.map((c) => ({ ...c, used: 'x' })) };
    expect(naechsterCode(leer)).toBe('C');
    expect(codeStand(leer)).toBe('Alle 3 eingelöst');
  });

  it('kommt mit dem Gutschein von vor der Frage zurecht', () => {
    const alt = alsGutschein({ shop: 'Brack', number: 'XY-1', total: 50 });
    expect(alt.codes).toEqual([{ value: 'XY-1', used: null }]);
    expect(naechsterCode(alt)).toBe('XY-1');
    expect(codeStand(alt)).toBe('');
  });

  it('markiert nur die gemeinte Nummer als gebraucht', () => {
    const neu = codeVerbrauchen(karte, 'B', new Date('2030-05-01T12:00:00Z'));
    expect(neu.codes![1].used).toBe('2030-05-01T12:00:00.000Z');
    expect(neu.codes![2].used).toBeFalsy();
    expect(karte.codes![1].used).toBeFalsy();
  });

  it('verliert beim Bearbeiten nicht, was schon eingelöst war', () => {
    const form = formularVon(karte);
    expect(form.weitereCodes).toBe('B\nC');
    const { eintrag } = formularPruefen({ ...form, shop: 'Hallenbad Sursee' }, karte);
    expect(eintrag!.codes).toEqual([
      { value: 'A', used: '2030-01-01T10:00:00Z' },
      { value: 'B', used: null },
      { value: 'C', used: null },
    ]);
  });

  it('liest Nummern aus Zeilen, Kommas und Strichpunkten', () => {
    expect(codesLesen('A\n B ,C; \n')).toEqual(['A', 'B', 'C']);
  });

  it('gibt beim Teilen nur die offenen Nummern weiter', () => {
    expect(teilText(karte)).toContain('Nummern: B, C');
  });
});

// ── Fast leer (Punkt 457) ──────────────────────────────────────────────────

describe('Der Rest, den man liegen lässt', () => {
  const basis: Pick<Gutschein, 'unit' | 'left' | 'total'> = {
    unit: 'chf',
    total: 100,
    left: 12,
  };

  it('meldet sich erst bei angebrochenen Gutscheinen', () => {
    expect(fastLeer(basis)).toBe(true);
    // Frisch geschenkter Zwanziger: ein Gutschein, kein Rest.
    expect(fastLeer({ unit: 'chf', total: 20, left: 20 })).toBe(false);
    expect(fastLeer({ unit: 'chf', total: 100, left: 60 })).toBe(false);
    expect(fastLeer({ unit: 'chf', total: 100, left: 0 })).toBe(false);
    expect(fastLeer({ unit: 'stk', total: 10, left: 1 })).toBe(false);
  });

  it('sagt es mit demselben Satz wie die Karte', () => {
    expect(restHinweis(basis)).toBe('Kleiner Rest – beim nächsten Einkauf mitnehmen');
    expect(restHinweis({ unit: 'chf', total: 100, left: 60 })).toBe('');
  });
});

// ── Doppelt erfasst (Punkt 456) ────────────────────────────────────────────

describe('Dieselbe Karte zweimal', () => {
  const mach = (over: Partial<Gutschein>): Gutschein => ({
    shop: 'Coop',
    unit: 'chf',
    total: 50,
    left: 50,
    expires: null,
    shared: 'familie',
    ...over,
  });

  it('erkennt die gleiche Nummer über Schreibweisen hinweg', () => {
    const liste = [mach({ id: '1', shop: 'Brack', number: 'XY-9', codes: [{ value: 'XY-9' }] })];
    const neu = mach({ shop: 'brack.ch', number: 'xy-9', codes: [{ value: 'xy-9' }] });
    expect(doppelte(liste, neu).map((t) => t.id)).toEqual(['1']);
  });

  it('vermutet ohne Nummer nur bei voller Übereinstimmung', () => {
    const liste = [mach({ id: '1', expires: '2030-01-01' }), mach({ id: '2', total: 80 })];
    expect(doppelte(liste, mach({ expires: '2030-01-01' })).map((t) => t.id)).toEqual(['1']);
    expect(doppelte(liste, mach({ expires: '2031-01-01' }))).toEqual([]);
  });

  it('zählt eine andere Nummer als Gegenbeweis', () => {
    const liste = [mach({ id: '1', number: 'A', codes: [{ value: 'A' }] })];
    expect(doppelte(liste, mach({ number: 'B', codes: [{ value: 'B' }] }))).toEqual([]);
  });

  it('übergeht sich selbst und das Archiv', () => {
    const eigen = mach({ id: '1', number: 'A', codes: [{ value: 'A' }] });
    const liste = [eigen, mach({ id: '2', number: 'A', codes: [{ value: 'A' }], archived: true })];
    expect(doppelte(liste, eigen)).toEqual([]);
  });

  it('sagt es in einem Satz', () => {
    expect(doppelteSatz([])).toBeNull();
    expect(doppelteSatz([mach({ shop: 'Coop' })])).toContain('Coop');
    expect(doppelteSatz([mach({}), mach({})])).toContain('2 Gutscheine');
  });
});

// ── Anfrage beim Laden (Punkt 459) ─────────────────────────────────────────

describe('Wenn die Karte weg ist', () => {
  it('stellt zusammen, was der Laden hören will', () => {
    const entry: Gutschein = {
      id: 'g1',
      shop: 'Ochsner Sport',
      unit: 'chf',
      total: 100,
      left: 40,
      number: 'ABC-1',
      pin: '9999',
      created: '2030-02-01T09:00:00',
      expires: '2031-06-30',
      shared: 'familie',
      file: { name: 'Gutschein.pdf', url: '/x', type: 'application/pdf', bytes: 100 },
      transactions: [{ at: '2030-03-05T10:00:00', amount: 60, by: 'Stefan', art: 'abzug' }],
    };
    const text = ladenAnfrage(entry, '2030-09-11');
    expect(text).toContain('Ochsner Sport');
    expect(text).toContain('Nummer: ABC-1');
    expect(text).toContain('Offen laut unserer Aufstellung: 40.00 CHF');
    expect(text).toContain('Erfasst am 01.02.2030');
    expect(text).toContain('Zuletzt eingelöst am 05.03.2030 über 60.00 CHF');
    expect(text).toContain('Beleg: Gutschein.pdf (liegt bei)');
    expect(text).toContain('Stand: 11.09.2030');
    // Nummer und PIN zusammen sind Bargeld - und das hier geht in eine Mail.
    expect(text).not.toContain('9999');
  });

  it('sagt auch, wenn noch nie eingelöst wurde', () => {
    const entry: Gutschein = {
      shop: 'Coop',
      unit: 'chf',
      total: 50,
      left: 50,
      expires: null,
      shared: 'familie',
    };
    expect(ladenAnfrage(entry, '2030-09-11')).toContain('Bisher nicht eingelöst');
    expect(ladenAnfrage(entry, '2030-09-11')).toContain('Unbegrenzt gültig');
  });
});

describe('mehrere Belege (Punkt 520)', () => {
  const pdf = { url: '/api/family/vouchers/1/datei?v=a', name: 'Gutschein.pdf', bytes: 1000 };
  const txt = { url: '/api/family/vouchers/1/datei?f=ab12&v=b', name: 'Bestellung.txt', id: 'ab12' };

  test('anhaenge nimmt die Liste, sonst den einen file', () => {
    expect(anhaenge({ files: [pdf, txt] })).toEqual([pdf, txt]);
    expect(anhaenge({ file: pdf })).toEqual([pdf]);
    expect(anhaenge({ file: null })).toEqual([]);
  });

  test('anhaengeSatz zählt ab zwei', () => {
    expect(anhaengeSatz([])).toBe('');
    expect(anhaengeSatz([pdf])).toBe('Gutschein.pdf, 1000 B');
    expect(anhaengeSatz([pdf, txt])).toBe('2 Belege: Gutschein.pdf, Bestellung.txt');
  });

  test('alsDateien liest die Liste mit Kennung und fällt auf file zurück', () => {
    expect(alsDateien([pdf, txt, 'quatsch'])).toEqual([
      { url: pdf.url, name: 'Gutschein.pdf', bytes: 1000 },
      { url: txt.url, name: 'Bestellung.txt', id: 'ab12' },
    ]);
    expect(alsDateien(undefined, pdf)).toEqual([{ url: pdf.url, name: 'Gutschein.pdf', bytes: 1000 }]);
    expect(alsGutschein({ shop: 'Brack', total: 100, files: [pdf, txt] }).files).toHaveLength(2);
  });

  test('das Formular führt die Liste und spiegelt den ersten in file', () => {
    const form = { ...formularVon({ ...brack, files: [pdf, txt] }), total: '100' };
    expect(form.files).toEqual([pdf, txt]);
    const ergebnis = formularPruefen(form, brack);
    expect(ergebnis.eintrag?.files).toEqual([pdf, txt]);
    expect(ergebnis.eintrag?.file).toEqual(pdf);
    const ohne = formularPruefen({ ...form, files: [] }, brack);
    expect(ohne.eintrag?.file).toBeNull();
    expect(ohne.eintrag?.files).toEqual([]);
  });
});
