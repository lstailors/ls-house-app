type AuthImageProps = {
  path: string;
  alt: string;
  className?: string;
  fit?: "cover" | "contain";
  onFail?: () => void;
};

/** Public ERP /files URLs load as a normal image. Private paths use the API proxy URL. */
export default function AuthImage({ path, alt, className, fit = "cover", onFail }: AuthImageProps) {
  if (!path) return <div className={className} />;

  return (
    <div className={className}>
      <img
        src={path}
        alt={alt}
        className={fit === "contain" ? "w-full h-full object-contain" : "w-full h-full object-cover"}
        onError={() => onFail?.()}
      />
    </div>
  );
}
