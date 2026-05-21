import { assert, it } from "@effect/vitest";
import { Effect, Layer } from "effect";
import * as SqlClient from "effect/unstable/sql/SqlClient";

import { runMigrations } from "../Migrations.ts";
import * as NodeSqliteClient from "../NodeSqliteClient.ts";

const layer = it.layer(Layer.mergeAll(NodeSqliteClient.layerMemory()));

layer("027_AddProjectTransport", (it) => {
  it.effect("adds transport columns and backfills event payloads", () =>
    Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient;

      yield* runMigrations({ toMigrationInclusive: 26 });

      yield* sql`
        INSERT INTO orchestration_events (
          event_id,
          aggregate_kind,
          stream_id,
          stream_version,
          event_type,
          occurred_at,
          command_id,
          causation_event_id,
          correlation_id,
          actor_kind,
          payload_json,
          metadata_json
        )
        VALUES (
          'event-project-legacy',
          'project',
          'project-legacy',
          1,
          'project.created',
          '2026-01-01T00:00:00.000Z',
          'cmd-legacy',
          NULL,
          'correlation-legacy',
          'user',
          '{"projectId":"project-legacy","title":"Legacy","workspaceRoot":"/tmp/legacy","defaultModelSelection":null,"scripts":[],"createdAt":"2026-01-01T00:00:00.000Z","updatedAt":"2026-01-01T00:00:00.000Z"}',
          '{}'
        )
      `;

      yield* runMigrations({ toMigrationInclusive: 27 });

      const projectColumns = yield* sql<{ name: string }>`
        PRAGMA table_info(projection_projects)
      `;
      const columnNames = new Set(projectColumns.map((column) => column.name));
      assert.ok(columnNames.has("transport_type"));
      assert.ok(columnNames.has("ssh_connection_id"));

      const eventRows = yield* sql<{ payloadJson: string }>`
        SELECT payload_json AS "payloadJson"
        FROM orchestration_events
        WHERE event_id = 'event-project-legacy'
      `;
      const payload = JSON.parse(eventRows[0]?.payloadJson ?? "{}") as {
        transport?: { type: string };
      };
      assert.deepStrictEqual(payload.transport, { type: "local" });
    }),
  );
});
