---
'vboard': patch
---

The CLI and the Node client now mint every token for the URL they talk to, never the audience a board's discovery claims. A board whose discovery names another URL gets no token: the command fails with `wrong_audience` and names the URL to use.
