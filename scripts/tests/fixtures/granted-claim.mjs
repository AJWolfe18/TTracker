// A Supabase client stand-in for the daily claim (ADO-645) that always grants the day. For tests
// about the daily checks themselves: pass it as the runner's `supabase`, so the fetch fake only
// answers the check's data reads and Discord.
// Claim, duplicate, failure and stale cases: scripts/tests/daily-check-claims-pglite.test.mjs

const GRANTED = { claimed: true, holder_status: 'running', holder_run_id: 'test-run', holder_claimed_at: null };

/** @returns {{calls: {fn: string, args: object}[], rpc: Function}} every rpc call lands in `calls` */
export function grantedClaimStub() {
  const calls = [];
  return {
    calls,
    async rpc(fn, args) {
      calls.push({ fn, args });
      // claim_daily_check returns the holder row; finish_daily_check returns true (marked)
      return { data: fn === 'claim_daily_check' ? [GRANTED] : true, error: null };
    },
  };
}
