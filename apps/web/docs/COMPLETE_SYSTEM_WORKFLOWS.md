# Smart Home Maintenance Services (HMS) — Complete System Architecture & Workflows

> **Executive Overview**  
> This document details the end-to-end operational, business, and financial workflows of the **Smart Home Maintenance Services (HMS)** platform as implemented in the codebase. It covers user onboarding, provider vetting, booking lifecycle, on-site execution, double-entry financial settlements, and dispute resolution with architectural diagrams.

---

## Table of Contents
1. [Platform Actors & Role Hierarchy](#1-platform-actors--role-hierarchy)
2. [Authentication & Session Architecture](#2-authentication--session-architecture)
3. [Provider Onboarding & Multi-Tier Verification](#3-provider-onboarding--multi-tier-verification)
4. [Customer Service Discovery & 6-Step Booking Flow](#4-customer-service-discovery--6-step-booking-flow)
5. [Field Execution & Job Lifecycle](#5-field-execution--job-lifecycle)
6. [Double-Entry Financial Architecture & Payouts](#6-double-entry-financial-architecture--payouts)
7. [Conduct, Penalties & Dispute Resolution](#7-conduct-penalties--dispute-resolution)
8. [End-to-End System State Machine](#8-end-to-end-system-state-machine)

---

## 1. Platform Actors & Role Hierarchy

HMS enforces strict Role-Based Access Control (RBAC) across five distinct operational roles.

```mermaid
flowchart TD
    subgraph Users["Platform Actors"]
        CU["Customer (CUSTOMER)"]
        PR["Professional / Service Provider (PROVIDER)"]
        AG["Field Verification Agent (AGENT)"]
        FI["Finance Officer (FINANCE)"]
        AD["Super Administrator (ADMIN)"]
    end

    subgraph Portals["Dedicated Workspaces"]
        CUP["Customer Portal (/account/*)"]
        PRP["Provider Portal (/provider/*)"]
        AGP["Field Agent Workspace (/agent/*)"]
        FIP["Finance Treasury (/finance/*)"]
        ADP["Admin Control Plane (/admin/*)"]
    end

    CU -->|Books services, manages addresses & receipts| CUP
    PR -->|Accepts jobs, configures slots & requests payouts| PRP
    AG -->|Verifies credentials, checks CNIC & physical audits| AGP
    FI -->|Reconciles cash debts, processes escrow & batch payouts| FIP
    AD -->|Manages catalogue, resolves disputes, enforces strikes| ADP
```

---

## 2. Authentication & Session Architecture

Authentication is secured via password hashing with **Argon2id**, multi-factor **TOTP 2FA**, and **httpOnly SameSite cookies** to prevent XSS and CSRF token extraction.

```mermaid
sequenceDiagram
    autonumber
    actor User as Visitor / User
    participant Web as Next.js Web App
    participant API as NestJS API Gateway
    participant DB as PostgreSQL Database

    User->>Web: Submits Phone, Email, Password & Name (/auth/register)
    Web->>API: POST /api/v1/auth/register
    API->>DB: Check uniqueness & hash password (Argon2id)
    API->>DB: Store pending verification with 6-digit OTP
    API-->>Web: 201 Created (OTP Dispatched via SMS/Email)

    User->>Web: Enters 6-digit OTP code (/auth/verify)
    Web->>API: POST /api/v1/auth/verify { target, code }
    API->>DB: Validate OTP hash & expiry (10 min TTL)
    API->>API: Generate Access Token (JWT 15m) & Refresh Token (7d)
    API-->>Web: Set-Cookie: refreshToken (httpOnly, Secure, SameSite=Lax)<br/>Body: { accessToken, user }
    Web-->>User: Redirect to Role Workspace (/account, /provider, etc.)
```

---

## 3. Provider Onboarding & Multi-Tier Verification

To ensure customer safety and trade excellence, service providers undergo strict background checks before their services can be published.

```mermaid
flowchart TD
    A["Provider Registers (/auth/register)"] --> B["Profile Created: Status PENDING"]
    B --> C["Upload Legal Documents (/provider/documents)"]
    
    subgraph Docs["Mandatory Documents"]
        C1["CNIC Scan (Front + Back) + 13-Digit Number"]
        C2["Police Character Certificate"]
        C3["Trade / Technical Certification"]
    end
    C --> Docs
    Docs --> D["Submit for Verification"]

    D --> E["Verification Agent Assigned (/agent/attempts)"]
    E --> F{"Field / Document Audit"}
    
    F -->|Incomplete / Invalid| G["Mark REJECTED with Reason"]
    G --> C
    
    F -->|Verified & GPS Check Passed| H["Agent Approves & Issues Token"]
    H --> I["Admin Final Activation"]
    I --> J["Provider Status: ACTIVE"]
    
    subgraph Setup["Post-Activation Configuration"]
        J --> K["Select Coverage Areas (/provider/areas)"]
        J --> L["Bind Catalogue Services & Rates (/provider/services)"]
        J --> M["Configure Calendar & Operating Slots (/provider/calendar)"]
    end
```

---

## 4. Customer Service Discovery & 6-Step Booking Flow

Customers can explore trade services with transparent pricing, instant booking guarantees, and an intelligent provider selection model.

```mermaid
sequenceDiagram
    autonumber
    actor Cust as Customer
    participant Web as Discovery & Booking Flow
    participant API as Search & Booking Engine
    participant DB as PostgreSQL / PostGIS

    Cust->>Web: Visits /services or /providers
    Web->>API: GET /catalogue/services & GET /catalogue/categories
    API-->>Web: Active catalogue, prices, warranty days & Cloudinary media
    Cust->>Web: Selects Service -> Enters 6-Step Booking Flow (/book/[slug])

    rect rgb(240, 248, 255)
    Note over Web: Step 1: Address Selection
    Cust->>Web: Selects saved address or pinpoints location
    Web->>API: Resolves GPS coordinates (Lat/Lng) & Area ID
    end

    rect rgb(255, 250, 240)
    Note over Web: Step 2: Provider Choice
    Cust->>Web: Selects 'Auto-Assign' OR picks 'Named Professional'
    Web->>API: GET /search/providers (Finds eligible & verified providers)
    end

    rect rgb(245, 255, 250)
    Note over Web: Step 3: Scheduling
    Cust->>Web: Selects Available Date & 2-Hour Time Slot
    end

    rect rgb(255, 245, 245)
    Note over Web: Step 4: Problem Scope & Evidence
    Cust->>Web: Chooses issue checklist + uploads initial damage photos
    end

    rect rgb(250, 240, 255)
    Note over Web: Step 5: Server Quote
    Web->>API: POST /bookings/quote
    API-->>Web: Authoritative price calculation (Base + Surcharge + Emergency fee)
    end

    rect rgb(240, 255, 255)
    Note over Web: Step 6: Payment & Confirmation
    Cust->>Web: Chooses Payment Mode: ONLINE (Escrow) vs CASH (On Completion)
    Web->>API: POST /bookings (Creates Booking)
    API->>DB: Persist booking in status 'CONFIRMED' or 'REQUESTED'
    API-->>Web: 201 Booking Created
    Web-->>Cust: Redirects to /account/bookings/[id] with Live Tracker
    end
```

---

## 5. Field Execution & Job Lifecycle

The core service execution ensures customer safety via secure **Start Codes**, mandatory before/after **photographic checklists**, and transparent **quote revisions**.

```mermaid
stateDiagram-v2
    [*] --> REQUESTED: Customer Places Booking
    REQUESTED --> CONFIRMED: Provider Accepts Broadcast Offer
    
    CONFIRMED --> EN_ROUTE: Professional Dispatches ("Mark En Route")
    note right of EN_ROUTE
        Live geolocation broadcasted 
        to customer tracking screen
    end note
    
    EN_ROUTE --> ARRIVED: Professional Arrives at Customer Location
    ARRIVED --> IN_PROGRESS: Customer Provides 6-Digit Start Code
    note right of IN_PROGRESS
        Start code verification proves
        physical presence before job timer starts
    end note
    
    IN_PROGRESS --> QUOTE_REVISION: Scope Expansion (Unexpected Faults)
    QUOTE_REVISION --> IN_PROGRESS: Customer Accepts Price Diff
    QUOTE_REVISION --> CANCELLED: Customer Rejects Expansion
    
    IN_PROGRESS --> COMPLETED: Provider Finishes Work & Uploads After-Photos
    COMPLETED --> CLOSED: Customer Approves & Funds Released
    CLOSED --> [*]
```

### The On-Site Verification Handshake
1. **En Route State**: Provider updates status to `EN_ROUTE`. Customer sees real-time status and estimated arrival window.
2. **Start Code Verification**: Upon arrival, the customer sees an on-screen **6-Digit Start Code** on `/account/bookings/[id]`. The technician cannot begin the timer or work until this code is entered on `/provider/jobs/[id]`, preventing phantom check-ins.
3. **Pre-Service Checklist & Photos**: The technician photographs the faulty fixture/leak before making modifications.
4. **Post-Service Proof**: After completing the repair, the technician uploads completion photographs and completes the trade checklist.

---

## 6. Double-Entry Financial Architecture & Payouts

All monetary movements inside HMS are governed by double-entry ledger bookkeeping (`packages/domain/ledger`), preventing phantom balances and reconciliation discrepancies.

```mermaid
flowchart TD
    subgraph EscrowManagement["Payment Inflow & Escrow"]
        PAY["Customer Pays (ONLINE or CASH)"]
        PAY -->|ONLINE| ESCROW["Held in Platform Escrow Account"]
        PAY -->|CASH| CASH_RCV["Cash Received Directly by Provider"]
    end

    subgraph JobSettlement["Job Completion Trigger"]
        COMP["Job Marked COMPLETED"]
        ESCROW --> COMP
        CASH_RCV --> COMP
    end

    subgraph LedgerBooking["Double-Entry Ledger Engine"]
        COMP --> LEDGER["Post Ledger Journal Entries"]
        LEDGER -->|Credit| COMM["Platform Commission Revenue (e.g., 15%)"]
        LEDGER -->|Credit| PROV_BAL["Provider Releasable Balance (85%)"]
        LEDGER -->|Debit (If Cash)| DEBT["Provider Platform Debt Created"]
    end

    subgraph PayoutWorkflow["Provider Payout & Reconciliation"]
        PROV_BAL --> REQ["Provider Requests Payout (/provider/payouts)"]
        REQ --> BATCH["Finance Aggregates Weekly Batch (/finance/payout-batches)"]
        DEBT -->|Deducted from Batch| BATCH
        BATCH --> BANK["Dispatched to Provider Bank / 1Link IBAN"]
    end
```

### Financial Rules & Balances
- **Online Bookings**: Funds are captured into platform escrow. Upon completion, net earnings are automatically moved into `Releasable Balance`.
- **Cash Bookings**: The customer pays the full amount in cash to the provider. The platform logs a `Cash Debt` for the platform commission. This debt is offset against the provider’s future online earnings or cleared via direct payment.
- **Batched Payouts**: The Finance department reviews aggregated payout batches, verifying compliance and deduction rules before executing wire transfers.

---

## 7. Conduct, Penalties & Dispute Resolution

To protect platform integrity, customer complaints and provider conduct are strictly monitored through an algorithmic penalty and strike system.

```mermaid
sequenceDiagram
    autonumber
    actor Cust as Customer
    participant Portal as HMS Complaint Center
    actor Prov as Provider
    actor Admin as Admin Dispute Panel

    Cust->>Portal: Files Complaint / Dispute (/complaints) with Evidence Photos
    Portal->>Portal: Temporarily holds Escrow / Payout for Booking
    Portal->>Prov: Notifies Provider & Opens 7-Day "Right of Reply" window
    
    alt Provider Responds
        Prov->>Portal: Submits Official Explanation & Defense Proof
    else Window Expires
        Portal->>Portal: Auto-forfeits provider right of reply
    end

    Portal->>Admin: Escrow dispute queued for arbitration (/admin/disputes)
    Admin->>Admin: Inspects photos, Start Code logs & GPS timestamps
    
    alt Customer Wins (Faulty Work)
        Admin->>Portal: Rules in Customer Favor: Full/Partial Refund
        Portal->>Cust: Refund processed to original payment method
        Admin->>Prov: Issues Conduct Strike & Deduction from earnings
    else Provider Wins (False Claim)
        Admin->>Portal: Dismisses complaint
        Portal->>Prov: Releases held escrow to provider balance
    end
```

### Strike & Penalty Rules
- **No-Show / Late Cancellation**: Provider incurs immediate strike points.
- **Safety Violation**: Instant suspension pending review by the operations team.
- **Threshold Block**: Reaching threshold points automatically prevents the provider from appearing in discovery or receiving broadcast job offers.

---

## 8. End-to-End System State Machine

The unified lifecycle diagram illustrating how data transitions across Customer, Provider, Agent, and Finance roles:

```mermaid
flowchart TD
    %% Roles Styling
    classDef cust fill:#e0f2fe,stroke:#0284c7,stroke-width:2px;
    classDef prov fill:#ecfdf5,stroke:#059669,stroke-width:2px;
    classDef admin fill:#fef3c7,stroke:#d97706,stroke-width:2px;
    classDef fin fill:#f3e8ff,stroke:#9333ea,stroke-width:2px;

    %% Onboarding
    Start((New User)) --> Reg["Register & Verify OTP"]:::cust
    Reg --> Choice{User Role?}
    
    %% Provider Flow
    Choice -->|Provider| P_Docs["Upload CNIC & Trade Docs"]:::prov
    P_Docs --> P_Audit["Field Agent Physical Audit"]:::admin
    P_Audit --> P_Active["Account Activated & Slots Configured"]:::prov
    
    %% Customer Flow
    Choice -->|Customer| C_Browse["Browse Services & Providers"]:::cust
    C_Browse --> C_Book["Configure 6-Step Booking"]:::cust
    C_Book --> C_Pay{Payment Mode}
    C_Pay -->|Online| C_Escrow["Funds Held in Escrow"]:::fin
    C_Pay -->|Cash| C_PendingCash["Cash on Completion"]:::cust
    
    %% Matching & Job
    C_Escrow --> Match["Job Match / Offer Broadcast"]:::prov
    C_PendingCash --> Match
    Match --> P_Accept["Provider Accepts Booking"]:::prov
    P_Active -.-> Match
    
    %% Execution
    P_Accept --> EnRoute["Professional En Route"]:::prov
    EnRoute --> Arrived["Arrival & Start Code Verification"]:::cust
    Arrived --> Working["Checklist & Repair In Progress"]:::prov
    Working --> Done["Upload Post-Repair Photos & Mark Complete"]:::prov
    
    %% Settlement
    Done --> Review["Customer Review & Rating"]:::cust
    Done --> Settlement["Ledger Double-Entry Allocation"]:::fin
    Settlement --> Payout["Bank Batch Payout Execution"]:::fin
    
    %% Completion
    Review --> EndNode(((Booking Closed)))
    Payout --> EndNode
```

---

## 9. Key API Endpoints & Route Mapping

| Workflow Stage | Frontend Route | Backend REST Endpoint | Primary Contract / DTO |
| :--- | :--- | :--- | :--- |
| **Authentication** | `/auth/sign-in`, `/auth/register` | `POST /api/v1/auth/login`, `POST /api/v1/auth/verify` | `LoginSchema`, `OtpVerifySchema` |
| **Provider Vetting** | `/provider/documents` | `POST /api/v1/provider/documents` | `DocumentUploadDto` |
| **Agent Verification** | `/agent/attempts`, `/verification/[token]`| `POST /api/v1/agent/attempts` | `VerificationAttemptDto` |
| **Catalogue & Search**| `/services`, `/providers` | `GET /api/v1/catalogue/services`, `GET /api/v1/search/providers` | `ProviderSearchQueryDto` |
| **Booking Flow** | `/book/[slug]` | `POST /api/v1/bookings/quote`, `POST /api/v1/bookings` | `BookingQuoteInput`, `CreateBookingDto` |
| **Job Execution** | `/provider/today`, `/provider/jobs/[id]` | `PATCH /api/v1/provider/bookings/:id/status`, `POST /api/v1/provider/bookings/:id/start-code` | `StartCodeVerificationDto` |
| **Customer Tracking** | `/track`, `/account/bookings/[id]` | `GET /api/v1/bookings/:id`, `GET /api/v1/bookings/:id/tracker` | `BookingDetailDto` |
| **Finance & Ledger** | `/finance/payout-batches`, `/finance/ledger` | `POST /api/v1/finance/payout-batches`, `GET /api/v1/finance/ledger` | `CreatePayoutBatchDto` |
| **Disputes & Conduct**| `/admin/disputes`, `/provider/conduct` | `POST /api/v1/complaints`, `PATCH /api/v1/admin/disputes/:id/resolve` | `DisputeResolutionDto` |

---

*Document generated and verified against the live HMS repository schemas, Prisma migrations, NestJS controllers, and Next.js Turbopack client applications.*
