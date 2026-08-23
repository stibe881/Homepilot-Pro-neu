import { ModuleKey } from '../screens/family/bausteine';
import { MODULGRUPPEN, gruppeVon, gruppiereModule } from './familiemodule';

const modul = (key: ModuleKey) => ({ key });

describe('Familien-Module in Gruppen', () => {
  it('sortiert jedes Modul in genau eine Gruppe', () => {
    const alle = MODULGRUPPEN.flatMap((gruppe) => gruppe.module);
    expect(new Set(alle).size).toBe(alle.length);
  });

  it('behält die Reihenfolge innerhalb der Gruppe', () => {
    // Wer seine Kacheln gezogen hat, findet sie in derselben Abfolge
    // wieder - nur eben unter einer Überschrift.
    const gruppen = gruppiereModule([
      modul('shopping'),
      modul('emergency'),
      modul('kalender'),
      modul('medications'),
    ]);
    expect(gruppen.map((g) => g.key)).toEqual(['alltag', 'notfall']);
    expect(gruppen[0].module.map((m) => m.key)).toEqual(['shopping', 'kalender']);
    expect(gruppen[1].module.map((m) => m.key)).toEqual(['emergency', 'medications']);
  });

  it('lässt leere Gruppen weg', () => {
    // Eine Überschrift ohne Kacheln darunter ist eine Frage, keine Auskunft.
    const gruppen = gruppiereModule([modul('recipes')]);
    expect(gruppen.map((g) => g.key)).toEqual(['nachschlagen']);
  });

  it('verliert ein unbekanntes Modul nicht', () => {
    // Ein neues Modul soll sichtbar sein, auch wenn jemand vergisst, es
    // einzutragen.
    expect(gruppeVon('gibtsnicht' as ModuleKey)).toBe('nachschlagen');
    expect(gruppiereModule([modul('gibtsnicht' as ModuleKey)])).toHaveLength(1);
  });

  it('stellt die Kontakte zu Notfall und Betreuung', () => {
    // Man sucht sie, wenn etwas ist - nicht, wenn man Nummern sortieren will.
    expect(gruppeVon('contacts')).toBe('notfall');
    expect(gruppeVon('babysitter')).toBe('notfall');
  });
});
