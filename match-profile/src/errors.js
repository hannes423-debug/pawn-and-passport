/**
 * errors.js - an error a route can throw to answer with a status and a code.
 *
 *   throw new AppError(409, 'username_taken', 'That username is taken.')
 *   -> 409 { "error": "username_taken", "message": "That username is taken." }
 */

export class AppError extends Error {
  constructor(status, code, message = code) {
    super(message);
    this.statusCode = status;
    this.code = code;
  }
}

export default { AppError };
