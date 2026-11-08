import { NextResponse, type NextRequest } from 'next/server'

// Edge guard: only checks cookie presence (cheap). Full DB-backed session
// validation happens server-side in every page + API route.
export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl
  // /super/login is the public Super Admin portal entry — never guarded.
  const isSuperLogin = pathname === '/super/login'
  if (pathname.startsWith('/admin') || pathname.startsWith('/super')) {
    const hasSession = req.cookies.has('pcs_session')
    if (!hasSession) {
      if (pathname.startsWith('/super')) {
        // Unauthenticated Super Admin area -> the super-only login portal.
        if (!isSuperLogin) {
          const url = req.nextUrl.clone()
          url.pathname = '/super/login'
          url.search = ''
          return NextResponse.redirect(url)
        }
      } else {
        const url = req.nextUrl.clone()
        url.pathname = '/login'
        url.searchParams.set('next', pathname)
        return NextResponse.redirect(url)
      }
    }
  }
  return NextResponse.next()
}

export const config = {
  matcher: ['/admin/:path*', '/super/:path*'],
}
