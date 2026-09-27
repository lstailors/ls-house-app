/** Vendor is identified by item_code prefix, never the brand name. Longest prefix wins. */
export function vendorForItem<T extends { vendor_code: string }>(itemCode: string, vendors: T[]): T | null {
  return (
    [...vendors]
      .sort((a, b) => b.vendor_code.length - a.vendor_code.length)
      .find((v) => itemCode.startsWith(v.vendor_code + "-")) ?? null
  );
}
