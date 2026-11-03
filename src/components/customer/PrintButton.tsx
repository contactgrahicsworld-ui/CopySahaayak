'use client'

export function PrintButton() {
  return (
    <button
      type="button"
      onClick={() => window.print()}
      className="rounded-lg bg-neutral-900 px-6 py-2.5 text-sm font-semibold text-white hover:bg-neutral-700 transition-colors print:hidden"
    >
      Print this sign (A4)
    </button>
  )
}
