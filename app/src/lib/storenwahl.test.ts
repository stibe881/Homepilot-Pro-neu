/** Die Storen-Auswahl der Wächter-Regeln. */

import {
  dabei,
  fuehlerDabei,
  fuehlerSatz,
  fuehlerUmschalten,
  storenSatz,
  umschalten,
} from './storenwahl';

const COVERS = [
  { id: 'c.1', name: 'Stube West' },
  { id: 'c.2', name: 'Küche' },
  { id: 'c.3', name: 'Schlafzimmer' },
];

describe('storenSatz', () => {
  it('leer heisst alle - und sagt das auch', () => {
    expect(storenSatz([], COVERS)).toBe('Alle 3 Storen.');
    expect(storenSatz([], [COVERS[0]])).toBe('Die eine Store des Hauses.');
    expect(storenSatz([], [])).toBe('Keine Storen im Haus gefunden.');
  });

  it('nennt die gewaehlten beim namen', () => {
    expect(storenSatz(['c.2'], COVERS)).toBe('Küche');
    expect(storenSatz(['c.1', 'c.2', 'c.3', 'c.x'], COVERS)).toBe(
      'Stube West, Küche, Schlafzimmer und 1 weitere'
    );
  });
});

describe('umschalten', () => {
  it('abwaehlen bei «alle» heisst: alle ausser diesem', () => {
    expect(umschalten([], 'c.2', COVERS)).toEqual(['c.1', 'c.3']);
  });

  it('der letzte haken zurueck ergibt wieder die leere liste', () => {
    // Als leer gespeichert, damit ein später dazugebauter Storen von
    // selbst mitmacht.
    expect(umschalten(['c.1', 'c.3'], 'c.2', COVERS)).toEqual([]);
  });

  it('den allerletzten haken gibt es nicht herzugeben', () => {
    // «Keine Storen» ist kein Zustand - dafür gibt es den Regelschalter.
    expect(umschalten(['c.1'], 'c.1', COVERS)).toEqual(['c.1']);
  });

  it('mittendrin wird schlicht umgeschaltet', () => {
    expect(umschalten(['c.1', 'c.2'], 'c.2', COVERS)).toEqual(['c.1']);
    expect(dabei([], 'c.9')).toBe(true);
    expect(dabei(['c.1'], 'c.2')).toBe(false);
  });
});

// ── Die Fühler des Hitze-Hinweises (Punkt 540) ────────────────────────
//
// Gemeldet mit einem Bild der Push «Drinnen wird es warm»: «Es sollen
// nicht alle Sensoren berücksichtigt werden.» Gemittelt wurde über
// jeden Fühler mit einem Raum - auch den im Serverschrank.

const fuehler = [
  { id: 's.stube', name: 'Stube', room: 'Wohnzimmer' },
  { id: 's.kueche', name: 'Küche', room: 'Küche' },
  { id: 's.rack', name: 'Serverschrank', room: 'Büro' },
];

describe('fuehlerSatz', () => {
  it('sagt bei der Temperatur, dass ohne Wahl alle gelten', () => {
    // Sonst käme der Hinweis ohne jede Einstellung nie - und niemand
    // wüsste, warum.
    expect(fuehlerSatz([], fuehler, 'temp')).toBe('Alle 3 Fühler im Mittel.');
    expect(fuehlerSatz([], [fuehler[0]], 'temp')).toBe('Der eine Fühler des Hauses.');
  });

  it('sagt bei der Feuchte, dass ohne Wahl gar keine dasteht', () => {
    // Die andere Vorgabe, und sie muss dastehen: Bisher nannte die
    // Nachricht keine Feuchte, und das bleibt ohne Zutun so.
    expect(fuehlerSatz([], fuehler, 'humidity')).toBe(
      'Keiner – die Nachricht nennt keine Feuchte.'
    );
  });

  it('nennt die gewählten beim Namen und kürzt ab vier', () => {
    expect(fuehlerSatz(['s.stube', 's.kueche'], fuehler, 'temp')).toBe('Stube, Küche');
    const viele = [...fuehler, { id: 's.bad', name: 'Bad' }];
    expect(fuehlerSatz(viele.map((e) => e.id), viele, 'temp')).toBe(
      'Stube, Küche, Serverschrank und 1 weitere'
    );
  });

  it('schweigt, wo es drinnen gar keinen Fühler gibt', () => {
    expect(fuehlerSatz([], [], 'temp')).toBe('Kein Temperaturfühler drinnen gefunden.');
    expect(fuehlerSatz([], [], 'humidity')).toBe('Kein Feuchtefühler drinnen gefunden.');
  });
});

describe('fuehlerUmschalten', () => {
  it('hakt an und wieder ab - ohne die «leer heisst alle»-Umkehr', () => {
    // Bei den Storen wird aus «alle ausser diesem» eine Liste aller
    // übrigen. Hier nicht: Wer genau einen Fühler will - den in der
    // Stube -, soll ihn anhaken können und fertig.
    expect(fuehlerUmschalten([], 's.stube')).toEqual(['s.stube']);
    expect(fuehlerUmschalten(['s.stube'], 's.kueche')).toEqual(['s.stube', 's.kueche']);
    expect(fuehlerUmschalten(['s.stube', 's.kueche'], 's.stube')).toEqual(['s.kueche']);
  });

  it('lässt auch den letzten Haken los', () => {
    // Bei den Storen wäre «keine» kein Zustand. Hier schon: zurück auf
    // die Vorgabe - alle im Mittel bzw. keine Feuchte.
    expect(fuehlerUmschalten(['s.stube'], 's.stube')).toEqual([]);
  });
});

describe('fuehlerDabei', () => {
  it('zählt leer nicht als «alle angehakt»', () => {
    // Der Unterschied zu `dabei` bei den Storen - dort heisst leer
    // «alle». Ein Häkchen an jedem Fühler wäre hier gelogen.
    expect(fuehlerDabei([], 's.stube')).toBe(false);
    expect(dabei([], 's.stube')).toBe(true);
    expect(fuehlerDabei(['s.stube'], 's.stube')).toBe(true);
  });
});

describe('Ein Hub, der die Fühlerwahl noch nicht kennt', () => {
  it('bringt die Regelliste nicht zum Absturz', () => {
    // Genau so passiert, beim Ansehen im Browser: Der laufende Demo-Hub
    // war älter als die App, schickte `temp_sensors` gar nicht - und
    // statt der Regeln stand da «Cannot read properties of undefined
    // (reading 'length')».
    expect(fuehlerSatz(undefined, undefined, 'temp')).toBe(
      'Kein Temperaturfühler drinnen gefunden.'
    );
    expect(fuehlerDabei(undefined, 's.stube')).toBe(false);
    expect(fuehlerUmschalten(undefined, 's.stube')).toEqual(['s.stube']);
  });
});

