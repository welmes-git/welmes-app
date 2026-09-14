import { useState, useRef } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import Logo from '../components/Logo';
import { Eye, EyeOff, Check, Upload, FileText, X, ChevronLeft } from 'lucide-react';

const MAX_CERT_BYTES = 5 * 1024 * 1024; // 5 MB

/** Account → business → verification → done. Progress mirrors Faire's 4px bar. */
type Step = 1 | 2 | 3 | 4;
const PROGRESS: Record<Step, number> = { 1: 15, 2: 50, 3: 85, 4: 100 };

// Faire Slate form field: 14/20 label, 40px field, 1px #dadada, 4px radius, 16px padding
const labelCls = 'text-[14px] leading-5 text-ink-700';
const fieldCls =
  'h-10 w-full rounded-sm border border-line-control bg-white px-4 text-[14px] text-ink-700 focus:border-ink-700 focus:outline-none';

/**
 * Faire retailer sign-up ("/welcome/r/personal"): full-screen page with a compact centred logo,
 * a 4px progress bar, then a single-column step — 24px/32px padding on mobile, 720px wide with
 * 120px/64px padding on desktop — serif 30/38 title, 14/20 subtitle, fields, full-width 48px Next.
 * Next stays disabled until the step is valid, so errors never need a toast.
 */
export default function Register() {
  const { registerMember, showToast } = useStore();
  const { t } = useTranslation();
  const location = useLocation();
  const [step, setStep] = useState<Step>(1);
  const [showPassword, setShowPassword] = useState(false);

  // Prefilled from the product sign-up modal (router state)
  const [email, setEmail] = useState((location.state as { email?: string } | null)?.email ?? '');
  const [representative, setRepresentative] = useState('');
  const [password, setPassword] = useState('');
  const [agreeMarketing, setAgreeMarketing] = useState(false);
  const [companyName, setCompanyName] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const stepValid = {
    1: /\S+@\S+\.\S+/.test(email) && representative.trim() !== '' && password.length >= 8,
    2: companyName.trim() !== '' && businessNumber.trim() !== '' && phone.trim() !== '',
    3: !!certificateFile && agreeTerms && agreePrivacy,
    4: true,
  }[step];

  const handleCertPick = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file
    if (!file) return;
    if (file.size > MAX_CERT_BYTES) {
      showToast(t('auth.certTooLarge'), 'error');
      return;
    }
    setCertificateFile(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!stepValid || submitting) return;
    if (step < 3) {
      setStep((step + 1) as Step);
      window.scrollTo(0, 0);
      return;
    }
    setSubmitting(true);
    const result = await registerMember({ email, password, companyName, businessNumber, representative, phone, address, certificateFile });
    setSubmitting(false);
    if (result.error) {
      showToast(result.error, 'error');
      return;
    }
    setStep(4);
    window.scrollTo(0, 0);
  };

  const titles: Record<Step, [string, string]> = {
    1: [t('signup.step1Title'), t('signup.step1Subtitle')],
    2: [t('signup.step2Title'), t('signup.step2Subtitle')],
    3: [t('signup.step3Title'), t('signup.step3Subtitle')],
    4: [t('signup.doneTitle'), `${t('auth.registerSuccess')} ${t('auth.pendingNote')}`],
  };

  return (
    <div className="flex min-h-screen flex-col bg-white tracking-[0.15px]">
      <header className="grid w-full grid-cols-3 items-center">
        <span className="pl-4 md:pl-6">
          {step > 1 && step < 4 && (
            <button
              type="button"
              onClick={() => setStep((step - 1) as Step)}
              className="flex items-center gap-1 text-[14px] leading-5 text-ink-700 hover:text-ink-900"
            >
              <ChevronLeft size={16} strokeWidth={1.5} />
              {t('common.back')}
            </button>
          )}
        </span>
        <div className="flex justify-center py-4">
          <Link to="/" aria-label="WELMES Business" className="flex">
            <Logo />
          </Link>
        </div>
        <span />
      </header>
      <div className="relative h-1 w-full bg-sunken">
        <progress className="sr-only" aria-label={t('signup.progress')} max={100} value={PROGRESS[step]} />
        <div className="h-full bg-ink-700 transition-[width] duration-1000 ease-in-out" style={{ width: `${PROGRESS[step]}%` }} />
      </div>

      <form onSubmit={handleSubmit} noValidate>
        <div key={step} className="signup-slide m-auto flex w-full flex-col gap-8 px-6 py-8 md:max-w-[720px] md:px-[120px] md:py-16">
          <div className="flex flex-col gap-3">
            <h1 className="font-serif text-[30px] font-normal leading-[38px] tracking-normal text-ink-700">{titles[step][0]}</h1>
            <p className="text-[14px] leading-5 text-ink-700">{titles[step][1]}</p>
          </div>

          {step === 1 && (
            <>
              <div className="flex flex-col">
                <label htmlFor="signup-name" className={labelCls}>{t('auth.representative')}</label>
                <input id="signup-name" autoComplete="name" value={representative} onChange={(e) => setRepresentative(e.target.value)} className={fieldCls} />
              </div>
              <div className="flex flex-col">
                <label htmlFor="signup-email" className={labelCls}>{t('signupModal.email')}</label>
                <input id="signup-email" type="email" autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} className={fieldCls} />
              </div>
              <div className="flex flex-col">
                <label htmlFor="signup-password" className={labelCls}>{t('auth.password')}</label>
                <div className="relative">
                  <input
                    id="signup-password"
                    type={showPassword ? 'text' : 'password'}
                    autoComplete="new-password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    className={`${fieldCls} pr-12`}
                  />
                  <button
                    type="button"
                    onClick={() => setShowPassword((v) => !v)}
                    aria-label={t(showPassword ? 'signup.hidePassword' : 'signup.showPassword')}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500"
                  >
                    {showPassword ? <EyeOff size={20} strokeWidth={1.25} /> : <Eye size={20} strokeWidth={1.25} />}
                  </button>
                </div>
                <p className="mt-1 text-[12px] leading-4 text-ink-700">{t('signup.passwordHint')}</p>
              </div>
              <label className="flex cursor-pointer items-start gap-2 text-[14px] leading-5 text-ink-700">
                <input type="checkbox" checked={agreeMarketing} onChange={(e) => setAgreeMarketing(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-ink-700" />
                {t('signup.marketing')}
              </label>
            </>
          )}

          {step === 2 && (
            <>
              <div className="flex flex-col">
                <label htmlFor="signup-company" className={labelCls}>{t('auth.companyName')}</label>
                <input id="signup-company" autoComplete="organization" value={companyName} onChange={(e) => setCompanyName(e.target.value)} className={fieldCls} />
              </div>
              <div className="flex flex-col gap-8 lg:flex-row lg:gap-4">
                <div className="flex w-full flex-col">
                  <label htmlFor="signup-bizno" className={labelCls}>{t('auth.businessNumber')}</label>
                  <input id="signup-bizno" value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)} className={fieldCls} />
                </div>
                <div className="flex w-full flex-col">
                  <label htmlFor="signup-phone" className={labelCls}>{t('auth.phone')}</label>
                  <input id="signup-phone" type="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className={fieldCls} />
                </div>
              </div>
              <div className="flex flex-col">
                <label htmlFor="signup-address" className={labelCls}>
                  {t('auth.address')} <span className="text-ink-500">({t('common.optional')})</span>
                </label>
                <input id="signup-address" autoComplete="street-address" value={address} onChange={(e) => setAddress(e.target.value)} className={fieldCls} />
              </div>
            </>
          )}

          {step === 3 && (
            <>
              <div className="flex flex-col">
                <span className={labelCls}>{t('auth.certLabel')}</span>
                <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp,application/pdf" className="hidden" onChange={handleCertPick} />
                {certificateFile ? (
                  <div className="flex w-full items-center gap-3 rounded-sm border border-ink-700 px-4 py-3">
                    <FileText size={20} strokeWidth={1.25} className="shrink-0 text-ink-700" />
                    <div className="min-w-0 flex-1">
                      <p className="truncate text-[14px] leading-5 text-ink-700">{certificateFile.name}</p>
                      <p className="text-[12px] leading-4 tabular-nums text-ink-500">{(certificateFile.size / 1024).toFixed(0)} KB</p>
                    </div>
                    <button type="button" onClick={() => setCertificateFile(null)} aria-label={t('common.close')} className="shrink-0 text-ink-500 hover:text-ink-900">
                      <X size={16} />
                    </button>
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => fileInputRef.current?.click()}
                    className="flex h-24 w-full flex-col items-center justify-center gap-1 rounded-sm border border-dashed border-line-control transition-colors hover:border-ink-700"
                  >
                    <Upload size={20} strokeWidth={1.25} className="text-ink-700" />
                    <span className="text-[14px] leading-5 text-ink-700">{t('auth.certUpload')}</span>
                    <span className="text-[12px] leading-4 text-ink-500">{t('auth.certHint')}</span>
                  </button>
                )}
              </div>
              <div className="flex flex-col gap-4">
                <label className="flex cursor-pointer items-start gap-2 text-[14px] leading-5 text-ink-700">
                  <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-ink-700" />
                  {t('signup.agreeTerms')}
                </label>
                <label className="flex cursor-pointer items-start gap-2 text-[14px] leading-5 text-ink-700">
                  <input type="checkbox" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} className="mt-0.5 size-4 shrink-0 accent-ink-700" />
                  {t('signup.agreePrivacy')}
                </label>
              </div>
            </>
          )}

          {step === 4 && (
            <div className="flex flex-col gap-2 rounded-sm bg-sunken p-4 text-[14px] leading-5 text-ink-700">
              <p className="flex items-center gap-2">
                <Check size={16} className="text-signal-ok" />
                {t('signup.company')}: {companyName}
              </p>
              <p className="pl-6">{t('signup.businessNo')}: {businessNumber}</p>
              <p className="pl-6">{t('signup.status')}: {t('status.pending')}</p>
            </div>
          )}

          <div className="flex flex-col gap-6 lg:pt-2">
            {step < 4 ? (
              <button
                type="submit"
                disabled={!stepValid || submitting}
                className="h-12 w-full rounded-sm bg-ink-700 px-5 text-[14px] leading-5 text-white transition-colors hover:bg-ink-900 disabled:cursor-not-allowed disabled:bg-line-control disabled:text-white"
              >
                {submitting ? t('common.loading') : step === 3 ? t('auth.registerButton') : t('common.next')}
              </button>
            ) : (
              <div className="flex flex-col gap-3">
                {/* Browsing works while pending (prices stay locked), so don't dead-end the new member */}
                <Link to="/products" className="flex h-12 w-full items-center justify-center rounded-sm bg-ink-700 px-5 text-[14px] leading-5 text-white hover:bg-ink-900">
                  {t('auth.browseWhileWaiting')}
                </Link>
                <Link to="/pending" className="flex h-12 w-full items-center justify-center rounded-sm border border-line-control px-5 text-[14px] leading-5 text-ink-700 hover:border-ink-700">
                  {t('auth.checkApplicationStatus')}
                </Link>
              </div>
            )}
            {step === 1 && (
              <p className="text-center text-[12px] leading-4 text-ink-700">
                {t('auth.alreadyHaveAccount')}{' '}
                <Link to="/login" className="underline underline-offset-[0.25em]">{t('common.login')}</Link>
              </p>
            )}
          </div>
        </div>
      </form>
    </div>
  );
}
