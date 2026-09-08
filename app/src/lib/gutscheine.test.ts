/**
 * Gutscheine (Punkt 264): Texte, Reihenfolge, der Abzug.
 *
 * Der Fall: Ein Brack-Gutschein über 100 Franken, von dem 20 gebraucht
 * sind, und die Frage «wie viel ist noch drauf, und bis wann?».
 */
import {
  Gutschein,
  ablaufSatz,
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
  dateiSymbol,
  formularPruefen,
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
  verlauf,
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
    expect(neu.transactions?.[1]).toEqual({ at: jetzt.toISOString(), amount: 30, by: 'Sandra' });
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
    const angehaengt = formularPruefen({ ...formularVon(brack), file: neu }, brack);
    expect(angehaengt.eintrag?.file).toEqual(neu);
    // Entfernen heisst null, nicht «Feld weglassen» - sonst behält der
    // Hub die alte Datei.
    const weg = formularPruefen({ ...formularVon({ ...brack, file: beleg }), file: null }, brack);
    expect(weg.eintrag?.file).toBeNull();
    // Und wer nie eine anhängt, schickt auch null.
    expect(formularPruefen(leeresFormular2(), null).eintrag?.file).toBeNull();
  });
});

/** Ein gültiges leeres Formular – der Laden und der Wert sind Pflicht. */
function leeresFormular2() {
  return { ...leeresFormular(), shop: 'Coop', total: '20' };
}
