# Inbound Runtime Correctness Seal

- Persist downstream processing completion for every canonical source record.
- Replay pending downstream work for duplicate ledger records.
- Block cursor advancement when a page contains rejected records.
- Persist run counters before downstream processing.
- Add migration 017 if required.
