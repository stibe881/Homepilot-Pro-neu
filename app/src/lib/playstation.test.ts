/**
 * Die PlayStation 5 in der App (Punkt 634) - was sich ohne Konsole
 * entscheiden lässt: Erkennung, Tasten, Kopplungsschritte, Codes.
 */
import type { Entity } from '../api/types';
import {
  KOPPLUNGS_TEXTE,
  PIN_LAENGE,
  PS_REIHE,
  PS_SYMBOLTASTEN,
  adresseBrauchbar,
  adresseSauber,
  istPlaystation,
  kopplungsSchritt,
  pinSauber,
  pinVollstaendig,
  psKopf,
  psTasten,
  psZustand,
} from './playstation';
import { GLEICHBEDEUTEND, SYMBOL } from './symbole';

const konsole = (state: Record<string, unknown> = {}, extra: Partial<Entity> = {}): Entity =>
  ({
    id: 'playstation.192_168_1_60',
    kind: 'media_player',
    name: 'PlayStation 5',
    integration: 'playstation',
    state: { state: 'on', has_screen: true, apps: [], ...state },
    commands: ['turn_on', 'turn_off', 'toggle', 'dpad_up', 'ok', 'back', 'home', 'cross', 'circle'],
    available: true,
    ...extra,
  }) as unknown as Entity;

describe('istPlaystation', () => {
  it('erkennt die Konsole an der Integration', () => {
    expect(istPlaystation(konsole())).toBe(true);
  });

  it('erkennt sie auch am Kreuz, wenn die Integration anders heisst', () => {
    // Wie isTelevision: Die Befehle verraten das Gerät - `cross` kennt
    // sonst nichts im Haus.
    expect(istPlaystation(konsole({}, { integration: 'demo' }))).toBe(true);
  });

  it('hält den Fernseher für keinen', () => {
    expect(
      istPlaystation(konsole({}, { integration: 'androidtv', commands: ['dpad_up', 'ok'] }))
    ).toBe(false);
    expect(istPlaystation(konsole({}, { integration: 'demo', commands: undefined }))).toBe(false);
    expect(istPlaystation(null)).toBe(false);
  });
});

describe('Die Tasten der Konsole', () => {
  it('liegen wie auf dem Controller: Dreieck oben, Viereck links, Kreis rechts, Kreuz unten', () => {
    expect(PS_SYMBOLTASTEN.oben.command).toBe('triangle');
    expect(PS_SYMBOLTASTEN.links.command).toBe('square');
    expect(PS_SYMBOLTASTEN.rechts.command).toBe('circle');
    expect(PS_SYMBOLTASTEN.unten.command).toBe('cross');
    expect(PS_REIHE.map((taste) => taste.command)).toEqual(['share', 'ps', 'options']);
  });

  it('schicken genau die Befehle aus dem Vertrag mit dem Hub', () => {
    const vertrag = ['cross', 'circle', 'triangle', 'square', 'options', 'share', 'ps'];
    expect(psTasten().map((taste) => taste.command).sort()).toEqual(vertrag.sort());
  });

  it('halten die Symbolsprache ein', () => {
    // Die Zeichen stehen als Daten und nicht als `name=` in einer Datei
    // - der Symboltest sähe sie nicht. Also hier: keines der Zeichen
    // ist ein verbotenes Zweitzeichen, und kein Begriff der Sprache
    // wird für etwas anderes benutzt als gemeint (Share ist teilen).
    for (const taste of psTasten()) {
      expect(GLEICHBEDEUTEND[taste.icon]).toBeUndefined();
    }
    expect(PS_REIHE[0].icon).toBe(SYMBOL.teilen);
  });

  it('haben je eine eigene Beschriftung', () => {
    const labels = psTasten().map((taste) => taste.label);
    expect(new Set(labels).size).toBe(labels.length);
  });
});

describe('psKopf und psZustand', () => {
  it('nennt das laufende Spiel', () => {
    expect(psKopf(konsole({ app: 'Gran Turismo 7' }))).toEqual({
      titel: 'PlayStation 5',
      unter: 'Gran Turismo 7',
    });
  });

  it('sagt «Eingeschaltet», wenn kein Spiel läuft', () => {
    expect(psZustand(konsole({ app: null }))).toBe('Eingeschaltet');
  });

  it('unterscheidet Standby von Aus - nur aus dem Standby lässt sie sich wecken', () => {
    expect(psZustand(konsole({ state: 'off', standby: true }))).toBe('Standby');
    expect(psZustand(konsole({ state: 'off', standby: false }))).toBe('Aus');
    expect(psZustand(konsole({ state: 'off' }))).toBe('Aus');
  });

  it('nennt im Aus kein Spiel mehr, auch wenn der letzte Zustand eines mitträgt', () => {
    expect(psZustand(konsole({ state: 'off', standby: true, app: 'Gran Turismo 7' }))).toBe(
      'Standby'
    );
  });

  it('heisst notfalls «PlayStation»', () => {
    expect(psKopf(konsole({}, { name: '  ' })).titel).toBe('PlayStation');
  });
});

describe('kopplungsSchritt', () => {
  it('beginnt beim Konto', () => {
    expect(
      kopplungsSchritt({ account: false, paired: false, online_id: null, remote_play: true })
    ).toBe('konto');
  });

  it('fragt nach dem Konto den Code von der Konsole', () => {
    expect(
      kopplungsSchritt({ account: true, paired: false, online_id: 'stefan', remote_play: true })
    ).toBe('code');
  });

  it('ist fertig, wenn beides da ist', () => {
    expect(
      kopplungsSchritt({ account: true, paired: true, online_id: 'stefan', remote_play: true })
    ).toBe('gekoppelt');
  });

  it('bietet ohne Bibliothek gar nichts an - ein Knopf wäre eine Sackgasse', () => {
    // Die PSN-Anmeldung gehört zur selben Bibliothek wie die Tasten.
    // Ohne sie stünde der Benutzer nach dem Anmelden vor einer Absage,
    // die schon vorher feststand.
    expect(
      kopplungsSchritt({ account: false, paired: false, online_id: null, remote_play: false })
    ).toBe('ohne_bibliothek');
    expect(
      kopplungsSchritt({ account: true, paired: true, online_id: 'x', remote_play: false })
    ).toBe('ohne_bibliothek');
  });

  it('nimmt eine fehlende Antwort als Anfang, nicht als Fehler', () => {
    expect(kopplungsSchritt(null)).toBe('konto');
    expect(kopplungsSchritt({})).toBe('konto');
  });

  it('hat zu jedem Schritt einen Wortlaut', () => {
    for (const schritt of ['ohne_bibliothek', 'konto', 'code', 'gekoppelt'] as const) {
      expect(KOPPLUNGS_TEXTE[schritt].kopf).toBeTruthy();
      expect(KOPPLUNGS_TEXTE[schritt].hinweis).toBeTruthy();
    }
    expect(KOPPLUNGS_TEXTE.code.hinweis).toContain('Remote Play');
  });
});

describe('pinSauber', () => {
  it('nimmt den Code, wie die Konsole ihn zeigt - mit Lücke', () => {
    expect(pinSauber('1234 5678')).toBe('12345678');
    expect(pinSauber(' 12-34-56-78 ')).toBe('12345678');
  });

  it('lässt nur Ziffern und nicht mehr als acht', () => {
    // Anders als der Fernseher-Code: keine Buchstaben.
    expect(pinSauber('12ab34')).toBe('1234');
    expect(pinSauber('1234567890')).toBe('12345678');
    expect(pinSauber('')).toBe('');
  });
});

describe('pinVollstaendig', () => {
  it('lässt erst bei acht Ziffern koppeln', () => {
    expect(PIN_LAENGE).toBe(8);
    expect(pinVollstaendig('1234567')).toBe(false);
    expect(pinVollstaendig('1234 5678')).toBe(true);
  });
});

describe('Die Rückkehr-Adresse', () => {
  const rueckkehr = 'https://remoteplay.dl.playstation.net/remoteplay/redirect?code=abc123&cid=xyz';

  it('kommt ohne die Leerzeichen des Kopierens beim Hub an', () => {
    expect(adresseSauber(`  ${rueckkehr}\n`)).toBe(rueckkehr);
  });

  it('erkennt die Rückkehr-Seite am Code darin', () => {
    expect(adresseBrauchbar(rueckkehr)).toBe(true);
    expect(adresseBrauchbar(` ${rueckkehr} `)).toBe(true);
  });

  it('weist die Anmeldeseite ab - die hat keinen Code', () => {
    // Der naheliegende Fehler: die Adresse kopieren, auf der man sich
    // angemeldet hat, statt die der Seite danach.
    expect(adresseBrauchbar('https://auth.api.sonyentertainmentnetwork.com/login')).toBe(false);
    expect(adresseBrauchbar('code=abc')).toBe(false);
    expect(adresseBrauchbar('')).toBe(false);
  });
});
