export function usd(n: number | null | undefined): string {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(
    Number(n) || 0,
  );
}
