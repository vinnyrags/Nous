"use client";

import { useContext } from "react";
import { CartContext, type CartContextValue } from "@/components/CartProvider";

export function useCart(): CartContextValue {
  const context = useContext(CartContext);

  if (!context) {
    throw new Error("useCart must be used within a CartProvider");
  }

  return context;
}
