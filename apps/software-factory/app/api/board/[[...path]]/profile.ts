// `x-board-profile` as board's protocol has it: a structured header, the profile's name with its
// avatar as a parameter (`clever-lemur-1956;avatar="https://…"`). The factory's board runs
// @vercel/board 0.32.0, which reads the name alone there and the avatar in `x-board-avatar`, so
// its route reads the new header into those until the factory moves to a release that reads it.

/** A profile as the protocol's header carries it, the way `formatProfileHeader` in board writes it. */
export function profileHeader(name: string, avatar?: string): string {
  return avatar ? `${name};avatar="${avatar.replace(/[\\"]/g, (char) => `\\${char}`)}"` : name;
}

const ITEM = /^\s*([A-Za-z][A-Za-z0-9-]{0,31});\s*avatar="((?:[^"\\]|\\["\\])*)"\s*$/;

/**
 * `request` as the factory's board reads it: a profile header with an avatar becomes the name in
 * `x-board-profile` and the avatar in `x-board-avatar`. Anything else goes as it is, and the board
 * says what's wrong with it.
 */
export function asBoardReadsIt(request: Request): Request {
  const found = ITEM.exec(request.headers.get("x-board-profile") ?? "");
  if (!found) return request;
  const headers = new Headers(request.headers);
  headers.set("x-board-profile", found[1]!);
  headers.set("x-board-avatar", found[2]!.replace(/\\(["\\])/g, "$1"));
  return new Request(request, { headers });
}
