import { STORAGE_KEYS, CART_TTL } from "./constants";

export interface CartItem {
  priceId: string;
  productId: number;
  title: string;
  price: string;
  image: string;
  stock: number;
  quantity: number;
}

function isClient(): boolean {
  return typeof window !== "undefined";
}

export function getCartItems(): CartItem[] {
  if (!isClient()) return [];

  try {
    const lastUpdated = parseInt(
      localStorage.getItem(STORAGE_KEYS.CART_TIMESTAMP) || "0",
      10,
    );

    if (lastUpdated && Date.now() - lastUpdated > CART_TTL) {
      clearCart();
      return [];
    }

    return JSON.parse(localStorage.getItem(STORAGE_KEYS.CART) || "[]");
  } catch {
    return [];
  }
}

export function saveCart(items: CartItem[]): void {
  if (!isClient()) return;
  localStorage.setItem(STORAGE_KEYS.CART, JSON.stringify(items));
  localStorage.setItem(STORAGE_KEYS.CART_TIMESTAMP, String(Date.now()));
}

export function addCartItem(item: CartItem): CartItem[] {
  const items = getCartItems();
  const existing = items.find((i) => i.priceId === item.priceId);

  if (existing) {
    existing.quantity = Math.min(
      existing.quantity + item.quantity,
      item.stock || Infinity,
    );
  } else {
    items.push({ ...item });
  }

  saveCart(items);
  return items;
}

export function removeCartItem(priceId: string): CartItem[] {
  const items = getCartItems().filter((i) => i.priceId !== priceId);
  saveCart(items);
  return items;
}

export function updateCartQuantity(
  priceId: string,
  quantity: number,
): CartItem[] {
  const items = getCartItems();
  const item = items.find((i) => i.priceId === priceId);

  if (item) {
    item.quantity = Math.min(Math.max(1, quantity), item.stock || Infinity);
    saveCart(items);
  }

  return items;
}

export function clearCart(): void {
  if (!isClient()) return;
  localStorage.removeItem(STORAGE_KEYS.CART);
  localStorage.removeItem(STORAGE_KEYS.CART_TIMESTAMP);
}

export function getCartCount(items?: CartItem[]): number {
  const list = items || getCartItems();
  return list.reduce((sum, item) => sum + item.quantity, 0);
}
