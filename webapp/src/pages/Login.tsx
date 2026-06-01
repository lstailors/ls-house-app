import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Mail, Lock, ArrowRight, Loader2 } from "lucide-react";
import { signIn } from "@/lib/authClient";
import { supabase } from "@/lib/supabaseClient";
import { useMe, ME_KEY } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { GlassCard } from "@/components/glass/GlassCard";
import { Monogram } from "@/components/glass/Monogram";
import { toast } from "sonner";
import { useEffect } from "react";

const DEMO_LOGINS = [
  { label: "Super Admin", email: "superadmin@lstailors.com" },
  { label: "NY Manager", email: "nymanager@lstailors.com" },
  { label: "NY Salesperson", email: "nysales@lstailors.com" },
  { label: "Houston Manager", email: "houstonmanager@lstailors.com" },
  { label: "Driver", email: "driver@lstailors.com" },
];

const DEMO_PASSWORD = "LS-Reset-9k4n!";

export default function Login() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const { data: me } = useMe();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  // If already signed in, redirect.
  useEffect(() => {
    if (me) {
      navigate(me.role === "driver" ? "/deliveries" : "/", { replace: true });
    }
  }, [me, navigate]);

  const signInMutation = useMutation({
    mutationFn: async (): Promise<null> => {
      const res = await signIn.email({ email, password });
      if (res?.error) {
        throw new Error(res.error.message || "Sign-in failed");
      }
      // Token now in localStorage. Invalidate me-query to refetch with new token.
      await qc.invalidateQueries({ queryKey: ME_KEY });
      return null; // onSuccess will navigate; role read from useMe() refetch
    },
    onSuccess: () => {
      toast.success("Welcome back.");
      // AppShell will redirect once useMe() resolves with valid user
    },
    onError: (err: Error) => {
      toast.error(err.message || "Sign-in failed");
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || !password) return;
    signInMutation.mutate();
  };

  const handleDemo = (demoEmail: string) => {
    setEmail(demoEmail);
    setPassword(DEMO_PASSWORD);
  };

  return (
    <div className="relative min-h-screen flex items-center justify-center px-4 py-12 overflow-hidden">
      <div className="pointer-events-none absolute inset-0 bg-brass-radial opacity-30" />
      <div
        className="pointer-events-none absolute inset-0 opacity-40"
        style={{
          maskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          WebkitMaskImage: "radial-gradient(ellipse at center, black 30%, transparent 75%)",
          backgroundImage:
            "url(\"data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' width='40' height='40'><path d='M0 20h40M20 0v40' stroke='%23B08D57' stroke-opacity='0.06'/></svg>\")",
        }}
      />

      <div className="relative w-full max-w-5xl grid grid-cols-1 lg:grid-cols-[1.2fr_1fr] gap-8 items-center">
        {/* Brand panel */}
        <div className="hidden lg:flex flex-col gap-6 px-4">
          <div className="flex items-center gap-4">
            <Monogram size="lg" />
            <div>
              <div className="font-display italic text-3xl text-cream">L&amp;S House</div>
              <div className="ui-label mt-1">Bespoke Operations · est. 2026</div>
            </div>
          </div>
          <h1 className="display-heading text-6xl xl:text-7xl leading-[0.95]">
            <span className="text-brass-shimmer">A house</span><br />
            for every<br />
            measurement.
          </h1>
          <p className="text-cream-muted max-w-md text-base leading-relaxed">
            Intake, custom orders, deliveries and customer comms — unified across
            <span className="text-cream"> New York</span> and{" "}
            <span className="text-cream">Houston</span>.
          </p>
          <div className="brass-divider mt-4 max-w-md" />
          <div className="ui-label">app.lstailors.com</div>
        </div>

        {/* Login card */}
        <GlassCard variant="strong" className="p-8 lg:p-10">
          <div className="flex flex-col items-center lg:items-start gap-2 mb-8">
            <div className="lg:hidden">
              <Monogram size="lg" />
            </div>
            <div className="ui-label">Sign in</div>
            <h2 className="display-heading text-3xl">Welcome back</h2>
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
                <button
                  type="button"
                  onClick={async () => {
                    if (!email) { toast.info("Enter your email first."); return; }
                    const { error } = await supabase.auth.resetPasswordForEmail(email);
                    if (error) toast.error(error.message);
                    else toast.success("Password reset email sent.");
                  }}
                  className="text-xs text-cream-dim hover:text-brass-light transition-colors"
                >
                  Forgot password?
                </button>
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
                <>
                  Enter the house
                  <ArrowRight className="ml-2 h-4 w-4" />
                </>
              )}
            </Button>
          </form>

          <div className="mt-8">
            <div className="brass-divider mb-4" />
            <div className="ui-label mb-3">Demo logins</div>
            <div className="grid grid-cols-2 gap-2">
              {DEMO_LOGINS.map((d) => (
                <button
                  key={d.email}
                  type="button"
                  onClick={() => handleDemo(d.email)}
                  className="text-left text-xs px-3 py-2 rounded-md border border-brass/15 hover:border-brass/40 hover:bg-brass/5 text-cream-muted hover:text-cream transition-colors"
                >
                  <div className="font-medium">{d.label}</div>
                  <div className="text-[10px] opacity-70 mt-0.5 truncate">{d.email}</div>
                </button>
              ))}
            </div>
            <div className="ui-label mt-4 text-center text-[9px] opacity-70">
              Password · {DEMO_PASSWORD}
            </div>
          </div>
        </GlassCard>
      </div>
    </div>
  );
}
