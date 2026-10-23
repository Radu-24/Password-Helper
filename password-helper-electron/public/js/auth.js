/**
 * Account client — placeholder until the Password Helper server is online.
 *
 * When the server is ready:
 *  1. add `auth:login` / `auth:register` handlers in main.js that call the
 *     server with net.fetch (pages can't reach the network: CSP connect-src 'none'),
 *     and keep the JWT in the main process — never in localStorage;
 *  2. expose them in preload.js;
 *  3. replace the two functions below with calls to window.api.auth.*.
 */
(function () {
  'use strict';

  class NoServerError extends Error {
    constructor() {
      super('The account server is not connected yet.');
      this.code = 'NO_SERVER';
    }
  }

  async function login(_email, _password) {
    throw new NoServerError();
  }

  async function register(_email, _password) {
    throw new NoServerError();
  }

  window.PH.Auth = { login, register, NoServerError };
})();
