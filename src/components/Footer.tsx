import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin } from 'lucide-react';
import { useTranslation } from 'react-i18next';

export default function Footer() {
  const { t } = useTranslation();

  return (
    <footer className="bg-ink-900 text-white/60 mt-auto">
      <div className="max-w-[1100px] mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          <div>
            <h4 className="text-white font-bold text-[14px] mb-4">{t('footer.support')}</h4>
            <div className="flex items-center gap-2 mb-2">
              <Phone size={14} />
              <span className="text-[20px] font-extrabold tabular-nums text-white">1544-1234</span>
            </div>
            <p className="text-[12px] leading-relaxed whitespace-pre-line">
              {t('footer.businessHours')}
            </p>
          </div>

          <div>
            <h4 className="text-white font-bold text-[14px] mb-4">{t('footer.company')}</h4>
            <div className="flex items-start gap-2 mb-2">
              <MapPin size={14} className="mt-0.5 shrink-0" />
              <span className="text-[12px] leading-relaxed">
                123 Teheran-ro, Gangnam-gu
                <br />
                WELMES Tower 15F, Seoul
              </span>
            </div>
            <div className="flex items-center gap-2">
              <Mail size={14} />
              <span className="text-[12px]">support@welmes.kr</span>
            </div>
          </div>

          <div>
            <h4 className="text-white font-bold text-[14px] mb-4">{t('footer.quickLinks')}</h4>
            <ul className="space-y-2">
              {[
                { label: t('footer.about'), to: '/' },
                { label: t('footer.terms'), to: '/' },
                { label: t('footer.privacy'), to: '/' },
                { label: t('footer.faq'), to: '/support' },
                { label: t('footer.shippingInfo'), to: '/support' },
                { label: t('footer.returnsExchanges'), to: '/support' },
              ].map(({ label, to }) => (
                <li key={label}>
                  <Link to={to} className="text-[12px] hover:text-white transition-colors">{label}</Link>
                </li>
              ))}
            </ul>
          </div>

          <div>
            <h4 className="text-white font-bold text-[14px] mb-4">{t('footer.wholesaleInfo')}</h4>
            <p className="text-[12px] leading-relaxed mb-3">{t('footer.tagline')}</p>
            <Link to="/register" className="inline-flex h-9 items-center bg-white text-ink-900 text-[12px] font-bold px-4 rounded-md hover:bg-sunken transition-colors">
              {t('auth.registerTitle')}
            </Link>
          </div>
        </div>
      </div>

      <div className="border-t border-white/10">
        <div className="max-w-[1100px] mx-auto px-4 py-5">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-[11px] text-white/50">
              {t('footer.companyInfo')}
            </p>
            <p className="text-[11px] text-white/50">
              Copyright WELMES Co., Ltd. {t('footer.rights')}
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
