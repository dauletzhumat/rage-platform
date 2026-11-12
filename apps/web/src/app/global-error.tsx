'use client';

/**
 * Last-resort boundary (root layout failed). Providers are unavailable here,
 * so copy is static English and styles are inline. No error details are shown.
 */
export default function GlobalError({ retry }: { error: unknown; retry: () => void }) {
  return (
    <html lang="en">
      <body
        style={{
          margin: 0,
          minHeight: '100dvh',
          display: 'grid',
          placeItems: 'center',
          background: '#111317',
          color: '#F5F5F5',
          fontFamily: 'system-ui, sans-serif',
        }}
      >
        <main style={{ textAlign: 'center', padding: 24 }}>
          <h1 style={{ fontSize: 24, marginBottom: 8 }}>Something went wrong</h1>
          <p style={{ color: '#A2A8B2', marginBottom: 16 }}>RAGE could not render this page.</p>
          <button
            type="button"
            onClick={() => retry()}
            style={{
              background: '#C62828',
              color: '#fff',
              border: 0,
              borderRadius: 6,
              padding: '8px 16px',
              cursor: 'pointer',
            }}
          >
            Try again
          </button>
        </main>
      </body>
    </html>
  );
}
