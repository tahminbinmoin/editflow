// Billing-ready plumbing. Payments are OFF: with BILLING_ENABLED unset, every check passes and
// the app runs as a free beta, but usage is recorded so plan limits can be switched on later.
//
// To add payments later:
//   1. Pick a provider (e.g. Stripe, Paddle, Lemon Squeezy, or SSLCommerz / bKash for Bangladesh)
//      and add an adapter to PAYMENT_PROVIDERS below: { createCheckout(user, planId) → url,
//      verifyWebhook(req, rawBody) → { userId, plan, status, customerId, subscriptionId, periodEnd } }.
//   2. Set prices in shared/plans.js, and PAYMENT_PROVIDER + its secret keys on Vercel.
//   3. The webhook (POST /api/billing/webhook) writes public.subscriptions with the Supabase
//      service-role key (SUPABASE_SERVICE_ROLE_KEY): users can read their row but never write it.
//   4. Set BILLING_ENABLED=true to enforce limits.
import { PLANS, DEFAULT_PLAN, USAGE_KINDS, checkLimit } from '../../shared/plans.js';

export const billingEnabled = () => process.env.BILLING_ENABLED === 'true';
export const PAYMENT_PROVIDERS = {}; // none connected yet

const monthStart = () => {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
};

export async function planOf(ctx) {
  const { data: rows } = await ctx.supabase.from('subscriptions').select('plan, status, current_period_end').eq('user_id', ctx.user.id).limit(1);
  const data = rows?.[0];
  if (data && ['active', 'trialing'].includes(data.status) && PLANS[data.plan]) return { id: data.plan, status: data.status, renews: data.current_period_end };
  return { id: DEFAULT_PLAN, status: 'active', renews: null };
}

export async function monthUsage(ctx) {
  const { data } = await ctx.supabase.from('usage_events').select('kind, amount').gte('created_at', monthStart()).limit(10000);
  const out = Object.fromEntries(Object.keys(USAGE_KINDS).map((k) => [k, 0]));
  for (const r of data || []) if (r.kind in out) out[r.kind] += Number(r.amount) || 0;
  return out;
}

/** Throws 402 when the plan's monthly limit would be passed (only when billing is enabled). */
export async function assertAllowed(ctx, kind, amount = 1) {
  if (!billingEnabled()) return;
  const [plan, usage] = await Promise.all([planOf(ctx), monthUsage(ctx)]);
  const c = checkLimit(plan.id, usage[kind], kind, amount);
  if (!c.allowed) throw Object.assign(new Error(`You've used this month's ${USAGE_KINDS[kind].label.toLowerCase()} on the ${PLANS[plan.id].label} plan (${c.limit}). Upgrade to keep going.`), { status: 402, code: 'plan_limit' });
}

/** Best effort: never blocks the request it belongs to. */
export async function recordUsage(ctx, kind, amount = 1, projectId = null) {
  try {
    await ctx.supabase.from('usage_events').insert({ user_id: ctx.user.id, kind, amount, project_id: projectId });
  } catch {}
}

export async function billingSummary(ctx) {
  const [plan, usage] = await Promise.all([planOf(ctx), monthUsage(ctx)]);
  return {
    enabled: billingEnabled(),
    providers: Object.keys(PAYMENT_PROVIDERS),
    plan: { ...plan, label: PLANS[plan.id].label },
    usage: Object.entries(USAGE_KINDS).map(([kind, k]) => ({ kind, label: k.label, ...checkLimit(plan.id, usage[kind], kind, 0) })),
    plans: Object.entries(PLANS).map(([id, p]) => ({ id, label: p.label, price: p.price, limits: p.limits })),
  };
}
