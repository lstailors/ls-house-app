"use client";

import { useEffect, useState } from "react";
import { api } from "./api";

export interface Me {
  user: string;
  account: string;
  is_internal: boolean;
  default_make_level: "Classico" | "Mezza Mano" | "Fatto a Mano";
  default_discount_pct: number;
  retail_multiplier: number;
  can_save: boolean;
}

export function useMe() {
  const [me, setMe] = useState<Me | null>(null);
  useEffect(() => {
    api.get<Me>("/api/me").then(setMe).catch(() => undefined);
  }, []);
  return me;
}
