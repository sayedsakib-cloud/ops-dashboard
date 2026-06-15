"use client";

import { useEffect } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter } from "next/navigation";

export default function RootPage() {
  const { status } = useSession();
  const router = useRouter();

  // Already signed in -> go straight to the dashboard (once).
  useEffect(() => {
    if (status === "authenticated") {
      router.replace("/dashboard");
    }
  }, [status, router]);

  // While NextAuth checks the session, or while forwarding an
  // authenticated user, show a neutral spinner -- NO redirect here.
  if (status === "loading" || status === "authenticated") {
    return (
      <div className="flex h-screen items-center justify-center" style={{ background: "#0a1628" }}>
        <div className="inline-block w-8 h-8 border-4 border-sky-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Not signed in -> this is the actual sign-in screen (pages.signIn = "/").
  return (
    <div className="flex h-screen items-center justify-center" style={{ background: "#0a1628" }}>
      <div
        className="w-full max-w-sm rounded-2xl border p-8 text-center"
        style={{ background: "#0e1623", borderColor: "#1a2540" }}
      >
        <h1 className="mb-1 text-lg font-semibold text-slate-100">Ops Dashboard</h1>
        <p className="mb-6 text-sm text-slate-400">
          Sign in with your work Google account to continue.
        </p>
        <button
          onClick={() => signIn("google", { callbackUrl: "/dashboard" })}
          className="w-full rounded-lg bg-sky-600 px-4 py-2.5 text-sm font-medium text-white transition hover:bg-sky-500"
        >
          Sign in with Google
        </button>
      </div>
    </div>
  );
}
