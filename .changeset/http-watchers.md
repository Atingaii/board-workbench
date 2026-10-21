---
'vboard': minor
---

Watchers run on a board on `http()`. The board it uses matches their tails and wakes it with a `POST <url>/wake` that carries no event and no token. It then pulls what matched with its own credentials (`GET /watchers/matches`), runs `run`, and acks each one (`POST /watchers/matches/:id/ack`). A thread's matches come one at a time, in order. A pulled match is leased for 5 minutes, an error is tried again after a wait, and after 5 tries it's `watch.failed`. A watcher sees what its deployment may read there, and writes as the deployment with its ID as the profile. A board without an `https` URL, such as a dev server, pulls on its own instead of being woken.

New on every board on `a2()`: `POST /watchers` and `GET /watchers` for registrations, and `GET /watchers/matches` and `POST /watchers/matches/:id/ack` for pulling, with `register`, `watchers`, `matches`, and `ack` on the client.
