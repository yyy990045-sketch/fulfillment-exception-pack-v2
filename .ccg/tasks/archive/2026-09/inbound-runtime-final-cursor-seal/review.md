# Review

- Successful page processing now updates run and state cursors together before return.
- Downstream pending is verified from persisted ledger rows after marking.
- An injected ledger-marking failure blocks cursor advancement and returns a stable error.
- Existing outbound behavior and all prior inbound correctness tests remain green.
