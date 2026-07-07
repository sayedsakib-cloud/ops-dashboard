"use client";

import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

/**
 * Shared date-range UI used across tabs for a consistent look.
 * It owns NO fetch logic — each tab passes its own values + handlers, so every
 * tab keeps its own behaviour while the control looks identical everywhere.
 *
 * Example:
 *   <DateRangeControls
 *     from={from} to={to}
 *     onFrom={setFrom} onTo={setTo}
 *     onApply={() => load(from, to)}
 *     loading={loading}
 *   >
 *     {/* optional extra filters, e.g. an agent <select> *​/}
 *   </DateRangeControls>
 */
export default function DateRangeControls({
  from, to, onFrom, onTo, onApply, loading = false, children,
}: {
  from: string;
  to: string;
  onFrom: (v: string) => void;
  onTo: (v: string) => void;
  onApply: () => void;
  loading?: boolean;
  children?: React.ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">From</Label>
        <Input type="date" value={from} onChange={e => onFrom(e.target.value)} className="h-9 w-auto" />
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">To</Label>
        <Input type="date" value={to} onChange={e => onTo(e.target.value)} className="h-9 w-auto" />
      </div>
      {children}
      <Button onClick={onApply} disabled={loading} className="h-9">
        {loading ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Loading</> : "Apply"}
      </Button>
    </div>
  );
}
