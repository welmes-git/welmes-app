import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { useTranslation } from 'react-i18next';
import Logo from '../components/Logo';
import { Eye, EyeOff } from 'lucide-react';
import * as db from '../lib/db';

// Faire Slate form field: 14/20 label, 40px field, 1px #dadada, 4px radius, 16px padding
const labelCls = 'text-[14px] leading-5 text-ink-700';
const fieldCls =
  'h-10 w-full rounded-sm border border-line-control bg-white px-4 text-[14px] text-ink-700 placeholder:text-ink-500 focus:border-ink-700 focus:outline-none';

/**
 * Faire sign-in sheet, measured on faire.com (1440px): 420px column, 40px padding (24/40/64 on mobile),
 * 88px logo on desktop, 32 → 30/38 serif title, 24 → email, 16 → password, a 20px slot that reveals
 * the secondary action once an email is typed, 16 → 48px Sign in, "or" divider, 48px outlined Sign up.
 * Faire's Google/Apple buttons are omitted — those sign-in providers aren't set up.
 */
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
    setSendingReset(true);
    const { error } = await db.sendPasswordReset(email.trim());
    setSendingReset(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    showToast(t('auth.resetSent', { email: email.trim() }), 'success');
  };

  const hasEmail = email.trim() !== '';

  return (
    <div className="mb-16 flex flex-col bg-white px-6 pb-16 pt-10 tracking-[0.15px] text-ink-700 md:m-auto md:min-h-[480px] md:w-[420px] md:p-10">
      <Link to="/" aria-label="WELMES Business" className="hidden self-start pl-1 md:flex">
        <Logo />
      </Link>
      <h1 className="font-serif text-[30px] font-normal leading-[38px] tracking-normal md:mt-8">{t('signin.title')}</h1>

      <form onSubmit={handleSubmit} className="contents">
        <div className="mt-6 flex flex-col">
          <label htmlFor="signin-email" className={labelCls}>{t('signin.emailLabel')}</label>
          <input
            id="signin-email"
            type="email"
            autoComplete="email"
            placeholder="name@company.com"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            className={fieldCls}
          />
        </div>
        <div className="mt-4 flex flex-col">
          <label htmlFor="signin-password" className={labelCls}>{t('auth.password')}</label>
          <div className="relative">
            <input
              id="signin-password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              spellCheck={false}
              placeholder={t('signin.passwordPlaceholder')}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className={`${fieldCls} pr-11`}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={t(showPassword ? 'signup.hidePassword' : 'signup.showPassword')}
              className="absolute right-3 top-1/2 flex size-6 -translate-y-1/2 items-center justify-center text-ink-700"
            >
              {showPassword ? <EyeOff size={16} strokeWidth={1.5} /> : <Eye size={16} strokeWidth={1.5} />}
            </button>
          </div>
        </div>

        {/* Faire reveals its secondary action once an email is typed */}
        <div
          aria-hidden={!hasEmail}
          className={`mt-4 flex h-5 justify-center transition-[opacity,transform] duration-200 ease-out motion-reduce:transition-none ${
            hasEmail ? 'visible translate-y-0 opacity-100' : 'invisible translate-y-1 opacity-0'
          }`}
        >
          <button
            type="button"
            onClick={handleForgotPassword}
            disabled={!hasEmail || sendingReset}
            className="text-[14px] leading-5 text-ink-700 underline underline-offset-[0.25em] hover:text-ink-900"
          >
            {sendingReset ? t('common.loading') : t('auth.forgotPassword')}
          </button>
        </div>

        <button type="submit" className="mt-4 h-12 w-full rounded-sm bg-ink-700 px-5 text-[14px] leading-5 text-white transition-colors hover:bg-ink-900">
          {t('signin.signIn')}
        </button>
      </form>

      <div className="mt-4 flex items-center gap-4">
        <hr className="w-full border-line-control" />
        <p className="text-[14px] leading-5">{t('signin.or')}</p>
        <hr className="w-full border-line-control" />
      </div>
      <Link
        to="/register"
        className="mt-4 flex h-12 w-full items-center justify-center rounded-sm border border-line-control bg-white px-5 text-[14px] leading-5 text-ink-700 transition-colors hover:border-ink-700"
      >
        {t('signin.signUp')}
      </Link>
    </div>
  );
}
