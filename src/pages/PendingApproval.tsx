import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import { initialProducts } from '../data/products';
import ProductCard from '../components/ProductCard';
import {
  Clock,
  XCircle,
  Phone,
  Mail,
  CheckCircle2,
  FileText,
  MessageCircle,
  Check,
} from 'lucide-react';

export default function PendingApproval() {
  const { currentUser, logout, products } = useStore();
  const { t } = useTranslation();
  const status = currentUser?.status ?? 'pending';
  const previewProducts = (products.length > 0 ? products : initialProducts).slice(0, 4);

  return (
    <div className="min-h-screen bg-canvas flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-[560px]">

        {/* Status card */}
        <div className="bg-white rounded-sm border border-line p-8 text-center mb-5">
          {status === 'pending' ? (
            <>
              <div className="w-16 h-16 rounded-full border border-line flex items-center justify-center mx-auto mb-4">
                <Clock size={32} className="text-ink-700" />
              </div>
              <h1 className="font-serif text-[30px] font-normal leading-[38px] text-ink-700 mb-2">
                {t('auth.pendingTitle')}
              </h1>
              <p className="text-[14px] text-ink-500 leading-relaxed mb-4">
                {t('auth.pendingDesc')}
              </p>
              <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ink-700">
                <span className="h-1.5 w-1.5 rounded-full bg-ink-500" />
                {t('status.pending')}
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full border border-line flex items-center justify-center mx-auto mb-4">
                <XCircle size={32} className="text-signal-error" />
              </div>
              <h1 className="font-serif text-[30px] font-normal leading-[38px] text-ink-700 mb-2">
                {t('auth.notApproved')}
              </h1>
              <p className="text-[14px] text-ink-500 leading-relaxed mb-4">
                {t('auth.notApprovedDesc')}
              </p>
              <div className="inline-flex items-center gap-1.5 text-[13px] font-bold text-ink-700">
                <span className="h-1.5 w-1.5 rounded-full bg-signal-error" />
                {t('account.notApproved')}
              </div>
            </>
          )}
        </div>

        {/* Progress stepper — a concrete "where am I" beat instead of a bare
            date-range sentence; the vague wait is what drives abandonment. */}
        {status === 'pending' && (
          <div className="bg-white rounded-sm border border-line p-5 mb-5">
            <div className="flex items-center">
              {[
                { label: t('auth.stepSubmitted'), done: true },
                { label: t('auth.stepReviewing'), done: true, current: true },
                { label: t('auth.stepApproved'), done: false },
              ].map((s, i, arr) => (
                <div key={i} className={`flex items-center ${i < arr.length - 1 ? 'flex-1' : ''}`}>
                  <div className="flex flex-col items-center gap-1.5 shrink-0">
                    <div className={`w-7 h-7 rounded-full flex items-center justify-center text-[11px] font-bold ${
                      s.done ? (s.current ? 'bg-ink-900 text-white ring-2 ring-ink-900 ring-offset-2' : 'bg-ink-900 text-white') : 'border border-line-strong bg-canvas text-ink-500'
                    }`}>
                      {s.done && !s.current ? <Check size={13} /> : i + 1}
                    </div>
                    <span className={`text-[11px] text-center whitespace-nowrap ${s.done ? 'text-ink-900 font-bold' : 'text-ink-500'}`}>
                      {s.label}
                    </span>
                  </div>
                  {i < arr.length - 1 && (
                    <div className={`flex-1 h-[2px] mb-5 ${arr[i + 1].done ? 'bg-ink-900' : 'bg-line'}`} />
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Account info */}
        <div className="bg-white rounded-sm border border-line p-5 mb-5">
          <h2 className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.02em] mb-3">
            {t('auth.yourApplication')}
          </h2>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-ink-500">{t('auth.company')}</span>
              <span className="font-medium text-ink-700">{currentUser?.companyName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-500">{t('auth.email')}</span>
              <span className="font-medium text-ink-700">{currentUser?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-500">{t('auth.businessRegNo')}</span>
              <span className="font-medium text-ink-700">{currentUser?.businessNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-ink-500">{t('auth.appliedOn')}</span>
              <span className="font-medium text-ink-700">
                {currentUser?.registeredDate ?? '—'}
              </span>
            </div>
          </div>
        </div>

        {/* What's next */}
        {status === 'pending' && (
          <div className="bg-white rounded-sm border border-line p-5 mb-5">
            <h2 className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.02em] mb-3">
              {t('auth.whatsNext')}
            </h2>
            <div className="space-y-3">
              {[
                { icon: <FileText size={15} className="text-ink-500" />, text: t('auth.step1') },
                { icon: <CheckCircle2 size={15} className="text-ink-500" />, text: t('auth.step2') },
                { icon: <Mail size={15} className="text-ink-500" />, text: t('auth.step3') },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">{item.icon}</div>
                  <p className="text-[13px] text-ink-500">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* What changes after approval — a concrete reason to keep waiting,
            not just a rules explanation. No prices here: what pricing gets
            shown to unapproved visitors is a separate, not-yet-decided policy. */}
        {status === 'pending' && (
          <div className="bg-white rounded-sm border border-line p-5 mb-5">
            <h2 className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.02em] mb-3">
              {t('auth.afterApproval')}
            </h2>
            <div className="space-y-2">
              {[
                t('auth.afterApproval1'),
                t('auth.afterApproval2'),
                t('auth.afterApproval3'),
                t('auth.afterApproval4'),
              ].map((line, i) => (
                <div key={i} className="flex items-start gap-2.5">
                  <CheckCircle2 size={15} className="text-ink-700 shrink-0 mt-0.5" />
                  <p className="text-[13px] text-ink-500">{line}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Browse while waiting — pricing stays masked (same as any other
            unapproved visitor), but gives them something to do besides
            leaving the tab open for two days. */}
        {status === 'pending' && previewProducts.length > 0 && (
          <div className="bg-white rounded-sm border border-line p-5 mb-5">
            <div className="flex items-center justify-between mb-3">
              <h2 className="text-[11px] font-bold text-ink-500 uppercase tracking-[0.02em]">
                {t('auth.browseWhileWaitingTitle')}
              </h2>
              <Link to="/products" className="text-[12px] font-bold text-ink-900 underline underline-offset-2">
                {t('common.viewAll')}
              </Link>
            </div>
            <div className="grid grid-cols-2 gap-x-2 gap-y-6">
              {previewProducts.map((p) => (
                <ProductCard key={p.id} product={p} showQuickAdd={false} />
              ))}
            </div>
          </div>
        )}

        {/* Contact support */}
        <div className="bg-sunken border border-line rounded-sm p-5 mb-6">
          <h2 className="text-[11px] font-bold text-ink-500 uppercase tracking-wide mb-3">
            {t('auth.needHelp')}
          </h2>
          <div className="space-y-2">
            <a
              href="tel:1544-1234"
              className="flex items-center gap-3 text-[13px] text-ink-700 hover:text-ink-900 transition-colors"
            >
              <Phone size={14} className="text-ink-500" />
              1544-1234 (Mon–Fri 09:00–18:00)
            </a>
            <a
              href="mailto:support@welmes.kr"
              className="flex items-center gap-3 text-[13px] text-ink-700 hover:text-ink-900 transition-colors"
            >
              <Mail size={14} className="text-ink-500" />
              support@welmes.kr
            </a>
            <Link
              to="/support"
              className="flex items-center gap-3 text-[13px] text-ink-700 hover:text-ink-900 transition-colors"
            >
              <MessageCircle size={14} className="text-ink-500" />
              {t('auth.visitSupport')}
            </Link>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Link
            to="/account"
            className="flex-1 h-11 flex items-center justify-center border border-line-strong rounded-lg text-[13px] font-bold text-ink-700 text-center hover:bg-sunken transition-colors"
          >
            {t('account.title')}
          </Link>
          <button
            onClick={logout}
            className="flex-1 h-11 bg-ink-700 text-white rounded-lg text-[13px] hover:bg-ink-900 transition-colors"
          >
            {t('common.logout')}
          </button>
        </div>

      </div>
    </div>
  );
}
