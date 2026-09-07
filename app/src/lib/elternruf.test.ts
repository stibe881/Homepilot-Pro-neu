import { rufKnoepfe } from './elternruf';

test('Notfallkontakte mit Nummer werden zu Knöpfen - mit Namen und tel:-Form', () => {
  const knoepfe = rufKnoepfe([
    { text: 'Mama', roles: ['notfall'], phone: '079 123 45 67' },
    { text: 'Papa', roles: ['notfall', 'familie'], phone: '+41 79 765 43 21' },
  ]);
  expect(knoepfe).toEqual([
    {
      name: 'Mama',
      label: 'Mama anrufen',
      nummer: '079 123 45 67',
      tel: '0791234567',
    },
    {
      name: 'Papa',
      label: 'Papa anrufen',
      nummer: '+41 79 765 43 21',
      tel: '+41797654321',
    },
  ]);
});

test('ohne Notfallrolle oder ohne Nummer gibt es keinen Knopf', () => {
  expect(
    rufKnoepfe([
      { text: 'Kinderärztin', roles: ['arzt'], phone: '041 111 22 33' },
      { text: 'Mama', roles: ['notfall'] }, // keine Nummer
    ])
  ).toEqual([]);
  expect(rufKnoepfe([])).toEqual([]);
  expect(rufKnoepfe(null)).toEqual([]);
});

test('ohne Kontaktnamen springen «Mami» und «Papi» ein', () => {
  const knoepfe = rufKnoepfe([
    { text: '  ', roles: ['notfall'], phone: '079 111 11 11' },
    { text: '', roles: ['notfall'], phone: '079 222 22 22' },
  ]);
  expect(knoepfe.map((knopf) => knopf.label)).toEqual([
    'Mami anrufen',
    'Papi anrufen',
  ]);
});

test('höchstens zwei Knöpfe - wie auf der Babysitter-Seite', () => {
  const knoepfe = rufKnoepfe([
    { text: 'Mama', roles: ['notfall'], phone: '1' },
    { text: 'Papa', roles: ['notfall'], phone: '2' },
    { text: 'Grosi', roles: ['notfall'], phone: '3' },
  ]);
  expect(knoepfe).toHaveLength(2);
});

test('die zweite Nummer eines Kontakts wird nicht gewählt - die erste ist die Mobile', () => {
  const knoepfe = rufKnoepfe([
    { text: 'Mama', roles: ['notfall'], phone: '079 123 45 67', phone2: '041 999 88 77' },
  ]);
  expect(knoepfe[0].tel).toBe('0791234567');
});
