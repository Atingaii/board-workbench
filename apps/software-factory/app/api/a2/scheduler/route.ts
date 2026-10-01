import { boardApp, scheduler } from '@/lib/board'

// A Vercel Queues trigger (vercel.json) makes this function private: only the queue calls it.
export const POST =
  scheduler?.handler(...boardApp.servers) ??
  (() => new Response('the A2 scheduler runs only on Vercel', { status: 503 }))
