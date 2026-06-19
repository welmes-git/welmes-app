import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CurrencyCode } from '../lib/currency';
import * as db from '../lib/db';
import { emailOrderPlaced, emailMemberApproved, emailMemberRejected, emailOrderShipped } from '../lib/email';

export interface SetOption {
  id: string;
  description: string;
  unitsPerSet: number;
  wholesalePrice: number;
  originalPrice: number;
}

export interface Product {
  id: number;
  name: string;
  brand: string;
  category: string;
  image: string;
  images?: string[];
  originalPrice: number;
  wholesalePrice: number;
  discount: number;
  tags: string[];
  rating: number;
  reviews: number;
  description: string;
  stock: number;
  status: 'active' | 'inactive';
  setOptions?: SetOption[];
}

export interface Member {
  id: string;           // UUID from Supabase
  authId?: string;      // auth.users UUID
  email: string;
  passwordHash: string; // kept for type compat, not used with Supabase
  companyName: string;
  businessNumber: string;
  representative: string;
  phone: string;
  address: string;
  status: 'pending' | 'approved' | 'rejected';
  registeredDate: string;
  isAdmin: boolean;
}

export interface CartItem {
  product: Product;
  quantity: number;
  setOption?: SetOption;
}

export interface ShippingAddress {
  company: string;
  recipient: string;
  phone: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  zipCode: string;
  country: string;
}

export interface Order {
  id: string;
  memberId: string;     // UUID
  memberName: string;
  items: CartItem[];
  subtotal: number;
  vat: number;
  total: number;
  status: 'pending' | 'processing' | 'shipped' | 'completed' | 'cancelled';
  date: string;
  poNumber?: string;
  notes?: string;
  shippingAddress?: ShippingAddress;
  trackingCarrier?: string;
  trackingNumber?: string;
  trackingShippedAt?: string;
}

interface AppState {
  // Auth
  currentUser: Member | null;
  isAuthenticated: boolean;
  isAdmin: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  initAuth: () => Promise<void>;

  // Products
  products: Product[];
  loadProducts: () => Promise<void>;
  addProduct: (product: Omit<Product, 'id'>) => Promise<void>;
  updateProduct: (id: number, updates: Partial<Product>) => Promise<void>;
  deleteProduct: (id: number) => Promise<void>;

  // Members
  members: Member[];
  loadMembers: () => Promise<void>;
  registerMember: (data: {
    email: string;
    password: string;
    companyName: string;
    businessNumber: string;
    representative: string;
    phone: string;
    address: string;
  }) => Promise<{ error?: string }>;
  updateMember: (id: string, updates: Partial<Member>) => Promise<void>;
  changePassword: (id: string, newPassword: string) => Promise<void>;
  approveMember: (id: string) => Promise<void>;
  rejectMember: (id: string) => Promise<void>;

  // Wishlist (stays local)
  wishlist: number[];
  toggleWishlist: (productId: number) => void;
  isWishlisted: (productId: number) => boolean;

  // Cart (stays local)
  cart: CartItem[];
  addToCart: (product: Product, quantity?: number, setOption?: SetOption) => void;
  removeFromCart: (productId: number, setOptionId?: string) => void;
  updateCartQuantity: (productId: number, quantity: number, setOptionId?: string) => void;
  clearCart: () => void;

  // Orders
  orders: Order[];
  loadOrders: () => Promise<void>;
  addOrder: (order: Order) => Promise<void>;
  updateOrderStatus: (id: string, status: Order['status']) => Promise<void>;
  updateOrderShipping: (id: string, carrier: string, trackingNumber: string) => Promise<void>;

  // Currency
  selectedCurrency: CurrencyCode;
  setSelectedCurrency: (code: CurrencyCode) => void;

  // UI
  toast: { message: string; type: 'success' | 'error' | 'info' } | null;
  showToast: (message: string, type: 'success' | 'error' | 'info') => void;
  clearToast: () => void;
}

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // ── Auth ──────────────────────────────────────────────────
      currentUser: null,
      isAuthenticated: false,
      isAdmin: false,

      initAuth: async () => {
        const { data: { session } } = await db.getSession();
        if (!session?.user) return;
        const member = await db.fetchMemberByAuthId(session.user.id);
        if (member) {
          set({
            currentUser: member,
            isAuthenticated: true,
            isAdmin: member.isAdmin,
          });
        }
      },

      login: async (email, password) => {
        const { data, error } = await db.signIn(email, password);
        if (error || !data.user) {
          console.error('[login] signIn failed:', error?.message, error?.status);
          return false;
        }

        const member = await db.fetchMemberByAuthId(data.user.id);
        if (!member) {
          console.error('[login] member not found for authId:', data.user.id);
          return false;
        }

        set({
          currentUser: member,
          isAuthenticated: true,
          isAdmin: member.isAdmin,
        });
        return true;
      },

      logout: async () => {
        await db.signOut();
        set({ currentUser: null, isAuthenticated: false, isAdmin: false });
      },

      // ── Products ──────────────────────────────────────────────
      products: [],

      loadProducts: async () => {
        const products = await db.fetchProducts();
        set({ products });
      },

      addProduct: async (product) => {
        const created = await db.insertProduct(product);
        if (created) {
          set((state) => ({ products: [created, ...state.products] }));
        }
      },

      updateProduct: async (id, updates) => {
        await db.updateProductById(id, updates);
        set((state) => ({
          products: state.products.map((p) =>
            p.id === id ? { ...p, ...updates } : p
          ),
        }));
      },

      deleteProduct: async (id) => {
        await db.deleteProductById(id);
        set((state) => ({
          products: state.products.filter((p) => p.id !== id),
        }));
      },

      // ── Members ───────────────────────────────────────────────
      members: [],

      loadMembers: async () => {
        const members = await db.fetchAllMembers();
        set({ members });
      },

      registerMember: async ({ email, password, companyName, businessNumber, representative, phone, address }) => {
        const { data, error } = await db.signUp(email, password, {
          companyName, businessNumber, representative, phone, address,
        });
        if (error) return { error: error.message };
        if (!data.user) return { error: 'Signup failed' };

        // Upsert full member record (trigger creates minimal row; we update with full details)
        await db.upsertMember(data.user.id, {
          email, companyName, businessNumber, representative, phone, address,
        });
        return {};
      },

      updateMember: async (id, updates) => {
        await db.updateMemberById(id, updates);
        set((state) => {
          const updatedMembers = state.members.map((m) =>
            m.id === id ? { ...m, ...updates } : m
          );
          const updatedCurrent =
            state.currentUser?.id === id
              ? { ...state.currentUser, ...updates }
              : state.currentUser;
          return { members: updatedMembers, currentUser: updatedCurrent };
        });
      },

      changePassword: async (_id, newPassword) => {
        await db.supabase.auth.updateUser({ password: newPassword });
      },

      approveMember: async (id) => {
        await db.updateMemberById(id, { status: 'approved' });
        set((state) => ({
          members: state.members.map((m) =>
            m.id === id ? { ...m, status: 'approved' as const } : m
          ),
        }));
        const member = get().members.find((m) => m.id === id);
        if (member) emailMemberApproved(member.email, member.companyName);
      },

      rejectMember: async (id) => {
        await db.updateMemberById(id, { status: 'rejected' });
        set((state) => ({
          members: state.members.map((m) =>
            m.id === id ? { ...m, status: 'rejected' as const } : m
          ),
        }));
        const member = get().members.find((m) => m.id === id);
        if (member) emailMemberRejected(member.email, member.companyName);
      },

      // ── Wishlist (local only) ────────────────────────────────
      wishlist: [],

      toggleWishlist: (productId) =>
        set((state) => ({
          wishlist: state.wishlist.includes(productId)
            ? state.wishlist.filter((id) => id !== productId)
            : [...state.wishlist, productId],
        })),

      isWishlisted: (productId) => get().wishlist.includes(productId),

      // ── Cart (local only) ─────────────────────────────────────
      cart: [],

      addToCart: (product, quantity = 1, setOption) =>
        set((state) => {
          const existing = state.cart.find(
            (item) =>
              item.product.id === product.id &&
              item.setOption?.id === setOption?.id
          );
          if (existing) {
            return {
              cart: state.cart.map((item) =>
                item.product.id === product.id &&
                item.setOption?.id === setOption?.id
                  ? { ...item, quantity: item.quantity + quantity }
                  : item
              ),
            };
          }
          return { cart: [...state.cart, { product, quantity, setOption }] };
        }),

      removeFromCart: (productId, setOptionId) =>
        set((state) => ({
          cart: state.cart.filter(
            (item) =>
              !(item.product.id === productId && item.setOption?.id === setOptionId)
          ),
        })),

      updateCartQuantity: (productId, quantity, setOptionId) =>
        set((state) => ({
          cart: state.cart.map((item) =>
            item.product.id === productId && item.setOption?.id === setOptionId
              ? { ...item, quantity }
              : item
          ),
        })),

      clearCart: () => set({ cart: [] }),

      // ── Orders ────────────────────────────────────────────────
      orders: [],

      loadOrders: async () => {
        const orders = await db.fetchOrders();
        set({ orders });
      },

      addOrder: async (order) => {
        await db.insertOrder(order);
        set((state) => ({ orders: [order, ...state.orders] }));
        const user = get().currentUser;
        if (user?.email) {
          emailOrderPlaced(order, user.email, get().selectedCurrency);
        }
      },

      updateOrderStatus: async (id, status) => {
        await db.updateOrderStatusById(id, status);
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === id ? { ...o, status } : o
          ),
        }));
      },

      updateOrderShipping: async (id, carrier, trackingNumber) => {
        const shippedAt = new Date().toISOString().split('T')[0];
        await db.updateOrderShippingById(id, carrier, trackingNumber, shippedAt);
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === id
              ? { ...o, status: 'shipped' as const, trackingCarrier: carrier, trackingNumber, trackingShippedAt: shippedAt }
              : o
          ),
        }));
        const order = get().orders.find((o) => o.id === id);
        const member = get().members.find((m) => m.id === order?.memberId);
        if (member?.email && order) {
          emailOrderShipped(member.email, id, order.memberName, carrier, trackingNumber, shippedAt);
        }
      },

      // ── Currency ──────────────────────────────────────────────
      selectedCurrency: 'JPY' as CurrencyCode,
      setSelectedCurrency: (code) => set({ selectedCurrency: code }),

      // ── UI ────────────────────────────────────────────────────
      toast: null,
      showToast: (message, type) => set({ toast: { message, type } }),
      clearToast: () => set({ toast: null }),
    }),
    {
      name: 'welmes-store',
      partialize: (state) => ({
        cart: state.cart,
        wishlist: state.wishlist,
        selectedCurrency: state.selectedCurrency,
        // Auth session is restored via initAuth() using Supabase session cookie
        // Products/members/orders are loaded from Supabase on demand
      }),
    }
  )
);
