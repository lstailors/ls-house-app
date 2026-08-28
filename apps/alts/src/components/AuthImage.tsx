import { useEffect, useState } from "react";

type AuthImageProps = {
  path: string;
  alt: string;
  className?: string;
  fit?: "cover" | "contain";
  onFail?: () => void;
};

/**
 * Public ERP / lookbook URLs load as a normal image.
 * Same-origin /api/* photo proxies are fetched with credentials
 * (session cookie) then shown via blob URL — required for private
 * MTMPro / wardrobe thumbs on Alts PWA.
 */
export default function AuthImage({ path, alt, className, fit = "cover", onFail }: AuthImageProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let revoke: string | null = null;
    let cancelled = false;
    setFailed(false);
    setSrc(null);

    if (!path) {
      setFailed(true);
      return;
    }

    const isApi = path.startsWith("/api/");

    async function load() {
      try {
        if (!isApi) {
          if (!cancelled) setSrc(path);
          return;
        }
        const res = await fetch(path, {
          credentials: "include",
          headers: { Accept: "image/*,*/*" },
        });
        if (!res.ok) throw new Error(`photo ${res.status}`);
        const blob = await res.blob();
        if (cancelled) return;
        const url = URL.createObjectURL(blob);
        revoke = url;
        setSrc(url);
      } catch {
        if (!cancelled) {
          setFailed(true);
          onFail?.();
        }
      }
    }

    void load();
    return () => {
      cancelled = true;
      if (revoke) URL.revokeObjectURL(revoke);
    };
  }, [path]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!path || failed || !src) {
    return <div className={className} />;
  }

  return (
    <div className={className}>
      <img
        src={src}
        alt={alt}
        className={fit === "contain" ? "w-full h-full object-contain" : "w-full h-full object-cover"}
        onError={() => {
          setFailed(true);
          onFail?.();
        }}
      />
    </div>
  );
}
