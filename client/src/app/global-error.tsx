/* global-error.tsx — last-resort error boundary: fires when the ROOT layout
   itself throws, so it replaces the whole document and must render its own
   <html>/<body>. That also means none of the layout's guarantees exist here:
   no next-intl provider (plain strings by design) and globals.css may not
   load — so no CSS variables / UI-kit components, only inline styles with
   hard-coded colors that match the dark theme tokens. */
"use client";

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  // Defensive on purpose: this is the boundary of last resort and must never
  // throw itself, whatever shape of error reaches it.
  const digest = error instanceof Error ? error.digest : undefined;
  return (
    <html lang="en" data-theme="dark">
      <body
        style={{
          margin: 0,
          background: "#0a0a0a",
          color: "#ededed",
          fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
        }}
      >
        <div
          style={{
            minHeight: "100vh",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 12,
            padding: 24,
            textAlign: "center",
          }}
        >
          <h1 style={{ margin: 0, fontSize: 18 }}>Something went wrong</h1>
          <p style={{ margin: 0, maxWidth: 420, lineHeight: 1.5, opacity: 0.8 }}>
            The app failed to render. Try again — if it keeps failing, restart
            the web app and check its terminal output.
            {digest ? ` (Error reference: ${digest})` : null}
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              marginTop: 8,
              padding: "8px 16px",
              fontSize: 14,
              borderRadius: 8,
              border: "1px solid #333",
              background: "#18181b",
              color: "#ededed",
              cursor: "pointer",
            }}
          >
            Try again
          </button>
        </div>
      </body>
    </html>
  );
}
