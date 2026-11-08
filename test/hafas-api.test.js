import { test } from 'node:test';
import assert from 'node:assert/strict';

import { createHafasClient, kindOf, readErrorBody, redact } from '../src/hafas-api.js';
import { fakeAtp, KEY, HAMILIUS, NOW } from './helpers/fixtures.js';

const client = (api) =>
  createHafasClient({
    fetch: api,
    now: () => NOW,
    baseUrl: 'https://cdt.hafas.de/opendata/apiserver',
  });

test('the departure board of a stop, with the key, in JSON', async () => {
  const api = fakeAtp();
  const board = await client(api).departureBoard({ key: KEY, stopId: HAMILIUS, language: 'de' });
  assert.equal(board.Departure.length, 10);
  const [call] = api.boardCalls();
  assert.equal(call.path, '/opendata/apiserver/departureBoard');
  assert.equal(call.query.lang, 'de');
  assert.equal(call.query.format, 'json');
  // A language the API does not offer: French.
  await client(api).departureBoard({ key: KEY, stopId: HAMILIUS, language: 'es' });
  assert.equal(api.boardCalls()[1].query.lang, 'fr');
});

test('errors: refused key, quota, missing key, unknown stop, server, network', async () => {
  const api = fakeAtp();
  const hafas = client(api);
  const kindAfter = async (setup, options = {}) => {
    setup();
    try {
      await hafas.departureBoard({ key: KEY, stopId: HAMILIUS, ...options });
      return 'none';
    } catch (err) {
      assert.ok(!err.message.includes(KEY), err.message);
      return err.kind;
    } finally {
      Object.assign(api.state, { error: null, failBoard: null });
    }
  };
  assert.equal(await kindAfter(() => (api.state.error = 'auth')), 'auth');
  assert.equal(await kindAfter(() => (api.state.error = 'quota')), 'quota');
  assert.equal(await kindAfter(() => {}, { stopId: '999999999' }), 'unknown_stop');
  assert.equal(await kindAfter(() => (api.state.failBoard = 503)), 'busy');
  assert.equal(await kindAfter(() => (api.state.failBoard = 500)), 'unreachable');
  assert.equal(await kindAfter(() => (api.state.failBoard = 'network')), 'unreachable');
  // No key: refused before any request; the server's own answer is read too.
  await assert.rejects(hafas.departureBoard({ key: '', stopId: HAMILIUS }), { kind: 'no_key' });
  assert.equal(kindOf('API_PARAM', 400, 'Missing value for required param accessId'), 'no_key');
  assert.equal(hafas.requests.failed, 6);
  assert.match(hafas.requests.lastError, /^unreachable/);
});

test('no departure is an empty board, not an error', async () => {
  const api = async () =>
    Response.json({ errorCode: 'SVC_NO_RESULT', errorText: 'no result found' }, { status: 500 });
  const board = await client(api).departureBoard({ key: KEY, stopId: HAMILIUS });
  assert.deepEqual(board, { Departure: [], Message: [] });
});

test('error bodies in JSON or XML; the key is hidden', () => {
  assert.deepEqual(readErrorBody('{"errorCode":"API_AUTH","errorText":"access denied"}'), {
    code: 'API_AUTH',
    text: 'access denied',
  });
  assert.deepEqual(
    readErrorBody(
      '<Error errorCode="API_PARAM" errorText="Missing value for required param accessId"/>',
    ),
    { code: 'API_PARAM', text: 'Missing value for required param accessId' },
  );
  assert.deepEqual(readErrorBody('Not Found'), { code: '', text: '' });
  assert.equal(redact(`https://x/?accessId=${KEY}&id=1`, KEY), 'https://x/?accessId=***&id=1');
  assert.equal(redact('text', ''), 'text');
});
