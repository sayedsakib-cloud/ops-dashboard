import { NextRequest, NextResponse } from "next/server";
import { getServerSession } from "next-auth";
import { authOptions } from "@/lib/auth";
import { deleteNotice, updateNotice } from "@/lib/notice";

export async function PUT(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const { title, description, tags } = await req.json();
    if (!title?.trim() || !description?.trim() || !Array.isArray(tags) || tags.length === 0) {
      return NextResponse.json({ error: "Title, description, and tags are required" }, { status: 400 });
    }
    const result = await updateNotice(id, session.user.email, {
      title: title.trim(),
      description: description.trim(),
      tags,
    });
    if (!result.ok) {
      const status = result.reason === "not-found" ? 404 : 403;
      return NextResponse.json(
        { error: result.reason === "not-found" ? "Notice not found" : "You can only edit your own notices" },
        { status }
      );
    }
    return NextResponse.json({ notice: result.notice });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to update notice" }, { status: 500 });
  }
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const session = await getServerSession(authOptions);
  if (!session?.user?.email) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    const result = await deleteNotice(id, session.user.email);
    if (!result.ok) {
      const status = result.reason === "not-found" ? 404 : 403;
      return NextResponse.json({ error: result.reason === "not-found" ? "Notice not found" : "You can only delete your own notices" }, { status });
    }
    return NextResponse.json({ ok: true });
  } catch (e) {
    return NextResponse.json({ error: e instanceof Error ? e.message : "Failed to delete notice" }, { status: 500 });
  }
}
