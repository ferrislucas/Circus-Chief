import request from 'supertest';

/**
 * Bind an Express app explicitly for tests that make several HTTP requests.
 *
 * Passing a bare app to Supertest creates and tears down a listener for every
 * request. The test database fixture can then close its SQLite connection
 * while a listener is still unwinding under load. Owning the listener here
 * makes that lifecycle explicit; callers must await `close()` before their
 * test's database teardown runs.
 *
 * @param {import('express').Express} app
 * @returns {Promise<{ client: import('supertest').SuperTest<import('supertest').Test>, close: () => Promise<void> }>}
 */
export async function createHttpTestServer(app) {
  const server = await new Promise((resolve, reject) => {
    const listeningServer = app.listen(0, '127.0.0.1');
    listeningServer.once('listening', () => resolve(listeningServer));
    listeningServer.once('error', reject);
  });

  return {
    client: request(server),
    close: () => new Promise((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    }),
  };
}
