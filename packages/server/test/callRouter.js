/**
 * Invoke an Express router directly with mocked req/res — no network.
 *
 * Supertest-based suites cannot bind a port in some sandboxes; these
 * network-free calls exercise the same route handlers (params, body,
 * status/json) through `router.handle`.
 *
 * @param {import('express').Router} router
 * @param {{ method: string, url: string, body?: object }} options
 * @returns {Promise<{ statusCode: number, body: any }>}
 */
export function callRouter(router, { method, url, body }) {
  return new Promise((resolve, reject) => {
    const req = {
      method,
      url,
      headers: {},
      body,
      params: {},
      get(name) {
        return this.headers[String(name).toLowerCase()];
      },
    };
    const res = {
      statusCode: 200,
      body: undefined,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        this.body = payload;
        resolve(this);
        return this;
      },
    };
    try {
      router.handle(req, res, (err) => (err ? reject(err) : resolve(res)));
    } catch (err) {
      reject(err);
    }
  });
}
