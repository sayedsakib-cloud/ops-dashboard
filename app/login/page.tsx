"use client";

import { useEffect, Suspense } from "react";
import { signIn, useSession } from "next-auth/react";
import { useRouter, useSearchParams } from "next/navigation";
import Image from "next/image";

function LoginInner() {
  const { status } = useSession();
  const router = useRouter();
  const params = useSearchParams();
  const error = params.get("error");

  // Already signed in -> go to the dashboard (once).
  useEffect(() => {
    if (status === "authenticated") router.replace("/");
  }, [status, router]);

  // While checking session, or while forwarding an authenticated user, show nothing
  // heavy -- a small spinner keeps it from flashing the login card to a signed-in user.
  if (status === "loading" || status === "authenticated") {
    return (
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    );
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-background px-4">
      {/* Ambient background glows */}
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0"
        style={{
          background:
            "radial-gradient(700px 380px at 15% 0%, rgba(237,28,62,0.12), transparent 60%)," +
            "radial-gradient(640px 420px at 100% 100%, rgba(250,100,44,0.08), transparent 55%)",
        }}
      />

      <div className="relative w-full max-w-sm">
        <div className="overflow-hidden rounded-2xl border border-border bg-card/80 shadow-2xl backdrop-blur-sm">
          {/* Header with logo */}
          <div className="flex flex-col items-center gap-4 border-b border-border px-8 pb-8 pt-10">
            <Image
              src="/Ops-Dashboard-transparent.svg"
              alt="Operations Dashboard"
              width={72}
              height={72}
              priority
              className="h-[72px] w-[72px]"
            />
            <div className="text-center">
              <h1 className="text-2xl font-bold tracking-tight text-foreground">Operations Dashboard</h1>
              <p className="mt-1.5 text-sm text-muted-foreground">FundedNext Operations</p>
            </div>
          </div>

          {/* Body */}
          <div className="px-8 py-8">
            <div className="mb-6 text-center">
              <h2 className="text-lg font-semibold text-foreground">Welcome</h2>
              <p className="mt-1 text-sm text-muted-foreground">Sign in to continue</p>
            </div>

            {error ? (
              <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 px-4 py-2.5 text-center text-sm text-destructive">
                {error === "AccessDenied"
                  ? "Access restricted to nextventures.io accounts."
                  : "Sign-in failed. Please try again."}
              </div>
            ) : null}

            <button
              onClick={() => signIn("google", { callbackUrl: "/" })}
              className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-secondary/60 px-4 py-3 text-sm font-medium text-foreground transition-colors hover:bg-secondary"
            >
              <GoogleIcon />
              Continue with Google
            </button>

            <p className="mt-6 text-center text-xs text-muted-foreground">
              Restricted to authorized FundedNext team members.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

function GoogleIcon() {
  return (
    <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
      <path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62Z" />
      <path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18Z" />
      <path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33Z" />
      <path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.46.89 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58Z" />
    </svg>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="flex min-h-screen items-center justify-center bg-background">
        <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted border-t-primary" />
      </div>
    }>
      <LoginInner />
    </Suspense>
  );
}
