import { useState } from 'react';
import { Phone, Mail, MapPin, Clock, ChevronDown, ChevronUp, Send, CheckCircle } from 'lucide-react';

// ─── FAQ Data ───────────────────────────────────────────────────────────────

const faqCategories = [
  { id: 'membership', label: 'Membership' },
  { id: 'orders', label: 'Orders & Shipping' },
  { id: 'returns', label: 'Returns & Exchanges' },
  { id: 'payment', label: 'Payment' },
  { id: 'products', label: 'Products' },
];

const faqs: Record<string, { q: string; a: string }[]> = {
  membership: [
    {
      q: 'Who can register as a member?',
      a: 'WELMES is an exclusive wholesale platform for verified business owners. You must have a valid business registration number to sign up. Individuals without a registered business cannot access wholesale pricing.',
    },
    {
      q: 'How long does business verification take?',
      a: 'Business verification is typically completed within 1–2 business days after you submit your business registration certificate. You will receive an email notification once approved.',
    },
    {
      q: 'Can I browse products before verification is complete?',
      a: 'You can browse product listings, but wholesale prices and the ability to add items to your cart are only available after your account has been approved by our admin team.',
    },
    {
      q: 'What documents are required for registration?',
      a: 'You will need to provide your business registration certificate. Please ensure the document is clear and legible. Additional documents may be requested in special cases.',
    },
    {
      q: 'Can I change my registered business information?',
      a: 'To update your business information, please contact our support team via email or phone. Changes to your business registration number require re-verification.',
    },
  ],
  orders: [
    {
      q: 'What is the minimum order quantity (MOQ)?',
      a: 'Minimum order quantities vary by product and brand. The MOQ is displayed on each product detail page. Some products may require a minimum order value of ₩100,000 or more.',
    },
    {
      q: 'How long does delivery take?',
      a: 'Standard delivery takes 2–5 business days after payment confirmation. Express delivery (1–2 business days) is available for an additional fee. Delivery times may vary during peak seasons.',
    },
    {
      q: 'Can I track my order?',
      a: 'Yes. Once your order is shipped, a tracking number will be sent to your registered email. You can also check order status in the My Orders section of your account.',
    },
    {
      q: 'Can I modify or cancel an order after placing it?',
      a: 'Orders can be modified or cancelled within 1 hour of placement. After that, once processing has begun, cancellations may not be possible. Please contact us immediately if you need to make changes.',
    },
    {
      q: 'Do you offer international shipping?',
      a: 'Currently, we ship within South Korea only. International shipping options are being evaluated and may be available in the future. Please check back for updates.',
    },
  ],
  returns: [
    {
      q: 'What is your return policy?',
      a: 'Returns are accepted within 7 days of delivery for items that are defective, damaged, or incorrectly shipped. Due to the nature of wholesale, returns for change-of-mind are generally not accepted.',
    },
    {
      q: 'How do I initiate a return or exchange?',
      a: 'Contact our support team within 7 days of receiving your order. Provide your order number, a description of the issue, and photos if the item is damaged. Our team will guide you through the process.',
    },
    {
      q: 'Who covers the return shipping cost?',
      a: 'If the return is due to a defect or our error, we cover the return shipping cost. If the return is for any other reason, the buyer is responsible for return shipping fees.',
    },
    {
      q: 'How long does a refund take to process?',
      a: 'Refunds are processed within 3–5 business days after we receive and inspect the returned items. The time for funds to appear in your account depends on your payment method and bank.',
    },
  ],
  payment: [
    {
      q: 'What payment methods are accepted?',
      a: 'We accept bank transfer, credit card (Visa, MasterCard, Amex), and major Korean payment methods including KakaoPay and NaverPay. Bank transfer orders are processed after payment confirmation.',
    },
    {
      q: 'Are prices inclusive of VAT?',
      a: 'All listed wholesale prices are exclusive of VAT (10%). VAT will be added at checkout. A tax invoice will be issued upon request for business members.',
    },
    {
      q: 'Can I request a tax invoice?',
      a: 'Yes. As a registered business member, you are entitled to a tax invoice for all purchases. Invoices can be requested from the order detail page or by contacting our support team.',
    },
    {
      q: 'Is there a credit limit or payment term option?',
      a: 'Credit terms (e.g., Net 30) are available for long-standing members with a strong order history. Please contact our sales team directly to discuss credit arrangements.',
    },
  ],
  products: [
    {
      q: 'Are all products authentic?',
      a: 'Yes. WELMES works directly with authorized distributors and brand partners. All products are 100% authentic and sourced through official supply chains.',
    },
    {
      q: 'Can I request products that are not listed?',
      a: 'Yes. If you are looking for a specific product or brand not currently listed, please contact us. We regularly expand our catalogue based on member demand.',
    },
    {
      q: 'Do products have an expiry date guarantee?',
      a: 'All products are guaranteed to have a minimum of 12 months remaining shelf life at the time of shipment, unless otherwise stated on the product page.',
    },
    {
      q: 'Can I get product samples before placing a bulk order?',
      a: 'Sample requests are available for select products for approved members. Please contact our support team with your account details and the products you are interested in.',
    },
  ],
};

// ─── Contact Info ────────────────────────────────────────────────────────────

const contactCards = [
  {
    icon: Phone,
    title: 'Phone',
    value: '1544-1234',
    sub: 'Mon – Fri  09:00 – 18:00\n(Lunch 12:00 – 13:00)',
    color: '#4a90e2',
  },
  {
    icon: Mail,
    title: 'Email',
    value: 'support@welmes.kr',
    sub: 'We reply within 1 business day',
    color: '#ff4d6d',
  },
  {
    icon: MapPin,
    title: 'Address',
    value: 'WELMES Tower 15F',
    sub: '123 Teheran-ro, Gangnam-gu\nSeoul, South Korea',
    color: '#2ecc71',
  },
  {
    icon: Clock,
    title: 'Business Hours',
    value: 'Mon – Fri',
    sub: '09:00 – 18:00 KST\nClosed on weekends & holidays',
    color: '#f39c12',
  },
];

// ─── FAQ Accordion Item ───────────────────────────────────────────────────────

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-[#e5e5e5] rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-[#f8f8fa] transition-colors"
      >
        <span className="text-[14px] font-semibold text-[#333] pr-4">{q}</span>
        {open ? (
          <ChevronUp size={18} className="text-[#999] shrink-0" />
        ) : (
          <ChevronDown size={18} className="text-[#999] shrink-0" />
        )}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-[#f0f0f0] bg-[#fafafa]">
          <p className="text-[13px] text-[#666] leading-relaxed pt-4">{a}</p>
        </div>
      )}
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

export default function CustomerSupport() {
  const [activeCategory, setActiveCategory] = useState('membership');
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({
    name: '',
    email: '',
    category: 'General Inquiry',
    message: '',
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) return;
    setSubmitted(true);
  };

  const handleChange = (
    e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>
  ) => setForm({ ...form, [e.target.name]: e.target.value });

  return (
    <div className="min-h-screen bg-white">

      {/* ── Hero ── */}
      <section className="bg-[#2c3e50] py-16">
        <div className="max-w-[1100px] mx-auto px-4 text-center">
          <h1 className="text-[32px] md:text-[40px] font-bold text-white mb-3">
            Customer Support
          </h1>
          <p className="text-[#bdc3c7] text-[15px] max-w-[520px] mx-auto leading-relaxed">
            We're here to help. Browse our FAQ or send us a message and we'll
            get back to you within one business day.
          </p>
        </div>
      </section>

      {/* ── Contact Cards ── */}
      <section className="max-w-[1100px] mx-auto px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {contactCards.map(({ icon: Icon, title, value, sub, color }) => (
            <div
              key={title}
              className="border border-[#e5e5e5] rounded-xl p-5 hover:shadow-md transition-shadow"
            >
              <div
                className="w-10 h-10 rounded-lg flex items-center justify-center mb-4"
                style={{ backgroundColor: `${color}18` }}
              >
                <Icon size={20} style={{ color }} />
              </div>
              <p className="text-[12px] text-[#999] font-medium uppercase tracking-wide mb-1">
                {title}
              </p>
              <p className="text-[15px] font-bold text-[#333] mb-1">{value}</p>
              <p className="text-[12px] text-[#888] leading-relaxed whitespace-pre-line">{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* ── FAQ ── */}
      <section className="bg-[#f8f8fa] py-14">
        <div className="max-w-[1100px] mx-auto px-4">
          <h2 className="text-[24px] font-bold text-[#333] mb-2">
            Frequently Asked Questions
          </h2>
          <p className="text-[13px] text-[#999] mb-8">
            Can't find your answer? Contact us using the form below.
          </p>

          {/* Category Tabs */}
          <div className="flex flex-wrap gap-2 mb-6">
            {faqCategories.map((cat) => (
              <button
                key={cat.id}
                onClick={() => setActiveCategory(cat.id)}
                className={`px-4 py-1.5 rounded-full text-[13px] font-medium transition-colors ${
                  activeCategory === cat.id
                    ? 'bg-[#333] text-white'
                    : 'bg-white border border-[#e5e5e5] text-[#666] hover:border-[#333]'
                }`}
              >
                {cat.label}
              </button>
            ))}
          </div>

          {/* FAQ List */}
          <div className="space-y-3">
            {faqs[activeCategory].map((item, i) => (
              <FaqItem key={i} q={item.q} a={item.a} />
            ))}
          </div>
        </div>
      </section>

      {/* ── Contact Form ── */}
      <section className="max-w-[1100px] mx-auto px-4 py-14">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">

          {/* Left: copy */}
          <div>
            <h2 className="text-[24px] font-bold text-[#333] mb-3">Send Us a Message</h2>
            <p className="text-[14px] text-[#666] leading-relaxed mb-6">
              Fill in the form and our team will respond within one business day.
              For urgent matters, please call us directly.
            </p>
            <div className="bg-[#f8f8fa] rounded-xl p-5 space-y-3">
              {[
                { label: 'Phone', value: '1544-1234' },
                { label: 'Email', value: 'support@welmes.kr' },
                { label: 'Hours', value: 'Mon – Fri  09:00 – 18:00 KST' },
              ].map(({ label, value }) => (
                <div key={label} className="flex gap-3">
                  <span className="text-[12px] font-semibold text-[#999] w-12 pt-0.5 uppercase">
                    {label}
                  </span>
                  <span className="text-[13px] text-[#333]">{value}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Right: form */}
          <div>
            {submitted ? (
              <div className="flex flex-col items-center justify-center py-16 text-center">
                <CheckCircle size={48} className="text-[#2ecc71] mb-4" />
                <h3 className="text-[20px] font-bold text-[#333] mb-2">Message Sent!</h3>
                <p className="text-[14px] text-[#666]">
                  Thank you, <strong>{form.name}</strong>. We'll reply to{' '}
                  <strong>{form.email}</strong> within one business day.
                </p>
                <button
                  onClick={() => { setSubmitted(false); setForm({ name: '', email: '', category: 'General Inquiry', message: '' }); }}
                  className="mt-6 text-[13px] text-[#4a90e2] hover:underline"
                >
                  Send another message
                </button>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="space-y-4">
                {/* Name + Email */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-[13px] text-[#666] mb-1.5">
                      Name <span className="text-[#ff4d6d]">*</span>
                    </label>
                    <input
                      name="name"
                      value={form.name}
                      onChange={handleChange}
                      placeholder="Your name"
                      required
                      className="w-full h-[44px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333] transition-colors"
                    />
                  </div>
                  <div>
                    <label className="block text-[13px] text-[#666] mb-1.5">
                      Email <span className="text-[#ff4d6d]">*</span>
                    </label>
                    <input
                      name="email"
                      type="email"
                      value={form.email}
                      onChange={handleChange}
                      placeholder="your@email.com"
                      required
                      className="w-full h-[44px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333] transition-colors"
                    />
                  </div>
                </div>

                {/* Category */}
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">Category</label>
                  <select
                    name="category"
                    value={form.category}
                    onChange={handleChange}
                    className="w-full h-[44px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] text-[#333] focus:outline-none focus:border-[#333] transition-colors bg-white"
                  >
                    {['General Inquiry', 'Membership & Verification', 'Order & Shipping', 'Returns & Exchanges', 'Payment & Invoice', 'Product Inquiry', 'Other'].map(
                      (opt) => <option key={opt}>{opt}</option>
                    )}
                  </select>
                </div>

                {/* Message */}
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Message <span className="text-[#ff4d6d]">*</span>
                  </label>
                  <textarea
                    name="message"
                    value={form.message}
                    onChange={handleChange}
                    placeholder="Describe your inquiry in detail…"
                    required
                    rows={5}
                    className="w-full px-4 py-3 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333] transition-colors resize-none"
                  />
                </div>

                <button
                  type="submit"
                  className="w-full h-[48px] bg-[#333] text-white rounded-lg font-semibold text-[14px] hover:bg-[#555] transition-colors flex items-center justify-center gap-2"
                >
                  <Send size={16} />
                  Send Message
                </button>
              </form>
            )}
          </div>
        </div>
      </section>

      {/* ── Notice Board ── */}
      <section className="bg-[#f8f8fa] py-12">
        <div className="max-w-[1100px] mx-auto px-4">
          <h2 className="text-[20px] font-bold text-[#333] mb-6">Notices</h2>
          <div className="bg-white rounded-xl border border-[#e5e5e5] divide-y divide-[#f0f0f0]">
            {[
              { badge: 'Notice', title: 'System maintenance scheduled – June 10, 2025 (02:00–04:00 KST)', date: '2025-06-03' },
              { badge: 'Update',  title: 'New brands added: AESTURA, Fation, Round Around', date: '2025-05-28' },
              { badge: 'Policy', title: 'Revised return & exchange policy effective June 1, 2025', date: '2025-05-20' },
              { badge: 'Notice', title: 'Holiday shipping schedule – Memorial Day (June 6)', date: '2025-05-15' },
              { badge: 'Update',  title: 'MOQ requirements updated for select skincare brands', date: '2025-05-10' },
            ].map(({ badge, title, date }) => (
              <div
                key={title}
                className="flex items-center justify-between px-5 py-4 hover:bg-[#f8f8fa] cursor-pointer transition-colors"
              >
                <div className="flex items-center gap-3">
                  <span
                    className={`text-[11px] font-semibold px-2 py-0.5 rounded ${
                      badge === 'Notice'
                        ? 'bg-[#4a90e2]/10 text-[#4a90e2]'
                        : badge === 'Policy'
                        ? 'bg-[#ff4d6d]/10 text-[#ff4d6d]'
                        : 'bg-[#2ecc71]/10 text-[#2ecc71]'
                    }`}
                  >
                    {badge}
                  </span>
                  <span className="text-[13px] text-[#333]">{title}</span>
                </div>
                <span className="text-[12px] text-[#999] shrink-0 ml-4">{date}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

    </div>
  );
}
