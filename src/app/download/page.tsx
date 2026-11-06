import { redirect } from 'next/navigation'

// The Desktop Sahaayak download lives in exactly ONE place: the "Desktop Sahaayak
// for Windows" section on the home page. This page only forwards old links there.
export default function DownloadPage() {
  redirect('/#download')
}
