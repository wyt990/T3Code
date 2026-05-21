import * as SqlClient from "effect/unstable/sql/SqlClient";
import * as SqlSchema from "effect/unstable/sql/SqlSchema";
import { Effect, Layer, Option, Schema } from "effect";

import {
  ModelSelection,
  ProjectScript,
  projectTransportFromDb,
  projectTransportToDb,
} from "@t3tools/contracts";
import { toPersistenceSqlError } from "../Errors.ts";
import {
  DeleteProjectionProjectInput,
  GetProjectionProjectInput,
  ProjectionProject,
  ProjectionProjectRepository,
  type ProjectionProjectRepositoryShape,
} from "../Services/ProjectionProjects.ts";

const ProjectionProjectDbRowColumnsSchema = Schema.Struct({
  projectId: ProjectionProject.fields.projectId,
  title: ProjectionProject.fields.title,
  workspaceRoot: ProjectionProject.fields.workspaceRoot,
  transportType: Schema.Literals(["local", "ssh"]),
  sshConnectionId: Schema.NullOr(Schema.String),
  defaultModelSelection: Schema.NullOr(Schema.fromJsonString(ModelSelection)),
  scripts: Schema.fromJsonString(Schema.Array(ProjectScript)),
  createdAt: ProjectionProject.fields.createdAt,
  updatedAt: ProjectionProject.fields.updatedAt,
  deletedAt: ProjectionProject.fields.deletedAt,
});

type ProjectionProjectDbRowColumns = typeof ProjectionProjectDbRowColumnsSchema.Type;

const toProjectionProject = (
  row: ProjectionProjectDbRowColumns,
): typeof ProjectionProject.Type => ({
  projectId: row.projectId,
  title: row.title,
  workspaceRoot: row.workspaceRoot,
  transport: projectTransportFromDb(row.transportType, row.sshConnectionId),
  defaultModelSelection: row.defaultModelSelection,
  scripts: row.scripts,
  createdAt: row.createdAt,
  updatedAt: row.updatedAt,
  deletedAt: row.deletedAt,
});

const makeProjectionProjectRepository = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient;

  const upsertProjectionProjectRow = SqlSchema.void({
    Request: ProjectionProject,
    execute: (row) => {
      const dbTransport = projectTransportToDb(row.transport);
      return sql`
        INSERT INTO projection_projects (
          project_id,
          title,
          workspace_root,
          transport_type,
          ssh_connection_id,
          default_model_selection_json,
          scripts_json,
          created_at,
          updated_at,
          deleted_at
        )
        VALUES (
          ${row.projectId},
          ${row.title},
          ${row.workspaceRoot},
          ${dbTransport.transportType},
          ${dbTransport.sshConnectionId},
          ${row.defaultModelSelection !== null ? JSON.stringify(row.defaultModelSelection) : null},
          ${JSON.stringify(row.scripts)},
          ${row.createdAt},
          ${row.updatedAt},
          ${row.deletedAt}
        )
        ON CONFLICT (project_id)
        DO UPDATE SET
          title = excluded.title,
          workspace_root = excluded.workspace_root,
          transport_type = excluded.transport_type,
          ssh_connection_id = excluded.ssh_connection_id,
          default_model_selection_json = excluded.default_model_selection_json,
          scripts_json = excluded.scripts_json,
          created_at = excluded.created_at,
          updated_at = excluded.updated_at,
          deleted_at = excluded.deleted_at
      `;
    },
  });

  const getProjectionProjectRow = SqlSchema.findOneOption({
    Request: GetProjectionProjectInput,
    Result: ProjectionProjectDbRowColumnsSchema,
    execute: ({ projectId }) =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          transport_type AS "transportType",
          ssh_connection_id AS "sshConnectionId",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        WHERE project_id = ${projectId}
      `,
  });

  const listProjectionProjectRows = SqlSchema.findAll({
    Request: Schema.Void,
    Result: ProjectionProjectDbRowColumnsSchema,
    execute: () =>
      sql`
        SELECT
          project_id AS "projectId",
          title,
          workspace_root AS "workspaceRoot",
          transport_type AS "transportType",
          ssh_connection_id AS "sshConnectionId",
          default_model_selection_json AS "defaultModelSelection",
          scripts_json AS "scripts",
          created_at AS "createdAt",
          updated_at AS "updatedAt",
          deleted_at AS "deletedAt"
        FROM projection_projects
        ORDER BY created_at ASC, project_id ASC
      `,
  });

  const deleteProjectionProjectRow = SqlSchema.void({
    Request: DeleteProjectionProjectInput,
    execute: ({ projectId }) =>
      sql`
        DELETE FROM projection_projects
        WHERE project_id = ${projectId}
      `,
  });

  const upsert: ProjectionProjectRepositoryShape["upsert"] = (row) =>
    upsertProjectionProjectRow(row).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.upsert:query")),
    );

  const getById: ProjectionProjectRepositoryShape["getById"] = (input) =>
    getProjectionProjectRow(input).pipe(
      Effect.map((row) => Option.map(row, toProjectionProject)),
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.getById:query")),
    );

  const listAll: ProjectionProjectRepositoryShape["listAll"] = () =>
    listProjectionProjectRows().pipe(
      Effect.map((rows) => rows.map(toProjectionProject)),
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.listAll:query")),
    );

  const deleteById: ProjectionProjectRepositoryShape["deleteById"] = (input) =>
    deleteProjectionProjectRow(input).pipe(
      Effect.mapError(toPersistenceSqlError("ProjectionProjectRepository.deleteById:query")),
    );

  return {
    upsert,
    getById,
    listAll,
    deleteById,
  } satisfies ProjectionProjectRepositoryShape;
});

export const ProjectionProjectRepositoryLive = Layer.effect(
  ProjectionProjectRepository,
  makeProjectionProjectRepository,
);
