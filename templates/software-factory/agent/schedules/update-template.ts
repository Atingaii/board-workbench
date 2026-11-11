import { defineSchedule } from "eve/schedules";
import { factory } from "../../app/api/board/[[...path]]/factory.ts";
import { CURRENT, latest, newer } from "../lib/template";

// Once a day (a Vercel Cron Job), a new template release becomes a task on the board, which the
// agent takes on with the update-template skill. Nothing runs a model on a day without one.
export default defineSchedule({
  cron: "0 9 * * *",
  async run({ waitUntil }) {
    waitUntil(
      (async () => {
        const version = await latest();
        if (!newer(version, CURRENT)) return;
        // As this deployment, on the board. The ID makes each release one thread, however often it fires.
        await factory.post("dev/factory", {
          id: `template-${version}`,
          text: `Template ${version} is out, and this factory is on ${CURRENT}. Update it.`,
          labels: { template: version },
          noSync: true,
        });
      })(),
    );
  },
});
