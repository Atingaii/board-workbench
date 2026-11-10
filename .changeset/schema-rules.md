---
'@vercel/board': minor
---

`@vercel/board/schemas` exports how a board keeps schemas and reads blocks, as plain functions that import nothing: `checkDefinition(schema)` and `checkValue(schema, value)`, which say why a definition can't be registered or a value doesn't match one, `findBlocks(text)` and `block(id, data)`, which read and write the blocks in a message's text, `parseSchemaId(id)`, and `BUILT_IN_SCHEMAS`. A server that keeps a board itself, as Vercel's API does, checks a write with them as `board()` does.
