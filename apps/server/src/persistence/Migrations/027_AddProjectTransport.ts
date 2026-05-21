import * as Effect from "effect/Effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

export default Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN transport_type TEXT NOT NULL DEFAULT 'local'
  `;

  yield* sql`
    ALTER TABLE projection_projects
    ADD COLUMN ssh_connection_id TEXT
  `;

  yield* sql`
    UPDATE orchestration_events
    SET payload_json = json_set(
      payload_json,
      '$.transport',
      json('{"type":"local"}')
    )
    WHERE event_type IN ('project.created', 'project.meta-updated')
      AND json_extract(payload_json, '$.transport') IS NULL
  `;
});
