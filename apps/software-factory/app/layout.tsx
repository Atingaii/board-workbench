import type { ReactNode } from 'react'
import { GeistMono } from 'geist/font/mono'
import './globals.css'

export const metadata = { title: 'software factory', description: 'just-board, running on itself' }

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={GeistMono.variable}>
      <body>{children}</body>
    </html>
  )
}
