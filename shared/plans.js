// Plans and limits (billing-ready; payments are NOT switched on yet).
// While BILLING_ENABLED is not "true" on the server, nothing is limited and everyone is on the
// free beta. Usage is still recorded (usage_events) so limits can be switched on later.
// Prices are set when a payment provider is connected (see server/billing/index.js).

export const PLANS = {
  free: { label: 'Free', price: null, limits: { exportsPerMonth: 5, aiTasksPerMonth: 40, transcribeMinutesPerMonth: 30 } },
  creator: { label: 'Creator', price: null, limits: { exportsPerMonth: 60, aiTasksPerMonth: 500, transcribeMinutesPerMonth: 300 } },
  pro: { label: 'Pro', price: null, limits: { exportsPerMonth: null, aiTasksPerMonth: null, transcribeMinutesPerMonth: 1200 } }, // null = unlimited
};
export const DEFAULT_PLAN = 'free';

/** usage_events.kind → the plan limit it counts against */
export const USAGE_KINDS = {
  export: { limit: 'exportsPerMonth', label: 'Exports' },
  ai_task: { limit: 'aiTasksPerMonth', label: 'AI edits' },
  transcribe_minutes: { limit: 'transcribeMinutesPerMonth', label: 'Transcription minutes' },
};

/** Is `amount` more of `kind` allowed this month? */
export function checkLimit(planId, used, kind, amount = 1) {
  const plan = PLANS[planId] || PLANS[DEFAULT_PLAN];
  const limit = plan.limits[USAGE_KINDS[kind]?.limit] ?? null;
  const u = Number(used) || 0;
  return { allowed: limit == null || u + amount <= limit, limit, used: u, remaining: limit == null ? null : Math.max(0, limit - u) };
}
