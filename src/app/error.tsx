'use client'

// Route-level error boundary: a render/network hiccup never leaves the shop
// staring at a white screen — they get a clear Hindi-first retry card.
import { useEffect } from 'react'
import { Button } from '@/components/ui/button'

export default function Error({ error, reset }: { error: Error & { digest?: string }; reset: () => void }) {
  useEffect(() => {
    console.error('Screen error:', error)
  }, [error])

  return (
    <main className="min-h-screen flex items-center justify-center p-4 bg-muted/30">
      <div className="max-w-sm w-full text-center space-y-4 bg-white rounded-2xl border p-8">
        <p className="text-4xl">⚠️</p>
        <div>
          <p className="font-bold text-lg">कुछ गड़बड़ हो गई — चिंता मत करो</p>
          <p className="text-xs text-muted-foreground mb-1">Something went wrong on this screen</p>
          <p className="text-sm text-muted-foreground">
            आपका डेटा सुरक्षित है। नीचे बटन दबाकर दोबारा कोशिश करो।
            <span className="block">Your data is safe — press the button to try again.</span>
          </p>
        </div>
        <Button className="w-full h-12 text-base" onClick={reset}>
          दोबारा कोशिश करो / Try again
        </Button>
      </div>
    </main>
  )
}
