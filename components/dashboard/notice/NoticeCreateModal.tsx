// components/dashboard/notice/NoticeCreateModal.tsx
"use client";
import { useState } from "react";
import { X, Loader2, Plus, Image as ImageIcon, Link as LinkIcon } from "lucide-react";
import {
  Dialog, DialogTrigger, DialogContent, DialogHeader, DialogTitle, DialogFooter,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { Attachment, Notice } from "@/lib/notice";

export default function NoticeCreateModal({ onCreated }: { onCreated: (notice: Notice) => void }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [tagInput, setTagInput] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [linkInput, setLinkInput] = useState("");
  const [uploading, setUploading] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState("");

  function resetForm() {
    setTitle(""); setDescription(""); setTagInput(""); setTags([]);
    setAttachments([]); setLinkInput(""); setError("");
  }

  function addTag() {
    const t = tagInput.trim().toLowerCase();
    if (t && !tags.includes(t)) setTags(prev => [...prev, t]);
    setTagInput("");
  }

  function removeTag(t: string) {
    setTags(prev => prev.filter(x => x !== t));
  }

  function addLink() {
    const url = linkInput.trim();
    if (!url) return;
    setAttachments(prev => [...prev, { type: "link", url, label: url }]);
    setLinkInput("");
  }

  async function handleFileUpload(e: React.ChangeEvent<HTMLInputElement>) {
    const files = e.target.files;
    if (!files || files.length === 0) return;
    setUploading(true); setError("");
    try {
      for (const file of Array.from(files)) {
        const fd = new FormData();
        fd.append("file", file);
        const res = await fetch("/api/notice/upload", { method: "POST", body: fd });
        const json = await res.json();
        if (!res.ok) throw new Error(json.error || "Upload failed");
        setAttachments(prev => [...prev, { type: "image", url: json.url }]);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Upload failed");
    } finally {
      setUploading(false);
      e.target.value = "";
    }
  }

  function removeAttachment(i: number) {
    setAttachments(prev => prev.filter((_, idx) => idx !== i));
  }

  async function handleSubmit() {
    setError("");
    if (!title.trim()) return setError("Title is required");
    if (!description.trim()) return setError("Description is required");
    if (tags.length === 0) return setError("At least one tag is required");

    setSubmitting(true);
    try {
      const res = await fetch("/api/notice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ title: title.trim(), description: description.trim(), tags, attachments }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json.error || "Failed to create notice");
      onCreated(json.notice as Notice);
      resetForm();
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Failed to create notice");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button className="gap-1.5"><Plus className="h-4 w-4" /> New Notice</Button>
      </DialogTrigger>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>New Notice</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div className="space-y-1.5">
            <Label>Title</Label>
            <Input value={title} onChange={e => setTitle(e.target.value)} placeholder="Notice title" />
          </div>

          <div className="space-y-1.5">
            <Label>Description</Label>
            <Textarea value={description} onChange={e => setDescription(e.target.value)} rows={4} placeholder="What's this notice about?" />
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

          <div className="space-y-1.5">
            <Label>Attachments <span className="text-muted-foreground font-normal">(optional)</span></Label>
            <div className="flex flex-wrap gap-2">
              <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md border border-input px-3 py-1.5 text-sm hover:bg-accent">
                <ImageIcon className="h-4 w-4" /> Upload image
                <input type="file" accept="image/png,image/jpeg,image/gif,image/webp" multiple hidden onChange={handleFileUpload} disabled={uploading} />
              </label>
              <Input value={linkInput} onChange={e => setLinkInput(e.target.value)}
                onKeyDown={e => e.key === "Enter" && (e.preventDefault(), addLink())}
                placeholder="Paste a link" className="w-48" />
              <Button type="button" variant="secondary" onClick={addLink}><LinkIcon className="h-4 w-4" /></Button>
            </div>
            {uploading ? <p className="text-xs text-muted-foreground">Uploading...</p> : null}
            {attachments.length > 0 ? (
              <div className="flex flex-wrap gap-2 pt-1">
                {attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-1 rounded-md border border-border px-2 py-1 text-xs">
                    {a.type === "image" ? <ImageIcon className="h-3 w-3" /> : <LinkIcon className="h-3 w-3" />}
                    <span className="max-w-32 truncate">{a.label ?? a.url}</span>
                    <button onClick={() => removeAttachment(i)} aria-label="Remove attachment"><X className="h-3 w-3" /></button>
                  </div>
                ))}
              </div>
            ) : null}
          </div>

          {error ? <p className="text-sm text-destructive">{error}</p> : null}
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => setOpen(false)} disabled={submitting}>Cancel</Button>
          <Button onClick={handleSubmit} disabled={submitting || uploading}>
            {submitting ? <><Loader2 className="mr-1 h-4 w-4 animate-spin" /> Posting</> : "Post Notice"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
