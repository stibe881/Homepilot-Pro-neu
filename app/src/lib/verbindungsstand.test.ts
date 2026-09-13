import {
  CODE_ABGEMELDET,
  CODE_FENSTER_ZU,
  VERBINDUNGSWORT,
  WARTEZEIT_MAX_MS,
  nachSchliessen,
  pausenSatz,
  pongAusgeblieben,
  verbindungsAnsage,
  verbindungsZusatz,
  wartezeit,
} from './verbindungsstand';

describe('pongAusgeblieben', () => {
  // Punkt 592 der Werkbank: Das iPad im Flur geht nie in den Hintergrund.
  // Nach einem Neustart des Accesspoints blieb sein Socket halboffen -
  // der Punkt grün, der Stand alt, nie neu verbunden.
  it('meldet den toten Socket, wenn nach dem Ping kein Pong kam', () => {
    expect(pongAusgeblieben(1_000_000, null)).toBe(true);
    // Ein Pong von vor dem Ping hat eine frühere Frage beantwortet.
    expect(pongAusgeblieben(1_000_000, 999_000)).toBe(true);
  });

  it('ist zufrieden, sobald ein Pong nach dem Ping da ist', () => {
    expect(pongAusgeblieben(1_000_000, 1_000_050)).toBe(false);
    expect(pongAusgeblieben(1_000_000, 1_000_000)).toBe(false);
  });
});

describe('nachSchliessen', () => {
  // Punkt 579 der Werkbank: Ein unter «Meine Geräte» beendetes iPad
  // verband in Endlosschleife neu und sagte «Keine Verbindung», obwohl
  // der Hub erreichbar war und gerade 4401 geantwortet hatte.
  it('gibt nach 4401 auf, statt weiter anzuklopfen', () => {
    expect(nachSchliessen(CODE_ABGEMELDET, 'Ungültiges Token', 3, 1_000_000)).toEqual({
      status: 'signed_out',
      wiederAb: null,
    });
  });

  it('verbindet nach einem gewöhnlichen Abbruch mit wachsender Wartezeit neu', () => {
    expect(nachSchliessen(1006, '', 0, 1_000_000)).toEqual({
      status: 'disconnected',
      wiederAb: 1_001_000,
    });
    expect(nachSchliessen(1000, '', 2, 1_000_000).wiederAb).toBe(1_004_000);
    // Ohne Code (ein von der App selbst geschlossener Socket) dasselbe.
    expect(nachSchliessen(undefined, undefined, 0, 1_000_000).status).toBe('disconnected');
  });

  // Punkt 624 der Werkbank: Das Kind um 20:01 sah ein kaputtes Haus,
  // nicht «Feierabend» - der Hub sagte «Ungültiges Token», die App
  // verband im Takt weiter.
  it('pausiert nach 4403 bis zur Zeit im Grund', () => {
    const morgen = new Date(2026, 8, 14, 7, 0);
    const jetzt = new Date(2026, 8, 13, 20, 1).getTime();
    const schritt = nachSchliessen(CODE_FENSTER_ZU, '2026-09-14T07:00', 0, jetzt);
    expect(schritt.status).toBe('paused');
    expect(schritt.wiederAb).toBe(morgen.getTime());
  });

  it('versucht es in einer Minute wieder, wenn die Zeit unlesbar oder vorbei ist', () => {
    const jetzt = new Date(2026, 8, 13, 20, 1).getTime();
    expect(nachSchliessen(CODE_FENSTER_ZU, 'quatsch', 0, jetzt).wiederAb).toBe(jetzt + 60_000);
    expect(nachSchliessen(CODE_FENSTER_ZU, '1999-01-01T07:00', 0, jetzt).wiederAb).toBe(
      jetzt + 60_000
    );
  });
});

describe('pausenSatz', () => {
  it('nennt die Uhrzeit, ab der es weitergeht', () => {
    const jetzt = new Date(2026, 8, 13, 20, 1).getTime();
    expect(pausenSatz(new Date(2026, 8, 14, 7, 0).getTime(), jetzt)).toBe(
      "Gute Nacht - ab 07:00 geht's weiter."
    );
  });

  it('nennt das Datum, wenn es mehr als einen Tag dauert', () => {
    // Die Putzhilfe am Freitag: «ab 08:00» hiesse sonst morgen früh.
    const freitag = new Date(2026, 7, 21, 12, 0).getTime();
    expect(pausenSatz(new Date(2026, 7, 27, 8, 0).getTime(), freitag)).toBe(
      "Gute Nacht - ab 27.08. 08:00 geht's weiter."
    );
  });

  it('bleibt ohne Zeit bei einem ruhigen Satz', () => {
    expect(pausenSatz(null, 0)).toBe('Gerade ausserhalb der Zugangszeit.');
  });

  it('wartet nie länger als die Obergrenze', () => {
    expect(wartezeit(10)).toBe(WARTEZEIT_MAX_MS);
    expect(wartezeit(0)).toBe(1000);
  });
});

describe('verbindungsZusatz', () => {
  it('schreibt neben den Punkt nichts, solange nichts wartet', () => {
    // Der Grund für die ganze Änderung: «verbunden» stand fast immer
    // da und sagte dasselbe wie der grüne Punkt daneben.
    expect(verbindungsZusatz(0)).toBe('');
    expect(verbindungsZusatz(-1)).toBe('');
  });

  it('nennt die wartenden Befehle - die sagt sonst niemand', () => {
    // Ohne diese Zahl ist ein Tipp im Funkloch nicht von einem
    // verschluckten Befehl zu unterscheiden.
    expect(verbindungsZusatz(1)).toBe('1 wartet');
    expect(verbindungsZusatz(3)).toBe('3 wartet');
  });
});

describe('verbindungsAnsage', () => {
  it('sagt der Vorlesefunktion, was der Punkt zeigt', () => {
    // Ein farbiger Kreis ohne Beschriftung ist für VoiceOver eine leere
    // Fläche - und für wen Farben schwer zu unterscheiden sind, die
    // einzige Auskunft, die er nicht bekommt.
    expect(verbindungsAnsage('connected', 0)).toBe('verbunden');
    expect(verbindungsAnsage('disconnected', 0)).toBe('getrennt');
    expect(verbindungsAnsage('connecting', 0)).toBe(VERBINDUNGSWORT.connecting);
    expect(verbindungsAnsage('signed_out', 0)).toBe('abgemeldet');
  });

  it('nimmt die Wartezahl mit', () => {
    expect(verbindungsAnsage('disconnected', 2)).toBe('getrennt · 2 wartet');
  });
});
