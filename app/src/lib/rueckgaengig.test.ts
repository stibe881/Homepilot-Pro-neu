/**
 * Der Rückzieher – und wo er bewusst schweigt.
 *
 * Lange galt er nur für an, aus und Helligkeit, also für die Griffe, bei
 * denen ein Fehlgriff am wenigsten wehtut. Gerade Storen, Thermostate
 * und Lautstärke sind die, deren alten Wert man hinterher nicht mehr
 * weiss.
 */
import { EntityState } from '../api/types';
import { undoCommand, undoLabel } from './rueckgaengig';

const zustand = (teile: EntityState): EntityState => teile;

describe('undoCommand: Licht und Schalter', () => {
  it('stellt die alte Helligkeit wieder her, nicht die volle', () => {
    expect(
      undoCommand(zustand({ state: 'on', brightness: 30 }), 'turn_off', 'light')
    ).toEqual({ command: 'set_brightness', data: { brightness: 30 } });
  });

  it('schweigt bei unbekanntem Ausgangszustand', () => {
    expect(undoCommand(zustand({ state: 'unknown' }), 'turn_on', 'light')).toBeNull();
  });
});

describe('undoCommand: Storen', () => {
  const store = ['open', 'close', 'stop', 'set_position', 'set_tilt'];

  it('fährt auf die alte Position zurück', () => {
    // «Die Store war vorher irgendwo bei 40» ist keine Angabe, mit der
    // man sie von Hand zurückstellt.
    expect(
      undoCommand(zustand({ state: 'open', position: 40 }), 'close', 'cover', store)
    ).toEqual({ command: 'set_position', data: { position: 40 } });
  });

  it('nimmt auf oder zu, wo es keine Position gibt', () => {
    expect(
      undoCommand(zustand({ state: 'open' }), 'close', 'cover', ['open', 'close'])
    ).toEqual({ command: 'open' });
  });

  it('nimmt die Lamellen für sich zurück', () => {
    expect(
      undoCommand(zustand({ state: 'open', position: 100, tilt: 60 }), 'set_tilt', 'cover', store)
    ).toEqual({ command: 'set_tilt', data: { tilt: 60 } });
  });

  it('bietet nichts an, wo die Store nichts gemeldet hat', () => {
    expect(undoCommand(zustand({ state: 'unknown' }), 'close', 'cover', store)).toBeNull();
  });
});

describe('undoCommand: nur in die sichere Richtung', () => {
  it('nimmt ein Aufschliessen zurück', () => {
    expect(undoCommand(zustand({ state: 'locked' }), 'unlock', 'lock')).toEqual({
      command: 'lock',
    });
  });

  it('bietet aber kein Aufschliessen an', () => {
    // Ein Band unter dem Daumen, das die Haustüre öffnet, wäre genau der
    // Knopf, den es hier nicht geben soll.
    expect(undoCommand(zustand({ state: 'unlocked' }), 'lock', 'lock')).toBeNull();
  });

  it('ruft den losgeschickten Sauger zurück, schickt ihn aber nie los', () => {
    expect(undoCommand(zustand({ state: 'docked' }), 'start', 'vacuum')).toEqual({
      command: 'dock',
    });
    expect(undoCommand(zustand({ state: 'cleaning' }), 'dock', 'vacuum')).toBeNull();
  });
});

describe('undoCommand: Zahlen, die man sich nicht merkt', () => {
  it('stellt die alte Zieltemperatur zurück', () => {
    expect(
      undoCommand(zustand({ state: 'on', target: 21 }), 'set_temperature', 'climate')
    ).toEqual({ command: 'set_temperature', data: { temperature: 21 } });
  });

  it('stellt die alte Lautstärke zurück', () => {
    expect(
      undoCommand(zustand({ state: 'playing', volume: 12 }), 'set_volume', 'media_player')
    ).toEqual({ command: 'set_volume', data: { volume: 12 } });
  });
});

describe('undoLabel', () => {
  it('sagt bei Storen die Richtung', () => {
    expect(undoLabel(zustand({ state: 'open' }), 'close', undefined, 'cover')).toBe(
      'heruntergefahren'
    );
    expect(
      undoLabel(zustand({ state: 'open', position: 20 }), 'set_position', { position: 80 }, 'cover')
    ).toBe('hochgefahren');
  });

  it('nennt Temperatur und Lautstärke beim Namen', () => {
    expect(undoLabel(zustand({ state: 'on' }), 'set_temperature', {}, 'climate')).toBe(
      'Temperatur gestellt'
    );
    expect(undoLabel(zustand({ state: 'on' }), 'set_volume', {}, 'media_player')).toBe(
      'Lautstärke gestellt'
    );
  });

  it('liest den Umschalter am Zustand von vorher ab', () => {
    expect(undoLabel(zustand({ state: 'on' }), 'toggle')).toBe('ausgeschaltet');
    expect(undoLabel(zustand({ state: 'off' }), 'toggle')).toBe('eingeschaltet');
  });

  it('nennt Dimmen auf 0 beim richtigen Namen', () => {
    expect(undoLabel(zustand({ state: 'on' }), 'set_brightness', { brightness: 0 })).toBe(
      'ausgeschaltet'
    );
  });
});
