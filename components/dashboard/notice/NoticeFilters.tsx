// components/dashboard/notice/NoticeFilters.tsx
"use client";
import { Search } from "lucide-react";
import DateRangeControls from "@/components/dashboard/DateRangeControls";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";

export default function NoticeFilters({
  keyword, onKeyword, from, to, onFrom, onTo, tagFilter, onTagFilter, onApply, loading,
}: {
  keyword: string; onKeyword: (v: string) => void;
  from: string; to: string; onFrom: (v: string) => void; onTo: (v: string) => void;
  tagFilter: string; onTagFilter: (v: string) => void;
  onApply: () => void; loading: boolean;
}) {
  return (
    <div className="flex flex-wrap items-end gap-3 rounded-lg border border-border bg-card p-4">
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Search</Label>
        <div className="relative">
          <Search className="pointer-events-none absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={keyword} onChange={e => onKeyword(e.target.value)}
            onKeyDown={e => e.key === "Enter" && onApply()}
            placeholder="Search title or description" className="h-9 w-56 pl-8"
          />
        </div>
      </div>
      <div className="space-y-1">
        <Label className="text-xs text-muted-foreground">Tag</Label>
        <Input
          value={tagFilter} onChange={e => onTagFilter(e.target.value)}
          onKeyDown={e => e.key === "Enter" && onApply()}
          placeholder="Filter by tag" className="h-9 w-40"
        />
      </div>
      <DateRangeControls from={from} to={to} onFrom={onFrom} onTo={onTo} onApply={onApply} loading={loading} />
    </div>
  );
}
