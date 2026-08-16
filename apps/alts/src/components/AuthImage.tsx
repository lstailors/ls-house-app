import { useEffect, useRef, useState } from "react";
import { api } from "@ls/api-client";

/**
 * Staff photos live behind the session cookie on app.lstailors.com.
 * A bare <img src="/api/..."> from alts.lstailors.com never sends that cookie.
 */
export function AuthImage({
  path,
  alt,
  className,
  fit = "cover",
  onFail,
}: {
  path: string;
  alt: string;
  className?: string;
  fit?: "cover" | "contain";
  onFail?: () => void;
}) {
  const box = useRef<HTMLDivElement | null>(null);
  const [src, setSrc] = useState<string | null>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const el = box.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) setVisible(true);
      },
      { rootMargin: "240px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, []);

  useEffect(() => {
    if (!visible || !path) return;
    const publicCdn = /^https?:\/\//i.test(path) && !/\/api\/fabric-stock\//.test(path);
    if (publicCdn) {
      setSrc(path);
      return;
    }

    let objectUrl: string | null = null;
    let cancelled = false;
    const endpoint = path.replace(/^https?:\/\/[^/]+/, "");

    (async () => {
      try {
        const res = await api.raw(endpoint);
        if (!res.ok) throw new Error(String(res.status));
        const blob = await res.blob();
        if (cancelled) return;
        if (!blob.type.startsWith("image/")) throw new Error(blob.type || "not image");
        objectUrl = URL.createObjectURL(blob);
        setSrc(objectUrl);
      } catch {
        if (!cancelled) onFail?.();
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [visible, path, onFail]);

  return (
    <div ref={box} className={className}>
      {src ? (
        <img
          src={src}
          alt={alt}
          className={fit === "contain" ? "w-full h-full object-contain" : "w-full h-full object-cover"}
        />
      ) : null}
    </div>
  );
}
