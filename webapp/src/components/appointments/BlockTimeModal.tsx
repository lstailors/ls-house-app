import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { LSHAgent } from "../../../../backend/src/types";

interface Props {
  open: boolean;
  onClose: () => void;
  onSubmit: (data: { start: string; end?: string; reason?: string; all_day?: boolean; whole_shop?: boolean }) => void;
  isSubmitting: boolean;
  currentUserEmail: string;
  currentUserRole: string;
  agents: LSHAgent[];
}

function todayStr(): string {
  return new Date().toISOString().split("T")[0];
}

export function BlockTimeModal({ open, onClose, onSubmit, isSubmitting, currentUserRole }: Props) {
  const [date, setDate] = useState(todayStr);
  const [startTime, setStartTime] = useState("09:00");
  const [endTime, setEndTime] = useState("10:00");
  const [allDay, setAllDay] = useState(false);
  const [reason, setReason] = useState("");
  const [wholeShop, setWholeShop] = useState(false);

  const isAdmin = currentUserRole === "super_admin" || currentUserRole === "store_manager";

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const start = allDay ? `${date}T00:00:00` : `${date}T${startTime}:00`;
    const end = allDay ? undefined : `${date}T${endTime}:00`;
    onSubmit({
      start,
      end,
      reason: reason.trim() || undefined,
      all_day: allDay,
      whole_shop: isAdmin ? wholeShop : undefined,
    });
  }

  function handleOpenChange(isOpen: boolean) {
    if (!isOpen) {
      onClose();
      setDate(todayStr());
      setStartTime("09:00");
      setEndTime("10:00");
      setAllDay(false);
      setReason("");
      setWholeShop(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="bg-[#0D1A10] border border-white/10 text-[#F1E9D6] max-w-sm mx-auto">
        <DialogHeader>
          <DialogTitle className="font-['Cormorant_Garamond'] text-xl italic text-[#F1E9D6] font-normal">
            Block My Time
          </DialogTitle>
        </DialogHeader>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Date</Label>
            <Input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              required
              className="bg-white/5 border-white/10 text-[#F1E9D6] focus:border-[#B08D57]/50"
            />
          </div>

          <div className="flex items-center gap-3">
            <input
              type="checkbox"
              id="allday"
              checked={allDay}
              onChange={(e) => setAllDay(e.target.checked)}
              className="w-4 h-4 rounded border-white/20 accent-[#B08D57]"
            />
            <Label htmlFor="allday" className="text-sm text-[#F1E9D6]/80 cursor-pointer">All day</Label>
          </div>

          {!allDay ? (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Start</Label>
                <Input
                  type="time"
                  value={startTime}
                  onChange={(e) => setStartTime(e.target.value)}
                  required={!allDay}
                  className="bg-white/5 border-white/10 text-[#F1E9D6] focus:border-[#B08D57]/50"
                />
              </div>
              <div>
                <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">End</Label>
                <Input
                  type="time"
                  value={endTime}
                  onChange={(e) => setEndTime(e.target.value)}
                  className="bg-white/5 border-white/10 text-[#F1E9D6] focus:border-[#B08D57]/50"
                />
              </div>
            </div>
          ) : null}

          <div>
            <Label className="text-[10px] uppercase tracking-wider text-white/40 mb-1.5 block">Reason (optional)</Label>
            <Input
              type="text"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Blocked"
              className="bg-white/5 border-white/10 text-[#F1E9D6] placeholder:text-white/20 focus:border-[#B08D57]/50"
            />
          </div>

          {isAdmin ? (
            <div className="flex items-center gap-3 p-3 rounded-xl bg-white/5 border border-white/10">
              <input
                type="checkbox"
                id="wholeshop"
                checked={wholeShop}
                onChange={(e) => setWholeShop(e.target.checked)}
                className="w-4 h-4 rounded border-white/20 accent-[#B08D57]"
              />
              <div>
                <Label htmlFor="wholeshop" className="text-sm text-[#F1E9D6]/80 cursor-pointer">Block whole shop</Label>
                <p className="text-[10px] text-white/30 mt-0.5">Blocks all agents</p>
              </div>
            </div>
          ) : null}

          <div className="flex gap-2 pt-1">
            <Button
              type="button"
              variant="outline"
              onClick={onClose}
              className="flex-1 border-white/20 text-[#F1E9D6] hover:bg-white/10"
              disabled={isSubmitting}
            >
              Cancel
            </Button>
            <Button
              type="submit"
              className="flex-1 bg-[#1F3A2E] hover:bg-[#2a4d3e] text-[#F1E9D6] border border-[#B08D57]/30"
              disabled={isSubmitting}
            >
              {isSubmitting ? "Blocking…" : "Block Time"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
