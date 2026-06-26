import { useRef, useState } from "react";
import { Camera, Loader2, X } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { cn } from "@/lib/utils";

interface PhotoUploaderProps {
  photos: string[];
  onChange: (photos: string[]) => void;
  /** Prefix used to build the stored filename, e.g. "intake/ALT-123/G1". */
  pathPrefix?: string;
  /** Attach uploaded files to an ERPNext document so they aren't orphaned. */
  doctype?: string;
  docname?: string;
  disabled?: boolean;
  /** Button label when no upload is in progress. */
  label?: string;
  className?: string;
}

export function PhotoUploader({
  photos,
  onChange,
  pathPrefix = "uploads",
  doctype,
  docname,
  disabled = false,
  label = "Add Photos",
  className,
}: PhotoUploaderProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [uploadingCount, setUploadingCount] = useState(0);

  const uploadPhoto = async (file: File): Promise<string | null> => {
    const ext = file.name.split(".").pop() ?? "jpg";
    const path = `${pathPrefix}/${Date.now()}-${Math.random().toString(36).slice(2, 7)}.${ext}`;
    try {
      const formData = new FormData();
      formData.append("file", file);
      formData.append("path", path);
      if (doctype && docname) {
        formData.append("doctype", doctype);
        formData.append("docname", docname);
      }
      const res = await api.raw("/api/files/upload", { method: "POST", body: formData });
      if (!res.ok) return null;
      const json = await res.json();
      return json.data?.url ?? null;
    } catch {
      return null;
    }
  };

  const handleFiles = async (files: FileList | null) => {
    if (!files || files.length === 0) return;
    const fileArr = Array.from(files);
    setUploadingCount((n) => n + fileArr.length);
    const uploaded: string[] = [];
    for (const file of fileArr) {
      const url = await uploadPhoto(file);
      setUploadingCount((n) => Math.max(0, n - 1));
      if (url) uploaded.push(url);
      else toast.error(`Failed to upload ${file.name}`);
    }
    if (uploaded.length > 0) onChange([...photos, ...uploaded]);
  };

  const removePhoto = (url: string) => onChange(photos.filter((p) => p !== url));

  return (
    <div className={cn("space-y-3", className)}>
      {(photos.length > 0 || uploadingCount > 0) ? (
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          {photos.map((url, i) => (
            <div
              key={`${url}-${i}`}
              className="relative group aspect-square rounded-lg overflow-hidden border border-brass/20 bg-forest-deep"
            >
              <a href={url} target="_blank" rel="noreferrer">
                <img src={url} alt={`Photo ${i + 1}`} className="w-full h-full object-cover" loading="lazy" />
              </a>
              {!disabled ? (
                <button
                  type="button"
                  onClick={() => removePhoto(url)}
                  className="absolute top-1 right-1 w-5 h-5 rounded-full bg-red-900/80 text-red-200 flex items-center justify-center opacity-0 group-hover:opacity-100 transition-opacity"
                  aria-label="Remove photo"
                >
                  <X className="w-3 h-3" />
                </button>
              ) : null}
            </div>
          ))}
          {Array.from({ length: uploadingCount }).map((_, i) => (
            <div
              key={`uploading-${i}`}
              className="aspect-square rounded-lg border border-brass/20 bg-forest-deep flex items-center justify-center"
            >
              <Loader2 className="w-4 h-4 text-brass-shimmer animate-spin" />
            </div>
          ))}
        </div>
      ) : null}

      {!disabled ? (
        <>
          <button
            type="button"
            onClick={() => fileInputRef.current?.click()}
            disabled={uploadingCount > 0}
            className="flex items-center gap-2 px-4 py-2 rounded-xl border border-dashed border-brass/30 text-cream-muted hover:border-brass/50 hover:text-cream transition-all text-sm disabled:opacity-50"
          >
            {uploadingCount > 0 ? (
              <><Loader2 className="w-4 h-4 animate-spin text-brass-shimmer" /> Uploading…</>
            ) : (
              <><Camera className="w-4 h-4 text-brass-shimmer" /> {label}</>
            )}
          </button>

          <input
            ref={fileInputRef}
            type="file"
            accept="image/*"
            capture="environment"
            multiple
            className="hidden"
            onChange={(e) => {
              handleFiles(e.target.files);
              e.target.value = "";
            }}
          />
        </>
      ) : null}
    </div>
  );
}
