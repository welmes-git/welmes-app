import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { CurrencyCode } from '../lib/currency';
import type { DescriptionI18n } from '../lib/productDescription';
import * as db from '../lib/db';
import { emailOrderPlaced, emailMemberRegistered, emailMemberApproved, emailMemberRejected, emailOrderShipped, emailOrderStatusChanged } from '../lib/email';

export interface AppNotification {
  id: string;
  memberId: string;
  type: 'order_status' | 'order_shipped' | 'member_approved' | 'member_rejected'
    | 'product_price_change' | 'product_sold_out' | 'product_restock' | 'product_missing'
    | 'product_registered';
  read: boolean;
  createdAt: string;
  // payload varies by type
  orderId?: string;
  orderStatus?: string;
  carrier?: string;
  trackingNumber?: string;
  /** Product alerts from sd-monitor.mjs — productId, productName, before/after values */
  payload?: Record<string, unknown>;
}

export interface SetOption {
  id: string;
  description: string;
  unitsPerSet: number;
  wholesalePrice: number;
  originalPrice: number;
}

export type ProductNameStatus = 'pending' | 'auto_approved' | 'review_required' | 'human_approved' | 'failed';
export type ProductNameSource = 'official' | 'grounded' | 'generated' | 'manual';

export interface Product {
  id: number;
  /** Original name as entered by the manufacturer/supplier (e.g. Japanese) */
  name: string;
  /** Canonical English/romanized name — shown as the primary heading site-wide */
  nameEn: string;
  /** Per-language product names (products.name_i18n); Japanese stays in `name`. */
  nameI18n?: Record<string, string>;
  /** English-name workflow is independent from the storefront active/inactive status. */
  nameEnStatus?: ProductNameStatus;
  nameEnConfidence?: number;
  nameEnSource?: ProductNameSource;
  nameEnGeneratedAt?: string;
  nameEnApprovedAt?: string;
  nameEnApprovedBy?: string;
  /** Stable SEO metadata; slug must not silently change when a title is edited. */
  seoSlug?: string;
  seoTitle?: string;
  seoDescription?: string;
  searchAliases?: string[];
  /** Verified JAN/GTIN candidate; emitted in JSON-LD only when format-valid. */
  jan?: string;
  updatedAt?: string;
  brand: string;
  /** Top-level category — one of the 19 mega-menu groups (e.g. "Skincare") */
  category: string;
  /** Sub-category within that group (e.g. "Toner") — optional for legacy rows */
  subcategory?: string;
  image: string;
  images?: string[];
  originalPrice: number;
  wholesalePrice: number;
  discount: number;
  tags: string[];
  rating: number;
  reviews: number;
  description: string;
  /** AI-translated description sections keyed by language, e.g. { en: { overview, ... } } */
  descriptionI18n?: Record<string, DescriptionI18n>;
  stock: number;
  status: 'active' | 'inactive';
  setOptions?: SetOption[];
  /** Superdelivery dealer (出展企業) page id (/p/do/dpsl/{id}/) — admin-only metadata */
  sdDealerId?: string;
  /** Superdelivery dealer company name — admin-only, never rendered on the storefront */
  sdDealerName?: string;
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
  /* ── Payment ledger (orders.payment_*) ──
     Written only by place_order / mark_order_paid; `total` is in JPY while
     `chargeAmount`/`chargeCurrency` are what the buyer is actually asked for,
     frozen at order time so a capture or wire can be reconciled against it. */
  paymentMethod?: 'bank_transfer' | 'paypal';
  paymentStatus?: 'unpaid' | 'paid' | 'failed' | 'refunded';
  /** PayPal capture id, or the wire reference an admin recorded. */
  paymentReference?: string;
  chargeCurrency?: string;
  chargeAmount?: number;
  paidAmount?: number;
  paidCurrency?: string;
  paidAt?: string;
  paymentError?: string;
  /** Wire transfers only: when an unpaid order's stock reservation is released. */
  paymentDueAt?: string;
  /** charge_amount − paid_amount when a wire arrived short (bank fees). */
  paymentShortfall?: number;
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
  /** True until the initial Supabase fetch settles — lets pages show a
   *  spinner instead of flashing the demo catalogue before real data loads */
  productsLoading: boolean;
  loadProducts: () => Promise<void>;
  addProduct: (product: Omit<Product, 'id'>) => Promise<Product | null>;
  updateProduct: (id: number, updates: Partial<Product>) => Promise<{ error: { message: string } } | void>;
  deleteProduct: (id: number) => Promise<void>;
  bulkUpdateProductStatus: (ids: number[], status: Product['status']) => Promise<{ error?: { message: string } } | void>;

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
  /**
   * Create an order via the `place_order` RPC. Prices, VAT, the total, the FX
   * rate and the stock reservation are all decided by the database — callers
   * pass ids, quantities and a currency choice only.
   */
  placeOrder: (input: {
    items: CartItem[];
    shipping: ShippingAddress;
    paymentMethod: 'bank_transfer' | 'paypal';
    poNumber?: string;
    notes?: string;
    chargeCurrency?: string;
    idempotencyKey?: string;
  }) => Promise<{ order?: db.PlacedOrder; error?: string }>;
  /** Pull a freshly paid order back from the server after /api/paypal ran. */
  syncOrderAfterPayment: (orderId: string) => Promise<Order | null>;
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
          await get().loadProducts();
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
        await get().loadProducts();
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
        await get().loadProducts();
      },

      // ── Products ──────────────────────────────────────────────
      products: [],
      productsLoading: true,

      loadProducts: async () => {
        const products = await db.fetchProducts();
        set({ products, productsLoading: false });
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

      bulkUpdateProductStatus: async (ids, status) => {
        const { error } = await db.bulkUpdateProductStatusByIds(ids, status);
        if (error) return { error: { message: error.message } };
        set((state) => ({
          products: state.products.map((p) =>
            ids.includes(p.id) ? { ...p, status } : p
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

        // signUp already opened a Supabase session (Confirm Email is off), but
        // nothing populated the app's own auth state — without this the buyer
        // looks "logged out" to the UI right after registering, even though
        // they're technically signed in, until they log in again manually.
        const member = await db.fetchMemberByAuthId(data.user.id);
        if (member) {
          set({ currentUser: member, isAuthenticated: true, isAdmin: member.isAdmin });
        }

        // Confirms receipt to the applicant and — critically — alerts the
        // admin, who otherwise has no way to know a new application is
        // waiting (previously only found by checking the dashboard manually).
        emailMemberRegistered({ email, companyName, businessNumber, representative, phone });
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

      placeOrder: async (input) => {
        // No stock call here any more: `place_order` re-prices the cart, takes
        // stock and writes the order in a single transaction, so there is no
        // window in which stock is taken but the order failed to save.
        const { order, error } = await db.placeOrder(input);
        if (error || !order) return { error: error ?? 'ORDER_FAILED' };

        // Refresh from the server rather than optimistically inserting: the
        // totals, id and payment state all come from the database now.
        get().loadMyOrders();
        get().loadProducts(); // stock counts changed
        const created = await db.fetchOrderById(order.orderId);
        const user = get().currentUser;
        if (created && user?.email) {
          emailOrderPlaced(created, user.email);
        }
        return { order };
      },

      /** Called after /api/paypal finished creating + capturing server-side. */
      syncOrderAfterPayment: async (orderId) => {
        const order = await db.fetchOrderById(orderId);
        get().loadMyOrders();
        get().loadProducts();
        const user = get().currentUser;
        if (order && user?.email) {
          emailOrderPlaced(order, user.email);
        }
        return order;
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
          // An in-app notification alone is invisible until the buyer next
          // opens the site, which is no good for a cancellation.
          const member = get().members.find((m) => m.id === order.memberId);
          if (member?.email) {
            emailOrderStatusChanged(order, member.email);
          }
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
      skipHydration: true,
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
