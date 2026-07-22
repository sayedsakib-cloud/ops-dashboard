// components/dashboard/notice/NoticeFeed.tsx
"use client";
import { useEffect, useRef } from "react";
import { Loader2 } from "lucide-react";
import NoticeCard from "@/components/dashboard/notice/NoticeCard";
import type { Notice } from "@/lib/notice";

export default function NoticeFeed({
  notices, currentUserEmail, onLoadMore, hasMore, loading, onDeleted, onUpdated,
}: {
  notices: Notice[]; currentUserEmail: string;
  onLoadMore: () => void; hasMore: boolean; loading: boolean;
  onDeleted: (id: string) => void;
  onUpdated?: (notice: Notice) => void;
}) {
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || !hasMore) return;
    const observer = new IntersectionObserver(entries => {
      if (entries[0]?.isIntersecting && !loading) onLoadMore();
    }, { rootMargin: "200px" });
    observer.observe(el);
    return () => observer.disconnect();
  }, [hasMore, loading, onLoadMore]);

  if (notices.length === 0 && !loading) {
    return <p className="py-12 text-center text-sm text-muted-foreground">No notices yet.</p>;
  }

  return (
    <div className="space-y-4">
      {notices.map(n => (
        <NoticeCard key={n.id} notice={n} currentUserEmail={currentUserEmail} onDeleted={onDeleted} onUpdated={onUpdated} />
      ))}
      {hasMore ? <div ref={sentinelRef} className="h-4" /> : null}
      {loading ? (
        <div className="flex justify-center py-4">
          <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
        </div>
      ) : null}
    </div>
  );
}
