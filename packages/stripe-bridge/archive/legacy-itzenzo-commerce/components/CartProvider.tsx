"use client";

import {
  createContext,
  useCallback,
  useEffect,
  useMemo,
  useState,
} from "react";
import type { CartItem } from "@/lib/cart";
import {
  getCartItems,
  addCartItem,
  removeCartItem,
  updateCartQuantity,
  clearCart,
  getCartCount,
} from "@/lib/cart";

export interface CartContextValue {
  items: CartItem[];
  itemCount: number;
  addItem: (item: CartItem) => void;
  removeItem: (priceId: string) => void;
  updateQuantity: (priceId: string, quantity: number) => void;
  clear: () => void;
}

export const CartContext = createContext<CartContextValue | null>(null);

export default function CartProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  const [items, setItems] = useState<CartItem[]>([]);

  useEffect(() => {
    setItems(getCartItems());
  }, []);

  const addItem = useCallback((item: CartItem) => {
    setItems(addCartItem(item));
  }, []);

  const removeItem = useCallback((priceId: string) => {
    setItems(removeCartItem(priceId));
  }, []);

  const updateQuantity = useCallback(
    (priceId: string, quantity: number) => {
      setItems(updateCartQuantity(priceId, quantity));
    },
    [],
  );

  const clear = useCallback(() => {
    clearCart();
    setItems([]);
  }, []);

  const itemCount = useMemo(() => getCartCount(items), [items]);

  const value = useMemo(
    () => ({ items, itemCount, addItem, removeItem, updateQuantity, clear }),
    [items, itemCount, addItem, removeItem, updateQuantity, clear],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}
