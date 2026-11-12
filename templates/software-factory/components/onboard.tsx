"use client";

import type { ReactNode } from "react";
import { useState, useTransition } from "react";

type Answer = { started: true; repo: string } | { started: false; repo: string; channel: string };

/**
 * A repo to onboard, typed or pasted, and the button that asks the factory for it: a POST to the
 * page's own route. What it says after is what came back. `where` is where the factory was asked,
 * as people know it.
 */
export function Onboard({ path, where }: { path: string; where: string }): ReactNode {
  const [repo, setRepo] = useState("");
  const [said, setSaid] = useState<string | null>(null);
  const [pending, start] = useTransition();
  return (
    <form
      className="onboard"
      onSubmit={(event) => {
        event.preventDefault();
        start(async () => {
          const response = await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ repo }) }).catch(() => null);
          if (response?.status === 400) return setSaid("Write it as GitHub does: owner/repo.");
          const answer = response?.ok ? ((await response.json().catch(() => null)) as Answer | null) : null;
          if (!answer) return setSaid("Couldn't ask the factory. Try again.");
          if (!answer.started) return setSaid(`${answer.repo} is already in ${answer.channel}.`);
          setRepo("");
          setSaid(`Asked in ${where}. The factory opens a pull request for ${answer.repo}.`);
        });
      }}
    >
      <div className="field">
        <input
          value={repo}
          onChange={(event) => setRepo(event.target.value)}
          placeholder="owner/repo"
          aria-label="A repo to onboard"
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
        />
        <button type="submit" className="button secondary" disabled={pending || !repo.trim()}>
          {pending ? "Asking" : "Onboard"}
        </button>
      </div>
      {said ? (
        <p className="note" role="status">
          {said}
        </p>
      ) : null}
    </form>
  );
}
