import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import { Eye, EyeOff } from 'lucide-react';
import * as db from '../lib/db';

export default function Login() {
  const navigate = useNavigate();
  const { login, showToast } = useStore();
  const { t } = useTranslation();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [sendingReset, setSendingReset] = useState(false);

  /** Send the signed-in user wherever their account state belongs. */
  const routeAfterLogin = () => {
    const user = useStore.getState().currentUser;
    if (user?.isAdmin) return navigate('/admin');
    if (user && user.status !== 'approved') return navigate('/pending');
    navigate('/');
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      showToast(t('auth.loginFailed'), 'error');
      return;
    }
    const success = await login(email, password);
    if (success) {
      routeAfterLogin();
    } else {
      showToast(t('auth.loginFailed'), 'error');
    }
  };

  const handleForgotPassword = async () => {
    if (!email.trim()) {
      showToast(t('auth.resetEmailRequired'), 'info');
      return;
    }
    setSendingReset(true);
    const { error } = await db.sendPasswordReset(email.trim());
    setSendingReset(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    showToast(t('auth.resetSent', { email: email.trim() }), 'success');
  };

  const handleDemoLogin = async (type: 'admin' | 'member' | 'pending') => {
    const credentials = {
      admin:   { email: 'admin@welmes.kr',        password: 'admin1234' },
      member:  { email: 'beautyworld@naver.com',   password: 'demo1234' },
      pending: { email: 'glamourshop@gmail.com',   password: 'demo1234' },
    }[type];
    const success = await login(credentials.email, credentials.password);
    if (success) routeAfterLogin();
  };

  return (
    <div className="min-h-screen bg-[#f8f8fa] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <span className="text-[28px] font-bold text-[#333]">WELMES</span>
          <span className="bg-[#4a90e2] text-white text-[11px] font-semibold px-2 py-0.5 rounded">Business</span>
        </Link>

        <div className="bg-white rounded-xl shadow-sm p-8">
          <h1 className="text-[20px] font-bold text-[#333] text-center mb-1">{t('auth.loginTitle')}</h1>
          <p className="text-[13px] text-[#999] text-center mb-6">{t('auth.loginSubtitle')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.email')}</label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={t('auth.email')}
                className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333] transition-colors"
              />
            </div>

            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">{t('auth.password')}</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={t('auth.password')}
                  className="w-full h-[46px] px-4 pr-11 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333] transition-colors"
                />
                <button type="button" onClick={() => setShowPassword(!showPassword)} className="absolute right-3 top-1/2 -translate-y-1/2 text-[#999]">
                  {showPassword ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            {/* "Remember me" was a no-op — Supabase already persists the
                session across reloads, so the checkbox only misled users. */}
            <div className="flex items-center justify-end">
              <button
                type="button"
                onClick={handleForgotPassword}
                disabled={sendingReset}
                className="text-[13px] text-[#4a90e2] hover:underline disabled:opacity-50"
              >
                {sendingReset ? t('common.loading') : t('auth.forgotPassword')}
              </button>
            </div>

            <button type="submit" className="w-full h-[50px] bg-[#333] text-white rounded-lg font-medium text-[15px] hover:bg-[#555] transition-colors">
              {t('auth.loginButton')}
            </button>
          </form>

          {/* Demo logins are for local development only — dead-code-eliminated
              from production builds so the admin credentials never ship. */}
          {import.meta.env.DEV && (
            <>
              <div className="flex items-center gap-3 my-6">
                <div className="flex-1 h-px bg-[#e5e5e5]" />
                <span className="text-[12px] text-[#999]">or</span>
                <div className="flex-1 h-px bg-[#e5e5e5]" />
              </div>

              <div className="space-y-2">
                <p className="text-[12px] text-[#999] text-center mb-3">{t('auth.demoLogin')}</p>
                <button onClick={() => handleDemoLogin('admin')} className="w-full h-[42px] bg-[#2c3e50] text-white rounded-lg text-[13px] font-medium hover:bg-[#34495e] transition-colors">
                  {t('auth.loginAsAdmin')}
                </button>
                <button onClick={() => handleDemoLogin('member')} className="w-full h-[42px] bg-[#4a90e2] text-white rounded-lg text-[13px] font-medium hover:bg-[#357abd] transition-colors">
                  {t('auth.loginAsBuyer')}
                </button>
                <button onClick={() => handleDemoLogin('pending')} className="w-full h-[42px] border border-[#ddd] text-[#666] rounded-lg text-[13px] font-medium hover:bg-[#f5f5f5] transition-colors">
                  {t('auth.loginAsPending')}
                </button>
              </div>
            </>
          )}

          <p className="text-[13px] text-[#999] text-center mt-6">
            {t('auth.noAccount')}{' '}
            <Link to="/register" className="text-[#4a90e2] hover:underline font-medium">{t('auth.registerHere')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
