# Ubiquitous Language

## Actors & endpoints

| Term               | Definition                                                                                                   | Aliases to avoid              |
| ------------------ | ------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **Device**         | A Supernote e-Ink tablet exposing its files over the built-in HTTP "Browse & Access" interface (port 8089). | Tablet, Supernote, remote     |
| **Local path**     | The root directory on the user's machine that mirrors selected device folders.                              | Sync dir, local folder, target |
| **Trash**          | The fixed `<LOCAL_PATH>/trash` directory where files are moved when deleted on the device.                  | Recycle bin, deleted dir      |
| **Sync dir**       | A top-level folder name (e.g. `Document`, `EXPORT`) that is synchronized bidirectionally.                   | Pull dir, push dir, category  |

## File identity & metadata

| Term               | Definition                                                                                                    | Aliases to avoid             |
| ------------------ | ------------------------------------------------------------------------------------------------------------- | ---------------------------- |
| **File key**       | The `(device_name, device_path)` pair that uniquely identifies a file across device, local fs, and DB.       | ID, path, key                |
| **Device file**    | A file as reported by the device's HTML/JSON listing.                                                        | Remote file                  |
| **Local file**     | A file present under **Local path**, discovered by filesystem walk.                                          | Disk file                    |
| **DB snapshot**    | The `file_meta` row recording size, md5, and timestamp from the last successful sync of a **File key**.      | Cache, record, state row     |
| **MD5**            | Streamed MD5 digest of a file's bytes, used to detect content change.                                        | Hash, checksum               |

## Sync state & actions

| Term           | Definition                                                                                                   | Aliases to avoid              |
| -------------- | ------------------------------------------------------------------------------------------------------------ | ----------------------------- |
| **Sync pass**  | One full invocation of `bun run sync`: list, classify, act, exit.                                            | Run, cycle, tick              |
| **Classify**   | Comparing device, local, and DB snapshot for a **File key** to assign a **Sync status**.                     | Check, diff                   |
| **Sync status**| The classification outcome: `OK`, `NEW`, `STALE`, `CONFLICT`, `DELETED`.                                     | State                         |
| **Download**   | Copy a **Device file** to **Local path** and update the **DB snapshot**.                                     | Pull, fetch                   |
| **Upload**     | Multipart POST a **Local file** to the device and update the **DB snapshot**.                                | Push, send                    |
| **Conflict**   | A **Sync status** where both sides diverged from the **DB snapshot**, or the device can't accept the change; logged and skipped. | Collision |
| **Stale**      | A **Sync status** where the device changed but the local copy still matches the **DB snapshot**; resolved by download. | Outdated               |

## Relationships

- A **Device** owns many **Device files**, grouped under **Sync dirs**.
- Each **File key** has at most one **Device file**, one **Local file**, and one **DB snapshot**.
- A **Sync pass** emits one **Sync status** per **File key**, which drives at most one **Download**, **Upload**, or trash move.
- A **Conflict** never mutates either side — only logs.

## Example dialogue

> **Dev:** "If a **Local file** is edited and the **Device file** hasn't changed, why don't we just **Upload** it?"

> **Domain expert:** "Because the **Device**'s HTTP API can't overwrite. An **Upload** only succeeds when the **File key** is **NEW** on the device. So a locally-edited file against an unchanged **Device file** is a **Conflict** — we log and skip."

> **Dev:** "And if the **Local file** is deleted but the **Device file** still exists?"

> **Domain expert:** "We can't tell the **Device** to delete, so we re-**Download** on the next **Sync pass**. Leaving the **DB snapshot** stale would orphan the **File key** forever."

> **Dev:** "What about the reverse — **Device file** gone, **Local file** still there?"

> **Domain expert:** "**Sync status** is `DELETED`. Move the **Local file** into **Trash** and drop the **DB snapshot** row."

## Flagged ambiguities

- "Pull" and "push" in the Python reference meant *directionality per folder*. In this port they're collapsed — every **Sync dir** is bidirectional. Prefer **Download** / **Upload** (concrete actions on a single **File key**) over pull/push.
- "Sync dir" vs "**Local path**": **Local path** is the single root; **Sync dirs** are the named top-level folders inside it that are actually synchronized.
- "File" alone is ambiguous — always qualify as **Device file**, **Local file**, or **DB snapshot** when the side matters.
