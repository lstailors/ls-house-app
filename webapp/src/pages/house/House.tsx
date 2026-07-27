import { useSearchParams } from "react-router-dom";
import { Bot, Cpu, Calendar, Brain, Radio } from "lucide-react";
import { SectionHeader } from "@ls/design";
import { cn } from "@ls/design/utils";
import AgentsTab from "./tabs/AgentsTab";
import ProfilesTab from "./tabs/ProfilesTab";
import CronTab from "./tabs/CronTab";
import MemoryTab from "./tabs/MemoryTab";
import LiveActivityTab from "./tabs/LiveActivityTab";

type Tab = "agents" | "profiles" | "cron" | "memory" | "live";

const TABS: { id: Tab; label: string; icon: any }[] = [
  { id: "agents", label: "Agents", icon: Bot },
  { id: "profiles", label: "Profiles", icon: Cpu },
  { id: "cron", label: "Cron", icon: Calendar },
  { id: "memory", label: "Memory", icon: Brain },
  { id: "live", label: "Live Activity", icon: Radio },
];

function isTab(v: string | null): v is Tab {
  return !!v && TABS.some((t) => t.id === v);
}

export default function House() {
  const [params, setParams] = useSearchParams();
  const raw = params.get("tab");
  const tab: Tab = isTab(raw) ? raw : "agents";

  const setTab = (id: Tab) => {
    const next = new URLSearchParams(params);
    next.set("tab", id);
    setParams(next, { replace: true });
  };

  return (
    <div className="space-y-6 animate-fade-up">
      <SectionHeader
        eyebrow="L&S House · Mission Control"
        title={
          <>
            The <span className="text-brass-shimmer">House</span> control panel.
          </>
        }
        description="The agent network that runs the business — profiles, schedules, memory, and live work, in one pane of glass."
      />

      {/* Tab bar */}
      <div className="flex items-center gap-1 overflow-x-auto scrollbar-none border border-brass/10 rounded-xl p-1 bg-forest-raised/20 backdrop-blur-xl">
        {TABS.map((t) => {
          const Icon = t.icon;
          const active = tab === t.id;
          return (
            <button
              key={t.id}
              onClick={() => setTab(t.id)}
              className={cn(
                "flex items-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium transition-all whitespace-nowrap shrink-0",
                active
                  ? "bg-brass/15 text-cream border border-brass/30"
                  : "text-cream-dim hover:text-cream hover:bg-brass/5 border border-transparent",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              <span>{t.label}</span>
            </button>
          );
        })}
      </div>

      {/* Panel */}
      <div className="min-h-[400px]">
        {tab === "agents" ? <AgentsTab /> : null}
        {tab === "profiles" ? <ProfilesTab /> : null}
        {tab === "cron" ? <CronTab /> : null}
        {tab === "memory" ? <MemoryTab /> : null}
        {tab === "live" ? <LiveActivityTab /> : null}
      </div>
    </div>
  );
}
