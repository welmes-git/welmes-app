import { useEffect } from 'react';
import { Routes, Route } from 'react-router-dom';
import { useStore } from './store/useStore';
import { supabase } from './lib/supabase';
import Header from './components/Header';
import Footer from './components/Footer';
import Toast from './components/Toast';
import Home from './pages/Home';
import ProductList from './pages/ProductList';
import ProductDetail from './pages/ProductDetail';
import Login from './pages/Login';
import Register from './pages/Register';
import AdminDashboard from './pages/AdminDashboard';
import CustomerSupport from './pages/CustomerSupport';
import Checkout from './pages/Checkout';
import MyAccount from './pages/MyAccount';
import Wishlist from './pages/Wishlist';
import PendingApproval from './pages/PendingApproval';
import ProtectedRoute from './components/ProtectedRoute';
import OrderPrint from './pages/OrderPrint';
import ResetPassword from './pages/ResetPassword';

function App() {
  const { initAuth, loadProducts } = useStore();

  useEffect(() => {
    // Restore session on mount
    initAuth();
    loadProducts();

    // Keep auth state in sync with Supabase session changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event) => {
      if (event === 'SIGNED_OUT') {
        useStore.setState({
          currentUser: null, isAuthenticated: false, isAdmin: false,
          notifications: [], cart: [], wishlist: [],
        });
      }
      if (event === 'PASSWORD_RECOVERY') {
        // Supabase has consumed the recovery token from the URL and given us a
        // session — send the user somewhere they can actually set a password.
        window.location.hash = '#/reset-password';
      }
    });

    return () => subscription.unsubscribe();
  }, []);

  return (
    <div className="min-h-screen flex flex-col font-['Pretendard','Noto_Sans_KR',sans-serif]">
      <Routes>
        {/* Admin route without header/footer */}
        <Route path="/admin" element={<AdminDashboard />} />

        {/* Public routes with header/footer */}
        <Route
          path="*"
          element={
            <>
              <Header />
              <main className="flex-1">
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/products" element={<ProductList />} />
                  <Route path="/product/:id" element={<ProductDetail />} />
                  <Route path="/login" element={<Login />} />
                  <Route path="/register" element={<Register />} />
                  <Route path="/support" element={<CustomerSupport />} />
                  <Route path="/pending" element={<PendingApproval />} />
                  <Route path="/reset-password" element={<ResetPassword />} />

                  <Route path="/account" element={
                    <ProtectedRoute><MyAccount /></ProtectedRoute>
                  } />
                  <Route path="/wishlist" element={
                    <ProtectedRoute><Wishlist /></ProtectedRoute>
                  } />
                  <Route path="/order/:id/print" element={
                    <ProtectedRoute><OrderPrint /></ProtectedRoute>
                  } />
                  <Route path="/checkout" element={
                    <ProtectedRoute requireApproved><Checkout /></ProtectedRoute>
                  } />
                </Routes>
              </main>
              <Footer />
              <Toast />
            </>
          }
        />
      </Routes>
    </div>
  );
}

export default App;
