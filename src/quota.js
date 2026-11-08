// -----------------------------------------------------------------------------
// The quota of the access key.
//
// A key of the ATP has a quota: 500 requests an hour and 5 000 a day by
// default (community documentation of the API, confirmed by the users who
// met "QuotaExceeded"). The integration keeps a margin under it, counting
// every request it makes in minute buckets kept in /data (a restart does not
// forget them):
//   - HOURLY_BUDGET   requests in the last 60 minutes;
//   - DAILY_BUDGET    requests in the last 24 hours.
// The reading interval of the stops grows with their number so that a whole
// day of readings fits the daily budget (`minimumInterval()`). When the API
// still answers API_QUOTA, nothing is asked before the next full hour.
// -----------------------------------------------------------------------------

const MINUTE_MS = 60 * 1000;
const HOUR_MS = 60 * MINUTE_MS;
const DAY_MS = 24 * HOUR_MS;
const HOURLY_BUDGET = 450;
const DAILY_BUDGET = 4500;
// The share of the daily budget the timer of the stops may plan for: the rest
// is for the widgets, the scene actions and "Test the connection".
const PLANNED_DAILY = 3600;

/**
 * @description The shortest interval (seconds) that keeps a day of readings
 * of these stops under the planned budget.
 * @param {number} stops - The stops read at each round (distinct ids).
 * @returns {number} Seconds.
 * @example
 * minimumInterval(3); // -> 72
 */
function minimumInterval(stops) {
  if (stops <= 0) {
    return 0;
  }
  return Math.ceil((stops * DAY_MS) / PLANNED_DAILY / 1000);
}

/**
 * @description The quota keeper.
 * @param {object} options - `{ store, now }`: `store.data.quota` holds
 * `{ minutes: { <minute index>: count }, blockedUntil }`.
 * @returns {object} `{ allow, record, block, usage, blockedUntil }`.
 */
function createQuota({ store, now }) {
  const state = () => {
    store.data.quota ??= { minutes: {}, blockedUntil: 0 };
    store.data.quota.minutes ??= {};
    return store.data.quota;
  };

  /**
   * @description Forget the buckets older than a day.
   * @returns {object} The buckets kept.
   */
  function prune() {
    const quota = state();
    const oldest = Math.floor((now() - DAY_MS) / MINUTE_MS);
    for (const minute of Object.keys(quota.minutes)) {
      if (Number(minute) <= oldest) {
        delete quota.minutes[minute];
      }
    }
    return quota.minutes;
  }

  /**
   * @description The requests made in the last hour and day.
   * @returns {{ hour: number, day: number }} The counts.
   */
  function usage() {
    const minutes = prune();
    const hourStart = Math.floor((now() - HOUR_MS) / MINUTE_MS);
    let hour = 0;
    let day = 0;
    for (const [minute, count] of Object.entries(minutes)) {
      day += count;
      if (Number(minute) > hourStart) {
        hour += count;
      }
    }
    return { hour, day };
  }

  return {
    usage,
    /**
     * @description Whether a request may be made now.
     * @returns {{ ok: boolean, reason?: string }} `reason`: `blocked`
     * (API_QUOTA answered), `hour` or `day` (budget spent).
     */
    allow() {
      const quota = state();
      if (quota.blockedUntil && now() < quota.blockedUntil) {
        return { ok: false, reason: 'blocked' };
      }
      const { hour, day } = usage();
      if (day >= DAILY_BUDGET) {
        return { ok: false, reason: 'day' };
      }
      if (hour >= HOURLY_BUDGET) {
        return { ok: false, reason: 'hour' };
      }
      return { ok: true };
    },
    /**
     * @description Count one request.
     */
    record() {
      const minutes = state().minutes;
      const minute = Math.floor(now() / MINUTE_MS);
      minutes[minute] = (minutes[minute] ?? 0) + 1;
    },
    /**
     * @description The API answered API_QUOTA: wait for the next full hour.
     */
    block() {
      state().blockedUntil = (Math.floor(now() / HOUR_MS) + 1) * HOUR_MS;
    },
    /**
     * @description Until when nothing is asked, 0 when free.
     * @returns {number} The instant (ms).
     */
    blockedUntil() {
      const until = state().blockedUntil ?? 0;
      return until > now() ? until : 0;
    },
  };
}

export {
  HOURLY_BUDGET,
  DAILY_BUDGET,
  PLANNED_DAILY,
  HOUR_MS,
  DAY_MS,
  minimumInterval,
  createQuota,
};
