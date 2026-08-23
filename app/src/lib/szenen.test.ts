/**
 * Der Szenen-Schnappschuss und seine Umkehrung.
 *
 * Der Fall dahinter: Die Szene «Kino» – gedimmt auf 15 % – liess sich in
 * der App nicht bauen, weil der Schnappschuss nur an/aus einsammelte.
 */
import { Entity } from '../api/types';
import {
  PRIVATSPHAERE_AUS,
  PRIVATSPHAERE_EIN,
  STUMM_AUS,
  STUMM_EIN,
  musikBefehl,
  musikSchluessel,
  szenenFuerKachel,
  richtungBefehl,
  richtungSchluessel,
  sceneActionsToDraft,
  snapshotAction,
  snapshotCommand,
} from './szenen';

const licht = (state: Entity['state'], commands: string[]): Entity =>
  ({
    id: 'hue.stehlampe',
    kind: 'light',
    name: 'Stehlampe',
    integration: 'hue',
    state,
    commands,
    available: true,
    room: 'Wohnzimmer',
  }) as Entity;

describe('snapshotAction', () => {
  it('nimmt die Helligkeit mit, nicht nur «an»', () => {
    const action = snapshotAction(
      licht({ state: 'on', brightness: 15 }, ['turn_on', 'turn_off', 'set_brightness'])
    );
    expect(action.command).toBe('set_brightness');
    expect(action.brightness).toBe(15);
  });

  it('nimmt die Farbe mit, wenn das Licht eine hat', () => {
    const action = snapshotAction(
      licht({ state: 'on', brightness: 40, color: '#FF8800' }, [
        'turn_on',
        'set_brightness',
        'set_color',
      ])
    );
    expect(action.color).toBe('#FF8800');
  });

  it('bleibt bei an/aus, wo es nichts zu dimmen gibt', () => {
    expect(snapshotAction(licht({ state: 'on' }, ['turn_on', 'turn_off'])).command).toBe(
      'turn_on'
    );
    expect(
      snapshotAction(licht({ state: 'off', brightness: 40 }, ['turn_on', 'set_brightness']))
        .command
    ).toBe('turn_off');
  });

  it('macht aus dem aktuellen Alarm-Modus den passenden Befehl', () => {
    const alarm = (state: Entity['state']) =>
      ({
        id: 'alarm.haus',
        kind: 'alarm',
        name: 'Alarmanlage',
        integration: 'alarm',
        state,
        commands: ['arm_night', 'arm_away', 'arm_vacation', 'disarm'],
        available: true,
      }) as Entity;
    expect(snapshotCommand(alarm({ state: 'unscharf' }))).toBe('disarm');
    expect(snapshotCommand(alarm({ state: 'scharf', mode: 'nacht' }))).toBe('arm_night');
    expect(snapshotCommand(alarm({ state: 'scharf', mode: 'urlaub' }))).toBe('arm_vacation');
  });
});

describe('sceneActionsToDraft', () => {
  it('liest die Werte aus data zurück – die Position ging vorher verloren', () => {
    const draft = sceneActionsToDraft([
      { entity_id: 'overkiz.store', command: 'set_position', data: { position: 50 } },
      { entity_id: 'hue.stehlampe', command: 'set_brightness', data: { brightness: 15 } },
    ]);
    expect(draft[0].position).toBe(50);
    expect(draft[1].brightness).toBe(15);
  });

  it('hängt die set_color-Zeile zurück an ihr Licht', () => {
    const draft = sceneActionsToDraft([
      { entity_id: 'hue.stehlampe', command: 'set_brightness', data: { brightness: 15 } },
      { entity_id: 'hue.stehlampe', command: 'set_color', data: { color: '#FF8800' } },
    ]);
    // Ein Eintrag, nicht zwei – sonst stünde das Licht doppelt in der Liste.
    expect(draft).toHaveLength(1);
    expect(draft[0].color).toBe('#FF8800');
  });
});

// ── Kameras in einer Szene ───────────────────────────────────────────────
// Der Fall: «eine Szene, bei der die Kamera die Privatsphäre aktiviert und
// Musik läuft». Kameras standen gar nicht in der Geräteliste – sie fielen
// durch ein Sieb aus Gerätearten, das von Hand gepflegt wurde.

describe('Privatsphäre der Kamera', () => {
  it('macht aus den zwei Chips einen Befehl mit Richtung', () => {
    expect(richtungBefehl(PRIVATSPHAERE_EIN)).toEqual({
      command: 'set_privacy',
      data: { enabled: true },
    });
    expect(richtungBefehl(PRIVATSPHAERE_AUS)).toEqual({
      command: 'set_privacy',
      data: { enabled: false },
    });
  });

  it('lässt jeden anderen Befehl in Ruhe', () => {
    expect(richtungBefehl('turn_on')).toBeNull();
    expect(richtungBefehl('set_privacy')).toBeNull();
  });

  it('liest den gespeicherten Befehl wieder als Chip', () => {
    expect(richtungSchluessel('set_privacy', { enabled: true })).toBe(PRIVATSPHAERE_EIN);
    expect(richtungSchluessel('set_privacy', { enabled: false })).toBe(PRIVATSPHAERE_AUS);
  });

  it('nimmt ohne Angabe «ein» an, damit ein Chip leuchtet', () => {
    // Eine Szene ohne markierten Zielzustand sähe aus, als wäre die
    // Kamera versehentlich drin.
    expect(richtungSchluessel('set_privacy', undefined)).toBe(PRIVATSPHAERE_EIN);
  });

  it('fasst fremde Befehle nicht an', () => {
    expect(richtungSchluessel('turn_on', { enabled: true })).toBeNull();
  });

  it('kommt beim Bearbeiten einer gespeicherten Szene richtig zurück', () => {
    const zurueck = sceneActionsToDraft([
      { entity_id: 'unifi.kueche', command: 'set_privacy', data: { enabled: true } },
      { entity_id: 'cast.wohnzimmer', command: 'play' },
    ]);
    expect(zurueck.map((a) => a.command)).toEqual([PRIVATSPHAERE_EIN, 'play']);
  });

  it('hält den Ist-Zustand der Kamera fest', () => {
    const kamera = (privacy: string) =>
      ({
        id: 'unifi.kueche',
        name: 'Küche',
        kind: 'camera',
        integration: 'unifi_protect',
        commands: ['set_privacy'],
        state: { state: 'online', privacy },
      }) as unknown as Parameters<typeof snapshotCommand>[0];
    expect(snapshotCommand(kamera('on'))).toBe(PRIVATSPHAERE_EIN);
    expect(snapshotCommand(kamera('off'))).toBe(PRIVATSPHAERE_AUS);
  });
});


// ── Lautsprecher können mehr als an und aus ──────────────────────────────
// Für eine Szene «Kino» fehlten Lautstärke und was gespielt wird. Beides
// kann der Hub längst; die Auswahl bot es nur nicht an.

describe('Stumm-Schalter', () => {
  it('macht aus den zwei Chips einen Befehl mit Richtung', () => {
    expect(richtungBefehl(STUMM_EIN)).toEqual({ command: 'mute', data: { muted: true } });
    expect(richtungBefehl(STUMM_AUS)).toEqual({ command: 'mute', data: { muted: false } });
  });

  it('liest ihn wieder als Chip zurück', () => {
    expect(richtungSchluessel('mute', { muted: false })).toBe(STUMM_AUS);
    expect(richtungSchluessel('mute', { muted: true })).toBe(STUMM_EIN);
    // Ohne Angabe «stumm»: Wer den Schalter in eine Szene nimmt, will
    // fast immer stumm schalten.
    expect(richtungSchluessel('mute', undefined)).toBe(STUMM_EIN);
  });

  it('verwechselt die beiden Schalter nicht', () => {
    expect(richtungSchluessel('mute', { enabled: false })).toBe(STUMM_EIN);
    expect(richtungSchluessel('set_privacy', { muted: false })).toBe(PRIVATSPHAERE_EIN);
  });
});

describe('Lautstärke, Playlist und App beim Bearbeiten', () => {
  it('holt die Werte aus den gespeicherten Daten zurück', () => {
    const zurueck = sceneActionsToDraft([
      { entity_id: 'cast.stube', command: 'set_volume', data: { volume: 25 } },
      { entity_id: 'spotify.x', command: 'play_playlist', data: { name: 'Sonntagmorgen' } },
      { entity_id: 'tv.stube', command: 'launch_app', data: { app: 'com.netflix.ninja' } },
    ]);
    expect(zurueck[0].volume).toBe(25);
    // Beim Hub heisst das Feld 'name'; im Entwurf 'playlist', damit es
    // nicht mit dem Namen der Szene verwechselt wird.
    expect(zurueck[1].playlist).toBe('Sonntagmorgen');
    expect(zurueck[2].app).toBe('com.netflix.ninja');
  });
});

describe('Ziel-Box einer Playlist', () => {
  it('kommt beim Bearbeiten wieder zurück', () => {
    const zurueck = sceneActionsToDraft([
      {
        entity_id: 'spotify.x',
        command: 'play_playlist',
        data: { name: 'Kochen', device: 'Küche' },
      },
    ]);
    expect(zurueck[0].playlist).toBe('Kochen');
    expect(zurueck[0].device).toBe('Küche');
  });

  it('bleibt leer, wenn keine Box gewählt wurde', () => {
    // Dann spielt sie dort, wo zuletzt Musik lief – das ist erlaubt,
    // aber es soll nicht so aussehen, als stünde eine Box fest.
    const zurueck = sceneActionsToDraft([
      { entity_id: 'spotify.x', command: 'play_playlist', data: { name: 'Kochen' } },
    ]);
    expect(zurueck[0].device).toBeUndefined();
  });
});

describe('Szenen auf der Raumkachel', () => {
  const geraet = (id: string, room: string): Entity =>
    ({
      id,
      kind: 'light',
      name: id,
      integration: 'x',
      state: {},
      commands: [],
      room,
      available: true,
    }) as Entity;
  const szene = (id: string, room: string | null, ids: string[] = []) => ({
    id,
    name: id,
    room,
    entity_ids: ids,
  });

  const geraete = [geraet('hue.stube', 'Wohnzimmer'), geraet('hue.kueche', 'Küche')];

  it('nimmt zuerst die Szenen, die dem Raum zugeteilt sind', () => {
    // Eine Szene, die bloss ein Gerät im Raum schaltet, ist der
    // schwächere Treffer - sie gehört nicht als Erste auf die Kachel.
    const alle = [
      szene('nebenbei', null, ['hue.stube']),
      szene('kino', 'Wohnzimmer'),
      szene('kueche', 'Küche', ['hue.kueche']),
    ];
    expect(
      szenenFuerKachel(alle, geraete, 'Wohnzimmer').map((s) => s.id)
    ).toEqual(['kino', 'nebenbei']);
  });

  it('zeigt höchstens zwei – eine Kachel ist keine Szenenliste', () => {
    const alle = ['a', 'b', 'c', 'd'].map((id) => szene(id, 'Wohnzimmer'));
    expect(szenenFuerKachel(alle, geraete, 'Wohnzimmer').length).toBe(2);
    expect(szenenFuerKachel(alle, geraete, 'Wohnzimmer', 3).length).toBe(3);
  });

  it('kommt ohne passende Szene aus', () => {
    expect(szenenFuerKachel([szene('x', 'Bad')], geraete, 'Wohnzimmer')).toEqual([]);
    expect(szenenFuerKachel([], geraete, 'Wohnzimmer')).toEqual([]);
  });
});


// ── «Musik an» und was dazugehört ────────────────────────────────────────
// Der Fall: «Wenn man in einem Ablauf oder einer Szene einen Lautsprecher
// wählt und bei dem Musik an, soll man auch die zu spielende Playlist
// auswählen und ob es im Shuffle abspielen soll.» Bis dahin hing die
// Playlist an einem eigenen Chip *neben* «Musik an» – wer «Musik an»
// wählte, sah darunter nichts.

describe('Musik an mit Playlist', () => {
  it('macht aus «Musik an» plus Playlist ein play_playlist', () => {
    expect(musikBefehl('play', { playlist: 'Party' })).toEqual({
      command: 'play_playlist',
      data: { name: 'Party' },
    });
  });

  it('nimmt Ziel-Box und Reihenfolge mit', () => {
    expect(
      musikBefehl('play', { playlist: 'Party', device: 'Küche', shuffle: true })
    ).toEqual({
      command: 'play_playlist',
      data: { name: 'Party', device: 'Küche', shuffle: true },
    });
    expect(musikBefehl('play', { playlist: 'Party', shuffle: false })).toEqual({
      command: 'play_playlist',
      data: { name: 'Party', shuffle: false },
    });
  });

  it('lässt «Musik an» ohne Playlist in Ruhe', () => {
    // «Weiterspielen, was lief» ist eine eigene Antwort, keine halbe.
    expect(musikBefehl('play', {})).toBeNull();
    expect(musikBefehl('play', { playlist: '   ' })).toBeNull();
    expect(musikBefehl('pause', { playlist: 'Party' })).toBeNull();
  });

  it('rührt die Reihenfolge nicht an, solange niemand sie gewählt hat', () => {
    // Sonst stellte eine Szene «Kino» das ganze Konto um, ohne es zu sagen.
    const befehl = musikBefehl('play', { playlist: 'Kino' });
    expect(befehl!.data).toEqual({ name: 'Kino' });
    expect('shuffle' in befehl!.data).toBe(false);
  });

  it('liest ein gespeichertes play_playlist wieder als «Musik an»', () => {
    expect(
      musikSchluessel('play_playlist', { name: 'Party', device: 'Küche', shuffle: true })
    ).toEqual({ command: 'play', playlist: 'Party', device: 'Küche', shuffle: true });
    expect(musikSchluessel('play', { name: 'Party' })).toBeNull();
  });

  it('geht durch Speichern und Öffnen unverändert hindurch', () => {
    const gespeichert = [
      {
        entity_id: 'spotify.player',
        command: 'play_playlist',
        data: { name: 'Party', device: 'Küche', shuffle: true },
      },
    ];
    const [entwurf] = sceneActionsToDraft(gespeichert);
    expect(entwurf.command).toBe('play');
    expect(entwurf.playlist).toBe('Party');
    expect(entwurf.shuffle).toBe(true);
    expect(musikBefehl(entwurf.command, entwurf)).toEqual({
      command: 'play_playlist',
      data: gespeichert[0].data,
    });
  });
});
