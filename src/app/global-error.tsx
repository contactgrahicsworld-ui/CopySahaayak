'use client'

// Last-resort boundary: even if the root layout itself throws, the app shows a
// full reload card instead of a blank page. Reloading remounts everything fresh.
import { useEffect } from 'react'

export default function GlobalError({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Fatal error:', error)
  }, [error])

  return (
    <html lang="hi">
      <body
        style={{
          fontFamily: 'Segoe UI, system-ui, sans-serif',
          background: '#f6f7f9',
          margin: 0,
          minHeight: '100vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '16px',
        }}
      >
        <div style={{ maxWidth: 380, width: '100%', textAlign: 'center', background: '#fff', borderRadius: 16, border: '1px solid #e5e7eb', padding: 32 }}>
          <p style={{ fontSize: 40, margin: 0 }}>⚠️</p>
          <p style={{ fontWeight: 700, fontSize: 18, margin: '12px 0 2px' }}>ऐप में दिक्कत आ गई</p>
          <p style={{ color: '#6b7280', fontSize: 13, margin: '0 0 4px' }}>Something went very wrong</p>
          <p style={{ color: '#374151', fontSize: 14, margin: '8px 0 16px' }}>
            ऐप को दोबारा लोड करो — सब कुछ वापस चालू हो जाएगा।
            <span style={{ display: 'block', color: '#6b7280', fontSize: 12 }}>Reload the app — everything comes back.</span>
          </p>
          <button
            onClick={reset}
            style={{
              width: '100%', height: 46, fontSize: 15, fontWeight: 600,
              background: '#16a34a', color: '#fff', border: 'none', borderRadius: 10, cursor: 'pointer',
            }}
          >
            दोबारा लोड करो / Reload
          </button>
        </div>
      </body>
    </html>
  )
}
