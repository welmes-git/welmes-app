import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import Logo from '../components/Logo';
import { Eye, EyeOff, Lock } from 'lucide-react';
import * as db from '../lib/db';
import { useStore } from '../store/useStore';

/**
 * Landing page for the password-recovery link. Supabase has already exchanged
 * the token for a session by the time we get here (App.tsx routes us on the
 * PASSWORD_RECOVERY event), so we can update the password directly.
 */
export default function ResetPassword() {
  const navigate = useNavigate();
  const { t } = useTranslation();
  const { showToast, logout } = useStore();

  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (password.length < 8) {
      showToast(t('auth.passwordTooShort'), 'error');
      return;
    }
    if (password !== confirm) {
      showToast(t('auth.passwordMismatch'), 'error');
      return;
    }
    setSaving(true);
    const { error } = await db.updatePassword(password);
    setSaving(false);
    if (error) {
      showToast(error.message, 'error');
      return;
    }
    // Force a fresh sign-in with the new credentials
    await logout();
    showToast(t('auth.resetSuccess'), 'success');
    navigate('/login');
  };

  return (
    <div className="min-h-screen bg-canvas flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        <Link to="/" aria-label="WELMES Business" className="mb-8 flex justify-center">
          <Logo size="auth" />
        </Link>

        <div className="bg-canvas rounded-[10px] border border-line p-8">
          <div className="w-12 h-12 rounded-full border border-line flex items-center justify-center mx-auto mb-4">
            <Lock size={20} className="text-ink-700" />
          </div>
          <h1 className="text-[20px] font-bold text-ink-700 text-center mb-1">{t('auth.resetTitle')}</h1>
          <p className="text-[13px] text-ink-500 text-center mb-6">{t('auth.resetDesc')}</p>

          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-[13px] text-ink-500 mb-1.5">{t('account.newPassword')}</label>
              <div className="relative">
                <input
                  type={show ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Min. 8 characters"
                  className="w-full h-[46px] px-4 pr-11 border border-line-strong rounded-lg bg-canvas text-[14px] text-ink-700 placeholder:text-ink-300 focus:outline-none focus:border-ink-900"
                />
                <button type="button" onClick={() => setShow(!show)} className="absolute right-3 top-1/2 -translate-y-1/2 text-ink-500">
                  {show ? <EyeOff size={18} /> : <Eye size={18} />}
                </button>
              </div>
            </div>

            <div>
              <label className="block text-[13px] text-ink-500 mb-1.5">{t('account.confirmNewPassword')}</label>
              <input
                type="password"
                value={confirm}
                onChange={(e) => setConfirm(e.target.value)}
                className="w-full h-[46px] px-4 border border-line-strong rounded-lg bg-canvas text-[14px] text-ink-700 placeholder:text-ink-300 focus:outline-none focus:border-ink-900"
              />
            </div>

            <p className="text-[12px] text-ink-300 leading-relaxed">{t('account.passwordHint')}</p>

            <button
              type="submit"
              disabled={saving}
              className="w-full h-[50px] bg-ink-900 text-white rounded-lg font-bold text-[15px] hover:shadow-hover transition-shadow disabled:opacity-60 disabled:cursor-not-allowed"
            >
              {saving ? t('account.updating') : t('auth.resetSubmit')}
            </button>
          </form>

          <p className="text-[13px] text-ink-500 text-center mt-6">
            <Link to="/login" className="text-ink-900 font-bold underline underline-offset-2">{t('common.login')}</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
