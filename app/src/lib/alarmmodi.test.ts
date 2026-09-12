import { EINGEBAUTE_MODI, modiAus, modusFehler, modusSchluessel } from './alarmmodi';

describe('modiAus', () => {
  it('nimmt ohne Liste die drei eingebauten', () => {
    expect(modiAus(undefined)).toBe(EINGEBAUTE_MODI);
    expect(modiAus([])).toBe(EINGEBAUTE_MODI);
  });

  it('hängt eigene Modi mit ihrem Symbol an - unbekannte Symbole werden zum Schild', () => {
    const modi = modiAus([
      { key: 'nacht', label: 'Nacht', builtin: true },
      { key: 'werkstatt', label: 'Werkstatt', icon: 'construct-outline' },
      { key: 'gaeste', label: 'Gäste da', icon: 'quatsch' },
    ]);
    expect(modi.map((m) => m.icon)).toEqual(['moon-outline', 'construct-outline', 'shield-outline']);
    expect(modi.map((m) => m.builtin)).toEqual([true, false, false]);
  });
});

describe('modusSchluessel', () => {
  it('rechnet wie der Hub', () => {
    expect(modusSchluessel('Nur Erdgeschoss')).toBe('nur_erdgeschoss');
    expect(modusSchluessel('Gäste da!')).toBe('gaeste_da');
    expect(modusSchluessel('   ')).toBe('');
  });
});

describe('modusFehler', () => {
  it('kennt leere, doppelte und zu viele', () => {
    expect(modusFehler('!!', EINGEBAUTE_MODI)).toMatch(/Buchstaben/);
    expect(modusFehler('Nacht', EINGEBAUTE_MODI)).toMatch(/gibt es schon/);
    const fuenf = [...EINGEBAUTE_MODI];
    for (let i = 0; i < 5; i += 1) {
      fuenf.push({ key: `m${i}`, label: `M${i}`, icon: 'shield-outline', builtin: false });
    }
    expect(modusFehler('Noch einer', fuenf)).toMatch(/fünf/);
    expect(modusFehler('Werkstatt', EINGEBAUTE_MODI)).toBeNull();
  });
});
