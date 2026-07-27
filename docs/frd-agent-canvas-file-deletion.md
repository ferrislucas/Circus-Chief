# Functional Requirements Document: Agent Canvas File Deletion

## 1. Purpose

Make the agent-facing "delete file from canvas" API delete the named canvas
file as a whole. A canvas file is the set of every version sharing the same
filename in a workspace; it is not merely the newest version currently
returned by the canvas listing API.

## 2. Problem Statement

Canvas uploads are versioned as separate records. The agent system prompt
exposes a filename-oriented delete operation, but its current implementation
resolves the filename to the latest record and deletes only that record. Older
versions then remain on the canvas and can reappear as the latest file. This
is surprising and makes an agent unable to reliably remove an artifact it
created.

## 3. Goals and Non-goals

### Goals

- Delete every version of a named file in the current workspace.
- Preserve the filename-oriented, agent-facing API shape.
- Make the operation atomic: it must either delete every matching version or
  leave the canvas unchanged.
- Return a result that lets callers confirm how many versions were removed.
- Keep session/workspace isolation and filename decoding behavior consistent
  with the existing canvas file APIs.

### Non-goals

- Deleting one selected historical version while retaining other versions.
- Changing browser UI trash, restore, or bulk-item behavior.
- Changing how canvas versions are created, numbered, or read.

## 4. Functional Requirements

### FR-1: Filename identifies the complete canvas file

For `DELETE /api/workspaces/:workspaceId/canvas/file/:filename`, the service
must resolve the workspace to its root canvas session and find every canvas
item in that session whose filename exactly matches `:filename`.

The match includes all versions, including versions that are no longer the
latest one. Matching must not be limited by the normal canvas-list endpoint's
latest-version projection.

### FR-2: Delete all versions permanently

The endpoint must permanently remove every matched version, including any
versions already in canvas trash. After a successful response, the filename
must not be available from the active canvas list, the canvas trash, the file
metadata endpoint, the content endpoint, or the history endpoint.

This endpoint is intentionally a whole-file, irreversible removal operation;
it is distinct from the existing item-based soft-delete/trash APIs.

### FR-3: Atomic behavior

All matching rows must be removed in one database transaction. The service
must not return success after only a subset of the file's versions has been
deleted.

### FR-4: Response contract

On success, return HTTP `200` with:

```json
{
  "filename": "report.md",
  "deletedCount": 3
}
```

`deletedCount` is the number of versions permanently removed, including
previously trashed versions.

If no version with that filename exists in the workspace, return HTTP `404`
with `{ "error": "File not found on canvas" }`. Do not treat a missing file
as a successful zero-count deletion.

### FR-5: Scope and authorization

The route must use the same root-session/project validation middleware as
other agent-facing canvas file routes. A child-session ID must operate on the
shared root workspace canvas; it must never delete records belonging to a
different workspace or project.

### FR-6: Realtime notification

For every removed canvas-item version, publish the existing `canvas:remove`
websocket event to the root workspace session. This keeps open canvas views
from retaining stale version metadata.

### FR-7: Agent prompt and reference documentation

The generated system prompt must document the endpoint and explicitly say it
permanently deletes **all versions** of the named file. The REST API reference
in `docs/agent-system-prompt.md` must carry the same contract, response, and
irreversibility warning.

The prompt example must URL-encode `filename` when necessary.

## 5. API Contract

| Method | Endpoint | Success | Failure |
| --- | --- | --- | --- |
| `DELETE` | `/api/workspaces/{workspaceId}/canvas/file/{filename}` | `200` and deleted filename/count | `404` when no matching file exists; existing validation errors for an invalid workspace/project |

`filename` is a path parameter and is interpreted as one canvas filename, not
a filesystem path. The client must encode reserved URL characters.

## 6. Implementation Notes

- Add a repository method that deletes by `(rootSessionId, filename)` without
  filtering on `deleted_at`, returns the deleted IDs/count, and runs in a
  transaction.
- Register the delete route before any generic `/:id/canvas/:itemId` route so
  Express cannot interpret `file` as an item ID.
- The agent-facing workspace route may delegate to the same handler as an
  equivalent sessions route, but there must be one canonical whole-file
  deletion behavior.
- Temporary files written by read endpoints are out of scope; the operation
  removes canvas persistence, not `/tmp` read-tool copies.

## 7. Acceptance Criteria

1. Given three active versions of `report.md`, deleting `report.md` returns
   `200` and `deletedCount: 3`.
2. After criterion 1, listing the canvas contains no `report.md`, and metadata,
   content, and every history version request for it returns `404`.
3. Given active and trashed versions of the same filename, one delete removes
   all of them and reports their combined count.
4. Deleting a filename that has never existed, or has already been fully
   deleted, returns `404` and does not affect other files.
5. Deleting `report.md` does not delete `report.pdf` or a `report.md` belonging
   to another workspace.
6. Connected clients receive one canvas-remove event per removed version.
7. The system-prompt output and API reference both state that the operation
   permanently removes all versions.

## 8. Test Requirements

- Route tests: active-only versions, mixed active/trashed versions, absent
  filename, encoded filenames, and cross-workspace isolation.
- Repository tests: all-version deletion returns accurate IDs/count and is
  transactional.
- Websocket tests: one removal event per deleted version.
- Prompt/documentation tests: the generated system prompt contains the delete
  endpoint and the phrase "all versions" (or equivalent unambiguous wording).
