import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useTranslation } from 'react-i18next';

/**
 * Inline sign-up banner for the product grid, measured on faire.com/search
 * (DiscoverSignUpInlineBanner). Layout switches on the banner's own width, not the
 * viewport — see .signup-banner in index.css.
 */
export default function SignUpBanner({ className = '', style }: { className?: string; style?: React.CSSProperties }) {
  const { t } = useTranslation();
  return (
    <div className={`signup-banner ${className}`} style={style}>
      <div className="signup-banner__inner">
        <div className="signup-banner__media">
          <img
            src="/banners/banner1.jpg"
            alt=""
            loading="lazy"
            className="absolute inset-0 h-full w-full object-cover object-[75%_50%]"
          />
        </div>
        <div className="signup-banner__text">
          <h3 className="signup-banner__title">{t('signupBanner.title')}</h3>
          <p className="signup-banner__desc">{t('signupBanner.desc')}</p>
          <div className="flex justify-start">
            {/* Faire primary medium: 48px, #333, 4px radius, 20px padding, 16px icon + 8px */}
            <Link
              to="/register"
              className="inline-flex h-12 items-center rounded-sm border border-transparent bg-ink-700 px-5 text-[14px] leading-5 tracking-[0.15px] text-white transition-colors hover:bg-ink-900"
            >
              <Lock size={16} strokeWidth={1.5} className="mr-2 shrink-0" />
              <span className="line-clamp-2 text-start">{t('signupBanner.cta')}</span>
            </Link>
          </div>
        </div>
      </div>
    </div>
  );
}
