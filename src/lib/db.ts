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
  if (fields.email)          row.email = fields.email;
  if (fields.companyName)    row.company_name = fields.companyName;
  if (fields.businessNumber) row.business_number = fields.businessNumber;
  if (fields.representative) row.representative = fields.representative;
  if (fields.phone)          row.phone = fields.phone;
  if (fields.address)        row.address = fields.address;
  if (fields.status)         row.status = fields.status;
  if (fields.certificatePath) row.certificate_url = fields.certificatePath;
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
  const row: Record<string, unknown> = {};
  if (fields.companyName)    row.company_name = fields.companyName;
  if (fields.businessNumber) row.business_number = fields.businessNumber;
  if (fields.representative) row.representative = fields.representative;
  if (fields.phone)          row.phone = fields.phone;
  if (fields.address)        row.address = fields.address;
  if (fields.status !== undefined) row.status = fields.status;
  return supabase.from('members').update(row).eq('id', id);
}

// ── Products ─────────────────────────────────────────────────────

export async function fetchProducts(): Promise<Product[]> {
  const { data, error } = await supabase
    .from('products')
    .select('*')
    .order('created_at', { ascending: false });
  if (error || !data) return [];
  return data.map(rowToProduct);
}

export async function insertProduct(p: Omit<Product, 'id'>): Promise<Product | null> {
  const { data, error } = await supabase
    .from('products')
    .insert([productToRow(p)])
    .select()
    .single();
  if (error || !data) { console.error(error); return null; }
  return rowToProduct(data);
}

export async function updateProductById(id: number, p: Partial<Product>) {
  return supabase.from('products').update(productToRow(p as Product)).eq('id', id);
}

export async function deleteProductById(id: number) {
  return supabase.from('products').delete().eq('id', id);
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
    brand:          row.brand as string,
    category:       row.category as string,
    image:          (row.image as string) || '',
    images:         (row.images as string[]) || [],
    originalPrice:  Number(row.original_price),
    wholesalePrice: Number(row.wholesale_price),
    discount:       Number(row.discount),
    tags:           (row.tags as string[]) || [],
    rating:         Number(row.rating),
    reviews:        Number(row.reviews),
    description:    (row.description as string) || '',
    stock:          Number(row.stock),
    status:         (row.status as 'active' | 'inactive') || 'active',
    setOptions:     row.set_options as Product['setOptions'],
  };
}

function productToRow(p: Partial<Product>): Record<string, unknown> {
  const row: Record<string, unknown> = {};
  if (p.name !== undefined)           row.name = p.name;
  if (p.nameEn !== undefined)         row.name_en = p.nameEn;
  if (p.brand !== undefined)          row.brand = p.brand;
  if (p.category !== undefined)       row.category = p.category;
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
