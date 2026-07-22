"use client";
import { useState, useEffect } from "react";
import { X, Loader2, Edit } from "lucide-react";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import RichTextEditor from "@/components/dashboard/notice/RichTextEditor";
import type { Notice } from "@/lib/notice";

interface NoticeEditModalProps {
  notice: Notice;
  onUpdated: (notice: Notice) => void;
}

export default function NoticeEditModal({ notice, onUpdated }: NoticeEditModalProps) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (open) {
      setTitle(notice.title);
      setDescription(notice.description);
      setTags(notice.tags);
      setError("");
    }
  }, [open, notice]);

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput("");
  }

  function removeTag(t: string) {
    setTags(prev => prev.filter(x => x !== t));
  }

  async function handleSubmit() {
    setError("");
    if (!title.trim()) return setError("Title is required");
    if (!description.trim()) return setError("Description is required");
    if (tags.length === 0) return setError("At least one tag is required");

    setSubmitting(true);
    try {
      const res = await fetch(`/api/notice/${notice.id}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), tags }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to update notice");
      onUpdated(json.notice as Notice);
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to update notice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant="ghost" size="icon" aria-label="Edit notice">
          <Edit className="h-4 w-4 text-muted-foreground" />
        </Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Edit Notice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Notice title" />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <RichTextEditor value={description} onChange={setDescription} />
          </div>

          <div className="space-y-1.5">
            <Label>Tags <span className="text-muted-foreground font-normal">(at least 1 required)</span></Label>
            <div className="flex gap-2">
              <Input
                value={tagInput} onChange={e => setTagInput(e.target.value)}
                onKeyDown={e => { if (e.key === "Enter" || e.key === ",") { e.preventDefault(); addTag(); } }}
                placeholder="Type a tag, press Enter"
              />
              <Button type="button" variant="secondary" onClick={addTag}>Add</Button>
            </div>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map(t => (
                  <Badge key={t} variant="secondary" className="gap-1">
                    {t}
                    <button onClick={() => removeTag(t)} aria-label={`Remove ${t}`}><X className="h-3 w-3" /></button>
                  </Badge>
                ))}
              </div>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting}>
            {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Updating</> : "Update Notice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
