import { Link } from 'react-router-dom';
import { Phone, Mail, MapPin } from 'lucide-react';

export default function Footer() {
  return (
    <footer className="bg-[#1a1a1a] text-[#999999] mt-auto">
      {/* Top Info Section */}
      <div className="max-w-[1100px] mx-auto px-4 py-10">
        <div className="grid grid-cols-1 md:grid-cols-4 gap-8">
          {/* Customer Center */}
          <div>
            <h4 className="text-white font-semibold text-[14px] mb-4">Customer Support</h4>
            <div className="flex items-center gap-2 mb-2">
              <Phone size={14} />
              <span className="text-[20px] font-bold text-white">1544-1234</span>
            </div>
            <p className="text-[12px] leading-relaxed">
              Mon – Fri  09:00 – 18:00
              <br />
              Lunch  12:00 – 13:00
              <br />
              Closed on weekends &amp; holidays
            </p>
          </div>

          {/* Company Info */}
          <div>
            <h4 className="text-white font-semibold text-[14px] mb-4">Company Info</h4>
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

          {/* Quick Links */}
          <div>
            <h4 className="text-white font-semibold text-[14px] mb-4">Quick Links</h4>
            <ul className="space-y-2">
              {[
                { label: 'About Us', to: '/' },
                { label: 'Terms of Service', to: '/' },
                { label: 'Privacy Policy', to: '/' },
                { label: 'FAQ', to: '/support' },
                { label: 'Shipping Info', to: '/support' },
                { label: 'Returns & Exchanges', to: '/support' },
              ].map(({ label, to }) => (
                <li key={label}>
                  <Link to={to} className="text-[12px] hover:text-white transition-colors">
                    {label}
                  </Link>
                </li>
              ))}
            </ul>
          </div>

          {/* Wholesale Info */}
          <div>
            <h4 className="text-white font-semibold text-[14px] mb-4">Wholesale Info</h4>
            <p className="text-[12px] leading-relaxed mb-3">
              An exclusive wholesale platform for verified business members.
              Access wholesale pricing and place orders after business verification.
            </p>
            <Link
              to="/register"
              className="inline-block bg-[#4a90e2] text-white text-[12px] font-medium px-4 py-2 rounded hover:bg-[#357abd] transition-colors"
            >
              Register as Business
            </Link>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-[#333333]">
        <div className="max-w-[1100px] mx-auto px-4 py-5">
          <div className="flex flex-col md:flex-row justify-between items-center gap-4">
            <p className="text-[11px] text-[#777]">
              Company: WELMES Co., Ltd. | CEO: Kim Daepyo | Business Reg. No.: 123-45-67890 |
              E-Commerce Reg.: 2025-Seoul Gangnam-0001
            </p>
            <p className="text-[11px] text-[#777]">
              Copyright WELMES Co., Ltd. All rights reserved.
            </p>
          </div>
        </div>
      </div>
    </footer>
  );
}
