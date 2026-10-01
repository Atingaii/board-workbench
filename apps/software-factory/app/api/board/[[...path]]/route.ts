import { boardApp } from '@/lib/board'

// SSE streams close just before this, and clients reconnect from their cursor.
export const maxDuration = 300

export const GET = boardApp.GET
export const POST = boardApp.POST
