// components/dashboard/tabs/NoticeTab.tsx
"use client";
import { useCallback, useEffect, useState } from "react";
import { useSession } from "next-auth/react";
import { AlertTriangle } from "lucide-react";
import { Button } from "@/components/ui/button";
import NoticeFilters from "@/components/dashboard/notice/NoticeFilters";
import NoticeFeed from "@/components/dashboard/notice/NoticeFeed";
import NoticeCreateModal from "@/components/dashboard/notice/NoticeCreateModal";
import type { Notice } from "@/lib/notice";

type Cursor = { createdAt: string; id: string } | null;

export default function NoticeTab() {
  const { data: session } = useSession();
  const currentUserEmail = session?.user?.email ?? "";

  const [notices, setNotices] = useState<Notice[]>([]);
  const [cursor, setCursor] = useState<Cursor>(null);
  const [hasMore, setHasMore] = useState(true);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const [keyword, setKeyword] = useState("");
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [tagFilter, setTagFilter] = useState("");

  const fetchPage = useCallback(async (reset: boolean) => {
    setLoading(true); setError("");
    try {
      const p = new URLSearchParams();
      if (keyword) p.set("keyword", keyword);
      if (from) p.set("from", from);
      if (to) p.set("to", to);
      if (tagFilter) p.set("tags", tagFilter);
      const useCursor = reset ? null : cursor;
      if (useCursor) { p.set("cursorCreatedAt", useCursor.createdAt); p.set("cursorId", useCursor.id); }

      const res = await fetch(`/api/notice?${p}`);
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to load notices");

      setNotices(prev => reset ? json.items : [...prev, ...json.items]);
      setCursor(json.nextCursor);
      setHasMore(!!json.nextCursor);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to load notices");
    } finally {
      setLoading(false);
    }
  }, [keyword, from, to, tagFilter, cursor]);

  useEffect(() => {
    fetchPage(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleApplyFilters() {
    setCursor(null);
    fetchPage(true);
  }

  function handleLoadMore() {
    if (!loading && hasMore) fetchPage(false);
  }

  function handleCreated(notice: Notice) {
    setNotices(prev => [notice, ...prev]);
  }

  function handleDeleted(id: string) {
    setNotices(prev => prev.filter(n => n.id !== id));
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <NoticeFilters
          keyword={keyword} onKeyword={setKeyword}
          from={from} to={to} onFrom={setFrom} onTo={setTo}
          tagFilter={tagFilter} onTagFilter={setTagFilter}
          onApply={handleApplyFilters} loading={loading}
        />
        <NoticeCreateModal onCreated={handleCreated} />
      </div>

      {error ? (
        <div className="flex items-center justify-between rounded-md border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
          <span className="flex items-center gap-2"><AlertTriangle className="h-4 w-4" /> {error}</span>
          <Button variant="ghost" size="sm" onClick={() => fetchPage(true)}>Retry</Button>
        </div>
      ) : null}

      <NoticeFeed
        notices={notices} currentUserEmail={currentUserEmail}
        onLoadMore={handleLoadMore} hasMore={hasMore} loading={loading}
        onDeleted={handleDeleted}
      />
    </div>
  );
}
