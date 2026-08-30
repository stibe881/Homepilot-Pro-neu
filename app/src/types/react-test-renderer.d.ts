// react-test-renderer liefert keine eigenen Typen mehr, und @types dazu
// ist nicht installiert. Hier steht der Ausschnitt, den die Tests
// wirklich benutzen: anlegen, neu zeichnen, den Baum durchsuchen,
// abräumen. Was dazukommt, trägt man hier nach - eine vollständige
// Nachbildung wäre Pflege für Dinge, die niemand aufruft.
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  /** Ein Knoten im gezeichneten Baum - mehr als die Eigenschaften
   *  braucht bisher niemand. */
  export interface TestKnoten {
    props: Record<string, unknown>;
  }

  export interface ReactTestRenderer {
    unmount(): void;
    toJSON(): unknown;
    /** Denselben Baum mit anderem Inhalt neu zeichnen. */
    update(element: ReactElement): void;
    root: {
      findAllByType(typ: unknown): TestKnoten[];
    };
  }

  export function act(callback: () => void | Promise<void>): void;

  function create(element: ReactElement): ReactTestRenderer;

  const renderer: { create: typeof create; act: typeof act };
  export { create };
  export type { ReactTestRenderer as ReactTestRendererType };
  export default renderer;
}
