/* --------------------------------------------------------------------------------------------
 * Copyright (c) Fredrik Hareide. All rights reserved.
 * Licensed under the MIT License.
 * ------------------------------------------------------------------------------------------ */

import {window} from 'vscode';

export function showMessage(err) {
  if (typeof err === 'number') {
    return;
  }

  const message = err.message || err;

  // Silently ignore user-initiated cancellations
  if (typeof message === 'string' && message.includes('cancelled by user')) {
    return;
  }

  if (err.type === 'info') {
    return window.showInformationMessage(message);
  } else if (err.type === 'warn') {
    return window.showWarningMessage(message);
  }

  return window.showErrorMessage(message);
}
