import { useRef, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { api } from "@/lib/api";
import { getStoredToken } from "@/lib/authClient";
import { cn } from "@ls/design/utils";
import "@alts/styles/alts-pos.css";

type Photo = {
  id: string;
  name: string;
  url: string;
  garmentRef?: string | null;
  creation?: string;
};

const API = import.meta.env.VITE_BACKEND_URL || "";

export default function TicketPhotos() {
  const { ticketName = "" } = useParams();
  const qc = useQueryClient();
  const cameraRef = useRef<HTMLInputElement>(null);
  const libraryRef = useRef<HTMLInputElement>(null);
  const [garmentRef, setGarmentRef] = useState("G1");
  const [preview, setPreview] = useState<string | null>(null);

  const ticket = useQuery({
    queryKey: ["photo-ticket", ticketName],
    enabled: !!ticketName,
    queryFn: () => api.get<any>(`/api/intake-alterations/tickets/${ticketName}`),
  });

  const photos = useQuery({
    queryKey: ["photos", ticketName],
    enabled: !!ticketName,
    queryFn: () => api.get<Photo[]>(`/api/intake-alterations/tickets/${ticketName}/photos`),
  });

  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("file", file);
      fd.append("path", `alts/${ticketName}/${garmentRef}-${Date.now()}-${file.name}`);
      fd.append("ticketName", ticketName);
      fd.append("garmentRef", garmentRef);
      const token = getStoredToken();
      const res = await fetch(`${API}/api/intake-alterations/photos`, {
        method: "POST",
        credentials: "include",
        headers: token ? { Authorization: `Bearer ${token}` } : {},
        body: fd,
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message || json?.error || "Upload failed");
      return json.data;
    },
    onSuccess: () => {
      toast.success("Photo saved on ticket");
      qc.invalidateQueries({ queryKey: ["photos", ticketName] });
      setPreview(null);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const onPick = (file: File | undefined) => {
    if (!file) return;
    setPreview(URL.createObjectURL(file));
    upload.mutate(file);
  };

  const garments = ticket.data?.garments ?? [];
  const refs: string[] = garments.length
    ? garments.map((g: any, i: number) => g.garment_id || `G${i + 1}`)
    : ["G1", "G2", "G3"];

  return (
    <div className="alts-root min-h-screen flex flex-col">
      <header className="flex items-center gap-3 px-5 py-4 border-b border-brass/20">
        <Link to={`/orders/alterations/${ticketName}`} className="text-cream-dim p-2">
          ←
        </Link>
        <div>
          <div className="display text-xl">Garment photos</div>
          <div className="caps font-mono">{ticketName}</div>
        </div>
      </header>

      <div className="p-5 max-w-3xl mx-auto w-full space-y-5">
        <p className="text-sm text-cream-dim">
          Condition at intake, stains, fittings — saved on the ticket (internal). Prefer camera on the floor.
        </p>

        <div className="flex flex-wrap gap-2">
          {refs.map((ref) => (
            <button
              key={ref}
              type="button"
              onClick={() => setGarmentRef(ref)}
              className={cn(
                "px-4 py-2 rounded-full text-xs font-bold border",
                garmentRef === ref ? "bg-brass text-forest-deep border-brass" : "border-brass/30 text-cream-dim",
              )}
            >
              {ref}
            </button>
          ))}
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <button
            type="button"
            disabled={upload.isPending}
            onClick={() => cameraRef.current?.click()}
            className="btn-brass h-16 text-[11px] disabled:opacity-50"
          >
            {upload.isPending ? "Uploading…" : `📷 Take photo · ${garmentRef}`}
          </button>
          <button
            type="button"
            disabled={upload.isPending}
            onClick={() => libraryRef.current?.click()}
            className="h-16 rounded-2xl border border-brass/35 bg-black/25 text-[11px] font-bold tracking-widest uppercase text-cream-muted disabled:opacity-50"
          >
            Choose from library
          </button>
        </div>
        <input
          ref={cameraRef}
          type="file"
          accept="image/*"
          capture="environment"
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />
        <input
          ref={libraryRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            onPick(e.target.files?.[0]);
            e.target.value = "";
          }}
        />

        {preview && (
          <img src={preview} alt="" className="rounded-2xl border border-brass/25 max-h-48 object-cover w-full" />
        )}

        <div className="grid grid-cols-2 md:grid-cols-3 gap-3">
          {(photos.data ?? []).map((p) => (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noreferrer"
              className="card-glass overflow-hidden block"
            >
              <img src={p.url} alt={p.name} className="w-full aspect-square object-cover bg-black/40" />
              <div className="px-2 py-1.5 text-[10px] text-cream-dim truncate">
                {p.garmentRef || "—"} · {p.name}
              </div>
            </a>
          ))}
        </div>
        {photos.isFetched && !(photos.data ?? []).length && (
          <p className="text-cream-dim text-sm italic text-center py-8">No photos yet</p>
        )}
      </div>
    </div>
  );
}
