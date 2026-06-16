import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Eye, EyeOff, Check, Upload } from 'lucide-react';

type Step = 1 | 2 | 3;

export default function Register() {
  const { registerMember, showToast } = useStore();
  const [step, setStep] = useState<Step>(1);
  const [showPassword, setShowPassword] = useState(false);

  // Form fields
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
  const [certificateUploaded, setCertificateUploaded] = useState(false);

  const handleNext = async () => {
    if (step === 1) {
      if (!email || !password || !confirmPassword) {
        showToast('Please fill in all fields', 'error');
        return;
      }
      if (password !== confirmPassword) {
        showToast('Passwords do not match', 'error');
        return;
      }
      setStep(2);
    } else if (step === 2) {
      if (!companyName || !businessNumber || !representative || !phone) {
        showToast('Please fill in all required fields', 'error');
        return;
      }
      if (!agreeTerms || !agreePrivacy) {
        showToast('Please agree to required terms', 'error');
        return;
      }
      const result = await registerMember({
        email,
        password,
        companyName,
        businessNumber,
        representative,
        phone,
        address,
      });
      if (result.error) {
        showToast(result.error, 'error');
        return;
      }
      setStep(3);
      showToast('Registration submitted for admin approval!', 'success');
    }
  };

  const handlePrev = () => {
    if (step === 2) setStep(1);
    else if (step === 3) setStep(2);
  };

  return (
    <div className="min-h-screen bg-[#f8f8fa] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[480px]">
        {/* Logo */}
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <span className="text-[28px] font-bold text-[#333]">WELMES</span>
          <span className="bg-[#4a90e2] text-white text-[11px] font-semibold px-2 py-0.5 rounded">
            Business
          </span>
        </Link>

        {/* Step Indicator */}
        {step < 3 && (
          <div className="flex items-center justify-center gap-2 mb-8">
            {[1, 2].map((s) => (
              <div key={s} className="flex items-center gap-2">
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center text-[13px] font-bold ${
                    step >= s
                      ? 'bg-[#333] text-white'
                      : 'bg-[#e5e5e5] text-[#999]'
                  }`}
                >
                  {s}
                </div>
                <span
                  className={`text-[12px] ${
                    step >= s ? 'text-[#333] font-medium' : 'text-[#999]'
                  }`}
                >
                  {s === 1 ? 'Account' : 'Business Info'}
                </span>
                {s === 1 && <div className="w-8 h-px bg-[#ddd] mx-1" />}
              </div>
            ))}
          </div>
        )}

        <div className="bg-white rounded-xl shadow-sm p-8">
          {/* Step 1: Account Info */}
          {step === 1 && (
            <>
              <h1 className="text-[20px] font-bold text-[#333] text-center mb-1">
                Create Account
              </h1>
              <p className="text-[13px] text-[#999] text-center mb-6">
                Enter your account information
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Email <span className="text-[#ff4d6d]">*</span>
                  </label>
                  <input
                    type="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    placeholder="business@company.com"
                    className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]"
                  />
                </div>

                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Password <span className="text-[#ff4d6d]">*</span>
                  </label>
                  <div className="relative">
                    <input
                      type={showPassword ? 'text' : 'password'}
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="At least 8 characters"
                      className="w-full h-[46px] px-4 pr-11 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]"
                    />
                    <button
                      type="button"
                      onClick={() => setShowPassword(!showPassword)}
                      className="absolute right-3 top-1/2 -translate-y-1/2 text-[#999]"
                    >
                      {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                    </button>
                  </div>
                </div>

                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Confirm Password <span className="text-[#ff4d6d]">*</span>
                  </label>
                  <input
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    placeholder="Confirm your password"
                    className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]"
                  />
                </div>
              </div>
            </>
          )}

          {/* Step 2: Business Info */}
          {step === 2 && (
            <>
              <h1 className="text-[20px] font-bold text-[#333] text-center mb-1">
                Business Information
              </h1>
              <p className="text-[13px] text-[#999] text-center mb-6">
                Enter your business details for verification
              </p>

              <div className="space-y-4">
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Company Name <span className="text-[#ff4d6d]">*</span>
                  </label>
                  <input
                    type="text"
                    value={companyName}
                    onChange={(e) => setCompanyName(e.target.value)}
                    placeholder="ABC Trading Co., Ltd."
                    className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]"
                  />
                </div>

                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Business Registration Number{' '}
                    <span className="text-[#ff4d6d]">*</span>
                  </label>
                  <input
                    type="text"
                    value={businessNumber}
                    onChange={(e) => setBusinessNumber(e.target.value)}
                    placeholder="123-45-67890"
                    className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]"
                  />
                </div>

                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Representative Name{' '}
                    <span className="text-[#ff4d6d]">*</span>
                  </label>
                  <input
                    type="text"
                    value={representative}
                    onChange={(e) => setRepresentative(e.target.value)}
                    placeholder="Kim Soo-min"
                    className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]"
                  />
                </div>

                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Phone Number <span className="text-[#ff4d6d]">*</span>
                  </label>
                  <input
                    type="tel"
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                    placeholder="010-1234-5678"
                    className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]"
                  />
                </div>

                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Business Address
                  </label>
                  <input
                    type="text"
                    value={address}
                    onChange={(e) => setAddress(e.target.value)}
                    placeholder="Seoul Gangnam-gu Teheran-ro 123"
                    className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333]"
                  />
                </div>

                {/* Certificate Upload */}
                <div>
                  <label className="block text-[13px] text-[#666] mb-1.5">
                    Business Registration Certificate
                  </label>
                  <button
                    type="button"
                    onClick={() => setCertificateUploaded(true)}
                    className={`w-full h-[80px] border-2 border-dashed rounded-lg flex flex-col items-center justify-center gap-1 transition-colors ${
                      certificateUploaded
                        ? 'border-green-400 bg-green-50'
                        : 'border-[#ddd] hover:border-[#999]'
                    }`}
                  >
                    {certificateUploaded ? (
                      <>
                        <Check size={24} className="text-green-500" />
                        <span className="text-[12px] text-green-600">
                          File uploaded successfully
                        </span>
                      </>
                    ) : (
                      <>
                        <Upload size={20} className="text-[#999]" />
                        <span className="text-[12px] text-[#999]">
                          Click to upload certificate
                        </span>
                      </>
                    )}
                  </button>
                </div>

                {/* Terms */}
                <div className="space-y-2 pt-2 border-t border-[#f0f0f0]">
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agreeTerms}
                      onChange={(e) => setAgreeTerms(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-[#ccc]"
                    />
                    <span className="text-[12px] text-[#666]">
                      I agree to the Terms of Service{' '}
                      <span className="text-[#ff4d6d]">(required)</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agreePrivacy}
                      onChange={(e) => setAgreePrivacy(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-[#ccc]"
                    />
                    <span className="text-[12px] text-[#666]">
                      I agree to the Privacy Policy{' '}
                      <span className="text-[#ff4d6d]">(required)</span>
                    </span>
                  </label>
                  <label className="flex items-start gap-2 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={agreeMarketing}
                      onChange={(e) => setAgreeMarketing(e.target.checked)}
                      className="mt-0.5 w-4 h-4 rounded border-[#ccc]"
                    />
                    <span className="text-[12px] text-[#666]">
                      I agree to receive marketing emails (optional)
                    </span>
                  </label>
                </div>
              </div>
            </>
          )}

          {/* Step 3: Complete */}
          {step === 3 && (
            <div className="text-center py-8">
              <div className="w-16 h-16 bg-green-100 rounded-full flex items-center justify-center mx-auto mb-4">
                <Check size={32} className="text-green-500" />
              </div>
              <h1 className="text-[20px] font-bold text-[#333] mb-2">
                Registration Complete!
              </h1>
              <p className="text-[14px] text-[#666] mb-2">
                Your business registration has been submitted.
              </p>
              <p className="text-[13px] text-[#999] mb-6">
                Admin verification is in progress. You will receive an email
                within 1-2 business days.
              </p>
              <div className="bg-[#f8f8fa] rounded-lg p-4 mb-6 text-left">
                <p className="text-[12px] text-[#666]">
                  <span className="font-medium">Company:</span> {companyName}
                </p>
                <p className="text-[12px] text-[#666] mt-1">
                  <span className="font-medium">Business No:</span>{' '}
                  {businessNumber}
                </p>
                <p className="text-[12px] text-[#666] mt-1">
                  <span className="font-medium">Status:</span>{' '}
                  <span className="text-yellow-600 font-medium">
                    Pending Approval
                  </span>
                </p>
              </div>
              <Link
                to="/"
                className="inline-block w-full h-[46px] bg-[#333] text-white rounded-lg font-medium text-[14px] hover:bg-[#555] transition-colors flex items-center justify-center"
              >
                Go to Home
              </Link>
            </div>
          )}

          {/* Navigation Buttons */}
          {step < 3 && (
            <div className="flex gap-3 mt-6">
              {step === 2 && (
                <button
                  onClick={handlePrev}
                  className="flex-1 h-[46px] border border-[#ddd] text-[#666] rounded-lg text-[14px] font-medium hover:bg-[#f5f5f5] transition-colors"
                >
                  Back
                </button>
              )}
              <button
                onClick={handleNext}
                className="flex-1 h-[46px] bg-[#333] text-white rounded-lg text-[14px] font-medium hover:bg-[#555] transition-colors"
              >
                {step === 1 ? 'Next' : 'Submit for Verification'}
              </button>
            </div>
          )}
        </div>

        {/* Login Link */}
        {step < 3 && (
          <p className="text-center text-[13px] text-[#666] mt-6">
            Already have an account?{' '}
            <Link
              to="/login"
              className="text-[#4a90e2] font-medium hover:underline"
            >
              Login
            </Link>
          </p>
        )}
      </div>
    </div>
  );
}
