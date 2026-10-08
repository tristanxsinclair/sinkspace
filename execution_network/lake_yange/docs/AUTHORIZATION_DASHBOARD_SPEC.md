# Visual Authorization Dashboard - Specification

**Document ID:** LY-SPEC-AUTH-DASHBOARD-V1.0  
**Status:** DRAFT - Awaiting Implementation  
**Author:** Principal Staff Engineer  
**Date:** 2026-10-08  
**Scope:** Lake Yange Civic Runtime - Human Operator Interface

---

## 1. EXECUTIVE SUMMARY

This specification defines the **Visual Authorization Dashboard** for Lake Yange, a constitutional state machine where **AI proposes and humans dispose**. The dashboard provides human stewards with a dedicated, sovereign interface to cryptographically approve or reject agent proposals while maintaining absolute data sovereignty and append-only audit integrity.

### 1.1 Prime Directive

> No action is executed without cryptographic human authorization via receipt.json

### 1.2 Core Principles

- **Data Sovereignty:** All authorization state is local; no external third-party APIs
- **Append-Only:** The ledger (three_tier_ledger.py) cannot be overwritten
- **Offline Execution:** Relies on local execution (llama-cpp-local-runtime.ts)
- **Constitutional State Machine:** Strict separation between proposal and disposal

---

## 2. ARCHITECTURE OVERVIEW

### 2.1 System Components

```
┌─────────────────────────────────────────────────────────────────┐
│                    VISUAL AUTHORIZATION DASHBOARD                   │
│                                                                     │
│  ┌─────────────┐  ┌─────────────┐  ┌─────────────────────────┐  │
│  │  UI Layer   │  │  API Layer  │  │   Authorization Engine     │  │
│  │ (TypeScript)│  │ (FastAPI)   │  │   (Python - auth_gate.py)  │  │
│  └──────┬──────┘  └──────┬──────┘  └──────────┬──────────────┘  │
│         │                 │                      │                  │
│         │ GET /api/proposals                                │                  │
│         │ POST /api/proposals/{pid}/authorize               │                  │
│         │ POST /api/proposals/{pid}/reject                  │                  │
│         ▼                 ▼                      ▼                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │                    Red Sink Ledger                         │    │
│  │              (Appends receipt.json on every action)        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                     │
└─────────────────────────────────────────────────────────────────┘
```

### 2.2 Data Flow

1. **Agent Proposes:** Agent submits proposal → Gateway records → State: PENDING
2. **Vera Audits:** Vera veto check → State: BLOCKED_BY_VERA or PENDING
3. **Human Reviews:** Steward views dashboard → Sees tiered, grouped proposals
4. **Human Verifies:** Steward inspects cryptographic message → Confirms hash
5. **Human Signs:** Steward signs with Ed25519 key (browser WebCrypto) → Signature collected
6. **Human Submits:** Signatures sent to backend → Token minted → Ledger appended
7. **Forge Executes:** Forge consumes token → Execution occurs → Result recorded

---

## 3. UI/UX SPECIFICATION

### 3.1 Dashboard Layout

The dashboard is organized into **four primary regions**:

```
┌─────────────────────────────────────────────────────────────────┐
│  HEADER: System Status | Steward Identity | Session Token           │
├─────────────────────────────────────────────────────────────────┤
│  NAVIGATION: Auth Dashboard | Command Center | System Map | Missions│
├─────────────────────────────────────────────────────────────────┤
│                                                                     │
│  ┌─────────────────┐  ┌─────────────────┐  ┌─────────────────┐    │
│  │   TIER 3         │  │   TIER 2         │  │   TIER 1         │    │
│  │  (Critical)      │  │  (High)          │  │  (Medium)        │    │
│  │                 │  │                 │  │                 │    │
│  │  ▼ LY-PROP-...   │  │  ▼ LY-PROP-...   │  │  ▼ LY-PROP-...   │    │
│  │  ▼ LY-PROP-...   │  │  ▼ LY-PROP-...   │  │  ▼ LY-PROP-...   │    │
│  │                 │  │                 │  │                 │    │
│  │  ┌─────────────┐ │  │  ┌─────────────┐ │  │  ┌─────────────┐ │    │
│  │  │ VERA VETO   │ │  │  │ VERA VETO   │ │  │  │ VERA VETO   │ │    │
│  │  │ (Urgent)    │ │  │  │ (Urgent)    │ │  │  │ (Urgent)    │ │    │
│  │  │             │ │  │  │             │ │  │  │             │ │    │
│  │  └─────────────┘ │  │  └─────────────┘ │  │  └─────────────┘ │    │
│  └─────────────────┘  └─────────────────┘  └─────────────────┘    │
│                                                                     │
│  ┌─────────────────┐                                              │
│  │   TIER 0         │                                              │
│  │  (Automatic)     │                                              │
│  │                 │                                              │
│  │  ▼ LY-PROP-...   │                                              │
│  └─────────────────┘                                              │
│                                                                     │
├─────────────────────────────────────────────────────────────────┤
│  FOOTER: Sync Status | Last Ledger Entry | Verification Hash        │
└─────────────────────────────────────────────────────────────────┘
```

### 3.2 Visual Design System

#### 3.2.1 Tier Color Coding

| Tier | Color | Background | Border | Purpose |
|------|-------|------------|--------|---------|
| 0 | `#34d399` (Emerald) | `#062014` | `#10b981` | Micro actions, auto-approvable |
| 1 | `#60a5fa` (Blue) | `#072a38` | `#3b82f6` | Single-steward approval |
| 2 | `#fbbf24` (Amber) | `#2a1a03` | `#d97706` | Dual-steward + 6h time-lock |
| 3 | `#fb7185` (Rose) | `#2d0a14` | `#ef4444` | Multi-sig (3) + 24h time-lock |

#### 3.2.2 Status Indicators

| Status | Badge | Icon | Animation |
|--------|-------|------|-----------|
| PENDING | Gray | ⏳ | None |
| AWAITING_HUMAN | Amber | 🔐 | Pulse |
| BLOCKED_BY_VERA | Rose | 🚫 | Flash |
| TIME_LOCKED | Amber | ⏰ | Countdown |
| APPROVED | Emerald | ✓ | None |
| REJECTED | Rose | ✗ | None |
| EXECUTED | Blue | ▶️ | None |

#### 3.2.3 Vera Veto Visual Isolation

Proposals with `status === "BLOCKED_BY_VERA"` MUST be:
- **Visually separated** within their tier group with a distinct sub-section
- **Highlighted** with a rose (`#fb7185`) border that pulses at 1.4s intervals
- **Labeled** with a prominent "🚫 BLOCKED BY VERA" banner
- **Positioned at the top** of their tier group (highest priority)

### 3.3 Proposal Card Design

Each proposal card contains:

```
┌─────────────────────────────────────────────────────────────────┐
│  [TIER BADGE] [PROPOSAL_ID] [AGENT_ID] [STATUS BADGE]               │
│                                                                      │
│  Action: [action_type] → [target_system]                           │
│  Justification: [justification_text]                               │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  CRYPTOGRAPHIC VERIFICATION                                    │    │
│  │  Hash: [proposal_hash_trimmed]...                             │    │
│  │  Tier: [tier_label] | Signatures: [collected]/[required]        │    │
│  │  Time-Lock: [countdown_or_status]                            │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                      │
│  [ADVANCED TOGGLE ▼]                                                  │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  Signing Message (UTF-8):                                      │    │
│  │  {"domain":"LAKE-YANGE-GATE/1","proposal_id":"...",        │    │
│  │   "proposal_hash":"...","tier":3,"decision":"APPROVE"}     │    │
│  │                                                               │    │
│  │  Signing Message (Base64): [b64_encoded]                       │    │
│  │                                                               │    │
│  │  SHA-256 Checksum: [checksum] ✓ Verified                        │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                      │
│  [Sign with Key] [HSM Sign] [Submit] [Reject]                      │
│  [Sync with Server]                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### 3.4 Action Buttons

| Button | Color | Icon | Behavior |
|--------|-------|------|----------|
| Sign with Key | Emerald (`#10b981`) | ✍️ | Sign with loaded WebCrypto key |
| HSM Sign | Amber (`#d97706`) | 🔐 | Prompt for external HSM signature |
| Submit Authorization | Emerald | ✓ | Submit collected signatures to backend |
| Reject | Rose (`#ef4444`) | ✗ | Open rejection modal with reason + revocation checkbox |
| Sync with Server | Blue (`#3b82f6`) | 🔄 | Refresh proposal state from backend |
| Clear | Gray | 🗑️ | Clear locally collected signatures |

### 3.5 Rejection Modal

```
┌─────────────────────────────────────────────────────────────────┐
│  REJECT PROPOSAL [PROPOSAL_ID]                                    │
├─────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Reason for Rejection:                                             │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ [Text area - max 500 chars]                                   │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                      │
│  ☐ Revoke agent's session key (permanent - use only for          │
│     malicious behavior)                                           │
│                                                                      │
│  [Cancel]                          [Reject & Sign]                      │
└─────────────────────────────────────────────────────────────────┘
```

**Critical:** The revocation checkbox is **explicit and optional**. Auto-revocation is prohibited.

### 3.6 Emergency Override Modal

For Tier 3 proposals blocked by Vera:

```
┌─────────────────────────────────────────────────────────────────┐
│  ⚠️ EMERGENCY OVERRIDE - TIER 3 PROPOSAL                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                      │
│  This proposal is BLOCKED BY VERA:                                 │
│  [veto_reason]                                                     │
│                                                                      │
│  Emergency override requires:                                      │
│  - 3 distinct steward signatures                                    │
│  - 24-hour cooling period                                          │
│  - Explicit confirmation from each steward                         │
│                                                                      │
│  Time-Lock Status:                                                 │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  ⏰ [XX]h [YY]m [ZZ]s remaining of 24h cooling                   │    │
│  │     (Filed by: [steward_list])                                │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Collected Signatures: [N]/3                                       │
│  - [Steward 1] ✓                                                   │
│  - [Steward 2] ✓                                                   │
│  - [Steward 3]                                                    │
│                                                                      │
│  Type: "Confirm Override [1-3]/3" to proceed                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │ [Input field - must match exact string]                       │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                      │
│  [Cancel]                          [Sign Override]                     │
└─────────────────────────────────────────────────────────────────┘
```

**Critical Constraints:**
- The input field **must** match the exact string "Confirm Override N/3" where N is the next signature number
- If the proposal is **still within its normal time-lock** (not the override cooling), the [Sign Override] button is **disabled** with tooltip: "Cannot override: Normal time-lock still active"
- The countdown timer updates in **real-time** (1-second granularity)

### 3.7 Time-Lock Cancel Modal

For cancelling an emergency override:

```
┌─────────────────────────────────────────────────────────────────┐
│  CANCEL EMERGENCY OVERRIDE                                          │
├─────────────────────────────────────────────────────────────────┤
│                                                                      │
│  This will cancel the emergency override for:                       │
│  [proposal_id] - [brief_description]                               │
│                                                                      │
│  Emergency override cancellation requires:                         │
│  - 2 distinct steward signatures (TIER_3_EMERGENCY_OVERRIDE)     │
│                                                                      │
│  Collected Signatures: [N]/2                                       │
│  - [Steward 1] ✓                                                   │
│  - [Steward 2]                                                    │
│                                                                      │
│  [Cancel]                          [Sign Cancel]                       │
└─────────────────────────────────────────────────────────────────┘
```

### 3.8 Post-Action Receipt Display

After any authorization action (approve/reject/override/cancel), immediately display:

```
┌─────────────────────────────────────────────────────────────────┐
│  ✓ AUTHORIZATION RECEIPT                                           │
├─────────────────────────────────────────────────────────────────┤
│                                                                      │
│  Action: [APPROVE/REJECT/OVERRIDE/CANCEL]                           │
│  Proposal: [proposal_id]                                            │
│  Decision: [decision_type]                                          │
│  Tier: [tier]                                                       │
│                                                                      │
│  ┌─────────────────────────────────────────────────────────┐    │
│  │  LEDGER ENTRY                                                  │    │
│  │  Index: [ledger_index]                                          │    │
│  │  Hash: [entry_hash]                                             │    │
│  │  Previous: [previous_hash]                                       │    │
│  │  Timestamp: [iso_timestamp]                                      │    │
│  └─────────────────────────────────────────────────────────┘    │
│                                                                      │
│  Verification Hash: [sha256_of_complete_receipt]                  │
│                                                                      │
│  [Copy Receipt] [Verify in Ledger] [Close]                          │
└─────────────────────────────────────────────────────────────────┘
```

---

## 4. CRYPTOGRAPHIC WORKFLOW

### 4.1 Signing Message Construction

The backend provides the exact bytes to sign via `GET /api/proposals/{pid}/signing-message?decision={decision}`

**Message Format:**
```json
{
  "domain": "LAKE-YANGE-GATE/1",
  "proposal_id": "LY-PROPOSAL-...",
  "proposal_hash": "sha256_hex_digest",
  "tier": 3,
  "decision": "APPROVE" | "REJECT" | "TIER_3_EMERGENCY_OVERRIDE" | "CANCEL_OVERRIDE"
}
```

**Verification in UI:**
1. Fetch signing message from backend
2. Display UTF-8 representation
3. Display Base64 representation  
4. Compute SHA-256 checksum of the UTF-8 bytes
5. Verify checksum matches backend's proposal_hash
6. Show ✓ Verified or ✗ Mismatch

### 4.2 Signature Collection

**Browser-Based Signing (WebCrypto):**
```javascript
// Steward key loaded into CryptoKey (Ed25519, non-extractable)
const signature = await crypto.subtle.sign(
  'Ed25519',
  stewardKey,
  messageBytes  // From backend's signing-message
);
```

**HSM/External Signing:**
- Display the exact UTF-8 message bytes
- Prompt steward to sign with external Ed25519 signer
- Steward pastes base64-encoded signature
- UI validates signature format (base64, correct length)

### 4.3 Signature Submission

**For APPROVE:**
```json
POST /api/proposals/{pid}/authorize
{
  "signatures": [
    {"steward_id": "steward-1", "signature_b64": "..."},
    {"steward_id": "steward-2", "signature_b64": "..."}
  ],
  "emergency_override": []  // Optional for override
}
```

**For REJECT:**
```json
POST /api/proposals/{pid}/reject
{
  "signature": {"steward_id": "steward-1", "signature_b64": "..."},
  "reason": "Human review identified...",
  "revoke_agent_key": false  // Explicit opt-in only
}
```

**For TIER_3_EMERGENCY_OVERRIDE:**
```json
POST /api/proposals/{pid}/authorize
{
  "signatures": [],
  "emergency_override": [
    {"steward_id": "steward-1", "signature_b64": "..."},
    {"steward_id": "steward-2", "signature_b64": "..."},
    {"steward_id": "steward-3", "signature_b64": "..."}
  ]
}
```

**For CANCEL_OVERRIDE:**
```json
POST /api/proposals/{pid}/override/cancel
{
  "signatures": [
    {"steward_id": "steward-1", "signature_b64": "..."},
    {"steward_id": "steward-2", "signature_b64": "..."}
  ]
}
```

### 4.4 Token Handling

Backend returns a **60-second single-use JWT** token:
```json
{
  "token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "expires_at": 1728384000,
  "seconds_left": 59,
  "tier": 3,
  "proposal": { ... }
}
```

**UI Behavior:**
- Display token expiry countdown
- Provide "Copy Token" button for Forge consumption
- Token auto-expires after 60 seconds
- Token is **single-use**: cannot be reused

---

## 5. DATA MODEL

### 5.1 Proposal State

```typescript
interface Proposal {
  id: string;                    // LY-PROPOSAL-...
  agent_id: string;              // prime, vera, forge, etc.
  action_type: string;           // write-report, deploy-service, etc.
  target_system: string;         // workspace:filesystem, prod:site, etc.
  justification: string;         // Human-readable justification
  amount_usd: string;           // Decimal string
  tier: 0 | 1 | 2 | 3;            // Determines signature requirements
  tier_label: string;           // "Tier 0 (Micro)", etc.
  status: string;                // PENDING, BLOCKED_BY_VERA, etc.
  proposal_hash: string;         // SHA-256 hex digest
  p_hash: string;                // Alias for proposal_hash
  
  // Lifecycle
  stage: string;                 // OBSERVE, ANALYZE, PROPOSE, HUMAN_AUTHORIZATION, EXECUTE, RECORD, REVIEW
  completed: string[];          // Completed stages
  rejected: boolean;
  awaiting_human: boolean;
  
  // Authorization
  signatures_required: number;   // 0, 1, 2, or 3
  time_lock_until: string | null; // ISO timestamp
  time_lock_active: boolean;
  veto_reason: string | null;
  override_required: number;    // 0 or 3 (for BLOCKED_BY_VERA)
  override_timelock: TimeLockStatus | null;
  
  // Token
  active_tokens: TokenInfo[];
}

interface TokenInfo {
  token: string;
  expires_at: number;            // Unix timestamp
  seconds_left: number;
}

interface TimeLockStatus {
  state: 'PENDING_TIME_LOCK' | 'EXPIRED' | 'CANCELLED';
  seconds_left: number;
  signers: string[];
}
```

### 5.2 Dashboard State

```typescript
interface DashboardState {
  // Proposals grouped by tier, then by veto status
  proposals: {
    [tier: number]: {
      normal: Proposal[];
      vera_veto: Proposal[];
    };
  };
  
  // Local signature collection (not persisted to server)
  collected_signatures: {
    [proposal_id: string]: {
      APPROVE: StewardSignature[];
      TIER_3_EMERGENCY_OVERRIDE: StewardSignature[];
      CANCEL_OVERRIDE: StewardSignature[];
    };
  };
  
  // Steward keys loaded in browser memory
  steward_keys: {
    [steward_id: string]: CryptoKey;  // Ed25519, non-extractable
  };
  
  // Recent receipts
  receipts: AuthorizationReceipt[];
  
  // Sync state
  last_sync: number;  // Unix timestamp
  sync_status: 'idle' | 'syncing' | 'error';
}

interface StewardSignature {
  steward_id: string;
  signature_b64: string;
}

interface AuthorizationReceipt {
  action: 'APPROVE' | 'REJECT' | 'OVERRIDE' | 'CANCEL';
  proposal_id: string;
  decision: string;
  tier: number;
  ledger_entry: LedgerEntry;
  verification_hash: string;
  timestamp: string;
}

interface LedgerEntry {
  index: number;
  hash: string;
  previous_hash: string;
  timestamp: string;
  data: any;
}
```

---

## 6. EDGE CASES & ERROR HANDLING

### 6.1 Time-Lock Enforcement

| Scenario | Behavior |
|----------|----------|
| Attempt to approve Tier 2 proposal within 6h of submission | **Block** with message: "Time-lock active until [timestamp]" |
| Attempt to approve Tier 3 proposal within 24h of submission | **Block** with message: "Time-lock active until [timestamp]" |
| Attempt to override Vera veto while normal time-lock is active | **Block** with message: "Cannot override: Normal time-lock still active" |
| Time-lock expires during dashboard session | Auto-refresh proposal state, enable approval buttons |

### 6.2 Signature Validation

| Scenario | Behavior |
|----------|----------|
| Steward attempts to sign with unloaded key | **Block** with message: "Load steward key first" |
| Steward attempts to sign with revoked key | Backend **rejects** with message: "Steward key [id] is revoked" |
| Duplicate signature from same steward | Backend **rejects** with message: "Duplicate signature from [id]" |
| Invalid signature (cryptographic) | Backend **rejects** with message: "Invalid signature from [id]" |
| Insufficient signatures for tier | Backend **rejects** with message: "Tier [N] needs [M] signatures; got [K]" |

### 6.3 Emergency Override Constraints

| Scenario | Behavior |
|----------|----------|
| Attempt to override with < 3 signatures | **Block** with message: "Collect 3 steward TIER_3_EMERGENCY_OVERRIDE signatures first ([N]/3)" |
| Attempt to override with duplicate stewards | **Block** at signature collection level |
| Attempt to override non-Vera-blocked proposal | **Block** with message: "Override only applies to BLOCKED_BY_VERA proposals" |
| Attempt to cancel override with < 2 signatures | **Block** with message: "Collect 2 steward CANCEL_OVERRIDE signatures first ([N]/2)" |
| Override cooling period active | Show countdown, **block** override submission until elapsed |

### 6.4 Vera Veto Handling

| Scenario | Behavior |
|----------|----------|
| New proposal blocked by Vera | Automatically move to top of tier group, show veto banner |
| Proposal unblocked by Vera | Remove from veto section, move to normal section |
| Override submitted for vetoed proposal | Show override status, start cooling timer |

### 6.5 Session & Token Handling

| Scenario | Behavior |
|----------|----------|
| Token expires (60s) | Show "Token EXPIRED", remove copy button |
| Token already used | Backend **rejects** with message: "Token already used or unknown" |
| Steward refreshes page | Local signature collection **cleared**, must re-sign |
| Steward clicks "Sync with Server" | Refresh proposal state from backend, preserve local signatures |

### 6.6 Network & Offline

| Scenario | Behavior |
|----------|----------|
| Backend unreachable | Show error banner: "Backend unreachable - offline mode" |
| Sync fails | Show error: "Sync failed: [reason]" |
| Proposal list empty | Show message: "No proposals awaiting human authorization" |

---

## 7. AUDIT TRAIL REQUIREMENTS

### 7.1 Ledger Appending

Every authorization action **MUST** append an entry to the Red Sink ledger:

- **APPROVE**: `agent_id=steward-X, decision=APPROVE, proposal_id=..., evidence_hash=proposal_hash, result=authorization token minted`
- **REJECT**: `agent_id=steward-X, decision=REJECT, proposal_id=..., evidence_hash=proposal_hash, result=rejected, reason=[reason]`
- **OVERRIDE**: `agent_id=steward-X, decision=TIER_3_EMERGENCY_OVERRIDE, proposal_id=..., evidence_hash=proposal_hash, result=override initiated`
- **CANCEL_OVERRIDE**: `agent_id=steward-X, decision=CANCEL_OVERRIDE, proposal_id=..., evidence_hash=proposal_hash, result=override cancelled`
- **KEY_REVOCATION**: `agent_id=steward-X, decision=REVOKE_KEY, target_agent=[agent_id], reason=[reason], result=session key revoked`

### 7.2 Verification Hash

After each action, compute and display:
```
verification_hash = SHA-256(
  proposal_id +
  decision +
  tier +
  steward_ids_sorted +
  timestamp_iso +
  ledger_entry_hash
)
```

This allows stewards to **independently verify** that the action they took resulted in the expected ledger state.

### 7.3 Receipt Display

The receipt displayed to the steward **MUST** include:
1. The complete ledger entry
2. The verification hash
3. A "Verify in Ledger" button that queries the backend for the entry
4. A "Copy Receipt" button that copies the full receipt JSON

---

## 8. IMPLEMENTATION CONSTRAINTS

### 8.1 Security Constraints

- **NO external APIs**: All execution is local (llama-cpp-local-runtime.ts)
- **NO steward private keys on server**: Keys remain in browser memory only
- **NO WebSockets**: Use manual sync to avoid state complexity
- **NO auto-revocation**: Agent key revocation requires explicit steward action
- **NO token persistence**: Tokens are 60-second, single-use, never stored

### 8.2 Data Constraints

- **Append-only ledger**: History cannot be overwritten
- **Cryptographic binding**: Tokens are bound to exact proposal hash
- **Quorum enforcement**: Backend enforces signature requirements, not client
- **Time-lock enforcement**: Backend enforces time-locks, not client

### 8.3 Performance Constraints

- Dashboard must render **< 500ms** for up to 100 proposals
- Sync with server must complete **< 2s** on local network
- Cryptographic operations (signing, verification) must be **< 100ms**

### 8.4 Compatibility Constraints

- **Browser**: Must support WebCrypto Ed25519 (Chrome ≥ 119, Firefox ≥ 123, Safari ≥ 17)
- **Backend**: FastAPI with Python 3.11+
- **Frontend**: Plain TypeScript/JavaScript, no external dependencies

---

## 9. API ENDPOINTS

The dashboard uses the following existing endpoints from `ui_api.py`:

### 9.1 Read Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/proposals` | List all proposals |
| GET | `/api/proposals/{pid}/signing-message?decision={decision}` | Get exact bytes to sign |
| GET | `/api/proposals/{pid}` | Get proposal details (via view function) |
| GET | `/api/stewards` | List registered stewards |
| GET | `/api/audit` | View ledger entries |
| GET | `/api/audit/verify` | Verify ledger integrity |

### 9.2 Write Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/proposals/{pid}/authorize` | Submit signatures for approval/override |
| POST | `/api/proposals/{pid}/reject` | Reject proposal with reason |
| POST | `/api/proposals/{pid}/override/cancel` | Cancel emergency override |
| POST | `/api/proposals/{pid}/token/verify` | Verify token validity |

### 9.3 Additional Endpoints (Existing)

| Method | Endpoint | Purpose |
|--------|----------|---------|
| GET | `/api/state/full` | Full system state (for sync) |
| GET | `/api/system/map` | System node status |

---

## 10. FILE STRUCTURE

```
execution_network/lake_yange/
├── ui/
│   ├── index.html          # Existing - Command Center
│   └── auth_dashboard.html # NEW - Dedicated Authorization Dashboard
├── docs/
│   └── AUTHORIZATION_DASHBOARD_SPEC.md  # This document
└── ui_api.py              # Existing - Backend API (no changes needed)

runtime/
└── auth_dashboard.ts      # NEW - Dashboard logic (if separate module)
```

### 10.1 Implementation Options

**Option A: Extend Existing index.html**
- Add new view tab: "6. AUTH DASHBOARD"
- Reuse existing session token, key loading, API client
- Minimal code duplication
- **Recommended**

**Option B: Standalone auth_dashboard.html**
- Separate file with dedicated focus
- Clean separation of concerns
- Slightly more code duplication
- Requires separate session token handling

---

## 11. ACCEPTANCE CRITERIA

### 11.1 Functional Requirements

- [ ] Dashboard loads and displays proposals grouped by tier
- [ ] Vera-blocked proposals are visually isolated within their tier
- [ ] Each proposal shows tier, status, agent, action, target, justification
- [ ] Cryptographic verification display shows hash with checksum
- [ ] "Advanced: View Raw Bytes" toggle shows full signing message
- [ ] Steward can load keys via WebCrypto (Ed25519)
- [ ] Steward can sign proposals with loaded keys
- [ ] Steward can use HSM/external signing
- [ ] Signature collection is local to browser session
- [ ] "Sync with Server" button refreshes proposal state
- [ ] Submit button sends signatures to backend
- [ ] Emergency override requires 3 signatures + cooling period
- [ ] Override cancellation requires 2 signatures
- [ ] Rejection modal has optional revocation checkbox
- [ ] Post-action receipt displays ledger entry and verification hash

### 11.2 Edge Case Requirements

- [ ] Time-lock enforcement blocks premature approvals
- [ ] Override cannot bypass active normal time-lock
- [ ] Duplicate signatures are prevented
- [ ] Revoked steward keys cannot sign
- [ ] Invalid signatures are rejected by backend
- [ ] Insufficient signatures are rejected by backend
- [ ] Token expiry is displayed and enforced
- [ ] Offline mode shows appropriate errors

### 11.3 Security Requirements

- [ ] Steward private keys never leave browser memory
- [ ] Only signatures are sent to backend
- [ ] Session token is required for all write operations
- [ ] Cross-origin writes are blocked
- [ ] Host validation enforces loopback-only (127.0.0.1, localhost)
- [ ] CSRF protection via session header

### 11.4 Audit Requirements

- [ ] Every action appends to Red Sink ledger
- [ ] Receipt displays verification hash
- [ ] Steward can verify receipt against ledger
- [ ] Ledger integrity can be verified

---

## 12. TESTING STRATEGY

### 12.1 Unit Tests

- Proposal grouping logic (tier + veto)
- Cryptographic verification (hash, checksum)
- Signature collection management
- Time-lock calculation
- Token expiry handling

### 12.2 Integration Tests

- Dashboard ↔ Backend API communication
- Key loading and signing
- Proposal state synchronization
- Ledger append verification

### 12.3 End-to-End Tests

- Complete approval flow (propose → sign → submit → verify)
- Complete rejection flow (propose → reject → verify)
- Emergency override flow (veto → override → cooling → cancel)
- Multi-steward coordination

### 12.4 Edge Case Tests

- Time-lock boundary conditions
- Signature validation failures
- Network interruption scenarios
- Browser refresh behavior

---

## 13. APPENDIX

### 13.1 Glossary

| Term | Definition |
|------|------------|
| AI | Artificial Intelligence - proposes actions |
| Agent | Autonomous system component (Prime, Vera, Forge) |
| AuthGate | Authorization gateway - validates signatures |
| CII | Cognitive Independence Index |
| Forge | Execution agent - executes approved proposals |
| HSM | Hardware Security Module - external signing device |
| Ledger | Append-only audit log (Red Sink) |
| Prime | Planning agent - proposes actions |
| Proposal | Agent's request for action |
| Red Sink | Audit ledger system |
| Steward | Human operator with authorization authority |
| Tier | Authorization level (0-3) based on action severity |
| Token | Single-use JWT authorization for Forge |
| Vera | Veto agent - audits proposals |
| WebCrypto | Browser cryptographic API |

### 13.2 Tier Definitions

| Tier | Amount Range | Signatures Required | Time-Lock | Use Case |
|------|--------------|---------------------|-----------|----------|
| 0 | < $100 | 0 (auto-approvable) | None | Micro actions |
| 1 | $100 - $1,000 | 1 | None | Minor actions |
| 2 | $1,001 - $10,000 | 2 | 6 hours | Significant actions |
| 3 | > $10,000 | 3 | 24 hours | Critical actions |

### 13.3 References

- `ARCHITECTURE.md` - System architecture overview
- `ui_api.py` - Backend API implementation
- `auth_gate.py` - Authorization gate implementation
- `three_tier_ledger.py` - Treasury ledger implementation
- `red_sink_ledger.py` - Audit ledger implementation

---

**Document Control**

| Version | Date | Author | Changes |
|---------|------|--------|---------|
| 1.0 | 2026-10-08 | Principal Staff Engineer | Initial specification |

---

*This specification is a living document. All changes must be approved by the system architect and recorded in the version history.*