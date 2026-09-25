import type { Metadata, Viewport } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "L&S Fabric Estimator",
  description: "Per-unit garment estimates for L&S trade accounts",
  icons: { icon: "/ls-logo-mark.png", apple: "/ls-logo-mark-256.png" },
  appleWebApp: { capable: true, title: "L&S Estimator", statusBarStyle: "black-translucent" },
};

export const viewport: Viewport = {
  themeColor: "#163524",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
