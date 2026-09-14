import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Link, useNavigate } from 'react-router-dom';
import { useTranslation } from 'react-i18next';
import { X } from 'lucide-react';

/**
 * Faire "appSignUpModal", measured on faire.com (1440px): 500px white sheet (full screen on mobile)
 * over rgba(51,51,51,.5); 32px padding, 144px product image (112 mobile), 30/38 serif title,
 * 14/20 label over a 40px #dadada field, 48px #333 button, then a #f7f7f7 footer with 12/16 links.
 * Native <dialog> gives the focus trap, Esc and backdrop; it is portalled so clicks never reach the card link.
 */
export default function SignUpModal({ image, onClose, onSignIn }: { image?: string; onClose: () => void; onSignIn: () => void }) {
  const { t } = useTranslation();
  const navigate = useNavigate();
  const ref = useRef<HTMLDialogElement>(null);
  const [email, setEmail] = useState('');

  useEffect(() => {
    ref.current?.showModal();
  }, []);

  const submit = (e: React.FormEvent) => {
    e.preventDefault();
    // Router state, not the URL, so the address never lands in history or logs
    navigate('/register', { state: { email: email.trim() } });
  };

  return createPortal(
    <dialog
      ref={ref}
      onClose={onClose}
      onClick={(e) => {
        e.stopPropagation();
        if (e.target === e.currentTarget) ref.current?.close(); // backdrop click
      }}
      aria-labelledby="signup-modal-title"
      className="m-0 h-full max-h-none w-full max-w-none bg-white text-ink-700 tracking-[0.15px] backdrop:bg-[rgba(51,51,51,0.5)] md:m-auto md:h-fit md:max-h-[calc(100vh-32px)] md:w-[500px]"
    >
      <div className="relative flex h-full flex-col overflow-y-auto">
        <button
          type="button"
          onClick={() => ref.current?.close()}
          aria-label={t('common.close')}
          className="absolute right-4 top-4 z-[1] flex size-6 items-center justify-center"
        >
          <X size={16} strokeWidth={1.5} />
        </button>

        <div className="flex flex-1 flex-col justify-center p-8">
          <div className="flex flex-col items-center">
            {image && <img src={image} alt="" className="size-28 object-cover md:size-36" />}
            <h2 id="signup-modal-title" className="mt-4 text-center font-serif text-[30px] font-normal leading-[38px] tracking-normal">
              {t('signupBanner.cta')}
            </h2>
          </div>
          <form onSubmit={submit} className="mt-8 flex flex-col">
            <label htmlFor="signup-modal-email" className="text-[14px] leading-5">
              {t('signupModal.email')}
            </label>
            <input
              id="signup-modal-email"
              type="email"
              name="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10 w-full rounded-sm border border-line-control bg-white px-4 text-[14px] focus:border-ink-700 focus:outline-none"
            />
            <button type="submit" className="mt-4 h-12 w-full rounded-sm bg-ink-700 px-5 text-[14px] leading-5 text-white transition-colors hover:bg-ink-900">
              {t('signupModal.cta')}
            </button>
          </form>
        </div>

        <div className="flex flex-col items-start gap-3 bg-[#f7f7f7] p-8 text-[12px] leading-4">
          <p>
            {t('homeHero.brandQuestion')}{' '}
            <Link to="/support" className="underline underline-offset-[0.25em]">{t('homeHero.brandCta')}</Link>
          </p>
          <p>
            {t('auth.alreadyHaveAccount')}{' '}
            <button type="button" onClick={onSignIn} className="underline underline-offset-[0.25em]">{t('common.login')}</button>
          </p>
        </div>
      </div>
    </dialog>,
    document.body,
  );
}
