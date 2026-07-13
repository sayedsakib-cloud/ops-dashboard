"use client";

// Catches errors thrown in the root layout itself. It replaces the whole
// document, so it must render its own <html>/<body> and can't rely on the
// app's CSS — hence inline styles.
export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, Segoe UI, Roboto, sans-serif", background: "#0b0709", color: "#e2e8f0" }}>
        <div style={{ minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", padding: "1rem" }}>
          <div style={{ maxWidth: 420, width: "100%", textAlign: "center", border: "1px solid #2b1a1f", borderRadius: 16, padding: 32, background: "#161013" }}>
            <h1 style={{ fontSize: 18, fontWeight: 600, margin: 0 }}>Something went wrong</h1>
            <p style={{ marginTop: 8, fontSize: 14, color: "#94a3b8" }}>
              The dashboard hit an unexpected error. Please try again.
            </p>
            <button
              onClick={() => reset()}
              style={{ marginTop: 24, border: "none", borderRadius: 8, padding: "8px 16px", fontSize: 14, fontWeight: 500, cursor: "pointer", background: "#ED1C3E", color: "#fff" }}
            >
              Try again
            </button>
            {error?.digest && (
              <p style={{ marginTop: 16, fontSize: 11, color: "#64748b" }}>Reference: {error.digest}</p>
            )}
          </div>
        </div>
      </body>
    </html>
  );
}
