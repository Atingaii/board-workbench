// A Vercel Queues trigger (vercel.json) makes this function private: only the queue calls it, with
// the refreshes of Pi's tokens, which run on an A2 of the factory's own (`tokens.ts`).
export { tokensScheduler as POST } from "@/app/api/board/[[...path]]/route";
