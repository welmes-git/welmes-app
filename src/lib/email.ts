import { supabase } from './supabase';
import type { Order, CartItem } from '../store/useStore';

async function invoke(type: string, data: Record<string, unknown>) {
  try {
    const { error } = await supabase.functions.invoke('send-email', {
      body: { type, data },
    });
    if (error) console.error(`[email:${type}]`, error.message);
  } catch (e) {
    console.error(`[email:${type}]`, e);
  }
}

export function emailOrderPlaced(order: Order, buyerEmail: string) {
  invoke('order_placed', {
    buyerEmail,
    orderId: order.id,
    memberName: order.memberName,
    items: order.items.map((item: CartItem) => ({
      name: item.product.nameEn ?? item.product.name,
      brand: item.product.brand,
      quantity: item.quantity,
      setDescription: item.setOption?.description ?? '',
      // Line total must use the set price when a set option is chosen,
      // otherwise sets are billed at the single-unit price.
      price: Math.round((item.setOption?.wholesalePrice ?? item.product.wholesalePrice) * item.quantity),
    })),
    subtotal: order.subtotal,
    vat: order.vat,
    total: order.total,
    // Order amounts are stored in JPY — label them JPY so the value and the
    // currency code always agree (previously showed e.g. "USD 363,660").
    currency: 'JPY',
    date: order.date,
  });
}

export function emailMemberRegistered(data: {
  email: string;
  companyName: string;
  businessNumber: string;
  representative: string;
  phone: string;
}) {
  invoke('member_registered', {
    ...data,
    date: new Date().toISOString().split('T')[0],
  });
}

export function emailMemberApproved(email: string, companyName: string) {
  invoke('member_approved', { email, companyName });
}

export function emailMemberRejected(email: string, companyName: string) {
  invoke('member_rejected', { email, companyName });
}

export function emailOrderShipped(
  buyerEmail: string,
  orderId: string,
  memberName: string,
  trackingCarrier: string,
  trackingNumber: string,
  trackingShippedAt: string,
) {
  invoke('order_shipped', {
    buyerEmail,
    orderId,
    memberName,
    trackingCarrier,
    trackingNumber,
    trackingShippedAt,
  });
}
