# 1 Core vs Solution Pack

The platform now separates:

```text
Core Platform
    +
Installable code-packaged Solution Packs
```

The Core owns:

- Evidence and domain persistence
- Rule execution
- Exception materialization
- Grounded Explanation
- Root Cause Hypothesis
- Decision Recommendation
- Policy Engine
- Automation Engine
- Outcome Intelligence
- Operational Analytics

A Solution Pack contributes:

- context types
- Rule Definitions and versions
- Outcome Definitions
- presentation metadata
- optional Decision eligibility hints
- deterministic demo data

# 2 Pack Manifest

Each pack has:

```text
id
version
name
description
contextTypes
capabilities
workbenchPath
coreApiVersion compatibility
```

The manifest is hashed with stable JSON and the hash is stored on installation.

# 3 Installation

Installation is tenant-scoped and persisted in `solution_pack_installations`.

Installing a pack:

- registers rules and versions
- installs pack Outcome Definitions
- stores manifest hash and config

Installation does not:

- create Context or Evidence
- evaluate rules
- create Exceptions
- create Resolution Cases
- execute Automation

# 4 Rule Contributions

Rule semantics live in packs. Core Rule Engine still owns:

- selector resolution
- comparison
- evaluation persistence
- Exception materialization

Packs cannot write Exceptions directly.

# 5 Outcome Contributions

Packs contribute Outcome Definitions. The Core Outcome evaluator remains generic and Evidence-backed.

# 6 Presentation

Presentation contributes labels, stage order, entity selectors, and workbench hints.

Presentation cannot create business facts.

# 7 Decision Eligibility

Core baseline eligibility is:

- `create_task`: eligible
- `supplement_evidence`: eligible
- `reject_overclaim`: ineligible

Packs may add domain-specific eligibility such as `urge_follow_up` or `review_quotation`.

Policy, Automation, Grounded AI, and Root Cause remain Core capabilities.

# 8 Manufacturing Migration

Manufacturing Fulfillment is now the first pack.

Existing Manufacturing IDs, rule codes, match keys, metrics, evidence roles, and SO-MFG Hero identity remain compatible.

# 9 Finance Proof Pack

Finance Reconciliation is the second domain pack.

It includes:

- `finance_reconciliation` Context
- receivable, invoice, and bank payment Entities
- three deterministic Rules
- one Evidence-backed Outcome Definition
- a synthetic demo

The Finance Pack does not copy Rule, AI, Policy, Automation, or Outcome engines.

# 10 Cross-pack Isolation

Rule evaluation resolves the installed pack from the Context type.

Manufacturing rules do not run on Finance Contexts and Finance rules do not run on Manufacturing Contexts.

If a Context type is pack-owned but the tenant has not installed the pack, no pack rules are silently loaded.

# 11 Generic Workspace

`/workspace?context=<contextId>` is the generic Solution Pack workbench.

It renders:

- Pack identity
- Business Context
- business stages
- Rules
- Exceptions
- Outcomes

Finance uses this workspace instead of a dedicated `/finance` application.

# 12 Cross-domain Analytics

Operational Analytics remains Context-generic.

Finance Contexts appear in the same Operations workbench as Manufacturing.

# 13 Future Pack SDK

The current platform is code-packaged only.

It does not download or execute remote code.

# 14 Truthfulness

```text
SOLUTION_PACK_PLATFORM_IMPLEMENTED = true
MANUFACTURING_PACK = true
FINANCE_RECONCILIATION_PACK = true
CROSS_DOMAIN_CORE_REUSE = true
REMOTE_PLUGIN_RUNTIME = false
PLUGIN_MARKETPLACE = false
REAL_FINANCE_CUSTOMER_DATA = false
REAL_MANUFACTURING_CUSTOMER_DATA = false
```
