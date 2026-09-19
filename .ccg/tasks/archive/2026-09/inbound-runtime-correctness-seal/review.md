# Review

- Canonical and downstream completion are now separate persisted states.
- Duplicate records with pending downstream processing re-enter the downstream callback.
- Cursor advancement requires zero rejected records and no pending downstream records.
- Rejected records retain canonical commits from valid siblings but block the safe cursor.
- Sync runs persist read, committed, duplicate, and rejected counters before downstream callbacks.
- Migration 017 adds the correctness fields without changing outbound semantics.
