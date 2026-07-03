import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import {
  Clock,
  XCircle,
  Phone,
  Mail,
  CheckCircle2,
  FileText,
  MessageCircle,
} from 'lucide-react';

export default function PendingApproval() {
  const { currentUser, logout } = useStore();
  const { t } = useTranslation();
  const status = currentUser?.status ?? 'pending';

  return (
    <div className="min-h-screen bg-[#f8f8fa] flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-[520px]">

        {/* Status card */}
        <div className="bg-white rounded-2xl border border-[#e5e5e5] p-8 text-center mb-5">
          {status === 'pending' ? (
            <>
              <div className="w-16 h-16 rounded-full bg-yellow-50 flex items-center justify-center mx-auto mb-4">
                <Clock size={32} className="text-yellow-500" />
              </div>
              <h1 className="text-[22px] font-bold text-[#222] mb-2">
                {t('auth.pendingTitle')}
              </h1>
              <p className="text-[14px] text-[#666] leading-relaxed mb-4">
                {t('auth.pendingDesc')}
              </p>
              <div className="inline-flex items-center gap-2 bg-yellow-50 border border-yellow-200 text-yellow-700 text-[13px] font-semibold px-4 py-2 rounded-full">
                <Clock size={14} />
                {t('status.pending')}
              </div>
            </>
          ) : (
            <>
              <div className="w-16 h-16 rounded-full bg-red-50 flex items-center justify-center mx-auto mb-4">
                <XCircle size={32} className="text-red-500" />
              </div>
              <h1 className="text-[22px] font-bold text-[#222] mb-2">
                {t('auth.notApproved')}
              </h1>
              <p className="text-[14px] text-[#666] leading-relaxed mb-4">
                {t('auth.notApprovedDesc')}
              </p>
              <div className="inline-flex items-center gap-2 bg-red-50 border border-red-200 text-red-700 text-[13px] font-semibold px-4 py-2 rounded-full">
                <XCircle size={14} />
                {t('account.notApproved')}
              </div>
            </>
          )}
        </div>

        {/* Account info */}
        <div className="bg-white rounded-2xl border border-[#e5e5e5] p-5 mb-5">
          <h2 className="text-[13px] font-semibold text-[#aaa] uppercase tracking-wide mb-3">
            {t('auth.yourApplication')}
          </h2>
          <div className="space-y-2 text-[13px]">
            <div className="flex justify-between">
              <span className="text-[#888]">{t('auth.company')}</span>
              <span className="font-medium text-[#333]">{currentUser?.companyName}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#888]">{t('auth.email')}</span>
              <span className="font-medium text-[#333]">{currentUser?.email}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#888]">{t('auth.businessRegNo')}</span>
              <span className="font-medium text-[#333]">{currentUser?.businessNumber}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-[#888]">{t('auth.appliedOn')}</span>
              <span className="font-medium text-[#333]">
                {(currentUser as any)?.registeredDate ?? '—'}
              </span>
            </div>
          </div>
        </div>

        {/* What's next */}
        {status === 'pending' && (
          <div className="bg-white rounded-2xl border border-[#e5e5e5] p-5 mb-5">
            <h2 className="text-[13px] font-semibold text-[#aaa] uppercase tracking-wide mb-3">
              {t('auth.whatsNext')}
            </h2>
            <div className="space-y-3">
              {[
                { icon: <FileText size={15} className="text-[#4a90e2]" />, text: t('auth.step1') },
                { icon: <CheckCircle2 size={15} className="text-[#4a90e2]" />, text: t('auth.step2') },
                { icon: <Mail size={15} className="text-[#4a90e2]" />, text: t('auth.step3') },
              ].map((item, i) => (
                <div key={i} className="flex items-start gap-3">
                  <div className="shrink-0 mt-0.5">{item.icon}</div>
                  <p className="text-[13px] text-[#555]">{item.text}</p>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Contact support */}
        <div className="bg-[#f0f7ff] border border-[#4a90e2]/20 rounded-2xl p-5 mb-6">
          <h2 className="text-[13px] font-semibold text-[#4a90e2] uppercase tracking-wide mb-3">
            {t('auth.needHelp')}
          </h2>
          <div className="space-y-2">
            <a
              href="tel:1544-1234"
              className="flex items-center gap-3 text-[13px] text-[#555] hover:text-[#4a90e2] transition-colors"
            >
              <Phone size={14} className="text-[#4a90e2]" />
              1544-1234 (Mon–Fri 09:00–18:00)
            </a>
            <a
              href="mailto:support@welmes.kr"
              className="flex items-center gap-3 text-[13px] text-[#555] hover:text-[#4a90e2] transition-colors"
            >
              <Mail size={14} className="text-[#4a90e2]" />
              support@welmes.kr
            </a>
            <Link
              to="/support"
              className="flex items-center gap-3 text-[13px] text-[#555] hover:text-[#4a90e2] transition-colors"
            >
              <MessageCircle size={14} className="text-[#4a90e2]" />
              {t('auth.visitSupport')}
            </Link>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3">
          <Link
            to="/account"
            className="flex-1 py-3 border border-[#ddd] rounded-xl text-[13px] font-medium text-[#555] text-center hover:bg-[#f5f5f5] transition-colors"
          >
            {t('account.title')}
          </Link>
          <button
            onClick={logout}
            className="flex-1 py-3 bg-[#333] text-white rounded-xl text-[13px] font-semibold hover:bg-[#555] transition-colors"
          >
            {t('common.logout')}
          </button>
        </div>

      </div>
    </div>
  );
}
