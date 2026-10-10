// Registers every verb group. Each module calls defineVerb() at import time.
// Owner per module is recorded in docs/ARCHITECTURE.md.
import "./setup.ts";
import "../signer/verbs.ts";
import "../lsp/verbs.ts";
import "../exec/verbs.ts";
import "../relayer/verbs.ts";
import "../erc4337/verbs.ts";
import "../abi/verbs.ts";
import "../tokens/verbs.ts";
import "../social/verbs.ts";
import "../display/verbs.ts";
import "../knowledge/verbs.ts";
import "../knowledge/onboarding.ts";
import "./start.ts";
