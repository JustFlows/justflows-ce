// SPDX-License-Identifier: MIT

/**
 * Input the caller can fix: a limit reached, a value that is not allowed.
 *
 * Library code throws this instead of a plain `Error` when its message is
 * written for the person saving, so a route can return it with 400 and treat
 * every other error as unexpected (justflows-ce#315). It lives on its own so
 * libraries can throw it without importing Express.
 */
export class InvalidInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "InvalidInputError";
  }
}
