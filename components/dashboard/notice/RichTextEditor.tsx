"use client";
import { useEditor, EditorContent } from "@tiptap/react";
import StarterKit from "@tiptap/starter-kit";
import Link from "@tiptap/extension-link";
import { Button } from "@/components/ui/button";
import { Bold, Italic, List, ListOrdered, Link as LinkIcon, Undo2, Redo2 } from "lucide-react";
import { cn } from "@/lib/utils";

interface RichTextEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
}

export default function RichTextEditor({ value, onChange, placeholder = "What's this notice about?" }: RichTextEditorProps) {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({
        heading: { levels: [2] },
        bulletList: { HTMLAttributes: { class: "list-disc ml-4" } },
        orderedList: { HTMLAttributes: { class: "list-decimal ml-4" } },
        listItem: { HTMLAttributes: { class: "list-item" } },
      }),
      Link.configure({ openOnClick: false, HTMLAttributes: { class: "text-blue-600 hover:underline dark:text-blue-400" } }),
    ],
    content: value,
    onUpdate: ({ editor }) => onChange(editor.getHTML()),
    editorProps: {
      attributes: {
        class: "rich-editor prose prose-sm dark:prose-invert max-w-none rounded-md border border-input bg-background px-3 py-2 text-sm text-foreground focus:outline-none focus:ring-1 focus:ring-ring min-h-32 [&_a]:text-blue-600 [&_a:hover]:underline dark:[&_a]:text-blue-400 [&_ul]:list-disc [&_ul]:ml-4 [&_ol]:list-decimal [&_ol]:ml-4 [&_li]:list-item [&_li]:ml-2",
      },
    },
  });

  if (!editor) return null;

  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap gap-1 rounded-md border border-input bg-muted/30 p-1">
        <ToolButton onClick={() => editor.chain().focus().toggleBold().run()} active={editor.isActive("bold")} icon={Bold} title="Bold" />
        <ToolButton onClick={() => editor.chain().focus().toggleItalic().run()} active={editor.isActive("italic")} icon={Italic} title="Italic" />
        <div className="mx-1 h-6 border-l border-border" />
        <ToolButton onClick={() => editor.chain().focus().toggleBulletList().run()} active={editor.isActive("bulletList")} icon={List} title="Bullet list" />
        <ToolButton onClick={() => editor.chain().focus().toggleOrderedList().run()} active={editor.isActive("orderedList")} icon={ListOrdered} title="Ordered list" />
        <div className="mx-1 h-6 border-l border-border" />
        <ToolButton onClick={() => { const url = prompt("URL:"); if (url) editor.chain().focus().setLink({ href: url }).run(); }} active={editor.isActive("link")} icon={LinkIcon} title="Add link" />
        <div className="mx-1 h-6 border-l border-border" />
        <ToolButton onClick={() => editor.chain().focus().undo().run()} icon={Undo2} title="Undo" />
        <ToolButton onClick={() => editor.chain().focus().redo().run()} icon={Redo2} title="Redo" />
      </div>
      <EditorContent editor={editor} />
    </div>
  );
}

function ToolButton({ onClick, active, icon: Icon, title }: { onClick: () => void; active?: boolean; icon: any; title: string }) {
  return (
    <Button
      variant="ghost"
      size="icon"
      onClick={onClick}
      title={title}
      className={cn("h-8 w-8", active && "bg-accent text-accent-foreground")}
    >
      <Icon className="h-4 w-4" />
    </Button>
  );
}
