// react-test-renderer liefert keine eigenen Typen mehr, und @types dazu
// ist nicht installiert. Für die Hook-Tests genügt dieser kleine
// Ausschnitt – mehr als create/act/unmount brauchen sie nicht.
declare module 'react-test-renderer' {
  import type { ReactElement } from 'react';

  export interface ReactTestRenderer {
    unmount(): void;
    toJSON(): unknown;
  }

  export function act(callback: () => void | Promise<void>): void;

  function create(element: ReactElement): ReactTestRenderer;

  const renderer: { create: typeof create; act: typeof act };
  export { create };
  export type { ReactTestRenderer as ReactTestRendererType };
  export default renderer;
}
