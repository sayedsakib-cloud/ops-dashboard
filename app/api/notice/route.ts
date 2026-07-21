import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { listNotices, createNotice, type Attachment } from "@/lib/notice";

export async function GET(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const sp = req.nextUrl.searchParams;
  const keyword = sp.get("keyword") || undefined;
  const from = sp.get("from") || undefined;
  const to = sp.get("to") || undefined;
  const tagsParam = sp.get("tags");
  const tags = tagsParam ? tagsParam.split(",").filter(Boolean) : undefined;
  const cursorCreatedAt = sp.get("cursorCreatedAt");
  const cursorId = sp.get("cursorId");
  const cursor = cursorCreatedAt && cursorId ? { createdAt: cursorCreatedAt, id: cursorId } : null;

  try {
    const result = await listNotices({
      keyword, from, to, tags, cursor, viewerEmail: session.user.email, limit: 20,
    });
    return NextResponse.json(result);
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to load notices" }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let body: { title?: string; description?: string; tags?: string[]; attachments?: Attachment[] };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  const title = (body.title ?? "").trim();
  const description = (body.description ?? "").trim();
  const tags = Array.isArray(body.tags) ? body.tags : [];
  const attachments = Array.isArray(body.attachments) ? body.attachments : [];

  if (!title) return NextResponse.json({ error: "Title is required" }, { status: 400 });
  if (!description) return NextResponse.json({ error: "Description is required" }, { status: 400 });
  if (tags.filter(t => t.trim()).length === 0) return NextResponse.json({ error: "At least one tag is required" }, { status: 400 });

  try {
    const notice = await createNotice({
      title, description, tags, attachments,
      authorName: session.user.name ?? "Unknown",
      authorEmail: session.user.email,
    });
    return NextResponse.json({ notice }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to create notice" }, { status: 500 });
  }
}
