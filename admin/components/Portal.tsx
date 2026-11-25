'use client';

import { createPortal } from 'react-dom';

/**
 * Renders a dialog at the end of <body>, outside the list row that opened it. A row's buttons sit in their own layer
 * (relative z-10), so a dialog left inside the row would be drawn under the buttons of the rows after it.
 * Dialogs open only after a click, so the document always exists here.
 */
export function Portal({ children }: { children: React.ReactNode }) {
  return createPortal(children, document.body);
}
