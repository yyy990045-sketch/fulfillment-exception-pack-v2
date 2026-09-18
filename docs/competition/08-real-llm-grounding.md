# 1 Phase Goal

Phase 6B adds an OpenAI provider inside the existing Grounding Firewall. A real model may generate an explanation, but it cannot decide the Exception, bypass citation/numeric validation, or mutate governance state.

# 2 Why a Real LLM Comes After 6A

The deterministic Rule Engine remains the source of truth:

```text
Evidence
  -> RuleEvaluation
  -> Exception
  -> Grounded Context
  -> OpenAI
  -> Structured Output
  -> Schema
  -> Citation Validator
  -> Numeric Validator
  -> Unsupported Claim Guard
  -> generated / rejected
```

# 3 Provider

The only real provider implemented in this phase is `openai`. Anthropic, Gemini, Qwen, DeepSeek, Ollama, and compatible proxies are not implemented.

# 4 Responses API

The provider uses the official OpenAI Node SDK and the Responses API. Chat Completions is not used.

The request sends the existing `system` and `user` prompt contract as `instructions` and `input`. It does not create a second business-rule prompt.

# 5 Structured Outputs

The request uses strict JSON Schema through `text.format = { type: "json_schema", strict: true }`.

The schema requires:

- executiveSummary
- facts
- discrepancy
- uncertainties
- questionsToVerify
- prohibitedConclusions

All nested objects use `additionalProperties: false`. Fact values are `string | number`, and fact kinds are limited to `expected`, `actual`, `metric`, and `source_fact`.

# 6 store=false

Every Responses API request explicitly sends:

```text
store: false
```

# 7 No Tools

The OpenAI request explicitly sends an empty tools array:

```text
tools: []
```

No web search, file search, computer use, function tools, or MCP tools are enabled.

# 8 Model Configuration

`OPENAI_GROUNDED_MODEL` is mandatory. There is no implicit production model default.

`OPENAI_GROUNDED_REASONING_EFFORT` is optional and accepts `none`, `low`, or `medium`.

`OPENAI_GROUNDED_TIMEOUT_MS` defaults to `20000` and is constrained to `1000–60000`.

# 9 Grounding Firewall

OpenAI structured output is data, not authority. Every result still passes through:

```text
parseGroundedExplanationOutput()
validateGroundedExplanation()
```

Citation errors, numeric errors, unsupported causal or liability claims, and hidden-reasoning fields fail closed.

# 10 Customer Claim Result

The contract test uses the Customer Claim exception:

```text
shipment = 96
customer claim = 80
difference = 16
```

The provider output must keep the customer claim as a claim, not convert it into actual receipt.

# 11 Quality Result

The contract test uses the Quality exception:

```text
inspected = 100
passed = 96
nonconforming = 4
```

The provider may explain the deterministic quantities but cannot infer that quality caused shipment shortfall.

# 12 Prompt Injection Result

The adversarial input places instructions inside an Evidence quote. The prompt keeps that text in the evidence data block and the model is not allowed to treat it as system instructions.

Live verification is only claimed when the real provider is explicitly enabled and the response either passes validation or is rejected by the firewall.

# 13 Deterministic vs Real Provider

Provider and model remain part of the Explanation identity:

```text
tenant, exception, snapshot hash, provider, model
```

`deterministic-demo` and `openai` can coexist for the same snapshot. OpenAI results do not overwrite deterministic results.

# 14 Failure Handling

Provider timeout maps to `AI_PROVIDER_TIMEOUT` with HTTP 504. Refusal maps to `AI_PROVIDER_REFUSAL` with HTTP 422. Invalid structured output maps to `AI_PROVIDER_INVALID_OUTPUT`; other SDK errors map to `AI_PROVIDER_FAILURE`.

Provider failures do not create a fallback Explanation and do not fall back to deterministic.

# 15 Idempotency / Cost Boundary

The real verification command uses temporary SQLite databases and does not touch production data.

The provider layer sets `maxRetries: 0` and uses an AbortController-backed timeout.

Same snapshot/provider/model requests reuse an existing Explanation and do not call OpenAI again.

# 16 Current Truthfulness Boundary

```text
OPENAI_PROVIDER_CODE_IMPLEMENTED = true
OPENAI_PROVIDER_MOCK_TESTED = true
REAL_OPENAI_API_VERIFIED = false
CUSTOMER_CLAIM_REAL_MODEL_VERIFIED = false
QUALITY_REAL_MODEL_VERIFIED = false
ADVERSARIAL_REAL_MODEL_VERIFIED = false
```

No `OPENAI_API_KEY` was present in the current environment, so the real provider verification remains blocked. The code path and mock contract are implemented; live claims must not be marked true until `npm run grounded-ai:verify` succeeds with a configured key and explicit model.
