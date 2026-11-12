/* Background jobs: dispatch due scheduled rides + expire unanswered searches.
   Runs in-process (fine for a single node); for horizontal scale move these
   to a queue worker (BullMQ/Redis) — see README. */
const rides = require('./services/rides');

function startScheduler() {
  const TICK_MS = 15000;
  setInterval(async () => {
    try {
      const dispatched = await rides.dispatchDueScheduled();
      const expired = await rides.expireStaleSearches();
      if (dispatched || expired) {
        console.log(`[scheduler] dispatched=${dispatched} expired=${expired}`);
      }
    } catch (err) {
      console.error('[scheduler] error:', err.message);
    }
  }, TICK_MS);
  console.log('✔ Scheduler running (15s tick)');
}

module.exports = { startScheduler };
