import { useState, useEffect } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { justLoggedOut, signIn } from "./authClient";
import { useMe, ME_KEY } from "./session";
import { Button } from "@ls/design/ui/button";
import { Input } from "@ls/design/ui/input";
import { Label } from "@ls/design/ui/label";
import { toast } from "sonner";

export default function Login() {
  const navigate = useNavigate();
  const location = useLocation();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  const fromLoc = (location.state as any)?.from as { pathname?: string; search?: string } | undefined;
  const from =
    fromLoc?.pathname
      ? `${fromLoc.pathname}${fromLoc.search || ""}`
      : null;

  useEffect(() => {
    if (me && !justLoggedOut()) {
      const dest = from ?? (me.role === "driver" ? "/deliveries" : "/");
      navigate(dest, { replace: true });
    }
  }, [me, navigate, from]);

  const signInMutation = useMutation({
    mutationFn: async (): Promise<null> => {
      const res = await signIn.email({ email, password });
      if (res?.error) throw new Error(res.error.message || "Sign-in failed");
      await qc.invalidateQueries({ queryKey: ME_KEY });
      return null;
    },
    onSuccess: () => { toast.success("Welcome back."); },
    onError: (err: Error) => { toast.error(err.message || "Sign-in failed"); },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    signInMutation.mutate();
  };

  return (
    <div className="min-h-screen flex bg-forest-deep">

      {/* ── Left panel — brand ── */}
      <div className="hidden lg:flex lg:w-1/2 flex-col items-center justify-center relative overflow-hidden"
        style={{ background: "linear-gradient(160deg, #1F3A2E 0%, #0D1A10 100%)" }}>

        {/* Corner marks */}
        {["top-6 left-6", "top-6 right-6", "bottom-6 left-6", "bottom-6 right-6"].map((pos) => (
          <div key={pos} className={`absolute ${pos} w-6 h-6 border-brass/30`}
            style={{ borderWidth: pos.includes("top") && pos.includes("left") ? "1px 0 0 1px" :
                                  pos.includes("top") ? "1px 1px 0 0" :
                                  pos.includes("left") ? "0 0 1px 1px" : "0 1px 1px 0" }} />
        ))}

        {/* Radial glow */}
        <div className="absolute inset-0 pointer-events-none"
          style={{ background: "radial-gradient(ellipse 60% 60% at 50% 45%, rgba(176,141,87,0.08) 0%, transparent 70%)" }} />

        <div className="flex flex-col items-center gap-8 z-10 px-12 text-center">
          {/* Real logo seal */}
          <img
            src="/ls-logo-seal.png"
            alt="L&S Custom Tailors"
            className="w-48 h-48 object-contain drop-shadow-2xl"
          />

          <div>
            <div className="font-display italic text-4xl text-cream leading-tight">
              L&amp;S Custom Tailors
            </div>
            <div className="text-brass-light text-sm tracking-[0.3em] uppercase mt-2 font-light">
              Est. · New York · 1974
            </div>
          </div>

          <div className="w-16 h-px bg-brass/40" />

          <p className="text-cream-muted text-sm leading-relaxed max-w-xs italic font-display">
            138 East 61st Street · Suite 201<br />New York, New York
          </p>
        </div>
      </div>

      {/* ── Right panel — form ── */}
      <div className="flex-1 flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">

          {/* Mobile logo */}
          <div className="flex flex-col items-center gap-4 mb-10 lg:hidden">
            <img src="/ls-logo-seal.png" alt="L&S Custom Tailors" className="w-20 h-20 object-contain" />
            <div className="text-center">
              <div className="font-display italic text-2xl text-cream">L&amp;S Custom Tailors</div>
              <div className="text-brass-light text-xs tracking-widest uppercase mt-1">Est. 1974 · New York</div>
            </div>
          </div>

          <div className="mb-8">
            <h1 className="text-2xl font-display italic text-cream">Welcome back.</h1>
            <p className="text-cream-muted text-sm mt-1">Sign in to the house.</p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="space-y-2">
              <Label htmlFor="email" className="ui-label">Email</Label>
              <div className="relative">
                <Mail className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cream-dim" />
                <Input
                  id="email"
                  type="email"
                  required
                  autoComplete="email"
                  placeholder="you@lstailors.com"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  className="pl-9 h-11 bg-forest-raised/40 border-brass/25 focus-visible:ring-brass/40 text-cream"
                />
              </div>
            </div>

            <div className="space-y-2">
              <Label htmlFor="password" className="ui-label">Password</Label>
              <div className="relative">
                <Lock className="absolute left-3 top-1/2 -translate-y-1/2 h-4 w-4 text-cream-dim" />
                <Input
                  id="password"
                  type="password"
                  required
                  autoComplete="current-password"
                  placeholder="•••••••••"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  className="pl-9 h-11 bg-forest-raised/40 border-brass/25 focus-visible:ring-brass/40 text-cream"
                />
              </div>
              <div className="flex justify-end">
                <a
                  href="https://erp.lstailors.com/update-password"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-cream-dim hover:text-brass-light transition-colors"
                >
                  Forgot password?
                </a>
              </div>
            </div>

            <Button
              type="submit"
              disabled={signInMutation.isPending}
              className="w-full h-11 btn-brass text-base"
            >
              {signInMutation.isPending ? (
                <Loader2 className="h-4 w-4 animate-spin" />
              ) : (
                <>Enter the house <ArrowRight className="ml-2 h-4 w-4" /></>
              )}
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
