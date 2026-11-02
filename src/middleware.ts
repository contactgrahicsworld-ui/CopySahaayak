import { NextResponse, type NextRequest } from 'next/server'

// Edge guard: only checks cookie presence (cheap). Full DB-backed session
// validation happens server-side in every page + API route.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  if (pathname.startsWith('/admin') || pathname.startsWith('/super')) {
    const hasSession = req.cookies.has('pcs_session')
    if (!hasSession) {
      const url = req.nextUrl.clone()
      url.pathname = '/login'
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/super/:path*'],
}
