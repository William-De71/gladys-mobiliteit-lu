import { test } from 'node:test';
import assert from 'node:assert/strict';

import {
  createQuota,
  minimumInterval,
  HOURLY_BUDGET,
  DAILY_BUDGET,
  HOUR_MS,
  DAY_MS,
} from '../src/quota.js';
import { NOW } from './helpers/fixtures.js';

const make = () => {
  const clock = { now: NOW };
  const store = { data: {} };
  return { clock, store, quota: createQuota({ store, now: () => clock.now }) };
};

test('the requests of the last hour and day, by minute', () => {
  const { clock, quota, store } = make();
  quota.record();
  quota.record();
  clock.now += 30 * 60 * 1000;
  quota.record();
  assert.deepEqual(quota.usage(), { hour: 3, day: 3 });
  clock.now += 45 * 60 * 1000;
  assert.deepEqual(quota.usage(), { hour: 1, day: 3 });
  clock.now += DAY_MS;
  assert.deepEqual(quota.usage(), { hour: 0, day: 0 });
  assert.deepEqual(store.data.quota.minutes, {}, 'old buckets are forgotten');
});

test('the budgets keep a margin under 500 an hour and 5 000 a day', () => {
  assert.ok(HOURLY_BUDGET < 500 && DAILY_BUDGET < 5000);
  const hourly = make();
  for (let index = 0; index < HOURLY_BUDGET; index += 1) {
    hourly.quota.record();
  }
  assert.deepEqual(hourly.quota.allow(), { ok: false, reason: 'hour' });
  hourly.clock.now += HOUR_MS;
  assert.deepEqual(hourly.quota.allow(), { ok: true });
  const daily = make();
  for (let hour = 0; hour < 12; hour += 1) {
    for (let index = 0; index < DAILY_BUDGET / 12; index += 1) {
      daily.quota.record();
    }
    daily.clock.now += HOUR_MS;
  }
  assert.deepEqual(daily.quota.allow(), { ok: false, reason: 'day' });
});

test('API_QUOTA: blocked until the next full hour', () => {
  const { clock, quota } = make();
  quota.block();
  // 18:30 -> 19:00.
  assert.equal(quota.blockedUntil(), Date.parse('2026-11-07T18:00:00Z'));
  assert.deepEqual(quota.allow(), { ok: false, reason: 'blocked' });
  clock.now = Date.parse('2026-11-07T18:00:00Z');
  assert.equal(quota.blockedUntil(), 0);
  assert.deepEqual(quota.allow(), { ok: true });
});

test('the interval of the stops fits a day of readings in the planned budget', () => {
  assert.equal(minimumInterval(0), 0);
  assert.equal(minimumInterval(1), 24);
  assert.equal(minimumInterval(3), 72);
  assert.equal(minimumInterval(10), 240);
  for (const stops of [1, 3, 5, 10]) {
    const interval = Math.max(120, minimumInterval(stops));
    assert.ok((stops * DAY_MS) / (interval * 1000) <= 3600, `${stops} stops`);
    assert.ok((stops * HOUR_MS) / (interval * 1000) < HOURLY_BUDGET, `${stops} stops an hour`);
  }
});
