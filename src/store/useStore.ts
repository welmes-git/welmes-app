import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CurrencyCode } from '../lib/currency';
import * as db from '../lib/db';
import { emailOrderPlaced, emailMemberApproved, emailMemberRejected, emailOrderShipped } from '../lib/email';

export interface AppNotification {
  id: string;
  memberId: string;
  type: 'order_status' | 'order_shipped' | 'member_approved' | 'member_rejected';
  read: boolean;
  createdAt: string;
  // payload varies by type
  orderId?: string;
  orderStatus?: string;
  carrier?: string;
  trackingNumber?: string;
}

export interface SetOption {
  id: string;
  description: string;
  unitsPerSet: number;
  wholesalePrice: number;
  originalPrice: number;
}

export interface Product {
  id: number;
  /** Original name as entered by the manufacturer/supplier (e.g. Japanese) */
  name: string;
  /** Canonical English/romanized name — shown as the primary heading site-wide */
  nameEn: string;
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
  /** Storage path of the uploaded business-registration certificate */
  certificatePath?: string;
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
  authLoading: boolean;
  login: (email: string, password: string) => Promise<boolean>;
  logout: () => void;
  initAuth: () => Promise<void>;

  // Products
  products: Product[];
  loadProducts: () => Promise<void>;
  addProduct: (product: Omit<Product, 'id'>) => Promise<Product | null>;
  updateProduct: (id: number, updates: Partial<Product>) => Promise<{ error: any } | void>;
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
    certificateFile?: File | null;
  }) => Promise<{ error?: string }>;
  updateMember: (id: string, updates: Partial<Member>) => Promise<{ error?: string }>;
  changePassword: (id: string, newPassword: string) => Promise<void>;
  approveMember: (id: string) => Promise<{ error?: string }>;
  rejectMember: (id: string) => Promise<{ error?: string }>;

  // Wishlist (stays local)
  wishlist: number[];
  toggleWishlist: (productId: number) => void;
  isWishlisted: (productId: number) => boolean;

  // Cart (synced with server when logged in)
  cart: CartItem[];
  addToCart: (product: Product, quantity?: number, setOption?: SetOption) => void;
  removeFromCart: (productId: number, setOptionId?: string) => void;
  updateCartQuantity: (productId: number, quantity: number, setOptionId?: string) => void;
  clearCart: () => void;
  syncCart: () => Promise<void>;

  // Orders
  orders: Order[];
  loadOrders: () => Promise<void>;
  /** Load orders visible to the current user (own orders, or all for admins) */
  loadMyOrders: () => Promise<void>;
  addOrder: (order: Order) => Promise<{ error?: string }>;
  updateOrderStatus: (id: string, status: Order['status']) => Promise<void>;
  updateOrderShipping: (id: string, carrier: string, trackingNumber: string) => Promise<void>;

  // Notifications (server-backed; local state is a cache for the current user)
  notifications: AppNotification[];
  loadNotifications: () => Promise<void>;
  addNotification: (n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>) => Promise<void>;
  markNotificationRead: (id: string) => void;
  markAllNotificationsRead: () => void;
  clearNotifications: (memberId: string) => void;

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
      authLoading: true,

      initAuth: async () => {
        set({ authLoading: true });
        const { data: { session } } = await db.getSession();
        if (!session?.user) {
          set({ authLoading: false });
          return;
        }
        const member = await db.fetchMemberByAuthId(session.user.id);
        if (member) {
          set({
            currentUser: member,
            isAuthenticated: true,
            isAdmin: member.isAdmin,
            authLoading: false,
          });
          await get().syncCart();
          get().loadNotifications();
        } else {
          set({ authLoading: false });
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
        await get().syncCart();
        get().loadNotifications();
        return true;
      },

      logout: async () => {
        await db.signOut();
        // Clear per-user state so it can't leak into the next account that logs
        // in on a shared browser. The signed-in cart already lives on the server
        // and is restored via syncCart() on the next login.
        set({
          currentUser: null,
          isAuthenticated: false,
          isAdmin: false,
          notifications: [],
          cart: [],
          wishlist: [],
        });
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
        return created;
      },

      updateProduct: async (id, updates) => {
        const result = await db.updateProductById(id, updates);
        if (result?.error) return { error: result.error };
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

      registerMember: async ({ email, password, companyName, businessNumber, representative, phone, address, certificateFile }) => {
        const { data, error } = await db.signUp(email, password, {
          companyName, businessNumber, representative, phone, address,
        });
        if (error) return { error: error.message };
        if (!data.user) return { error: 'Signup failed' };

        // Upload the certificate now that we (usually) have a session from signUp.
        // Best-effort: if there's no session (email confirmation on) or storage
        // fails, we still create the account so registration isn't blocked.
        let certificatePath: string | undefined;
        if (certificateFile) {
          certificatePath = (await db.uploadCertificate(data.user.id, certificateFile)) ?? undefined;
        }

        // Upsert full member record (trigger creates minimal row; we update with full details).
        // Surface a failure here — otherwise the auth user exists but their
        // business details were silently dropped (e.g. blocked by RLS).
        const { error: memberErr } = await db.upsertMember(data.user.id, {
          email, companyName, businessNumber, representative, phone, address, certificatePath,
        });
        if (memberErr) {
          console.error('[registerMember] upsertMember failed:', memberErr.message);
          return { error: memberErr.message };
        }
        return {};
      },

      updateMember: async (id, updates) => {
        const { error } = await db.updateMemberById(id, updates);
        if (error) {
          console.error('[updateMember]', error.message);
          return { error: error.message };
        }
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
        return {};
      },

      changePassword: async (_id, newPassword) => {
        await db.supabase.auth.updateUser({ password: newPassword });
      },

      approveMember: async (id) => {
        // Only announce the decision once the database actually accepted it —
        // otherwise a failed update still emailed the member "approved".
        const { error } = await db.updateMemberById(id, { status: 'approved' });
        if (error) {
          console.error('[approveMember]', error.message);
          return { error: error.message };
        }
        set((state) => ({
          members: state.members.map((m) =>
            m.id === id ? { ...m, status: 'approved' as const } : m
          ),
        }));
        const member = get().members.find((m) => m.id === id);
        if (member) {
          emailMemberApproved(member.email, member.companyName);
          get().addNotification({ memberId: id, type: 'member_approved' });
        }
        return {};
      },

      rejectMember: async (id) => {
        const { error } = await db.updateMemberById(id, { status: 'rejected' });
        if (error) {
          console.error('[rejectMember]', error.message);
          return { error: error.message };
        }
        set((state) => ({
          members: state.members.map((m) =>
            m.id === id ? { ...m, status: 'rejected' as const } : m
          ),
        }));
        const member = get().members.find((m) => m.id === id);
        if (member) {
          emailMemberRejected(member.email, member.companyName);
          get().addNotification({ memberId: id, type: 'member_rejected' });
        }
        return {};
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

      // ── Cart (synced with server when logged in) ─────────────
      cart: [],

      syncCart: async () => {
        const { currentUser, cart: localCart } = get();
        if (!currentUser) return;

        const serverCart = await db.fetchServerCart(currentUser.id);

        // Merge: combine local + server, take higher quantity for duplicates
        const merged = [...serverCart];
        for (const localItem of localCart) {
          const key = `${localItem.product.id}__${localItem.setOption?.id ?? ''}`;
          const existIdx = merged.findIndex(
            (i) => `${i.product.id}__${i.setOption?.id ?? ''}` === key
          );
          if (existIdx >= 0) {
            merged[existIdx] = {
              ...merged[existIdx],
              quantity: Math.max(merged[existIdx].quantity, localItem.quantity),
            };
          } else {
            merged.push(localItem);
          }
        }

        set({ cart: merged });
        await db.replaceServerCart(currentUser.id, merged);
      },

      addToCart: (product, quantity = 1, setOption) => {
        set((state) => {
          const existing = state.cart.find(
            (item) =>
              item.product.id === product.id &&
              item.setOption?.id === setOption?.id
          );
          let newCart: CartItem[];
          if (existing) {
            newCart = state.cart.map((item) =>
              item.product.id === product.id && item.setOption?.id === setOption?.id
                ? { ...item, quantity: item.quantity + quantity }
                : item
            );
          } else {
            newCart = [...state.cart, { product, quantity, setOption }];
          }
          return { cart: newCart };
        });
        const { currentUser, cart } = get();
        if (currentUser) {
          const updatedItem = cart.find(
            (i) => i.product.id === product.id && i.setOption?.id === setOption?.id
          );
          if (updatedItem) db.upsertCartItem(currentUser.id, updatedItem);
        }
      },

      removeFromCart: (productId, setOptionId) => {
        set((state) => ({
          cart: state.cart.filter(
            (item) =>
              !(item.product.id === productId && item.setOption?.id === setOptionId)
          ),
        }));
        const { currentUser } = get();
        if (currentUser) db.deleteCartItem(currentUser.id, productId, setOptionId);
      },

      updateCartQuantity: (productId, quantity, setOptionId) => {
        set((state) => ({
          cart: state.cart.map((item) =>
            item.product.id === productId && item.setOption?.id === setOptionId
              ? { ...item, quantity }
              : item
          ),
        }));
        const { currentUser, cart } = get();
        if (currentUser) {
          const updatedItem = cart.find(
            (i) => i.product.id === productId && i.setOption?.id === setOptionId
          );
          if (updatedItem) db.upsertCartItem(currentUser.id, updatedItem);
        }
      },

      clearCart: () => {
        set({ cart: [] });
        const { currentUser } = get();
        if (currentUser) db.clearServerCart(currentUser.id);
      },

      // ── Orders ────────────────────────────────────────────────
      orders: [],

      loadOrders: async () => {
        const orders = await db.fetchOrders();
        set({ orders });
      },

      loadMyOrders: async () => {
        const user = get().currentUser;
        if (!user) return;
        const orders = user.isAdmin
          ? await db.fetchOrders()
          : await db.fetchOrdersByMemberId(user.id);
        set({ orders });
      },

      addOrder: async (order) => {
        // `products.stock` counts pieces, so a set contributes qty × unitsPerSet
        const stockLines: db.StockLine[] = order.items.map((item) => ({
          product_id: item.product.id,
          units: item.quantity * (item.setOption?.unitsPerSet ?? 1),
        }));

        // Take stock first (atomic check + decrement) so two concurrent
        // checkouts can't oversell the same units.
        const stockRes = await db.decrementStock(stockLines);
        if (stockRes.error) return { error: stockRes.error };

        const { error } = await db.insertOrder(order);
        if (error) {
          await db.restoreStock(stockLines); // compensate — we already took stock
          return { error };
        }

        set((state) => ({ orders: [order, ...state.orders] }));
        get().loadProducts(); // refresh the catalogue so stock counts are current
        const user = get().currentUser;
        if (user?.email) {
          emailOrderPlaced(order, user.email);
        }
        return {};
      },

      updateOrderStatus: async (id, status) => {
        await db.updateOrderStatusById(id, status);
        set((state) => ({
          orders: state.orders.map((o) =>
            o.id === id ? { ...o, status } : o
          ),
        }));
        const order = get().orders.find((o) => o.id === id);
        if (order) {
          get().addNotification({
            memberId: order.memberId,
            type: 'order_status',
            orderId: id,
            orderStatus: status,
          });
        }
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
        if (order) {
          get().addNotification({
            memberId: order.memberId,
            type: 'order_shipped',
            orderId: id,
            carrier,
            trackingNumber,
          });
        }
      },

      // ── Notifications (stored in Supabase so they reach the target member) ──
      notifications: [],

      loadNotifications: async () => {
        const user = get().currentUser;
        if (!user) {
          set({ notifications: [] });
          return;
        }
        const notifications = await db.fetchNotificationsByMemberId(user.id);
        set({ notifications });
      },

      addNotification: async (n) => {
        const created = await db.insertNotification(n);
        // Only mirror into local state when it's for the current user
        // (admins create notifications for other members)
        const user = get().currentUser;
        if (created && user && created.memberId === user.id) {
          set((state) => ({
            notifications: [created, ...state.notifications].slice(0, 100),
          }));
        }
      },

      markNotificationRead: (id) => {
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.id === id ? { ...n, read: true } : n
          ),
        }));
        db.markNotificationReadById(id);
      },

      markAllNotificationsRead: () => {
        const user = get().currentUser;
        if (!user) return;
        set((state) => ({
          notifications: state.notifications.map((n) =>
            n.memberId === user.id ? { ...n, read: true } : n
          ),
        }));
        db.markAllNotificationsReadByMemberId(user.id);
      },

      clearNotifications: (memberId) => {
        set((state) => ({
          notifications: state.notifications.filter((n) => n.memberId !== memberId),
        }));
        db.deleteNotificationsByMemberId(memberId);
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
        // Notifications live in Supabase and are fetched per user — persisting
        // them locally would leak them across accounts on a shared browser
        // Auth session is restored via initAuth() using Supabase session cookie
        // Products/members/orders are loaded from Supabase on demand
      }),
    }
  )
);
