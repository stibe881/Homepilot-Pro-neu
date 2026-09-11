import { Entity } from '../api/types';
import {
  addableButtons,
  darfDirekt,
  direktMoeglich,
  mitDirekt,
  resolveButtons,
  standardDirekt,
} from './widgetButtons';


describe('Warum ein Widget-Knopf nicht schaltet', () => {
  /**
   * Der gemeldete Fall: «Mit den Widgets steuert man nichts, es öffnet
   * sich nur die App.» Beides konnte zutreffen – der Knopf durfte nicht,
   * oder der Hausstand war aus. Unterschieden hat die App es nicht, und
   * gesagt hat sie gar nichts.
   */
  const lampe: Entity = {
    id: 'hue.wohnzimmer',
    kind: 'light',
    name: 'Licht Wohnzimmer',
    integration: 'hue',
    state: { state: 'off' },
    commands: ['toggle'],
  } as Entity;

  const tuer: Entity = {
    id: 'nuki.haustuer',
    kind: 'lock',
    name: 'Haustüre',
    integration: 'nuki',
    state: { state: 'locked' },
    commands: ['unlock', 'open_door'],
  } as Entity;

  it('geht bei einem Licht, sobald der Hausstand an ist', () => {
    expect(direktMoeglich('entity:hue.wohnzimmer', [lampe], true)).toBe('geht');
  });

  it('nennt den fehlenden Hausstand beim Namen', () => {
    expect(direktMoeglich('entity:hue.wohnzimmer', [lampe], false)).toBe('kein-hausstand');
  });

  it('nennt beim Schloss die Rückfrage als Grund – nicht «geht nicht»', () => {
    // Der gemeldete Fall die zweite: zwei Schlösser auf dem Widget,
    // jeder Tipp öffnete nur die App. Der Grund war die Tür-Rückfrage,
    // und die App soll ihn beim Namen nennen können.
    expect(direktMoeglich('entity:nuki.haustuer', [tuer], true)).toBe('rueckfrage');
    expect(direktMoeglich('entity:nuki.haustuer', [tuer], true, true)).toBe('geht');
    // «Alles aus» bleibt endgültig verboten, das ist keine Rückfrage-Sache.
    expect(direktMoeglich('alloff', [tuer], true, true)).toBe('nicht-erlaubt');
  });

  it('nimmt ohne eigene Wahl alles, was darf', () => {
    expect(
      standardDirekt(['entity:hue.wohnzimmer', 'entity:nuki.haustuer'], [lampe, tuer])
    ).toEqual(['entity:hue.wohnzimmer']);
    // Ohne Rückfrage rutscht das Schloss in die Vorgabe mit hinein.
    expect(
      standardDirekt(['entity:hue.wohnzimmer', 'entity:nuki.haustuer'], [lampe, tuer], true)
    ).toEqual(['entity:hue.wohnzimmer', 'entity:nuki.haustuer']);
    // Szenen dürfen immer.
    expect(standardDirekt(['scene:kino'], [])).toEqual(['scene:kino']);
  });
});

// ── Die Anlage am Widget und im Auto (Punkt 486) ───────────────────────────

describe('Scharf schalten geht direkt, unscharf nie', () => {
  it('lässt «Scharf» selbst schalten und «Alarm» den Umweg gehen', () => {
    expect(darfDirekt('alarm_arm', [])).toBe(true);
    // Unscharf am Widget hiesse: Wer das Telefon vom Tisch nimmt, hebt
    // die Anlage auf, ohne es zu entsperren.
    expect(darfDirekt('alarm', [])).toBe(false);
  });

  it('schaltet in den Modus, in dem man gerade weggeht', () => {
    const [knopf] = mitDirekt(
      resolveButtons(['alarm_arm'], [], []),
      ['alarm_arm'],
      [],
      true
    );
    expect(knopf.direct).toBe(true);
    expect(knopf.actionPath).toBe('/api/alarm/arm');
    expect(JSON.parse(knopf.actionBody as string)).toEqual({ mode: 'ausser_haus' });
  });

  it('steht als eigener Knopf zur Auswahl', () => {
    const angebot = addableButtons([], [], []).map((knopf) => knopf.key);
    expect(angebot).toContain('alarm_arm');
    expect(angebot).toContain('alarm');
  });
});
