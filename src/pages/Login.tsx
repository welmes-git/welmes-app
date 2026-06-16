import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useStore } from '../store/useStore';
import { Eye, EyeOff } from 'lucide-react';

export default function Login() {
  const navigate = useNavigate();
  const { login, showToast } = useStore();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [rememberMe, setRememberMe] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email.trim() || !password.trim()) {
      showToast('Please enter email and password', 'error');
      return;
    }
    const success = await login(email, password);
    if (success) {
      showToast('Login successful!', 'success');
      navigate('/');
    } else {
      showToast('Invalid email or password', 'error');
    }
  };

  const handleDemoLogin = async (type: 'admin' | 'member' | 'pending') => {
    const credentials = {
      admin:   { email: 'admin@welmes.kr',        password: 'admin1234' },
      member:  { email: 'beautyworld@naver.com',   password: 'demo1234' },
      pending: { email: 'glamourshop@gmail.com',   password: 'demo1234' },
    }[type];

    const success = await login(credentials.email, credentials.password);
    if (success) {
      showToast(
        type === 'admin'
          ? 'Logged in as Admin'
          : type === 'member'
          ? 'Logged in as Verified Member'
          : 'Logged in as Pending Member',
        'success'
      );
      navigate(type === 'admin' ? '/admin' : '/');
    }
  };

  return (
    <div className="min-h-screen bg-[#f8f8fa] flex items-center justify-center px-4 py-12">
      <div className="w-full max-w-[420px]">
        {/* Logo */}
        <Link to="/" className="flex items-center justify-center gap-2 mb-8">
          <span className="text-[28px] font-bold text-[#333]">WELMES</span>
          <span className="bg-[#4a90e2] text-white text-[11px] font-semibold px-2 py-0.5 rounded">
            Business
          </span>
        </Link>

        <div className="bg-white rounded-xl shadow-sm p-8">
          <h1 className="text-[20px] font-bold text-[#333] text-center mb-1">
            Business Member Login
          </h1>
          <p className="text-[13px] text-[#999] text-center mb-6">
            Sign in to access wholesale prices
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {/* Email */}
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">
                Email
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="Enter your email"
                className="w-full h-[46px] px-4 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333] transition-colors"
              />
            </div>

            {/* Password */}
            <div>
              <label className="block text-[13px] text-[#666] mb-1.5">
                Password
              </label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="Enter your password"
                  className="w-full h-[46px] px-4 pr-11 border border-[#e5e5e5] rounded-lg text-[14px] focus:outline-none focus:border-[#333] transition-colors"
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

            {/* Remember me */}
            <div className="flex items-center justify-between">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={rememberMe}
                  onChange={(e) => setRememberMe(e.target.checked)}
                  className="w-4 h-4 rounded border-[#ccc]"
                />
                <span className="text-[13px] text-[#666]">Remember me</span>
              </label>
              <button type="button" className="text-[13px] text-[#4a90e2] hover:underline">
                Find Password
              </button>
            </div>

            {/* Login Button */}
            <button
              type="submit"
              className="w-full h-[50px] bg-[#333] text-white rounded-lg font-medium text-[15px] hover:bg-[#555] transition-colors"
            >
              Login
            </button>
          </form>

          {/* Divider */}
          <div className="flex items-center gap-3 my-6">
            <div className="flex-1 h-px bg-[#e5e5e5]" />
            <span className="text-[12px] text-[#999]">or</span>
            <div className="flex-1 h-px bg-[#e5e5e5]" />
          </div>

          {/* Demo Login Buttons */}
          <div className="space-y-2">
            <p className="text-[12px] text-[#999] text-center mb-3">Demo Login (Quick Access)</p>
            <button
              onClick={() => handleDemoLogin('admin')}
              className="w-full h-[42px] bg-[#2c3e50] text-white rounded-lg text-[13px] font-medium hover:bg-[#34495e] transition-colors"
            >
              Login as Admin
            </button>
            <button
              onClick={() => handleDemoLogin('member')}
              className="w-full h-[42px] bg-[#4a90e2] text-white rounded-lg text-[13px] font-medium hover:bg-[#357abd] transition-colors"
            >
              Login as Verified Member
            </button>
            <button
              onClick={() => handleDemoLogin('pending')}
              className="w-full h-[42px] border border-[#ddd] text-[#666] rounded-lg text-[13px] font-medium hover:bg-[#f5f5f5] transition-colors"
            >
              Login as Pending Member
            </button>
          </div>

          {/* Register Link */}
          <p className="text-center text-[13px] text-[#666] mt-6">
            Don&apos;t have an account?{' '}
            <Link to="/register" className="text-[#4a90e2] font-medium hover:underline">
              Register as Business
            </Link>
          </p>
        </div>
      </div>
    </div>
  );
}
