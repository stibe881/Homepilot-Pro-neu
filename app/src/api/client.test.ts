/**
 * Der Weg zum Hub – und was passiert, wenn er nicht antwortet.
 *
 * Diese Tests halten den Fall fest, der die Einkaufsliste leer aussehen
 * liess: Der Server sagte «Methode nicht erlaubt», die App machte daraus
 * pflichtschuldig eine leere Liste, und niemand erfuhr davon.
 */
import { HubFehler, fehlerText, hubClient, onHubFehler } from './client';

describe('fehlerText', () => {
  it('sagt bei fehlender Antwort, woran es liegt', () => {
    expect(fehlerText(null, '/api/entities')).toContain('antwortet nicht');
  });

  it('unterscheidet fehlende Berechtigung von fehlendem Weg', () => {
    expect(fehlerText(403, '/x')).toContain('Berechtigung');
    expect(fehlerText(404, '/x')).toContain('neusten Stand');
    // 405 ist genau der Fall der Einkaufsliste.
    expect(fehlerText(405, '/api/family/shopping')).toContain('neusten Stand');
  });

  it('schiebt einen Serverfehler nicht dem Benutzer zu', () => {
    expect(fehlerText(500, '/x')).toContain('Im Hub');
  });
});

describe('hubClient', () => {
  const echt = global.fetch;
  afterEach(() => {
    global.fetch = echt;
  });

  function antworte(status: number, körper = '{}') {
    global.fetch = jest.fn().mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      text: async () => körper,
    }) as never;
  }

  it('liefert den entpackten Körper', async () => {
    antworte(200, '{"a":1}');
    await expect(hubClient('http://hub', 't').get('/x')).resolves.toEqual({ a: 1 });
  });

  it('verträgt eine leere Antwort', async () => {
    antworte(204, '');
    await expect(hubClient('http://hub', 't').del('/x')).resolves.toBeNull();
  });

  it('wirft bei einem Fehlerstatus, statt still etwas Leeres zu liefern', async () => {
    antworte(405);
    await expect(hubClient('http://hub', 't').get('/x')).rejects.toBeInstanceOf(HubFehler);
  });

  it('liefert den Ersatzwert, wenn man ihn ausdrücklich nennt', async () => {
    antworte(500);
    await expect(hubClient('http://hub', 't').get('/x', { fallback: [] })).resolves.toEqual([]);
  });

  it('meldet jeden Fehlschlag an die Zuhörer', async () => {
    antworte(403);
    const gesehen: HubFehler[] = [];
    const ab = onHubFehler((f) => gesehen.push(f));
    await hubClient('http://hub', 't').get('/api/geheim', { fallback: null });
    ab();
    expect(gesehen).toHaveLength(1);
    expect(gesehen[0].status).toBe(403);
    expect(gesehen[0].pfad).toBe('/api/geheim');
  });

  it('schweigt, wo man es verlangt', async () => {
    antworte(500);
    const gesehen: HubFehler[] = [];
    const ab = onHubFehler((f) => gesehen.push(f));
    // Abfragen im Minutentakt dürfen nicht jede Minute einblenden.
    await hubClient('http://hub', 't').get('/x', { fallback: null, still: true });
    ab();
    expect(gesehen).toHaveLength(0);
  });

  it('schickt Token und Körper mit', async () => {
    antworte(200);
    const gerufen = global.fetch as jest.Mock;
    await hubClient('http://hub', 'geheim').post('/x', { a: 1 });
    const [adresse, optionen] = gerufen.mock.calls[0];
    expect(adresse).toBe('http://hub/x');
    expect(optionen.headers.Authorization).toBe('Bearer geheim');
    expect(optionen.body).toBe('{"a":1}');
  });

  // Der Hub schreibt in `detail` fertige Sätze, die sagen, was zu tun ist.
  // Die gingen verloren: Die Durchsage scheiterte, der Hub nannte das
  // fehlende gTTS, und in der App stand bloss die Statuszahl.
  describe('Worte des Hubs', () => {
    it('zeigt den Grund, den der Hub nennt', async () => {
      antworte(400, '{"detail":"Sprachausgabe nicht installiert."}');
      await expect(hubClient('http://hub', 't').post('/api/broadcast', {})).rejects.toThrow(
        'Sprachausgabe nicht installiert.'
      );
    });

    it('bleibt beim eigenen Satz, wo der Hub nur «Not Found» sagt', async () => {
      // «Not Found» hilft niemandem; der eigene Satz nennt den Weg und den
      // wahrscheinlichen Grund (Hub zu alt).
      antworte(404, '{"detail":"Not Found"}');
      await expect(hubClient('http://hub', 't').get('/api/neu')).rejects.toThrow('neusten Stand');
    });

    it('bleibt beim eigenen Satz, wenn der Hub selbst stolpert', async () => {
      antworte(500, '{"detail":"Traceback (most recent call last)"}');
      await expect(hubClient('http://hub', 't').get('/x')).rejects.toThrow('Im Hub');
    });

    it('liest keine Formatprüfung vor', async () => {
      // FastAPI legt bei einer Formatprüfung eine Liste von Objekten in
      // `detail` - unlesbar, also lieber der eigene Satz.
      antworte(422, '{"detail":[{"loc":["body","text"],"msg":"field required"}]}');
      await expect(hubClient('http://hub', 't').post('/x', {})).rejects.toThrow('abgelehnt (422)');
    });

    it('verträgt eine Antwort, die gar kein JSON ist', async () => {
      antworte(400, '<html>Bad Request</html>');
      await expect(hubClient('http://hub', 't').get('/x')).rejects.toThrow('abgelehnt (400)');
    });
  });

  it('gibt nach dem Zeitlimit auf', async () => {
    global.fetch = jest.fn(
      (_u: string, o: { signal: AbortSignal }) =>
        new Promise((_ok, weg) => {
          o.signal.addEventListener('abort', () => weg(new Error('abgebrochen')));
        })
    ) as never;
    await expect(
      hubClient('http://hub', 't').get('/x', { timeout: 20 })
    ).rejects.toBeInstanceOf(HubFehler);
  });
});
