/**
 * Der kurze Weg zu den persönlichen Einstellungen.
 *
 * Geprüft wird, was die Kacheln davon erwarten: einmal fragen statt
 * zwanzigmal, nur den eigenen Schlüssel schicken, und ein misslungener
 * Abruf darf sich nicht als «leer» festsetzen.
 */
import {
  persoenlichLesen,
  persoenlichSetzen,
  persoenlichVergessen,
  persoenlichWert,
} from './persoenlich';

// Die Namen müssen mit «mock» beginnen: Jest hebt den Mock über die
// Deklarationen und lässt sonst keine Variable von aussen hinein.
const mockGet = jest.fn();
const mockPut = jest.fn();

jest.mock('../api/client', () => ({
  hubClient: () => ({ get: mockGet, put: mockPut }),
}));

const get = mockGet;
const put = mockPut;

const settings = { url: 'http://hub', token: 'abc' };

beforeEach(() => {
  persoenlichVergessen();
  get.mockReset();
  put.mockReset();
  put.mockResolvedValue(null);
});

test('liest die Einstellungen vom Hub', async () => {
  get.mockResolvedValue({ prefs: { theme: 'dark' } });
  await expect(persoenlichLesen(settings)).resolves.toEqual({ theme: 'dark' });
});

test('fragt nur einmal, auch wenn zwanzig Kacheln fragen', async () => {
  get.mockResolvedValue({ prefs: { theme: 'dark' } });
  await persoenlichLesen(settings);
  await persoenlichLesen(settings);
  expect(get).toHaveBeenCalledTimes(1);
});

test('gleichzeitige Fragen teilen sich einen Abruf', async () => {
  get.mockResolvedValue({ prefs: {} });
  await Promise.all([persoenlichLesen(settings), persoenlichLesen(settings)]);
  expect(get).toHaveBeenCalledTimes(1);
});

test('ein misslungener Abruf setzt sich nicht als leer fest', async () => {
  // Sonst sähen die Einstellungen den Rest der Sitzung verschwunden aus.
  get.mockResolvedValueOnce(null);
  await expect(persoenlichLesen(settings)).resolves.toEqual({});
  get.mockResolvedValueOnce({ prefs: { theme: 'sand' } });
  await expect(persoenlichLesen(settings)).resolves.toEqual({ theme: 'sand' });
});

test('eine andere Anmeldung bekommt eigene Einstellungen', async () => {
  get.mockResolvedValue({ prefs: { theme: 'dark' } });
  await persoenlichLesen(settings);
  get.mockResolvedValue({ prefs: { theme: 'pink' } });
  await expect(
    persoenlichLesen({ url: 'http://hub', token: 'xyz' })
  ).resolves.toEqual({ theme: 'pink' });
});

test('ein einzelner Wert kommt mit Rückfall', async () => {
  get.mockResolvedValue({ prefs: { ziel: 'kueche' } });
  await expect(persoenlichWert(settings, 'ziel', 'alle')).resolves.toBe('kueche');
  await expect(persoenlichWert(settings, 'fehlt', 'alle')).resolves.toBe('alle');
});

test('setzen schickt nur den eigenen Schlüssel', async () => {
  get.mockResolvedValue({ prefs: { theme: 'dark' } });
  await persoenlichLesen(settings);
  persoenlichSetzen(settings, 'ziel', 'kueche');
  expect(put).toHaveBeenCalledWith(
    '/api/prefs',
    { prefs: { ziel: 'kueche' } },
    expect.anything()
  );
});

test('setzen zieht das Gedächtnis sofort nach', async () => {
  get.mockResolvedValue({ prefs: { theme: 'dark' } });
  await persoenlichLesen(settings);
  persoenlichSetzen(settings, 'ziel', 'kueche');
  // Ohne Nachziehen läse die nächste Kachel den alten Stand, während der
  // Zug noch unterwegs ist.
  await expect(persoenlichLesen(settings)).resolves.toEqual({
    theme: 'dark',
    ziel: 'kueche',
  });
  expect(get).toHaveBeenCalledTimes(1);
});

test('null löscht', async () => {
  get.mockResolvedValue({ prefs: { ziel: 'kueche' } });
  await persoenlichLesen(settings);
  persoenlichSetzen(settings, 'ziel', null);
  await expect(persoenlichLesen(settings)).resolves.toEqual({});
  expect(put).toHaveBeenCalledWith(
    '/api/prefs',
    { prefs: { ziel: null } },
    expect.anything()
  );
});

test('ohne Anmeldung wird nichts geschickt', () => {
  persoenlichSetzen({ url: '', token: '' }, 'ziel', 'kueche');
  expect(put).not.toHaveBeenCalled();
});
