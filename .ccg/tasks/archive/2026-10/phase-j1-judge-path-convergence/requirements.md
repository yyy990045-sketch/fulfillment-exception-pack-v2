# Phase J1 Requirements

The competition product is **履约哨兵 / Fulfillment Sentinel**: a cross-system
production-fulfillment conflict disposition app for one discrete-manufacturing
order line across ERP, MES, QMS and WMS.

The implementation must converge the existing Judge Demo to the five Judge
Contract cases A-E without replacing the existing platform architecture:

- correlate the four source facts through deterministic business lineage;
- evaluate only at a common global watermark after due time plus grace;
- use `Shipment.executionCommittedQty` as WMS authority;
- create `FULFILLMENT_STATE_CONFLICT@1.0` only from source facts;
- keep authorized disposition separate from observed conflict;
- require a new source fact and revalidation before closure;
- preserve ERP external obligation at 100 even after internal short-shipment disposition;
- expose the four source facts and current result on the first Judge screen;
- keep optional LineCounter corroboration and real open supOS runtime status honest.

Do not add a second industry scenario, generic framework, new event-streaming
platform, new permission platform, or a large new test suite.
