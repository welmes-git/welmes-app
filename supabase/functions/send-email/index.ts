import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'WELMES <onboarding@resend.dev>'
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? 'admin@welmes.kr'
/**
 * Where humans should land when they reply, and the address shown in the
 * footer. FROM_EMAIL sends from a Resend-verified domain that has no mailbox
 * behind it, so without this every customer reply would bounce into a void.
 */
const SUPPORT_EMAIL = Deno.env.get('SUPPORT_EMAIL') ?? 'welmes0001@gmail.com'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

/**
 * Public site origin used for every link in the outgoing emails. Kept in one
 * place (and overridable per environment) so a domain change never means
 * hunting down hardcoded URLs across the templates again.
 */
const SITE_URL = (Deno.env.get('SITE_URL') ?? 'https://www.welmes.business').replace(/\/+$/, '')
/** Same origin without the scheme, for display as link text in the footer. */
const SITE_HOST = SITE_URL.replace(/^https?:\/\//, '')

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
}

// ── Security helpers ─────────────────────────────────────────────────────────

/**
 * Escape user-supplied text before interpolating it into the HTML templates.
 * Company names, product names and order notes all come from user input.
 */
function esc(value: unknown): string {
  return String(value ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]!
  ))
}

/** Coerce to a finite number so template maths can't be poisoned. */
function num(value: unknown): number {
  const n = Number(value)
  return Number.isFinite(n) ? n : 0
}

interface Caller { id: string; email: string; isAdmin: boolean }

/**
 * Resolve the calling user from their JWT. Returns null for anonymous callers
 * (the public anon key is a valid JWT but carries no user), which stops anyone
 * from using this function to send mail as WELMES.
 */
async function resolveCaller(req: Request): Promise<Caller | null> {
  const authHeader = req.headers.get('Authorization') ?? ''
  const jwt = authHeader.replace(/^Bearer\s+/i, '')
  if (!jwt) return null

  const admin = createClient(SUPABASE_URL, SERVICE_ROLE_KEY)
  const { data: { user }, error } = await admin.auth.getUser(jwt)
  if (error || !user) return null

  const { data: member } = await admin
    .from('members')
    .select('id, email, is_admin')
    .eq('auth_id', user.id)
    .single()

  return {
    id: member?.id ?? user.id,
    email: member?.email ?? user.email ?? '',
    isAdmin: !!member?.is_admin,
  }
}

// ── Resend helper ────────────────────────────────────────────────────────────

async function sendEmail(to: string, subject: string, html: string) {
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM_EMAIL, reply_to: SUPPORT_EMAIL, to, subject, html }),
  })
  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`)
  return res.json()
}

// ── HTML Templates ───────────────────────────────────────────────────────────

/**
 * WELMES palette (src/index.css / DESIGN.md). Mail clients can't read CSS
 * variables, so the token values are mirrored here as literals.
 */
const INK_900 = '#141414' // CTA fills, strongest emphasis
const INK_700 = '#333333' // body copy
const INK_500 = '#6c6a6a' // secondary copy, labels
const INK_300 = '#a8a6a6' // footer, faintest copy
const LINE = '#e5e3e3'    // hairline rules
const SUNKEN = '#f5f4f4'  // inset panels

/** Body face. Pretendard/Graphik aren't loadable in mail, so degrade to system. */
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI','Helvetica Neue',Arial,sans-serif"
/** Wordmark face — same stack as the `font-logo` Tailwind token. */
const LOGO_FACE = "'Cormorant Garamond',Georgia,'Times New Roman',serif"

/**
 * The Logo component (src/components/Logo.tsx) as table-safe HTML: Cormorant
 * Garamond over a small, widely tracked BUSINESS line. Letter-spacing also adds
 * space after the final letter, so each line carries a negative right margin of
 * the same amount to stay optically centred — same trick as the React version.
 */
function wordmark() {
  return `
    <div style="text-align:center;line-height:1;">
      <div style="font-family:${LOGO_FACE};font-weight:500;font-size:26px;letter-spacing:0.32em;color:${INK_900};margin:0 -0.32em 6px 0;">WELMES</div>
      <div style="font-family:${SANS};font-size:10px;letter-spacing:0.5em;color:${INK_500};margin:0 -0.5em 0 0;">BUSINESS</div>
    </div>`
}

function base(content: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WELMES</title>
</head>
<body style="margin:0;padding:0;background:#ffffff;font-family:${SANS};-webkit-font-smoothing:antialiased;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#ffffff;">
    <tr><td align="center" style="padding:40px 16px;">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;">
        <!-- Wordmark -->
        <tr><td style="padding:0 0 32px;">${wordmark()}</td></tr>
        <!-- Body, fenced by hairlines instead of a card border -->
        <tr><td style="border-top:1px solid ${INK_900};border-bottom:1px solid ${LINE};padding:36px 4px 40px;">${content}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="padding:20px 4px 0;">
            <p style="margin:0;font-size:11px;color:${INK_300};line-height:1.8;letter-spacing:0.02em;">
              WELMES Co., Ltd. · 123 Teheran-ro, Gangnam-gu, Seoul<br />
              <a href="mailto:${SUPPORT_EMAIL}" style="color:${INK_500};text-decoration:none;border-bottom:1px solid ${LINE};">${SUPPORT_EMAIL}</a>
              &nbsp;&nbsp;·&nbsp;&nbsp;
              <a href="${SITE_URL}" style="color:${INK_500};text-decoration:none;border-bottom:1px solid ${LINE};">${SITE_HOST}</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

/**
 * Status line above the headline. The old version used a tinted pill per state;
 * monochrome tracked capitals carry the same signal without importing five
 * accent colours into a black-and-white layout.
 */
function label(text: string) {
  return `<p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:0.18em;color:${INK_500};text-transform:uppercase;">${text}</p>`
}

function divider() {
  return `<hr style="border:none;border-top:1px solid ${LINE};margin:28px 0;" />`
}

function button(href: string, text: string) {
  return `<a href="${href}" style="display:inline-block;background:${INK_900};color:#ffffff;font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:14px 32px;text-decoration:none;">${text}</a>`
}

/** Secondary action — outlined rather than filled, for non-primary links. */
function buttonGhost(href: string, text: string) {
  return `<a href="${href}" style="display:inline-block;background:#ffffff;color:${INK_900};font-size:12px;font-weight:600;letter-spacing:0.08em;text-transform:uppercase;padding:13px 31px;text-decoration:none;border:1px solid ${INK_900};">${text}</a>`
}

/** Inset panel for order/company detail tables. */
function panel(inner: string) {
  return `<div style="background:${SUNKEN};padding:20px;margin-bottom:28px;">${inner}</div>`
}

/** Small uppercase caption used above lists and tables. */
function caption(text: string) {
  return `<p style="margin:0 0 12px;font-size:10px;font-weight:700;letter-spacing:0.14em;color:${INK_500};text-transform:uppercase;">${text}</p>`
}

/** Absolute link into the app's hash router, e.g. url('/account'). */
function url(path: string) {
  return `${SITE_URL}/#${path}`
}

// ── 1. Order Placed (buyer) ──────────────────────────────────────────────────

interface OrderItem { name: string; brand: string; quantity: number; setDescription: string; price: number }
interface OrderPlacedData {
  buyerEmail: string; orderId: string; memberName: string
  items: OrderItem[]; subtotal: number; vat: number; total: number
  currency: string; date: string; shippingCountry?: string
}

function orderPlacedBuyerHtml(d: OrderPlacedData) {
  const cur = esc(d.currency)
  const rows = (d.items ?? []).map(i => `
    <tr>
      <td style="padding:14px 0;border-bottom:1px solid ${LINE};">
        <p style="margin:0;font-size:13px;font-weight:600;color:${INK_900};">${esc(i.name)}</p>
        <p style="margin:3px 0 0;font-size:11px;color:${INK_500};">${esc(i.brand)} · ${esc(i.setDescription)}</p>
      </td>
      <td style="padding:14px 0;border-bottom:1px solid ${LINE};text-align:center;font-size:13px;color:${INK_500};">×${num(i.quantity)}</td>
      <td style="padding:14px 0;border-bottom:1px solid ${LINE};text-align:right;font-size:13px;font-weight:600;color:${INK_900};">${cur} ${num(i.price).toLocaleString()}</td>
    </tr>`).join('')

  return base(`
    ${label('Order Confirmed')}
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">Thank you, ${esc(d.memberName)}.</h1>
    <p style="margin:0 0 28px;font-size:14px;color:${INK_500};line-height:1.7;">Your order has been received and is being processed.</p>

    ${panel(`
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td><p style="margin:0;font-size:10px;color:${INK_500};text-transform:uppercase;letter-spacing:.14em;">Order ID</p><p style="margin:6px 0 0;font-size:14px;font-weight:700;font-family:monospace;color:${INK_900};">${esc(d.orderId)}</p></td>
          <td align="right"><p style="margin:0;font-size:10px;color:${INK_500};text-transform:uppercase;letter-spacing:.14em;">Date</p><p style="margin:6px 0 0;font-size:14px;color:${INK_900};">${esc(d.date)}</p></td>
        </tr>
      </table>`)}

    ${caption('Items Ordered')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};">${rows}</table>

    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;margin-top:18px;">
      <tr><td style="padding:4px 0;color:${INK_500};">Subtotal (excl. VAT)</td><td align="right" style="color:${INK_700};">${cur} ${num(d.subtotal).toLocaleString()}</td></tr>
      <tr><td style="padding:4px 0;color:${INK_500};">VAT (10%)</td><td align="right" style="color:${INK_700};">${cur} ${num(d.vat).toLocaleString()}</td></tr>
      <tr>
        <td style="padding:14px 0 0;border-top:1px solid ${INK_900};font-size:15px;font-weight:700;color:${INK_900};">Total</td>
        <td align="right" style="padding:14px 0 0;border-top:1px solid ${INK_900};font-size:15px;font-weight:700;color:${INK_900};">${cur} ${num(d.total).toLocaleString()}</td>
      </tr>
    </table>

    ${divider()}
    <p style="margin:0 0 24px;font-size:13px;color:${INK_500};line-height:1.8;">
      Our team will review your order and send a proforma invoice. Goods will be dispatched after payment confirmation.
    </p>
    ${button(url('/account'), 'View My Orders')}
  `)
}

// ── 2. Order Placed (admin notification) ─────────────────────────────────────

function orderPlacedAdminHtml(d: OrderPlacedData) {
  const cur = esc(d.currency)
  return base(`
    ${label('New Order')}
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">New order from ${esc(d.memberName)}</h1>
    <p style="margin:0 0 28px;font-size:13px;color:${INK_500};">Order ID <strong style="font-family:monospace;color:${INK_700};">${esc(d.orderId)}</strong> · ${esc(d.date)}</p>

    ${panel(`
      <p style="margin:0 0 6px;font-size:10px;color:${INK_500};text-transform:uppercase;letter-spacing:.14em;">Total Amount</p>
      <p style="margin:0;font-size:24px;font-weight:700;color:${INK_900};">${cur} ${num(d.total).toLocaleString()}</p>`)}

    ${caption(`${(d.items ?? []).length} item type(s)`)}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};margin-bottom:8px;">
      ${(d.items ?? []).map(i => `
      <tr>
        <td style="padding:11px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${INK_700};">${esc(i.name)}</td>
        <td style="padding:11px 0;border-bottom:1px solid ${LINE};text-align:right;font-size:13px;color:${INK_500};">×${num(i.quantity)}</td>
      </tr>`).join('')}
    </table>

    ${divider()}
    ${button(url('/admin'), 'Open Admin Dashboard')}
  `)
}

// ── 3. Member Registered (buyer welcome + admin alert) ───────────────────────
// Sent the moment a business finishes registration, before any admin action —
// closes the "did this actually submit?" anxiety gap during the approval wait,
// and makes sure the admin actually finds out there's a new application to
// review (previously nothing notified them at all).

interface MemberRegisteredData {
  email: string; companyName: string; businessNumber: string
  representative: string; phone: string; date: string
}

/** Key/value rows for the detail panels, so every panel aligns identically. */
function rows(pairs: [string, string][]) {
  return `<table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
    ${pairs.map(([k, v]) => `
    <tr>
      <td style="padding:5px 0;color:${INK_500};">${esc(k)}</td>
      <td align="right" style="padding:5px 0;color:${INK_900};font-weight:600;">${esc(v)}</td>
    </tr>`).join('')}
  </table>`
}

function memberRegisteredBuyerHtml(d: MemberRegisteredData) {
  return base(`
    ${label('Application Received')}
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">Thanks for applying, ${esc(d.companyName)}.</h1>
    <p style="margin:0 0 28px;font-size:14px;color:${INK_500};line-height:1.8;">
      We've received your business registration and our team is reviewing it now.
      Approval typically takes <strong style="color:${INK_900};">1–2 business days</strong> — we'll
      email you the moment a decision is made.
    </p>

    ${panel(rows([
      ['Company', d.companyName],
      ['Business Reg. No.', d.businessNumber],
      ['Submitted', d.date],
    ]))}

    ${caption('While you wait')}
    <p style="margin:0 0 24px;font-size:13px;color:${INK_500};line-height:1.8;">
      You can already browse our full catalogue and save items to your wishlist —
      wholesale pricing unlocks automatically the moment you're approved.
    </p>
    ${button(url('/products'), 'Browse Products')}
  `)
}

function memberRegisteredAdminHtml(d: MemberRegisteredData) {
  return base(`
    ${label('New Application')}
    <h1 style="margin:0 0 8px;font-size:22px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">${esc(d.companyName)} applied for a business account</h1>
    <p style="margin:0 0 28px;font-size:13px;color:${INK_500};">Submitted ${esc(d.date)}</p>

    ${panel(rows([
      ['Representative', d.representative],
      ['Business Reg. No.', d.businessNumber],
      ['Email', d.email],
      ['Phone', d.phone],
    ]))}

    <p style="margin:0 0 24px;font-size:13px;color:${INK_500};line-height:1.8;">
      The site promises a 1–2 business day review — please action this application soon.
    </p>
    ${button(url('/admin'), 'Review in Admin Dashboard')}
  `)
}

// ── 4. Member Approved ───────────────────────────────────────────────────────

interface MemberData { email: string; companyName: string }

function memberApprovedHtml(d: MemberData) {
  const perks = [
    'Access to wholesale prices',
    'Bulk order capability',
    'Multi-currency support (JPY, USD, EUR and more)',
    'Dedicated business support',
  ]
  return base(`
    ${label('Approved')}
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">Your account has been approved.</h1>
    <p style="margin:0 0 28px;font-size:14px;color:${INK_500};line-height:1.8;">
      Congratulations, <strong style="color:${INK_900};">${esc(d.companyName)}</strong>. Your WELMES
      business account has been verified. You can now access wholesale pricing and
      place bulk orders.
    </p>

    ${caption("What's now unlocked")}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};margin-bottom:28px;">
      ${perks.map(p => `
      <tr>
        <td width="18" style="padding:11px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${INK_900};vertical-align:top;">—</td>
        <td style="padding:11px 0;border-bottom:1px solid ${LINE};font-size:13px;color:${INK_700};">${esc(p)}</td>
      </tr>`).join('')}
    </table>

    ${button(url('/products'), 'Start Shopping')}
  `)
}

// ── 5. Member Rejected ───────────────────────────────────────────────────────

function memberRejectedHtml(d: MemberData) {
  return base(`
    ${label('Application Update')}
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">Update on your application</h1>
    <p style="margin:0 0 28px;font-size:14px;color:${INK_500};line-height:1.8;">
      Dear <strong style="color:${INK_900};">${esc(d.companyName)}</strong>,<br /><br />
      We were unable to approve your WELMES business account at this time. This may
      be due to incomplete documentation or eligibility requirements.
    </p>

    <div style="border-left:2px solid ${INK_900};padding:2px 0 2px 16px;margin-bottom:28px;">
      <p style="margin:0;font-size:13px;color:${INK_700};line-height:1.8;">
        If you believe this is an error or would like to re-apply with updated
        information, please contact our support team.
      </p>
    </div>

    ${buttonGhost(url('/support'), 'Contact Support')}
  `)
}

// ── 6. Order Shipped ─────────────────────────────────────────────────────────

interface ShippedData {
  buyerEmail: string; orderId: string; memberName: string
  trackingCarrier: string; trackingNumber: string; trackingShippedAt: string
}

function orderShippedHtml(d: ShippedData) {
  const trackUrl = `https://www.17track.net/en/track#nums=${encodeURIComponent(String(d.trackingNumber ?? ''))}`
  return base(`
    ${label('Shipped')}
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">Your order is on its way.</h1>
    <p style="margin:0 0 28px;font-size:14px;color:${INK_500};line-height:1.8;">
      Hi <strong style="color:${INK_900};">${esc(d.memberName)}</strong>, your order has been dispatched.
    </p>

    ${caption('Tracking Details')}
    <table width="100%" cellpadding="0" cellspacing="0" style="border-top:1px solid ${LINE};margin-bottom:28px;font-size:13px;">
      <tr><td style="padding:11px 0;border-bottom:1px solid ${LINE};color:${INK_500};width:120px;">Order ID</td><td style="padding:11px 0;border-bottom:1px solid ${LINE};font-family:monospace;font-weight:700;color:${INK_900};">${esc(d.orderId)}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid ${LINE};color:${INK_500};">Carrier</td><td style="padding:11px 0;border-bottom:1px solid ${LINE};font-weight:600;color:${INK_900};">${esc(d.trackingCarrier)}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid ${LINE};color:${INK_500};">Tracking No.</td><td style="padding:11px 0;border-bottom:1px solid ${LINE};font-family:monospace;font-size:15px;font-weight:700;color:${INK_900};">${esc(d.trackingNumber)}</td></tr>
      <tr><td style="padding:11px 0;border-bottom:1px solid ${LINE};color:${INK_500};">Shipped On</td><td style="padding:11px 0;border-bottom:1px solid ${LINE};color:${INK_900};">${esc(d.trackingShippedAt)}</td></tr>
    </table>

    ${button(trackUrl, 'Track My Package')}

    ${divider()}
    <p style="margin:0;font-size:11px;color:${INK_300};line-height:1.7;word-break:break-all;">
      You can also track your shipment at <a href="${trackUrl}" style="color:${INK_500};">${esc(trackUrl)}</a>
    </p>
  `)
}

// ── 7. Order lifecycle: payment confirmed / completed / cancelled ────────────
// Admin drives these from the status dropdown. Previously a status change only
// wrote an in-app notification, so a buyer whose order was cancelled had no way
// to find out unless they happened to open the site again.

interface OrderStatusData {
  buyerEmail: string; orderId: string; memberName: string
  total: number; currency: string; date: string
  /** Optional free-text note from the admin; the section is omitted when absent. */
  reason?: string
}

/** Shared order summary block so the three status emails stay visually consistent. */
function orderSummary(d: OrderStatusData) {
  return panel(`
    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
      <tr><td style="padding:5px 0;color:${INK_500};">Order ID</td><td align="right" style="padding:5px 0;font-family:monospace;font-weight:700;color:${INK_900};">${esc(d.orderId)}</td></tr>
      <tr><td style="padding:5px 0;color:${INK_500};">Order Date</td><td align="right" style="padding:5px 0;color:${INK_900};font-weight:600;">${esc(d.date)}</td></tr>
      <tr><td style="padding:5px 0;color:${INK_500};">Total</td><td align="right" style="padding:5px 0;color:${INK_900};font-weight:700;">${esc(d.currency)} ${num(d.total).toLocaleString()}</td></tr>
    </table>`)
}

function orderPaymentConfirmedHtml(d: OrderStatusData) {
  return base(`
    ${label('Payment Confirmed')}
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">We've received your payment.</h1>
    <p style="margin:0 0 28px;font-size:14px;color:${INK_500};line-height:1.8;">
      Thank you, <strong style="color:${INK_900};">${esc(d.memberName)}</strong>. Your payment has been
      confirmed and your order is now being prepared for dispatch. We'll email you
      again with tracking details the moment it ships.
    </p>

    ${orderSummary(d)}

    ${button(url(`/order/${encodeURIComponent(d.orderId)}/print`), 'View Order Document')}
  `)
}

function orderCompletedHtml(d: OrderStatusData) {
  return base(`
    ${label('Completed')}
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">Your order is complete.</h1>
    <p style="margin:0 0 28px;font-size:14px;color:${INK_500};line-height:1.8;">
      Hi <strong style="color:${INK_900};">${esc(d.memberName)}</strong>, this order is now closed. We hope
      the goods arrived in perfect condition — if anything is missing or damaged,
      reply to this email and we'll sort it out.
    </p>

    ${orderSummary(d)}

    ${buttonGhost(url('/products'), 'Order Again')}
  `)
}

function orderCancelledHtml(d: OrderStatusData) {
  return base(`
    ${label('Cancelled')}
    <h1 style="margin:0 0 8px;font-size:24px;font-weight:700;color:${INK_900};letter-spacing:-0.01em;">Your order has been cancelled.</h1>
    <p style="margin:0 0 28px;font-size:14px;color:${INK_500};line-height:1.8;">
      Dear <strong style="color:${INK_900};">${esc(d.memberName)}</strong>, the order below has been
      cancelled. Any payment already received for it will be refunded.
    </p>

    ${orderSummary(d)}

    ${d.reason ? `
    <div style="border-left:2px solid ${INK_900};padding:2px 0 2px 16px;margin-bottom:28px;">
      <p style="margin:0 0 6px;font-size:10px;font-weight:700;text-transform:uppercase;letter-spacing:.14em;color:${INK_500};">Reason</p>
      <p style="margin:0;font-size:13px;color:${INK_700};line-height:1.8;">${esc(d.reason)}</p>
    </div>` : ''}

    <p style="margin:0 0 24px;font-size:13px;color:${INK_500};line-height:1.8;">
      If this was unexpected, reply to this email and we'll look into it right away.
    </p>
    ${buttonGhost(url('/support'), 'Contact Support')}
  `)
}

// ── Main handler ─────────────────────────────────────────────────────────────

/** Email types only an admin may trigger. */
const ADMIN_ONLY = new Set([
  'member_approved', 'member_rejected', 'order_shipped',
  'order_payment_confirmed', 'order_completed', 'order_cancelled',
])

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  })
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders })
  }

  try {
    // The anon key alone is a valid JWT, so require a real signed-in user —
    // otherwise anyone could send mail from the WELMES address.
    const caller = await resolveCaller(req)
    if (!caller) return json({ error: 'Unauthorized' }, 401)

    const { type, data } = await req.json()

    if (ADMIN_ONLY.has(type) && !caller.isAdmin) {
      return json({ error: 'Forbidden' }, 403)
    }
    // A buyer may only trigger their own order confirmation / registration email.
    if (type === 'order_placed' && !caller.isAdmin && data?.buyerEmail !== caller.email) {
      return json({ error: 'Forbidden' }, 403)
    }
    if (type === 'member_registered' && !caller.isAdmin && data?.email !== caller.email) {
      return json({ error: 'Forbidden' }, 403)
    }

    switch (type) {
      case 'order_placed':
        await Promise.all([
          sendEmail(data.buyerEmail, `Order Confirmed — ${data.orderId}`, orderPlacedBuyerHtml(data)),
          sendEmail(ADMIN_EMAIL, `[New Order] ${data.orderId} from ${data.memberName}`, orderPlacedAdminHtml(data)),
        ])
        break
      case 'member_registered':
        await Promise.all([
          sendEmail(data.email, 'Your WELMES Business Application Has Been Received', memberRegisteredBuyerHtml(data)),
          sendEmail(ADMIN_EMAIL, `[New Application] ${data.companyName}`, memberRegisteredAdminHtml(data)),
        ])
        break
      case 'member_approved':
        await sendEmail(data.email, 'Your WELMES Business Account has been Approved ✓', memberApprovedHtml(data))
        break
      case 'member_rejected':
        await sendEmail(data.email, 'Update on your WELMES Business Account Application', memberRejectedHtml(data))
        break
      case 'order_shipped':
        await sendEmail(data.buyerEmail, `Your order has been shipped — ${data.orderId}`, orderShippedHtml(data))
        break
      case 'order_payment_confirmed':
        await sendEmail(data.buyerEmail, `Payment confirmed — ${data.orderId}`, orderPaymentConfirmedHtml(data))
        break
      case 'order_completed':
        await sendEmail(data.buyerEmail, `Order completed — ${data.orderId}`, orderCompletedHtml(data))
        break
      case 'order_cancelled':
        await sendEmail(data.buyerEmail, `Order cancelled — ${data.orderId}`, orderCancelledHtml(data))
        break
      default:
        throw new Error(`Unknown email type: ${type}`)
    }

    return json({ success: true })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('[send-email]', message)
    return json({ error: message }, 500)
  }
})
