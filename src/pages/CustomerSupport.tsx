import { useState, useEffect, useRef } from 'react';
import { Phone, Mail, MapPin, Clock, ChevronDown, ChevronUp, Send, CheckCircle, MessageCircle, Loader2 } from 'lucide-react';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import { supabase } from '../lib/supabase';
import * as db from '../lib/db';
import type { SupportRoom, SupportMessage } from '../lib/db';

function FaqItem({ q, a }: { q: string; a: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="border border-line rounded-lg overflow-hidden">
      <button onClick={() => setOpen(!open)} className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-sunken transition-colors">
        <span className="text-[14px] font-bold text-ink-900 pr-4">{q}</span>
        {open ? <ChevronUp size={18} className="text-ink-500 shrink-0" /> : <ChevronDown size={18} className="text-ink-500 shrink-0" />}
      </button>
      {open && (
        <div className="px-5 pb-5 border-t border-line bg-sunken">
          <p className="text-[13px] text-ink-500 leading-relaxed pt-4">{a}</p>
        </div>
      )}
    </div>
  );
}

// ─── Live Chat Component ─────────────────────────────────────────────────────

function LiveChat() {
  const { isAuthenticated, currentUser } = useStore();
  const { t } = useTranslation();
  const [room, setRoom] = useState<SupportRoom | null>(null);
  const [messages, setMessages] = useState<SupportMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [sending, setSending] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });

  useEffect(() => { scrollToBottom(); }, [messages]);

  useEffect(() => {
    if (!isAuthenticated || !currentUser) return;
    setLoading(true);
    db.getOrCreateRoom(
      currentUser.authId ?? currentUser.id,
      currentUser.companyName || currentUser.email,
      currentUser.email,
    ).then((r) => {
      setRoom(r);
      if (r) return db.fetchMessages(r.id);
      return [];
    }).then((msgs) => {
      setMessages(msgs);
      setLoading(false);
    });
  }, [isAuthenticated, currentUser]);

  useEffect(() => {
    if (!room) return;
    const channel = supabase
      .channel(`room:${room.id}`)
      .on('postgres_changes', {
        event: 'INSERT',
        schema: 'public',
        table: 'support_messages',
        filter: `room_id=eq.${room.id}`,
      }, (payload) => {
        const r = payload.new as Record<string, unknown>;
        const msg: SupportMessage = {
          id: r.id as string,
          roomId: r.room_id as string,
          senderId: r.sender_id as string,
          senderName: (r.sender_name as string) || '',
          role: r.role as 'member' | 'admin',
          content: r.content as string,
          createdAt: r.created_at as string,
        };
        setMessages((prev) => prev.some((m) => m.id === msg.id) ? prev : [...prev, msg]);
      })
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [room]);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!input.trim() || !room || !currentUser || sending) return;
    setSending(true);
    const content = input.trim();
    setInput('');
    await db.sendMessage(
      room.id,
      currentUser.authId ?? currentUser.id,
      currentUser.companyName || currentUser.email,
      'member',
      content,
    );
    setSending(false);
  };

  if (!isAuthenticated) {
    return (
      <div className="flex flex-col items-center justify-center py-24 text-center">
        <MessageCircle size={48} className="text-line-strong mb-4" />
        <h3 className="text-[18px] font-bold text-ink-700 mb-2">{t('support.loginToChat')}</h3>
        <p className="text-[14px] text-ink-500">{t('support.loginToChatDesc')}</p>
      </div>
    );
  }

  if (loading) {
    return (
      <div className="flex items-center justify-center py-24">
        <Loader2 size={32} className="animate-spin text-ink-500" />
      </div>
    );
  }

  return (
    <div className="max-w-[680px] mx-auto">
      {/* Chat header */}
      <div className="bg-ink-900 rounded-t-[10px] px-5 py-4 flex items-center gap-3">
        <div className="w-9 h-9 bg-white/10 rounded-full flex items-center justify-center shrink-0">
          <MessageCircle size={18} className="text-white" />
        </div>
        <div>
          <p className="text-white font-semibold text-[14px]">{t('support.liveSupport')}</p>
          <p className="text-white/60 text-[12px] flex items-center gap-1">
            <span className="w-2 h-2 bg-signal-ok rounded-full inline-block" />
            {t('support.onlineStatus')}
          </p>
        </div>
        {room?.status === 'closed' && (
          <span className="ml-auto inline-flex items-center gap-1.5 text-[11px] font-bold text-white/80"><span className="h-1.5 w-1.5 rounded-full bg-signal-error" />{t('support.chatClosed')}</span>
        )}
      </div>

      {/* Messages */}
      <div className="bg-white border-x border-line h-[420px] overflow-y-auto px-5 py-5 space-y-4">
        {messages.length === 0 && (
          <div className="flex flex-col items-center justify-center h-full text-center">
            <MessageCircle size={36} className="text-line-strong mb-3" />
            <p className="text-[14px] text-ink-500 font-medium">{t('support.startConversation')}</p>
            <p className="text-[12px] text-ink-300 mt-1">{t('support.teamReady')}</p>
          </div>
        )}
        {messages.map((msg) => {
          const isMe = msg.role === 'member';
          return (
            <div key={msg.id} className={`flex gap-3 ${isMe ? 'flex-row-reverse' : 'flex-row'}`}>
              {!isMe && (
                <div className="w-8 h-8 bg-ink-900 rounded-full flex items-center justify-center shrink-0 mt-auto">
                  <span className="text-white text-[11px] font-bold">W</span>
                </div>
              )}
              <div className={`max-w-[75%] ${isMe ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
                {!isMe && <span className="text-[11px] text-ink-500 px-1">Support Team</span>}
                <div className={`px-4 py-2.5 rounded-[10px] text-[14px] leading-relaxed ${
                  isMe
                    ? 'bg-ink-900 text-white rounded-br-sm'
                    : 'bg-sunken text-ink-900 rounded-bl-sm'
                }`}>
                  {msg.content}
                </div>
                <span className="text-[11px] text-ink-300 px-1">
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </span>
              </div>
            </div>
          );
        })}
        <div ref={messagesEndRef} />
      </div>

      {/* Input */}
      <div className="bg-white border border-line rounded-b-[10px] px-4 py-3">
        {room?.status === 'closed' ? (
          <p className="text-center text-[13px] text-ink-500 py-2">{t('support.conversationClosed')}</p>
        ) : (
          <form onSubmit={handleSend} className="flex gap-2">
            <input
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder={t('support.typeMessage')}
              className="flex-1 h-[42px] px-4 bg-canvas border border-line-strong rounded-full text-[14px] text-ink-700 placeholder:text-ink-300 focus:outline-none focus:border-ink-900"
            />
            <button
              type="submit"
              disabled={!input.trim() || sending}
              className="w-[42px] h-[42px] bg-ink-900 rounded-full flex items-center justify-center text-white hover:shadow-hover transition-shadow disabled:opacity-40"
            >
              {sending ? <Loader2 size={16} className="animate-spin" /> : <Send size={16} />}
            </button>
          </form>
        )}
      </div>

      <p className="text-center text-[11px] text-ink-300 mt-3">
        {t('support.poweredBy')}
      </p>
    </div>
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

type PageTab = 'faq' | 'contact' | 'chat';

export default function CustomerSupport() {
  const { t } = useTranslation();
  const [pageTab, setPageTab] = useState<PageTab>('faq');
  const [activeCategory, setActiveCategory] = useState('membership');
  const [submitted, setSubmitted] = useState(false);
  const [form, setForm] = useState({ name: '', email: '', category: '', message: '' });

  const faqCategories = [
    { id: 'membership', label: t('support.faqCategories.membership') },
    { id: 'orders', label: t('support.faqCategories.orders') },
    { id: 'returns', label: t('support.faqCategories.returns') },
    { id: 'payment', label: t('support.faqCategories.payment') },
    { id: 'products', label: t('support.faqCategories.products') },
  ];

  const faqData = {
    membership: t('support.faqs.membership', { returnObjects: true }) as { q: string; a: string }[],
    orders: t('support.faqs.orders', { returnObjects: true }) as { q: string; a: string }[],
    returns: t('support.faqs.returns', { returnObjects: true }) as { q: string; a: string }[],
    payment: t('support.faqs.payment', { returnObjects: true }) as { q: string; a: string }[],
    products: t('support.faqs.products', { returnObjects: true }) as { q: string; a: string }[],
  };

  const formCategories = t('support.formCategories', { returnObjects: true }) as string[];

  const contactCards = [
    { icon: Phone,  label: t('support.phone'),  value: '1544-1234',        sub: 'Mon – Fri  09:00 – 18:00\n(Lunch 12:00 – 13:00)' },
    { icon: Mail,   label: t('support.email'),  value: 'support@welmes.kr', sub: 'We reply within 1 business day' },
    { icon: MapPin, label: t('support.address'), value: 'WELMES Tower 15F', sub: '123 Teheran-ro, Gangnam-gu\nSeoul, South Korea' },
    { icon: Clock,  label: t('support.hours'),  value: 'Mon – Fri',        sub: '09:00 – 18:00 KST\nClosed on weekends & holidays' },
  ];

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!form.name || !form.email || !form.message) return;
    setSubmitted(true);
  };

  const handleChange = (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [e.target.name]: e.target.value });

  const currentFaqs = faqData[activeCategory as keyof typeof faqData] ?? [];

  return (
    <div className="min-h-screen bg-white">

      {/* Hero */}
      <section className="bg-sunken border-b border-line py-16">
        <div className="max-w-[1100px] mx-auto px-4 text-center">
          <h1 className="text-[30px] font-extrabold tracking-[-0.02em] text-ink-900 mb-3">{t('support.title')}</h1>
          <p className="text-ink-500 text-[15px] max-w-[520px] mx-auto leading-relaxed">
            {t('support.subtitle')}
          </p>
        </div>
      </section>

      {/* Contact Cards */}
      <section className="max-w-[1100px] mx-auto px-4 py-12">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-5">
          {contactCards.map(({ icon: Icon, label, value, sub }) => (
            <div key={label} className="border border-line rounded-[10px] p-5">
              <div className="w-10 h-10 rounded-lg border border-line flex items-center justify-center mb-4">
                <Icon size={20} className="text-ink-700" />
              </div>
              <p className="text-[11px] text-ink-500 font-bold uppercase tracking-[0.02em] mb-1">{label}</p>
              <p className="text-[15px] font-bold tabular-nums text-ink-900 mb-1">{value}</p>
              <p className="text-[12px] text-ink-500 leading-relaxed whitespace-pre-line">{sub}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Tab Navigation */}
      <section className="border-b border-line bg-canvas sticky top-[112px] md:top-[121px] z-10">
        <div className="max-w-[1100px] mx-auto px-4 flex gap-0">
          {([
            { id: 'faq',     label: t('support.faq') },
            { id: 'contact', label: t('support.contactForm') },
            { id: 'chat',    label: t('support.liveChat') },
          ] as { id: PageTab; label: string }[]).map((tab) => (
            <button
              key={tab.id}
              onClick={() => setPageTab(tab.id)}
              className={`px-6 py-4 text-[14px] font-semibold border-b-2 transition-colors ${
                pageTab === tab.id
                  ? 'border-ink-900 font-bold text-ink-900'
                  : 'border-transparent text-ink-500 hover:text-ink-900'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </section>

      {/* FAQ Tab */}
      {pageTab === 'faq' && (
        <section className="bg-canvas py-14">
          <div className="max-w-[1100px] mx-auto px-4">
            <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-ink-900 mb-2">{t('support.faqTitle')}</h2>
            <p className="text-[13px] text-ink-500 mb-8">{t('support.faqSubtitle')}</p>
            <div className="flex flex-wrap gap-2 mb-6">
              {faqCategories.map((cat) => (
                <button
                  key={cat.id}
                  onClick={() => setActiveCategory(cat.id)}
                  className={`h-8 px-3.5 rounded-md text-[13px] transition-colors ${
                    activeCategory === cat.id
                      ? 'bg-ink-900 border border-ink-900 font-bold text-white'
                      : 'bg-canvas border border-line-strong text-ink-700 hover:border-ink-900'
                  }`}
                >
                  {cat.label}
                </button>
              ))}
            </div>
            <div className="space-y-3">
              {currentFaqs.map((item, i) => <FaqItem key={i} q={item.q} a={item.a} />)}
            </div>
          </div>
        </section>
      )}

      {/* Contact Form Tab */}
      {pageTab === 'contact' && (
        <section className="max-w-[1100px] mx-auto px-4 py-14">
          <div className="grid grid-cols-1 md:grid-cols-2 gap-12 items-start">
            <div>
              <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-ink-900 mb-3">{t('support.sendMessage')}</h2>
              <p className="text-[14px] text-ink-500 leading-relaxed mb-6">
                {t('support.sendMessageDesc')}
              </p>
              <div className="bg-sunken rounded-[10px] p-5 space-y-3">
                {[
                  { label: t('support.phone'), value: '1544-1234' },
                  { label: t('support.email'), value: 'support@welmes.kr' },
                  { label: t('support.hours'), value: 'Mon – Fri  09:00 – 18:00 KST' },
                ].map(({ label, value }) => (
                  <div key={label} className="flex gap-3">
                    <span className="text-[11px] font-bold text-ink-500 w-12 pt-0.5 uppercase tracking-[0.02em]">{label}</span>
                    <span className="text-[13px] text-ink-700">{value}</span>
                  </div>
                ))}
              </div>
            </div>
            <div>
              {submitted ? (
                <div className="flex flex-col items-center justify-center py-16 text-center">
                  <CheckCircle size={48} className="text-signal-ok mb-4" />
                  <h3 className="text-[20px] font-bold text-ink-700 mb-2">{t('support.messageSent')}</h3>
                  <p className="text-[14px] text-ink-500">
                    {t('support.thankYouMsg', { name: form.name, email: form.email })}
                  </p>
                  <button
                    onClick={() => { setSubmitted(false); setForm({ name: '', email: '', category: '', message: '' }); }}
                    className="mt-6 text-[13px] font-bold text-ink-900 underline underline-offset-2"
                  >
                    {t('support.sendAnother')}
                  </button>
                </div>
              ) : (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-[13px] text-ink-500 mb-1.5">{t('support.name')} <span className="text-ink-900">*</span></label>
                      <input name="name" value={form.name} onChange={handleChange} placeholder={t('support.namePlaceholder')} required className="w-full h-[44px] px-4 border border-line-strong rounded-lg bg-canvas text-[14px] text-ink-700 placeholder:text-ink-300 focus:outline-none focus:border-ink-900 transition-colors" />
                    </div>
                    <div>
                      <label className="block text-[13px] text-ink-500 mb-1.5">{t('support.email')} <span className="text-ink-900">*</span></label>
                      <input name="email" type="email" value={form.email} onChange={handleChange} placeholder="your@email.com" required className="w-full h-[44px] px-4 border border-line-strong rounded-lg bg-canvas text-[14px] text-ink-700 placeholder:text-ink-300 focus:outline-none focus:border-ink-900 transition-colors" />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[13px] text-ink-500 mb-1.5">{t('support.category')}</label>
                    <select name="category" value={form.category} onChange={handleChange} className="w-full h-[44px] px-4 border border-line-strong rounded-lg text-[14px] text-ink-700 focus:outline-none focus:border-ink-900 transition-colors bg-canvas">
                      {formCategories.map((opt) => <option key={opt}>{opt}</option>)}
                    </select>
                  </div>
                  <div>
                    <label className="block text-[13px] text-ink-500 mb-1.5">{t('support.message')} <span className="text-ink-900">*</span></label>
                    <textarea name="message" value={form.message} onChange={handleChange} placeholder={t('support.messagePlaceholder')} required rows={5} className="w-full px-4 py-3 border border-line-strong rounded-lg bg-canvas text-[14px] text-ink-700 placeholder:text-ink-300 focus:outline-none focus:border-ink-900 transition-colors resize-none" />
                  </div>
                  <button type="submit" className="w-full h-11 bg-ink-900 text-white rounded-lg font-bold text-[14px] hover:shadow-hover transition-shadow flex items-center justify-center gap-2">
                    <Send size={16} />
                    {t('support.send')}
                  </button>
                </form>
              )}
            </div>
          </div>
        </section>
      )}

      {/* Live Chat Tab */}
      {pageTab === 'chat' && (
        <section className="max-w-[1100px] mx-auto px-4 py-14">
          <div className="mb-8">
            <h2 className="text-[22px] font-extrabold tracking-[-0.01em] text-ink-900 mb-2">{t('support.liveChatTitle')}</h2>
            <p className="text-[13px] text-ink-500">{t('support.liveChatDesc')}</p>
          </div>
          <LiveChat />
        </section>
      )}

      {/* Notices */}
      <section className="bg-sunken border-t border-line py-12">
        <div className="max-w-[1100px] mx-auto px-4">
          <h2 className="text-[17px] font-extrabold tracking-[-0.01em] text-ink-900 mb-5">{t('support.notices')}</h2>
          <div className="bg-canvas rounded-[10px] border border-line divide-y divide-line">
            {[
              { badge: 'Notice', title: 'System maintenance scheduled – June 10, 2025 (02:00–04:00 KST)', date: '2025-06-03' },
              { badge: 'Update',  title: 'New brands added: AESTURA, Fation, Round Around', date: '2025-05-28' },
              { badge: 'Policy', title: 'Revised return & exchange policy effective June 1, 2025', date: '2025-05-20' },
              { badge: 'Notice', title: 'Holiday shipping schedule – Memorial Day (June 6)', date: '2025-05-15' },
              { badge: 'Update',  title: 'MOQ requirements updated for select skincare brands', date: '2025-05-10' },
            ].map(({ badge, title, date }) => (
              <div key={title} className="flex items-center justify-between px-5 py-4 hover:bg-sunken cursor-pointer transition-colors">
                <div className="flex items-center gap-3">
                  <span className="w-[62px] shrink-0 rounded-sm border border-line-strong bg-canvas px-[7px] py-[3px] text-center text-[11px] font-bold tracking-[0.02em] text-ink-700">{badge}</span>
                  <span className="text-[13px] text-ink-700">{title}</span>
                </div>
                <span className="text-[12px] tabular-nums text-ink-500 shrink-0 ml-4">{date}</span>
              </div>
            ))}
          </div>
        </div>
      </section>
    </div>
  );
}
