import { useState, useRef } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff, Check, Upload, FileText, X } from 'lucide-react';

const MAX_CERT_BYTES = 5 * 1024 * 1024; // 5 MB

type Step = 1 | 2 | 3;

export default function Register() {
  const { registerMember, showToast } = useStore();
  const { t } = useTranslation();
  const [step, setStep] = useState<Step>(1);
  const [showPassword, setShowPassword] = useState(false);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [companyName, setCompanyName] = useState('');
  const [businessNumber, setBusinessNumber] = useState('');
  const [representative, setRepresentative] = useState('');
  const [phone, setPhone] = useState('');
  const [address, setAddress] = useState('');
  const [agreeTerms, setAgreeTerms] = useState(false);
  const [agreePrivacy, setAgreePrivacy] = useState(false);
  const [agreeMarketing, setAgreeMarketing] = useState(false);
  const [certificateFile, setCertificateFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

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

  const handleNext = async () => {
    if (step === 1) {
      if (!email || !password || !confirmPassword) {
        showToast(t('common.required'), 'error');
        return;
      }
      if (password.length < 8) {
        showToast(t('auth.passwordTooShort'), 'error');
        return;
      }
      if (password !== confirmPassword) {
        showToast(t('auth.passwordMismatch'), 'error');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!companyName || !businessNumber || !representative || !phone) {
        showToast(t('common.required'), 'error');
        return;
      }
      if (!certificateFile) {
        showToast(t('auth.certRequired'), 'error');
        return;
      }
      if (!agreeTerms || !agreePrivacy) {
        showToast(t('common.required'), 'error');
        return;
      }
      if (submitting) return;
      setSubmitting(true);
      const result = await registerMember({ email, password, companyName, businessNumber, representative, phone, address, certificateFile });
      setSubmitting(false);
      if (result.error) {
        showToast(result.error, 'error');
        return;
      }
      setStep(3);
      showToast(t('auth.registerSuccess'), 'success');
    }
  };

  const handlePrev = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  return (
    <div className="min-h-screen bg-[#f8f8fa] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[480px]">
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <span className="text-[28px] font-bold text-[#333]">WELMES</span>
          <span className="bg-[#4a90e2] text-white text-[11px] font-semibold px-2 py-0.5 rounded">Business</span>
        </Link>

        {step < 3 && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold ${step >= s ? 'bg-[#333] text-white' : 'bg-[#e5e5e5] text-[#999]'}`}>{s}</div>
                <span className={`text-[12px] ${step >= s ? 'text-[#333] font-medium' : 'text-[#999]'}`}>
                  {s === 1 ? t('auth.email') : t('auth.companyName')}
                </span>
                {s === 1 && <div className="w-8 h-px bg-[#ddd] mx-1" />}
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-8">
          {step === 1 && (
            <>
              <h1 className="text-[20px] font-bold text-[#333] text-center mb-1">{t('auth.registerTitle')}</h1>
              <p className="text-[13px] text-[#999] text-center mb-6">{t('auth.registerSubtitle')}</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.email')} <span className="text-[#ff4d6d]">*</span></label>
                  <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="business@company.com" className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.password')} <span className="text-[#ff4d6d]">*</span></label>
                  <div className="relative">
                    <input type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} placeholder="At least 8 characters" className="w-full h-[46px] px-4 pr-11 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]" />
                    <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#999]">
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.confirmPassword')} <span className="text-[#ff4d6d]">*</span></label>
                  <input type="password" value={confirmPassword} onChange={(e) => setConfirmPassword(e.target.value)} placeholder="Confirm your password" className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]" />
                </div>
              </div>
            </>
          )}

          {step === 2 && (
            <>
              <h1 className="text-[20px] font-bold text-[#333] text-center mb-1">Business Information</h1>
              <p className="text-[13px] text-[#999] text-center mb-6">Enter your business details for verification</p>
              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.companyName')} <span className="text-[#ff4d6d]">*</span></label>
                  <input type="text" value={companyName} onChange={(e) => setCompanyName(e.target.value)} placeholder="ABC Trading Co., Ltd." className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.businessNumber')} <span className="text-[#ff4d6d]">*</span></label>
                  <input type="text" value={businessNumber} onChange={(e) => setBusinessNumber(e.target.value)} placeholder="123-45-67890" className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.representative')} <span className="text-[#ff4d6d]">*</span></label>
                  <input type="text" value={representative} onChange={(e) => setRepresentative(e.target.value)} placeholder="Kim Soo-min" className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.phone')} <span className="text-[#ff4d6d]">*</span></label>
                  <input type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="010-1234-5678" className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.address')}</label>
                  <input type="text" value={address} onChange={(e) => setAddress(e.target.value)} placeholder="Seoul Gangnam-gu Teheran-ro 123" className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]" />
                </div>
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    {t('auth.certLabel')} <span className="text-[#ff4d6d]">*</span>
                  </label>
                  <input
                    ref={fileInputRef}
                    type="file"
                    accept="image/png,image/jpeg,image/webp,application/pdf"
                    className="hidden"
                    onChange={handleCertPick}
                  />
                  {certificateFile ? (
                    <div className="w-full flex items-center gap-3 border-2 border-green-400 bg-green-50 rounded-lg px-4 py-3">
                      <FileText size={20} className="text-green-600 shrink-0" />
                      <div className="flex-1 min-w-0">
                        <p className="text-[13px] text-green-700 font-medium truncate">{certificateFile.name}</p>
                        <p className="text-[11px] text-green-600">{(certificateFile.size / 1024).toFixed(0)} KB</p>
                      </div>
                      <button type="button" onClick={() => setCertificateFile(null)} className="text-green-600 hover:text-green-800 shrink-0">
                        <X size={16} />
                      </button>
                    </div>
                  ) : (
                    <button
                      type="button"
                      onClick={() => fileInputRef.current?.click()}
                      className="w-full h-[80px] border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1 transition-colors border-[#ddd] hover:border-[#999]"
                    >
                      <Upload size={20} className="text-[#999]" />
                      <span className="text-[12px] text-[#999]">{t('auth.certUpload')}</span>
                      <span className="text-[11px] text-[#bbb]">{t('auth.certHint')}</span>
                    </button>
                  )}
                </div>
                <div className="space-y-2 pt-2 border-t border-[#f0f0f0]">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={agreeTerms} onChange={(e) => setAgreeTerms(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-[#ccc]" />
                    <span className="text-[12px] text-[#666]">I agree to the Terms of Service <span className="text-[#ff4d6d]">({t('common.required')})</span></span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={agreePrivacy} onChange={(e) => setAgreePrivacy(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-[#ccc]" />
                    <span className="text-[12px] text-[#666]">I agree to the Privacy Policy <span className="text-[#ff4d6d]">({t('common.required')})</span></span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input type="checkbox" checked={agreeMarketing} onChange={(e) => setAgreeMarketing(e.target.checked)} className="mt-0.5 w-4 h-4 rounded border-[#ccc]" />
                    <span className="text-[12px] text-[#666]">I agree to receive marketing emails ({t('common.optional')})</span>
                  </label>
                </div>
              </div>
            </>
          )}

          {step === 3 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-green-500" />
              </div>
              <h1 className="text-[20px] font-bold text-[#333] mb-2">Registration Complete!</h1>
              <p className="text-[14px] text-[#666] mb-2">{t('auth.registerSuccess')}</p>
              <p className="text-[13px] text-[#999] mb-6">{t('auth.pendingNote')}</p>
              <div className="bg-[#f8f8fa] rounded-lg p-4 mb-6 text-left">
                <p className="text-[12px] text-[#666]"><span className="font-medium">Company:</span> {companyName}</p>
                <p className="text-[12px] text-[#666] mt-1"><span className="font-medium">Business No:</span> {businessNumber}</p>
                <p className="text-[12px] text-[#666] mt-1"><span className="font-medium">Status:</span> <span className="text-yellow-600 font-medium">{t('status.pending')}</span></p>
              </div>
              {/* Send them straight into the catalogue instead of a dead-end
                  "back to home" — browsing already works while pending
                  (pricing just stays locked), so give them something to do
                  during the 1–2 day wait instead of just leaving. */}
              <Link to="/products" className="inline-flex w-full h-[46px] bg-[#333] text-white rounded-lg font-medium text-[14px] hover:bg-[#555] transition-colors items-center justify-center">
                {t('auth.browseWhileWaiting')}
              </Link>
              <Link to="/pending" className="inline-flex w-full h-[42px] mt-2 text-[#666] text-[13px] hover:text-[#333] transition-colors items-center justify-center">
                {t('auth.checkApplicationStatus')}
              </Link>
            </div>
          )}

          {step < 3 && (
            <div className="flex gap-3 mt-6">
              {step === 2 && (
                <button onClick={handlePrev} className="flex-1 h-[46px] border border-[#ddd] text-[#666] rounded-lg text-[14px] font-medium hover:bg-[#f5f5f5] transition-colors">
                  {t('common.back')}
                </button>
              )}
              <button
                onClick={handleNext}
                disabled={submitting}
                className="flex-1 h-[46px] bg-[#333] text-white rounded-lg text-[14px] font-medium hover:bg-[#555] transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
              >
                {submitting ? t('common.loading') : step === 1 ? t('common.next') : t('auth.registerButton')}
              </button>
            </div>
          )}
        </div>

        {step < 3 && (
          <p className="text-center text-[13px] text-[#666] mt-6">
            {t('auth.alreadyHaveAccount')}{' '}
            <Link to="/login" className="text-[#4a90e2] font-medium hover:underline">{t('common.login')}</Link>
          </p>
        )}
      </div>
    </div>
  );
}
