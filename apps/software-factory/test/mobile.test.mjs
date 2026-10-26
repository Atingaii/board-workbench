import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { test } from "node:test";
import { draw } from "../components/diagram-grid.ts";

const css = await readFile(new URL("../app/globals.css", import.meta.url), "utf8");
const rule = (selector) => {
  const at = css.indexOf(`\n${selector} {`);
  assert.notEqual(at, -1, `globals.css has no ${selector} rule`);
  return css.slice(at, css.indexOf("}", at));
};

// iOS's monospace font (SF Mono) runs a little past 0.6em a column, and the
// diagram was sized to the viewport minus a guess at the page's padding, so on
// a phone its right edge ran off the screen.
test("mobile: the landing diagram fits its column in a font up to 0.62em a column", () => {
  const columns = draw(0)[0].length;
  const font = rule(".diagram pre").match(/font-size:\s*clamp\(([^;]+)\);/)?.[1];
  assert.ok(font, "the diagram's font size is a clamp()");
  const preferred = font.split(",")[1].trim();
  const divisor = preferred.match(/^100cqi \/ ([\d.]+)$/)?.[1];
  assert.ok(divisor, `the diagram's font follows its container's width, not the viewport's: ${preferred}`);
  assert.match(rule(".diagram"), /container-type:\s*inline-size/);
  assert.ok(Number(divisor) >= columns * 0.62, `${columns} columns at 0.62em need 100cqi / ${columns * 0.62}`);
});

test("mobile: a code block without a title keeps its text out from under the copy button", () => {
  assert.match(rule(".code > pre:first-child"), /margin-right:\s*2rem/);
  assert.match(rule(".copy"), /right:\s*0\.35rem;[\s\S]*width:\s*1\.6rem/);
});

test("mobile: iOS doesn't inflate the page's text", () => {
  assert.match(rule("html"), /-webkit-text-size-adjust:\s*100%/);
});
