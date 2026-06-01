import { useLocation, Link } from "react-router-dom";
import { useEffect } from "react";
import { ArrowLeft, Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  const location = useLocation();

  useEffect(() => {
    console.error("404 Error: User attempted to access non-existent route:", location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4">
      <div className="max-w-lg text-center">
        <div className="mx-auto mb-6 h-20 w-20 rounded-full border-2 border-brass/30 bg-brass/10 flex items-center justify-center shadow-brass-glow">
          <Compass className="h-9 w-9 text-brass-light" />
        </div>
        <div className="ui-label mb-2">404 · Not Found</div>
        <h1 className="display-heading text-5xl md:text-6xl text-cream mb-4 leading-tight">
          A door that doesn't <span className="text-brass-shimmer">open</span>.
        </h1>
        <p className="text-cream-muted leading-relaxed mb-2">
          The hallway you wandered down doesn't lead anywhere — at least not in this house.
        </p>
        <p className="text-cream-dim text-xs font-mono mb-8 break-all">
          {location.pathname}
        </p>
        <Button asChild className="btn-brass">
          <Link to="/">
            <ArrowLeft className="h-4 w-4 mr-1.5" /> Back to the front room
          </Link>
        </Button>
      </div>
    </div>
  );
}
