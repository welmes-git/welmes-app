/**
 * Data access layer — all Supabase queries go here.
 * Components/store import from this file, never directly from supabase.ts.
 */
import { supabase } from './supabase';
export { supabase };
import type { Product, Member, Order, CartItem, ShippingAddress, AppNotification } from '../store/useStore';

// ── Auth ─────────────────────────────────────────────────────────

export async function signIn(email: string, password: string) {
  return supabase.auth.signInWithPassword({ email, password });
}

export async function signOut() {
  return supabase.auth.signOut();
}

export async function signUp(
  email: string,
  password: string,
  meta: {
    companyName: string;
    businessNumber: string;
    representative: string;
    phone: string;
    address: string;
  }
) {
  return supabase.auth.signUp({
    email,
    password,
    options: { data: { company_name: meta.companyName } },
  });
}

export async function getSession() {
  return supabase.auth.getSession();
}

/**
 * Email a password-recovery link. Supabase strips the recovery token from the
 * URL on load and fires a PASSWORD_RECOVERY event, which App.tsx routes to the
 * reset page — so we point the link at the site root.
 */
export async function sendPasswordReset(email: string) {
  return supabase.auth.resetPasswordForEmail(email, {
    redirectTo: `${window.location.origin}${window.location.pathname}`,
  });
}

/** Set a new password for the currently recovered/signed-in user. */
export async function updatePassword(newPassword: string) {
  return supabase.auth.updateUser({ password: newPassword });
}

// ── Members ──────────────────────────────────────────────────────

export async function fetchMemberByAuthId(authId: string): Promise<Member | null> {
  const { data, error } = await supabase
    .from('members')
    .select('*')
    .eq('auth_id', authId)
    .single();
  if (error || !data) {
    console.error('[fetchMemberByAuthId] error:', error, 'authId:', authId);
    return null;
  }
  return rowToMember(data);
}

export async function fetchAllMembers(): Promise<Member[]> {
  const { data, error } = await supabase.from('members').select('*').order('created_at');
  if (error || !data) return [];
  return data.map(rowToMember);
}

export async function upsertMember(authId: string, fields: Partial<Member>) {
  const row: Record<string, unknown> = { auth_id: authId };
  if (fields.email           !== undefined) row.email            = fields.email;
  if (fields.companyName     !== undefined) row.company_name     = fields.companyName;
  if (fields.businessNumber  !== undefined) row.business_number  = fields.businessNumber;
  if (fields.representative  !== undefined) row.representative   = fields.representative;
  if (fields.phone           !== undefined) row.phone            = fields.phone;
  if (fields.address         !== undefined) row.address          = fields.address;
  if (fields.status          !== undefined) row.status           = fields.status;
  if (fields.certificatePath !== undefined) row.certificate_url  = fields.certificatePath;
  return supabase.from('members').upsert(row, { onConflict: 'auth_id' });
}

/**
 * Upload a business-registration certificate to the private
 * `business-certificates` bucket. Returns the storage path (not a public URL);
 * admins generate a signed URL to view it. Best-effort — returns null on failure.
 */
export async function uploadCertificate(authId: string, file: File): Promise<string | null> {
  const ext = (file.name.split('.').pop() || 'pdf').toLowerCase();
  const path = `${authId}/certificate-${Date.now()}.${ext}`;
  const { error } = await supabase.storage
    .from('business-certificates')
    .upload(path, file, { upsert: true, contentType: file.type || undefined });
  if (error) { console.error('[uploadCertificate]', error.message); return null; }
  return path;
}

export async function updateMemberById(id: string, fields: Partial<Member>) {
  // Compare against undefined, not falsiness — otherwise clearing a field to ""
  // silently keeps the old value.
  const row: Record<string, unknown> = {};
  if (fields.companyName    !== undefined) row.company_name    = fields.companyName;
  if (fields.businessNumber !== undefined) row.business_number = fields.businessNumber;
  if (fields.representative !== undefined) row.representative  = fields.representative;
  if (fields.phone          !== undefined) row.phone           = fields.phone;
  if (fields.address        !== undefined) row.address         = fields.address;
  if (fields.status         !== undefined) row.status          = fields.status;
  return supabase.from('members').update(row).eq('id', id);
}

// ── Products ─────────────────────────────────────────────────────

export async function fetchProducts(): Promise<Product[]> {
  const { data: { session } } = await supabase.auth.getSession();
  const member = session?.user ? await fetchMemberByAuthId(session.user.id) : null;
  const source = member?.isAdmin ? 'products_admin' : 'products_public';
  const { data, error } = await supabase
    .from(source)
    .select('*')
    .order('created_at', { ascending: false });
  if (error || !data) return [];

  let rows = data as Record<string, unknown>[];
  if (member && !member.isAdmin && member.status === 'approved' && rows.length) {
    const { data: prices, error: priceError } = await supabase
      .from('product_prices_approved')
      .select('id,original_price,wholesale_price,discount,set_options');
    if (!priceError && prices) {
      const byId = new Map(prices.map((row) => [Number(row.id), row]));
      rows = rows.map((row) => ({ ...row, ...(byId.get(Number(row.id)) ?? {}) }));
    }
  }
  return rows.map(rowToProduct);
}

export async function insertProduct(p: Omit<Product, 'id'>): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products_admin')
    .insert([productToRow(p)])
    .select()
    .single();
  if (error || !data) { console.error(error); return null; }
  return rowToProduct(data);
}

export async function updateProductById(id: number, p: Partial<Product>) {
  return supabase.from('products_admin').update(productToRow(p as Product)).eq('id', id);
}

/** Bulk status change from the admin products list (checkbox multi-select). */
export async function bulkUpdateProductStatusByIds(ids: number[], status: Product['status']) {
  return supabase.from('products_admin').update({ status }).in('id', ids);
}

export async function deleteProductById(id: number) {
  return supabase.from('products_admin').delete().eq('id', id);
}

// ── Stock ────────────────────────────────────────────────────────

/** Total pieces per line — `products.stock` counts pieces, not sets. */
export interface StockLine { product_id: number; units: number }

/**
 * Atomically verify and decrement stock for every line. Fails (and changes
 * nothing) if any product is short — the error message carries
 * `INSUFFICIENT_STOCK:<productId>`.
 */
export async function decrementStock(items: StockLine[]): Promise<{ error?: string }> {
  if (items.length === 0) return {};
  const { error } = await supabase.rpc('decrement_product_stock', { p_items: items });
  if (error) { console.error('[decrementStock]', error.message); return { error: error.message }; }
  return {};
}

/** Compensating action when the order insert fails after stock was taken. */
export async function restoreStock(items: StockLine[]): Promise<void> {
  if (items.length === 0) return;
  const { error } = await supabase.rpc('restore_product_stock', { p_items: items });
  if (error) console.error('[restoreStock]', error.message);
}

// ── Orders ───────────────────────────────────────────────────────

export async function fetchOrders(): Promise<Order[]> {
  const { data: orderRows, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .order('created_at', { ascending: false });
  if (error || !orderRows) return [];
  return orderRows.map(rowToOrder);
}

export async function fetchOrdersByMemberId(memberId: string): Promise<Order[]> {
  const { data: orderRows, error } = await supabase
    .from('orders')
    .select('*, order_items(*)')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false });
  if (error || !orderRows) return [];
  return orderRows.map(rowToOrder);
}

export async function insertOrder(order: Order): Promise<{ error?: string }> {
  // Insert order header
  const { error: orderErr } = await supabase.from('orders').insert([{
    id:               order.id,
    member_id:        order.memberId,
    member_name:      order.memberName,
    subtotal:         order.subtotal,
    vat:              order.vat,
    total:            order.total,
    status:           order.status,
    date:             order.date,
    po_number:        order.poNumber ?? null,
    notes:            order.notes ?? null,
    shipping_address: order.shippingAddress ?? null,
  }]);
  if (orderErr) { console.error('[insertOrder] header failed:', orderErr); return { error: orderErr.message }; }

  // Insert order items
  if (order.items.length > 0) {
    const items = order.items.map((item: CartItem) => ({
      order_id:         order.id,
      product_snapshot: item.product,
      quantity:         item.quantity,
      set_option:       item.setOption ?? null,
    }));
    const { error: itemsErr } = await supabase.from('order_items').insert(items);
    if (itemsErr) {
      console.error('[insertOrder] items failed:', itemsErr);
      // Best-effort rollback so we don't leave a header-only order behind
      await supabase.from('orders').delete().eq('id', order.id);
      return { error: itemsErr.message };
    }
  }
  return {};
}

export async function updateOrderStatusById(id: string, status: Order['status']) {
  return supabase.from('orders').update({ status }).eq('id', id);
}

export async function updateOrderShippingById(
  id: string,
  carrier: string,
  trackingNumber: string,
  shippedAt: string,
) {
  return supabase.from('orders').update({
    status: 'shipped',
    tracking_carrier: carrier,
    tracking_number: trackingNumber,
    tracking_shipped_at: shippedAt,
  }).eq('id', id);
}

// ── Cart sync ────────────────────────────────────────────────────

export async function fetchServerCart(memberId: string): Promise<CartItem[]> {
  const { data, error } = await supabase
    .from('cart_items')
    .select('*')
    .eq('member_id', memberId)
    .order('updated_at', { ascending: true });
  if (error || !data) return [];
  return data.map((row) => ({
    product:   row.product_snapshot as CartItem['product'],
    quantity:  Number(row.quantity),
    setOption: row.set_option as CartItem['setOption'],
  }));
}

export async function upsertCartItem(
  memberId: string,
  item: CartItem,
) {
  return supabase.from('cart_items').upsert({
    member_id:        memberId,
    product_id:       item.product.id,
    set_option_id:    item.setOption?.id ?? '',
    product_snapshot: item.product,
    set_option:       item.setOption ?? null,
    quantity:         item.quantity,
    updated_at:       new Date().toISOString(),
  }, { onConflict: 'member_id,product_id,set_option_id' });
}

export async function deleteCartItem(
  memberId: string,
  productId: number,
  setOptionId?: string,
) {
  return supabase
    .from('cart_items')
    .delete()
    .eq('member_id', memberId)
    .eq('product_id', productId)
    .eq('set_option_id', setOptionId ?? '');
}

export async function clearServerCart(memberId: string) {
  return supabase.from('cart_items').delete().eq('member_id', memberId);
}

export async function replaceServerCart(memberId: string, items: CartItem[]) {
  await clearServerCart(memberId);
  if (items.length === 0) return;
  return supabase.from('cart_items').insert(
    items.map((item) => ({
      member_id:        memberId,
      product_id:       item.product.id,
      set_option_id:    item.setOption?.id ?? '',
      product_snapshot: item.product,
      set_option:       item.setOption ?? null,
      quantity:         item.quantity,
      updated_at:       new Date().toISOString(),
    }))
  );
}

// ── Notifications (server-backed so they reach the target member) ─

export function rowToNotification(r: Record<string, unknown>): AppNotification {
  return {
    id:             r.id as string,
    memberId:       r.member_id as string,
    type:           r.type as AppNotification['type'],
    read:           !!r.read,
    createdAt:      r.created_at as string,
    orderId:        (r.order_id as string) || undefined,
    orderStatus:    (r.order_status as string) || undefined,
    carrier:        (r.carrier as string) || undefined,
    trackingNumber: (r.tracking_number as string) || undefined,
    payload:        (r.payload as Record<string, unknown>) || undefined,
  };
}

export async function fetchNotificationsByMemberId(memberId: string): Promise<AppNotification[]> {
  const { data, error } = await supabase
    .from('notifications')
    .select('*')
    .eq('member_id', memberId)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error || !data) {
    if (error) console.error('[fetchNotifications]', error.message);
    return [];
  }
  return data.map(rowToNotification);
}

export async function insertNotification(
  n: Omit<AppNotification, 'id' | 'createdAt' | 'read'>,
): Promise<AppNotification | null> {
  const { data, error } = await supabase
    .from('notifications')
    .insert([{
      member_id:       n.memberId,
      type:            n.type,
      order_id:        n.orderId ?? null,
      order_status:    n.orderStatus ?? null,
      carrier:         n.carrier ?? null,
      tracking_number: n.trackingNumber ?? null,
      payload:         n.payload ?? null,
    }])
    .select()
    .single();
  if (error || !data) {
    if (error) console.error('[insertNotification]', error.message);
    return null;
  }
  return rowToNotification(data);
}

export async function markNotificationReadById(id: string) {
  return supabase.from('notifications').update({ read: true }).eq('id', id);
}

export async function markAllNotificationsReadByMemberId(memberId: string) {
  return supabase.from('notifications').update({ read: true }).eq('member_id', memberId);
}

export async function deleteNotificationsByMemberId(memberId: string) {
  return supabase.from('notifications').delete().eq('member_id', memberId);
}

// ── SD product change log (admin-only, RLS-guarded) ──────────────
// Populated by scripts/sd-monitor.mjs when an imported product's price,
// stock or trading status changes on Superdelivery.

export interface SdProductChange {
  id: string;
  productId: number;
  changeType: 'price_up' | 'price_down' | 'sold_out' | 'restock' | 'not_trading' | 'missing';
  oldValue: Record<string, unknown> | null;
  newValue: Record<string, unknown> | null;
  acknowledged: boolean;
  createdAt: string;
}

function rowToChange(r: Record<string, unknown>): SdProductChange {
  return {
    id:          r.id as string,
    productId:   Number(r.product_id),
    changeType:  r.change_type as SdProductChange['changeType'],
    oldValue:    (r.old_value as Record<string, unknown>) ?? null,
    newValue:    (r.new_value as Record<string, unknown>) ?? null,
    acknowledged: !!r.acknowledged,
    createdAt:   r.created_at as string,
  };
}

export async function fetchUnacknowledgedChanges(): Promise<SdProductChange[]> {
  const { data, error } = await supabase
    .from('sd_product_changes')
    .select('*')
    .eq('acknowledged', false)
    .order('created_at', { ascending: false })
    .limit(500);
  if (error || !data) return [];
  return data.map(rowToChange);
}

/** Mark every unacknowledged change of one product as reviewed. */
export async function acknowledgeProductChanges(productId: number) {
  return supabase.from('sd_product_changes').update({ acknowledged: true }).eq('product_id', productId);
}

// ── Search trends ────────────────────────────────────────────────
// Logs real buyer search terms so "Trending Searches" reflects actual
// activity instead of a hardcoded list.

/** Fire-and-forget — a failed log shouldn't block the user's search. */
export function logSearchQuery(term: string, memberId?: string) {
  const trimmed = term.trim();
  if (!trimmed) return;
  supabase
    .from('search_queries')
    .insert([{ term: trimmed, member_id: memberId ?? null }])
    .then(({ error }) => { if (error) console.error('[logSearchQuery]', error.message); });
}

export interface TrendingSearch {
  term: string;
  count: number;
}

export async function fetchTrendingSearches(limit = 10): Promise<TrendingSearch[]> {
  const { data, error } = await supabase.rpc('get_trending_searches', { p_limit: limit });
  if (error || !data) {
    if (error) console.error('[fetchTrendingSearches]', error.message);
    return [];
  }
  return (data as { term: string; search_count: number }[]).map((row) => ({
    term: row.term,
    count: Number(row.search_count),
  }));
}

// ── Reviews ──────────────────────────────────────────────────────

export interface Review {
  id: string;
  productId: number;
  memberId: string;
  memberName: string;
  rating: number;
  content: string;
  createdAt: string;
}

export async function fetchReviewsByProductId(productId: number): Promise<Review[]> {
  const { data, error } = await supabase
    .from('reviews')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map((row) => ({
    id:         row.id as string,
    productId:  Number(row.product_id),
    memberId:   row.member_id as string,
    memberName: row.member_name as string,
    rating:     Number(row.rating),
    content:    row.content as string,
    createdAt:  row.created_at as string,
  }));
}

export async function insertReview(review: Omit<Review, 'id' | 'createdAt'>): Promise<{ error?: string }> {
  const { error } = await supabase.from('reviews').insert([{
    product_id:  review.productId,
    member_id:   review.memberId,
    member_name: review.memberName,
    rating:      review.rating,
    content:     review.content,
  }]);
  if (error) return { error: error.message };
  return {};
}

export async function hasReviewedProduct(memberId: string, productId: number): Promise<boolean> {
  const { count } = await supabase
    .from('reviews')
    .select('id', { count: 'exact', head: true })
    .eq('member_id', memberId)
    .eq('product_id', productId);
  return (count ?? 0) > 0;
}

// ── Type converters ──────────────────────────────────────────────

function rowToMember(row: Record<string, unknown>): Member {
  return {
    id:             row.id as string,
    authId:         row.auth_id as string,
    email:          row.email as string,
    companyName:    row.company_name as string,
    businessNumber: row.business_number as string,
    representative: row.representative as string,
    phone:          row.phone as string,
    address:        row.address as string,
    status:         row.status as Member['status'],
    isAdmin:        row.is_admin as boolean,
    registeredDate: row.registered_date as string,
    certificatePath: (row.certificate_url as string) || undefined,
    passwordHash:   '',
  };
}

function rowToProduct(row: Record<string, unknown>): Product {
  return {
    id:             Number(row.id),
    name:           row.name as string,
    nameEn:         (row.name_en as string) || (row.name as string),
    nameEnStatus:   (row.name_en_status as Product['nameEnStatus']) || undefined,
    nameEnConfidence: row.name_en_confidence == null ? undefined : Number(row.name_en_confidence),
    nameEnSource:   (row.name_en_source as Product['nameEnSource']) || undefined,
    nameEnGeneratedAt: (row.name_en_generated_at as string) || undefined,
    nameEnApprovedAt: (row.name_en_approved_at as string) || undefined,
    nameEnApprovedBy: (row.name_en_approved_by as string) || undefined,
    seoSlug:        (row.seo_slug as string) || undefined,
    seoTitle:       (row.seo_title as string) || undefined,
    seoDescription: (row.seo_description as string) || undefined,
    searchAliases:  (row.search_aliases as string[]) || [],
    jan:            (row.jan as string) || undefined,
    updatedAt:      (row.updated_at as string) || (row.created_at as string) || undefined,
    brand:          row.brand as string,
    category:       row.category as string,
    subcategory:    (row.subcategory as string) || undefined,
    image:          (row.image as string) || '',
    images:         (row.images as string[]) || [],
    originalPrice:  Number(row.original_price ?? 0),
    wholesalePrice: Number(row.wholesale_price ?? 0),
    discount:       Number(row.discount ?? 0),
    tags:           (row.tags as string[]) || [],
    rating:         Number(row.rating),
    reviews:        Number(row.reviews),
    description:    (row.description as string) || '',
    stock:          Number(row.stock),
    status:         (row.status as 'active' | 'inactive') || 'active',
    setOptions:     (row.set_options as Product['setOptions']) ?? [],
    sdDealerId:     (row.sd_dealer_id as string) || undefined,
    sdDealerName:   (row.sd_dealer_name as string) || undefined,
  };
}

function productToRow(p: Partial<Product>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (p.name !== undefined)           row.name = p.name;
  if (p.nameEn !== undefined)         row.name_en = p.nameEn;
  if (p.nameEnStatus !== undefined)   row.name_en_status = p.nameEnStatus;
  if (p.nameEnConfidence !== undefined) row.name_en_confidence = p.nameEnConfidence;
  if (p.nameEnSource !== undefined)   row.name_en_source = p.nameEnSource;
  if (p.nameEnGeneratedAt !== undefined) row.name_en_generated_at = p.nameEnGeneratedAt;
  if (p.nameEnApprovedAt !== undefined) row.name_en_approved_at = p.nameEnApprovedAt;
  if (p.nameEnApprovedBy !== undefined) row.name_en_approved_by = p.nameEnApprovedBy || null;
  if (p.seoSlug !== undefined)        row.seo_slug = p.seoSlug || null;
  if (p.seoTitle !== undefined)       row.seo_title = p.seoTitle || null;
  if (p.seoDescription !== undefined) row.seo_description = p.seoDescription || null;
  if (p.searchAliases !== undefined)  row.search_aliases = p.searchAliases;
  if (p.brand !== undefined)          row.brand = p.brand;
  if (p.category !== undefined)       row.category = p.category;
  if (p.subcategory !== undefined)    row.subcategory = p.subcategory || null;
  if (p.image !== undefined)          row.image = p.image;
  if (p.images !== undefined)         row.images = p.images;
  if (p.originalPrice !== undefined)  row.original_price = p.originalPrice;
  if (p.wholesalePrice !== undefined) row.wholesale_price = p.wholesalePrice;
  if (p.discount !== undefined)       row.discount = p.discount;
  if (p.tags !== undefined)           row.tags = p.tags;
  if (p.rating !== undefined)         row.rating = p.rating;
  if (p.reviews !== undefined)        row.reviews = p.reviews;
  if (p.description !== undefined)    row.description = p.description;
  if (p.stock !== undefined)          row.stock = p.stock;
  if (p.status !== undefined)         row.status = p.status;
  if (p.setOptions !== undefined)     row.set_options = p.setOptions ?? null;
  if (p.sdDealerId !== undefined)     row.sd_dealer_id = p.sdDealerId || null;
  if (p.sdDealerName !== undefined)   row.sd_dealer_name = p.sdDealerName || null;
  return row;
}

function rowToOrder(row: Record<string, unknown>): Order {
  const items = ((row.order_items as Record<string, unknown>[]) || []).map((oi) => ({
    product:   oi.product_snapshot as Product,
    quantity:  Number(oi.quantity),
    setOption: oi.set_option as CartItem['setOption'],
  }));
  return {
    id:              row.id as string,
    memberId:        row.member_id as string,
    memberName:      row.member_name as string,
    items,
    subtotal:        Number(row.subtotal),
    vat:             Number(row.vat),
    total:           Number(row.total),
    status:          row.status as Order['status'],
    date:            row.date as string,
    poNumber:           row.po_number as string | undefined,
    notes:              row.notes as string | undefined,
    shippingAddress:    row.shipping_address as ShippingAddress | undefined,
    trackingCarrier:    (row.tracking_carrier as string) || undefined,
    trackingNumber:     (row.tracking_number as string) || undefined,
    trackingShippedAt:  (row.tracking_shipped_at as string) || undefined,
  };
}

// ── Support Chat ────────────────────────────────────────────────────────────

export interface SupportRoom {
  id: string;
  memberId: string;
  memberName: string;
  memberEmail: string;
  status: 'open' | 'closed';
  lastMessage: string;
  lastMessageAt: string;
  unreadAdmin: number;
  createdAt: string;
}

export interface SupportMessage {
  id: string;
  roomId: string;
  senderId: string;
  senderName: string;
  role: 'member' | 'admin';
  content: string;
  createdAt: string;
}

export async function getOrCreateRoom(memberId: string, memberName: string, memberEmail: string): Promise<SupportRoom | null> {
  const { data: existing } = await supabase
    .from('support_rooms')
    .select('*')
    .eq('member_id', memberId)
    .eq('status', 'open')
    .order('created_at', { ascending: false })
    .limit(1)
    .single();
  if (existing) return rowToRoom(existing);

  const { data, error } = await supabase
    .from('support_rooms')
    .insert([{ member_id: memberId, member_name: memberName, member_email: memberEmail }])
    .select()
    .single();
  if (error || !data) { console.error(error); return null; }
  return rowToRoom(data);
}

export async function fetchMessages(roomId: string): Promise<SupportMessage[]> {
  const { data, error } = await supabase
    .from('support_messages')
    .select('*')
    .eq('room_id', roomId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];
  return data.map(rowToMessage);
}

export async function sendMessage(roomId: string, senderId: string, senderName: string, role: 'member' | 'admin', content: string): Promise<SupportMessage | null> {
  const { data, error } = await supabase
    .from('support_messages')
    .insert([{ room_id: roomId, sender_id: senderId, sender_name: senderName, role, content }])
    .select()
    .single();
  if (error || !data) { console.error(error); return null; }

  const { error: roomErr } = await supabase.from('support_rooms').update({
    last_message: content,
    last_message_at: new Date().toISOString(),
    ...(role === 'admin' ? { unread_admin: 0 } : {}),
  }).eq('id', roomId);
  if (roomErr) console.error('[sendMessage] room update failed:', roomErr);

  if (role === 'member') {
    const { error: rpcErr } = await supabase.rpc('increment_room_unread', { room: roomId });
    if (rpcErr) console.error('[sendMessage] unread increment failed:', rpcErr);
  }
  return rowToMessage(data);
}

export async function fetchAllRooms(): Promise<SupportRoom[]> {
  const { data, error } = await supabase
    .from('support_rooms')
    .select('*')
    .order('last_message_at', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToRoom);
}

export async function closeRoom(roomId: string) {
  return supabase.from('support_rooms').update({ status: 'closed' }).eq('id', roomId);
}

export async function markRoomRead(roomId: string) {
  return supabase.from('support_rooms').update({ unread_admin: 0 }).eq('id', roomId);
}

function rowToRoom(r: Record<string, unknown>): SupportRoom {
  return {
    id: r.id as string,
    memberId: r.member_id as string,
    memberName: (r.member_name as string) || '',
    memberEmail: (r.member_email as string) || '',
    status: (r.status as 'open' | 'closed') || 'open',
    lastMessage: (r.last_message as string) || '',
    lastMessageAt: (r.last_message_at as string) || (r.created_at as string),
    unreadAdmin: Number(r.unread_admin) || 0,
    createdAt: r.created_at as string,
  };
}

function rowToMessage(r: Record<string, unknown>): SupportMessage {
  return {
    id: r.id as string,
    roomId: r.room_id as string,
    senderId: r.sender_id as string,
    senderName: (r.sender_name as string) || '',
    role: (r.role as 'member' | 'admin') || 'member',
    content: r.content as string,
    createdAt: r.created_at as string,
  };
}

// ── English-name enrichment review (Task 7) ──────────────────────
// Admin-only. The audit table `product_name_enrichment_runs` is RLS-guarded so
// only admins can read AI inputs, evidence, warnings and validation details.

export interface NameEvidence {
  citationUrl: string;
  resolvedUrl: string | null;
  title?: string;
  officialDomain: string | null;
  verified: boolean;
  matchedBy: string[];
  error?: string;
}

export interface NameValidationError { code: string; message: string; value?: string }

export interface NameEnrichmentRun {
  id: string;
  productId: number;
  provider: string;
  model: string;
  status: 'queued' | 'running' | 'succeeded' | 'review_required' | 'failed' | 'skipped';
  candidateName?: string;
  seoTitle?: string;
  seoDescription?: string;
  searchAliases: string[];
  sourceType?: string;
  confidence?: number;
  evidence: NameEvidence[];
  warnings: string[];
  errors: NameValidationError[];
  /** Deterministic facts/qualifiers extracted from the source name (validation payload). */
  extracted: {
    brand?: string;
    facts?: unknown;
    qualifiers?: unknown;
  };
  errorMessage?: string;
  createdAt: string;
}

function rowToNameRun(r: Record<string, unknown>): NameEnrichmentRun {
  const result = (r.result_payload as Record<string, unknown>) ?? {};
  const validation = (r.validation_payload as Record<string, unknown>) ?? {};
  return {
    id:            r.id as string,
    productId:     Number(r.product_id),
    provider:      (r.provider as string) || '',
    model:         (r.model as string) || '',
    status:        (r.status as NameEnrichmentRun['status']) || 'queued',
    candidateName: (result.candidateName as string) || undefined,
    seoTitle:      (result.seoTitle as string) || undefined,
    seoDescription: (result.seoDescription as string) || undefined,
    searchAliases: (result.searchAliases as string[]) || [],
    sourceType:    (result.sourceType as string) || undefined,
    confidence:    r.confidence == null ? (validation.confidence as number) : Number(r.confidence),
    evidence:      (result.evidence as NameEvidence[]) || [],
    warnings:      (result.warnings as string[]) || [],
    errors:        (validation.errors as NameValidationError[]) || [],
    extracted: {
      brand:       (validation.brand as string) || undefined,
      facts:       validation.facts,
      qualifiers:  validation.qualifiers,
    },
    errorMessage:  (r.error_message as string) || undefined,
    createdAt:     r.created_at as string,
  };
}

/** Products needing English-name review, most recently generated first. */
export async function fetchProductsForNameReview(
  statuses: Product['nameEnStatus'][] = ['review_required'],
): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products_admin')
    .select('*')
    .in('name_en_status', statuses as string[])
    .order('name_en_generated_at', { ascending: false, nullsFirst: false })
    .limit(500);
  if (error || !data) return [];
  return data.map(rowToProduct);
}

/** Most recent enrichment run for one product (candidate, evidence, warnings). */
export async function fetchLatestNameRun(productId: number): Promise<NameEnrichmentRun | null> {
  const { data, error } = await supabase
    .from('product_name_enrichment_runs')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  if (error || !data) return null;
  return rowToNameRun(data);
}

/** Full run history for one product (admin audit view). */
export async function fetchNameRunHistory(productId: number): Promise<NameEnrichmentRun[]> {
  const { data, error } = await supabase
    .from('product_name_enrichment_runs')
    .select('*')
    .eq('product_id', productId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error || !data) return [];
  return data.map(rowToNameRun);
}

export type { NameApprovalInput } from './nameReview';
export type { ApprovalConcurrency } from './nameReview';
import { buildApprovalPatch, validateApprovalName } from './nameReview';
import type { ApprovalConcurrency } from './nameReview';
export { buildApprovalPatch };

/**
 * Human approval (approve as-is or approve after edit) via the
 * `approve_product_name_review` RPC. The RPC is admin-guarded and runs a
 * latest-run + generated-timestamp optimistic-concurrency check so a stale
 * candidate is never stamped over a fresher worker run. It also rejects empty
 * and Japanese-containing names server-side (defence in depth). The stable-URL
 * policy (slug assigned only once) lives inside the RPC, so we pass the desired
 * slug and let the DB keep any existing one.
 */
export async function approveProductName(
  productId: number,
  reviewerId: string,
  input: import('./nameReview').NameApprovalInput,
  concurrency: ApprovalConcurrency,
) {
  const validation = validateApprovalName(input.nameEn);
  if (!validation.ok) {
    return { data: null, error: { message: validation.message, code: validation.code } };
  }
  const { data, error } = await supabase.rpc('approve_product_name_review', {
    p_product_id: productId,
    p_reviewer_id: reviewerId,
    p_name_en: input.nameEn.trim(),
    p_seo_slug: input.seoSlug ?? null,
    p_seo_title: input.seoTitle ?? null,
    p_seo_description: input.seoDescription ?? null,
    p_search_aliases: input.searchAliases ?? [],
    p_name_source: input.source,
    p_expected_run_id: concurrency.expectedRunId,
    p_expected_generated_at: concurrency.expectedGeneratedAt,
  });
  return { data, error };
}

/**
 * Put a product back into the review queue (hold). Keeps any existing candidate
 * data intact; only the workflow status changes so it resurfaces in the filter.
 */
export async function holdProductNameReview(productId: number) {
  return updateProductById(productId, { nameEnStatus: 'review_required' });
}

/**
 * Request a fresh enrichment run for one product via the atomic
 * `request_product_name_regeneration` RPC.
 *
 * The RPC supersedes any queued/running run and resets name_en_status to
 * `pending` in a single transaction, guarded by the same latest-run +
 * generated-timestamp optimistic-concurrency check as approval. The enrichment
 * worker (`enrich:names`) remains the single source of truth for the immutable
 * job snapshot + input hash (it rebuilds and verifies them, per its
 * INPUT_HASH_MISMATCH guard), so we intentionally do NOT fabricate a hash here.
 * The next worker pass (`npm run enrich:names -- --ids=<id>`) enqueues a
 * correctly-hashed job. Existing human approvals are left untouched.
 */
export async function regenerateProductName(
  productId: number,
  concurrency: ApprovalConcurrency,
) {
  const { data, error } = await supabase.rpc('request_product_name_regeneration', {
    p_product_id: productId,
    p_expected_run_id: concurrency.expectedRunId,
    p_expected_generated_at: concurrency.expectedGeneratedAt,
  });
  return { data, error };
}
