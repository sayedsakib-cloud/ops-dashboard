// components/dashboard/notice/NoticeCard.tsx
"use client";
import { useState } from "react";
import { Heart, Trash2, Link as LinkIcon } from "lucide-react";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import NoticeEditModal from "@/components/dashboard/notice/NoticeEditModal";
import type { Notice } from "@/lib/notice";

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days}d ago`;
  return new Date(iso).toLocaleDateString();
}

export default function NoticeCard({
  notice, currentUserEmail, onDeleted, onUpdated,
}: {
  notice: Notice;
  currentUserEmail: string;
  onDeleted: (id: string) => void;
  onUpdated?: (notice: Notice) => void;
}) {
  const [liked, setLiked] = useState(notice.likedByMe);
  const [likeCount, setLikeCount] = useState(notice.likeCount);
  const [likersOpen, setLikersOpen] = useState(false);
  const [likers, setLikers] = useState<{ userEmail: string; userName: string }[] | null>(null);
  const [likersLoading, setLikersLoading] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggleLike() {
    const prevLiked = liked; const prevCount = likeCount;
    setLiked(!prevLiked); setLikeCount(prevLiked ? prevCount - 1 : prevCount + 1);
    try {
      const res = await fetch(`/api/notice/${notice.id}/like`, { method: "POST" });
      if (!res.ok) throw new Error();
      const json = await res.json();
      setLiked(json.liked); setLikeCount(json.likeCount);
    } catch {
      setLiked(prevLiked); setLikeCount(prevCount);
    }
  }

  async function openLikers() {
    setLikersOpen(true);
    if (likers) return;
    setLikersLoading(true);
    try {
      const res = await fetch(`/api/notice/${notice.id}/like`);
      const json = await res.json();
      setLikers(json.likers ?? []);
    } catch {
      setLikers([]);
    } finally {
      setLikersLoading(false);
    }
  }

  async function handleDelete() {
    if (!confirm("Delete this notice?")) return;
    setDeleting(true);
    try {
      const res = await fetch(`/api/notice/${notice.id}`, { method: "DELETE" });
      if (res.ok) onDeleted(notice.id);
    } finally {
      setDeleting(false);
    }
  }

  const initial = notice.authorName.charAt(0).toUpperCase();
  const isOwner = notice.authorEmail === currentUserEmail;

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3 space-y-0">
        <div className="flex items-center gap-3">
          <Avatar>
            {notice.authorImage ? (
              <img src={notice.authorImage} alt={notice.authorName} className="h-full w-full object-cover" />
            ) : (
              <AvatarFallback>{initial}</AvatarFallback>
            )}
          </Avatar>
          <div>
            <p className="text-sm font-semibold text-foreground">{notice.authorName}</p>
            <p className="text-xs text-muted-foreground">{relativeTime(notice.createdAt)}</p>
          </div>
        </div>
        {isOwner ? (
          <div className="flex gap-1">
            <NoticeEditModal notice={notice} onUpdated={onUpdated || (() => {})} />
            <Button variant="ghost" size="icon" onClick={handleDelete} disabled={deleting} aria-label="Delete notice">
              <Trash2 className="h-4 w-4 text-muted-foreground" />
            </Button>
          </div>
        ) : null}
      </CardHeader>
      <CardContent className="space-y-3">
        <div>
          <h3 className="text-sm font-semibold text-foreground">{notice.title}</h3>
          <div className="mt-1 prose prose-sm dark:prose-invert max-w-none text-sm text-muted-foreground" dangerouslySetInnerHTML={{ __html: notice.description }} />
        </div>

        {notice.tags.length > 0 ? (
          <div className="flex flex-wrap gap-1.5">
            {notice.tags.map(tag => <Badge key={tag} variant="secondary">{tag}</Badge>)}
          </div>
        ) : null}

        {notice.attachments.length > 0 ? (
          <div className="space-y-1">
            {notice.attachments.map((a, i) =>
              <a key={i} href={a.url} target="_blank" rel="noreferrer"
                className="flex items-center gap-1.5 text-sm text-blue-600 hover:underline">
                <LinkIcon className="h-4 w-4 flex-shrink-0" />
                <span className="truncate">{a.label ?? a.url}</span>
              </a>
            )}
          </div>
        ) : null}

        <div className="flex items-center gap-3 pt-1">
          <button onClick={toggleLike} className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground">
            <Heart className={cn("h-4 w-4", liked && "fill-red-500 text-red-500")} />
          </button>
          <button onClick={openLikers} className="text-sm text-muted-foreground hover:text-foreground hover:underline">
            {likeCount} {likeCount === 1 ? "like" : "likes"}
          </button>
        </div>

        {likersOpen ? (
          <div className="rounded-md border border-border bg-muted/30 p-2 text-xs">
            {likersLoading ? (
              <p className="text-muted-foreground">Loading...</p>
            ) : likers && likers.length > 0 ? (
              <ul className="space-y-1">
                {likers.map(l => <li key={l.userEmail} className="text-foreground">{l.userName}</li>)}
              </ul>
            ) : (
              <p className="text-muted-foreground">No likes yet.</p>
            )}
            <button onClick={() => setLikersOpen(false)} className="mt-1 text-muted-foreground hover:underline">Hide</button>
          </div>
        ) : null}
      </CardContent>
    </Card>
  );
}
