import { useEffect, lazy, Suspense } from 'react';
import { Routes, Route, Navigate, useParams } from 'react-router-dom';
import { useStore } from './store/useStore';
import { supabase } from './lib/supabase';
import { productPath } from './lib/productUrl';
import Header from './components/Header';
import Footer from './components/Footer';
import Toast from './components/Toast';
import ProductDetail from './pages/ProductDetail';
import ProtectedRoute from './components/ProtectedRoute';

const Home = lazy(() => import('./pages/Home'));
const ProductList = lazy(() => import('./pages/ProductList'));
const Login = lazy(() => import('./pages/Login'));
const Register = lazy(() => import('./pages/Register'));
const AdminDashboard = lazy(() => import('./pages/AdminDashboard'));
const AdminSupply = lazy(() => import('./pages/AdminSupply'));
const CustomerSupport = lazy(() => import('./pages/CustomerSupport'));
const Checkout = lazy(() => import('./pages/Checkout'));
const MyAccount = lazy(() => import('./pages/MyAccount'));
const Wishlist = lazy(() => import('./pages/Wishlist'));
const PendingApproval = lazy(() => import('./pages/PendingApproval'));
const OrderPrint = lazy(() => import('./pages/OrderPrint'));
const ResetPassword = lazy(() => import('./pages/ResetPassword'));

/**
 * Legacy `/product/:id` → canonical `/products/{id}/{slug}` redirect.
 * The id is the authoritative key; we look the product up to build a slug and
 * replace the history entry so the old URL never stays in the address bar.
 */
function LegacyProductRedirect() {
  const { id } = useParams<{ id: string }>();
  const { products } = useStore();
  const product = products.find((p) => String(p.id) === id);
  if (!product) return <Navigate to={`/products/${id}`} replace />;
  return <Navigate to={productPath(product)} replace />;
}

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
        window.history.replaceState(null, '', '/reset-password');
      }
    });

    return () => subscription.unsubscribe();
  }, [initAuth, loadProducts]);

  return (
    <div className="min-h-screen flex flex-col">
      <Suspense fallback={<main className="min-h-[50vh] flex items-center justify-center" aria-busy="true">Loading…</main>}>
        <Routes>
        {/* Admin route without header/footer */}
        <Route path="/admin" element={<AdminDashboard />} />
        <Route path="/admin/supply" element={<><AdminSupply /><Toast /></>} />
        {/* Sign-up is a full-screen flow with its own compact header (Faire) */}
        <Route path="/register" element={<><Register /><Toast /></>} />

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
                  {/* Canonical product path: /products/{id}/{stable-slug} */}
                  <Route path="/products/:id/:slug?" element={<ProductDetail />} />
                  {/* Legacy /product/:id → canonical redirect (server rewrite serves the SPA) */}
                  <Route path="/product/:id" element={<LegacyProductRedirect />} />
                  <Route path="/login" element={<Login />} />
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
      </Suspense>
    </div>
  );
}

export default App;
