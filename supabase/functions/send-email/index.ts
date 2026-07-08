import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')!
const FROM_EMAIL = Deno.env.get('FROM_EMAIL') ?? 'WELMES <onboarding@resend.dev>'
const ADMIN_EMAIL = Deno.env.get('ADMIN_EMAIL') ?? 'admin@welmes.kr'
const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!
const SERVICE_ROLE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!

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
    body: JSON.stringify({ from: FROM_EMAIL, to, subject, html }),
  })
  if (!res.ok) throw new Error(`Resend error: ${await res.text()}`)
  return res.json()
}

// ── HTML Templates ───────────────────────────────────────────────────────────

function base(content: string) {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>WELMES</title>
</head>
<body style="margin:0;padding:0;background:#f5f5f7;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background:#f5f5f7;padding:32px 16px;">
    <tr><td align="center">
      <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;background:#ffffff;border-radius:12px;overflow:hidden;border:1px solid #e5e5e5;">
        <!-- Header -->
        <tr>
          <td style="background:#1a1a1a;padding:24px 32px;">
            <span style="font-size:22px;font-weight:800;color:#ffffff;letter-spacing:-0.5px;">WELMES</span>
            <span style="font-size:11px;font-weight:600;color:#ffffff;background:#4a90e2;padding:2px 8px;border-radius:4px;margin-left:8px;">Business</span>
          </td>
        </tr>
        <!-- Body -->
        <tr><td style="padding:32px;">${content}</td></tr>
        <!-- Footer -->
        <tr>
          <td style="background:#f8f8fa;border-top:1px solid #e5e5e5;padding:20px 32px;">
            <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">
              WELMES Co., Ltd. · 123 Teheran-ro, Gangnam-gu, Seoul<br />
              <a href="mailto:support@welmes.kr" style="color:#4a90e2;text-decoration:none;">support@welmes.kr</a>
              &nbsp;·&nbsp;
              <a href="https://welmes-app.vercel.app" style="color:#4a90e2;text-decoration:none;">welmes-app.vercel.app</a>
            </p>
          </td>
        </tr>
      </table>
    </td></tr>
  </table>
</body>
</html>`
}

function badge(color: string, text: string) {
  return `<span style="display:inline-block;background:${color}15;color:${color};font-size:11px;font-weight:700;padding:3px 10px;border-radius:99px;border:1px solid ${color}40;">${text}</span>`
}

function divider() {
  return `<hr style="border:none;border-top:1px solid #f0f0f0;margin:24px 0;" />`
}

function button(href: string, text: string, color = '#333333') {
  return `<a href="${href}" style="display:inline-block;background:${color};color:#ffffff;font-size:13px;font-weight:600;padding:11px 28px;border-radius:8px;text-decoration:none;">${text}</a>`
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
      <td style="padding:10px 0;border-bottom:1px solid #f5f5f5;">
        <p style="margin:0;font-size:13px;font-weight:600;color:#222;">${esc(i.name)}</p>
        <p style="margin:2px 0 0;font-size:11px;color:#aaa;">${esc(i.brand)} · ${esc(i.setDescription)}</p>
      </td>
      <td style="padding:10px 0;border-bottom:1px solid #f5f5f5;text-align:center;font-size:13px;color:#555;">×${num(i.quantity)}</td>
      <td style="padding:10px 0;border-bottom:1px solid #f5f5f5;text-align:right;font-size:13px;font-weight:600;color:#222;">${cur} ${num(i.price).toLocaleString()}</td>
    </tr>`).join('')

  return base(`
    <p style="margin:0 0 6px;font-size:13px;color:#999;">Order Confirmed</p>
    <h1 style="margin:0 0 4px;font-size:22px;font-weight:800;color:#1a1a1a;">Thank you, ${esc(d.memberName)}!</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#666;">Your order has been received and is being processed.</p>

    <div style="background:#f8f8fa;border-radius:8px;padding:16px;margin-bottom:24px;">
      <table width="100%" cellpadding="0" cellspacing="0">
        <tr>
          <td><p style="margin:0;font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:.5px;">Order ID</p><p style="margin:4px 0 0;font-size:14px;font-weight:700;font-family:monospace;color:#333;">${esc(d.orderId)}</p></td>
          <td align="right"><p style="margin:0;font-size:11px;color:#aaa;text-transform:uppercase;letter-spacing:.5px;">Date</p><p style="margin:4px 0 0;font-size:14px;color:#333;">${esc(d.date)}</p></td>
        </tr>
      </table>
    </div>

    <h3 style="margin:0 0 12px;font-size:13px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#aaa;">Items Ordered</h3>
    <table width="100%" cellpadding="0" cellspacing="0">${rows}</table>

    ${divider()}

    <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
      <tr><td style="padding:3px 0;color:#666;">Subtotal (excl. VAT)</td><td align="right" style="color:#555;">${cur} ${num(d.subtotal).toLocaleString()}</td></tr>
      <tr><td style="padding:3px 0;color:#666;">VAT (10%)</td><td align="right" style="color:#555;">${cur} ${num(d.vat).toLocaleString()}</td></tr>
      <tr><td style="padding:8px 0 0;font-size:15px;font-weight:800;color:#1a1a1a;">Total</td><td align="right" style="padding:8px 0 0;font-size:15px;font-weight:800;color:#1a1a1a;">${cur} ${num(d.total).toLocaleString()}</td></tr>
    </table>

    ${divider()}
    <p style="margin:0 0 20px;font-size:13px;color:#666;line-height:1.7;">
      Our team will review your order and send a proforma invoice. Goods will be dispatched after payment confirmation.
    </p>
    ${button('https://welmes-app.vercel.app/#/account', 'View My Orders')}
  `)
}

// ── 2. Order Placed (admin notification) ─────────────────────────────────────

function orderPlacedAdminHtml(d: OrderPlacedData) {
  const cur = esc(d.currency)
  return base(`
    <p style="margin:0 0 6px;">${badge('#ff9500', 'NEW ORDER')}</p>
    <h1 style="margin:8px 0 4px;font-size:20px;font-weight:800;color:#1a1a1a;">New order from ${esc(d.memberName)}</h1>
    <p style="margin:0 0 24px;font-size:13px;color:#666;">Order ID: <strong style="font-family:monospace;">${esc(d.orderId)}</strong> · ${esc(d.date)}</p>

    <div style="background:#f8f8fa;border-radius:8px;padding:16px;margin-bottom:24px;font-size:13px;">
      <p style="margin:0 0 4px;color:#888;">Total Amount</p>
      <p style="margin:0;font-size:22px;font-weight:800;color:#1a1a1a;">${cur} ${num(d.total).toLocaleString()}</p>
    </div>

    <p style="margin:0 0 6px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#aaa;">${(d.items ?? []).length} item type(s)</p>
    ${(d.items ?? []).map(i => `<p style="margin:0 0 6px;font-size:13px;color:#444;">· ${esc(i.name)} — ×${num(i.quantity)}</p>`).join('')}

    ${divider()}
    ${button('https://welmes-app.vercel.app/#/admin', 'Open Admin Dashboard', '#4a90e2')}
  `)
}

// ── 3. Member Approved ───────────────────────────────────────────────────────

interface MemberData { email: string; companyName: string }

function memberApprovedHtml(d: MemberData) {
  return base(`
    <p style="margin:0 0 6px;">${badge('#22c55e', 'APPROVED')}</p>
    <h1 style="margin:8px 0 8px;font-size:22px;font-weight:800;color:#1a1a1a;">Your account has been approved!</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.7;">
      Congratulations, <strong>${esc(d.companyName)}</strong>! Your WELMES business account has been verified.
      You can now access wholesale pricing and place bulk orders.
    </p>

    <div style="background:#f0fdf4;border:1px solid #bbf7d0;border-radius:8px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#166534;line-height:1.7;">
        ✓ Access to wholesale prices<br/>
        ✓ Bulk order capability<br/>
        ✓ Multi-currency support (JPY, USD, EUR and more)<br/>
        ✓ Dedicated business support
      </p>
    </div>

    ${button('https://welmes-app.vercel.app/#/products', 'Start Shopping', '#22c55e')}
  `)
}

// ── 4. Member Rejected ───────────────────────────────────────────────────────

function memberRejectedHtml(d: MemberData) {
  return base(`
    <p style="margin:0 0 6px;">${badge('#ef4444', 'APPLICATION UPDATE')}</p>
    <h1 style="margin:8px 0 8px;font-size:22px;font-weight:800;color:#1a1a1a;">Update on your application</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#666;line-height:1.7;">
      Dear <strong>${esc(d.companyName)}</strong>,<br/><br/>
      We were unable to approve your WELMES business account at this time.
      This may be due to incomplete documentation or eligibility requirements.
    </p>

    <div style="background:#fef2f2;border:1px solid #fecaca;border-radius:8px;padding:16px;margin-bottom:24px;">
      <p style="margin:0;font-size:13px;color:#991b1b;line-height:1.7;">
        If you believe this is an error or would like to re-apply with updated information, please contact our support team.
      </p>
    </div>

    ${button('https://welmes-app.vercel.app/#/support', 'Contact Support', '#ef4444')}
  `)
}

// ── 5. Order Shipped ─────────────────────────────────────────────────────────

interface ShippedData {
  buyerEmail: string; orderId: string; memberName: string
  trackingCarrier: string; trackingNumber: string; trackingShippedAt: string
}

function orderShippedHtml(d: ShippedData) {
  const trackUrl = `https://www.17track.net/en/track#nums=${encodeURIComponent(String(d.trackingNumber ?? ''))}`
  return base(`
    <p style="margin:0 0 6px;">${badge('#7c3aed', 'SHIPPED')}</p>
    <h1 style="margin:8px 0 8px;font-size:22px;font-weight:800;color:#1a1a1a;">Your order is on its way!</h1>
    <p style="margin:0 0 24px;font-size:14px;color:#666;">
      Hi <strong>${esc(d.memberName)}</strong>, your order has been dispatched.
    </p>

    <div style="background:#f5f3ff;border:1px solid #ddd6fe;border-radius:10px;padding:20px;margin-bottom:24px;">
      <p style="margin:0 0 12px;font-size:12px;font-weight:700;text-transform:uppercase;letter-spacing:.5px;color:#7c3aed;">Tracking Details</p>
      <table width="100%" cellpadding="0" cellspacing="0" style="font-size:13px;">
        <tr><td style="padding:4px 0;color:#6b7280;width:120px;">Order ID</td><td style="font-family:monospace;font-weight:700;color:#1a1a1a;">${esc(d.orderId)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Carrier</td><td style="font-weight:600;color:#1a1a1a;">${esc(d.trackingCarrier)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Tracking No.</td><td style="font-family:monospace;font-size:15px;font-weight:700;color:#7c3aed;">${esc(d.trackingNumber)}</td></tr>
        <tr><td style="padding:4px 0;color:#6b7280;">Shipped On</td><td style="color:#1a1a1a;">${esc(d.trackingShippedAt)}</td></tr>
      </table>
    </div>

    ${button(trackUrl, '📦 Track My Package', '#7c3aed')}

    ${divider()}
    <p style="margin:0;font-size:12px;color:#aaa;line-height:1.6;">
      You can also track your shipment on <a href="${trackUrl}" style="color:#4a90e2;">${esc(trackUrl)}</a>
    </p>
  `)
}

// ── Main handler ─────────────────────────────────────────────────────────────

/** Email types only an admin may trigger. */
const ADMIN_ONLY = new Set(['member_approved', 'member_rejected', 'order_shipped'])

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
    // A buyer may only trigger their own order confirmation.
    if (type === 'order_placed' && !caller.isAdmin && data?.buyerEmail !== caller.email) {
      return json({ error: 'Forbidden' }, 403)
    }

    switch (type) {
      case 'order_placed':
        await Promise.all([
          sendEmail(data.buyerEmail, `Order Confirmed — ${data.orderId}`, orderPlacedBuyerHtml(data)),
          sendEmail(ADMIN_EMAIL, `[New Order] ${data.orderId} from ${data.memberName}`, orderPlacedAdminHtml(data)),
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
