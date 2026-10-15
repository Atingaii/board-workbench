#!/usr/bin/env bash
# Copies the board's side effects out of the sandbox into the evidence dir:
# the served project's .vboard/ (board.db log, attachments/, config.json), the
# serve log, a file listing, and `vb read <id> --json` of every thread in every channel.
#
# usage: collect.sh <sandbox>     (down.sh runs it first)
set -euo pipefail
source "$(dirname "$0")/common.sh"
name=${1:-}
need_name "$name"
ev=$(evidence_dir "$name")
sbx_script "$name" "cd $PROJ
  : > /tmp/read.json; : > /tmp/read.err
  for c in \$($VB channels --json 2>>/tmp/read.err | node -e 'for (const l of require(\"fs\").readFileSync(0, \"utf8\").split(\"\\n\")) if (l) console.log(JSON.parse(l).path)'); do
    # a line is a thread summary, or a message on releases before them: either way, its thread's root
    for id in \$($VB read \"\$c\" --json --limit 500 2>>/tmp/read.err | node -e 'const ids = new Set(); for (const l of require(\"fs\").readFileSync(0, \"utf8\").split(\"\\n\")) if (l) { const t = JSON.parse(l); ids.add(t.message ? t.message.id : (t.re ?? t.id)) } console.log([...ids].join(\" \"))'); do
      $VB read \"\$id\" --json >> /tmp/read.json 2>>/tmp/read.err || true
    done
  done
  find .vboard -type f -exec ls -l {} + > /tmp/files.txt 2>&1 || true
  tar -czf /tmp/evidence.tgz .vboard -C /vercel serve.log -C /tmp read.json read.err files.txt" >/dev/null
"$SB" cp "$name:/tmp/evidence.tgz" "$ev/sandbox-files.tgz" >/dev/null 2>&1
mkdir -p "$ev/files"
tar -xzf "$ev/sandbox-files.tgz" -C "$ev/files"
echo "collected  ${ev/#$HOME/\~}/files"
