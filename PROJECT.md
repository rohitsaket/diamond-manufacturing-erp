# Diamond Manufacturing ERP — Project Documentation

> **DiamondMatrix ERP v2.0** — A full-stack production ERP for diamond manufacturing, covering lot tracking, payroll, HRMS, compliance, and enterprise reporting.

---

## 📋 Table of Contents

1. [Project Overview](#project-overview)
2. [Architecture](#architecture)
3. [Tech Stack](#tech-stack)
4. [Directory Structure](#directory-structure)
5. [Database Schema](#database-schema)
6. [Core Domain Concepts](#core-domain-concepts)
7. [API Routes](#api-routes)
8. [Frontend Pages](#frontend-pages)
9. [Authentication & Authorization](#authentication--authorization)
10. [Development Workflow](#development-workflow)
11. [Deployment](#deployment)
12. [Environment Configuration](#environment-configuration)

---

## 🎯 Project Overview

**Diamond Manufacturing ERP** is a specialized ERP system designed for diamond manufacturing facilities. It handles the complete lifecycle of diamond lots — from issuance to workers through polishing, verification, and final yield calculation — while integrating payroll, HR, attendance, statutory compliance, and enterprise reporting.

### Key Capabilities

| Module            | Description                                                                                      |
| ----------------- | ------------------------------------------------------------------------------------------------ |
| **Manufacturing** | Lot issuance, tracking, receipt, verification, yield analysis, leakage detection                 |
| **Rate Cards**    | Dynamic per-carat rates by shape category, lab, carat range with audit trail                     |
| **Payroll**       | Period-based salary computation, multi-level verification, loan management, statutory deductions |
| **HRMS**          | Employee lifecycle, attendance (device + face + QR), leave, advances, recruitment, engagement    |
| **Compliance**    | PF, ESI, PT, TDS challans, Form 16, compliance calendar, audit trails                            |
| **Organization**  | Units, places, job architecture, governance, finance mapping                                     |
| **Dashboards**    | Real-time KPIs, floor exceptions, payroll pending, HR analytics                                  |

---

## 🏗️ Architecture

### High-Level Diagram

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                              CLIENT (Browser)                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  React 19 + Vite + Tailwind CSS 4                                    │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │Dashboard │ │ FloorMgr │ │MasterLedg│ │Employees │ │ Payroll  │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  │  ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐ ┌──────────┐  │    │
│  │  │Attendance│ │   HR     │ │Recruitmnt│ │Compliance│ │  Org     │  │    │
│  │  └──────────┘ └──────────┘ └──────────┘ └──────────┘ └──────────┘  │    │
│  │  State: React Context (AuthContext, AppContext)                      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ HTTPS / REST API
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            API SERVER (Express)                              │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  Express 4 + TypeScript                                              │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │    │
│  │  │ Auth   │ │Dashboard│ │ Floor  │ │ Ledger │ │Employee│ │Payroll │  │    │
│  │  └────────┘ └────────┘ └────────┘ └────────┘ └────────┘ └────────┘  │    │
│  │  ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐ ┌────────┐  │    │
│  │  │Compens.│ │Statutory│ │Compliance│ │RateCard│ │Attend. │ │ Leave  │  │    │
│  │  └────────┘ └────────┘ └──────────┘ └────────┘ └────────┘ └────────┘  │    │
│  │  Middleware: helmet, cors, JWT auth, errorHandler, multer upload      │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└──────────────────────────────────┬──────────────────────────────────────────┘
                                   │ MySQL Protocol
                                   ▼
┌─────────────────────────────────────────────────────────────────────────────┐
│                            DATABASE (MySQL 8)                                │
│  ┌─────────────────────────────────────────────────────────────────────┐    │
│  │  76 Migrations — Core + HRMS + Enterprise Payroll + Compliance      │    │
│  │  Connection Pool (10 connections, keep-alive, utf8mb4, UTC)         │    │
│  └─────────────────────────────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────────────────────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    ▼                             ▼
            ┌───────────────┐             ┌───────────────┐
            │   Redis       │             │  BullMQ       │
            │   (Queue)     │             │  (Jobs)       │
            └───────────────┘             └───────────────┘
```

### Layered Architecture (Backend)

```
src/
├── config/          # Environment, database pool
├── controllers/     # HTTP request handlers (23 controllers)
├── services/        # Business logic (40+ services)
├── repositories/    # Data access layer (35+ repositories)
├── routes/          # Route definitions (23 route modules)
├── middleware/      # Auth, error handling, upload
├── database/        # Migrations, seeders
├── types/           # TypeScript interfaces
├── utils/           # Helpers
├── app.ts           # Express app setup
└── server.ts        # Entry point
```

**Request Flow:**
```
HTTP Request
    │
    ▼
Middleware (helmet → cors → json → auth)
    │
    ▼
Route → Controller
    │
    ▼
Service (business logic, orchestration)
    │
    ▼
Repository (SQL queries)
    │
    ▼
MySQL Pool
    │
    ▼
Response ← Controller ← Service ← Repository
```

---

## 🛠️ Tech Stack

### Backend

| Category  | Technology              | Version    |
| --------- | ----------------------- | ---------- |
| Runtime   | Node.js                 | 20+        |
| Language  | TypeScript              | 5.7        |
| Framework | Express                 | 4.21       |
| Database  | MySQL                   | 8.0        |
| DB Driver | mysql2/promise          | 3.12       |
| Auth      | jsonwebtoken + bcryptjs | 9.0 / 2.4  |
| Queue     | BullMQ + ioredis        | 6.0 / 6.0  |
| Email     | Nodemailer              | 9.0        |
| PDF       | pdfkit                  | 0.19       |
| QR Code   | qrcode                  | 1.5        |
| Security  | helmet, cors            | 8.0 / 2.8  |
| Dev Tools | tsx, typescript         | 4.19 / 5.7 |

### Frontend

| Category  | Technology           | Version   |
| --------- | -------------------- | --------- |
| Framework | React                | 19.2      |
| Build     | Vite                 | 7.3       |
| Language  | TypeScript           | 5.9       |
| Styling   | Tailwind CSS         | 4.1       |
| Charts    | Recharts             | 3.9       |
| Animation | Framer Motion        | 12.42     |
| Icons     | Lucide React         | 1.22      |
| Utils     | clsx, tailwind-merge | 2.1 / 3.4 |

### Shared

| Category  | Technology                   |
| --------- | ---------------------------- |
| Types     | TypeScript interfaces        |
| Constants | Shared enums & config values |

---

## 📁 Directory Structure

```
diamond-manufacturing-erp/
├── backend/
│   ├── package.json
│   ├── tsconfig.json
│   └── src/
│       ├── app.ts                 # Express app factory
│       ├── server.ts              # Entry point
│       ├── config/
│       │   ├── env.ts             # Environment config
│       │   └── database.ts        # MySQL pool
│       ├── controllers/           # 23 controllers
│       │   ├── AdvanceController.ts
│       │   ├── AttendanceController.ts
│       │   ├── AttendanceEnterpriseController.ts
│       │   ├── AuthController.ts
│       │   ├── CandidateController.ts
│       │   ├── CompensationController.ts
│       │   ├── ComplianceController.ts
│       │   ├── DashboardController.ts
│       │   ├── DocumentController.ts
│       │   ├── EmployeeController.ts
│       │   ├── EngagementController.ts
│       │   ├── EssController.ts
│       │   ├── FloorController.ts
│       │   ├── HrDashboardController.ts
│       │   ├── LeaveController.ts
│       │   ├── LedgerController.ts
│       │   ├── NotificationController.ts
│       │   ├── OrganizationController.ts
│       │   ├── PayrollAdminController.ts
│       │   ├── PayrollController.ts
│       │   ├── PayrollLoanController.ts
│       │   ├── PayrollRunController.ts
│       │   ├── ProfileController.ts
│       │   ├── RateCardController.ts
│       │   └── StatutoryController.ts
│       ├── services/              # 40+ services
│       │   ├── AdvanceService.ts
│       │   ├── AttendanceAnalyticsService.ts
│       │   ├── AttendanceComplianceService.ts
│       │   ├── AttendanceDeviceService.ts
│       │   ├── AttendanceLiveService.ts
│       │   ├── AttendancePolicyService.ts
│       │   ├── AttendanceReportService.ts
│       │   ├── AttendanceRequestService.ts
│       │   ├── AttendanceService.ts
│       │   ├── AuthService.ts
│       │   ├── BankPaymentService.ts
│       │   ├── CalendarService.ts
│       │   ├── CandidateService.ts
│       │   ├── ChallanService.ts
│       │   ├── CompensationService.ts
│       │   ├── ComplianceAnalyticsService.ts
│       │   ├── ComplianceAuditService.ts
│       │   ├── ComplianceCalendarService.ts
│       │   ├── ComplianceCheckService.ts
│       │   ├── DashboardAggregateService.ts
│       │   ├── DashboardService.ts
│       │   ├── DocumentAdminService.ts
│       │   ├── DocumentService.ts
│       │   ├── EmailService.ts
│       │   ├── EmployeeDocumentService.ts
│       │   ├── EmployeeService.ts
│       │   ├── EngagementService.ts
│       │   ├── EssAccountService.ts
│       │   ├── FaceRecognitionProvider.ts
│       │   ├── FloorService.ts
│       │   ├── Form16Service.ts
│       │   ├── JobQueueService.ts
│       │   ├── LeaveService.ts
│       │   ├── LedgerService.ts
│       │   ├── NotificationService.ts
│       │   ├── OrgAnalyticsService.ts
│       │   ├── OrganizationService.ts
│       │   ├── PayAwardService.ts
│       │   ├── PayrollAnalyticsService.ts
│       │   ├── PayrollApprovalService.ts
│       │   ├── PayrollCalculationService.ts
│       │   ├── PayrollEngineV2Service.ts
│       │   ├── PayrollLoanService.ts
│       │   ├── PayrollService.ts
│       │   ├── PayslipService.ts
│       │   ├── ProfileService.ts
│       │   ├── PunchEngineService.ts
│       │   ├── QrTokenService.ts
│       │   ├── RateCardService.ts
│       │   ├── RegulatoryFilingService.ts
│       │   ├── SchedulingService.ts
│       │   ├── SearchService.ts
│       │   ├── StatutoryContributionService.ts
│       │   ├── TaxCalculatorService.ts
│       │   ├── TaxComputationService.ts
│       │   ├── TaxDeclarationService.ts
│       │   ├── TaxProofService.ts
│       │   └── VisitorService.ts
│       ├── repositories/          # 35+ repositories
│       │   ├── ActivityRepository.ts
│       │   ├── AdvanceRepository.ts
│       │   ├── ApprovalRepository.ts
│       │   ├── AttendanceAnalyticsRepository.ts
│       │   ├── AttendanceAuditRepository.ts
│       │   ├── AttendanceComplianceRepository.ts
│       │   ├── AttendanceCredentialRepository.ts
│       │   ├── AttendanceDayRepository.ts
│       │   ├── AttendanceDeviceRepository.ts
│       │   ├── AttendancePolicyRepository.ts
│       │   ├── AttendancePunchRepository.ts
│       │   ├── AttendanceRepository.ts
│       │   ├── AttendanceRequestRepository.ts
│       │   ├── BankPaymentRepository.ts
│       │   ├── BaseRepository.ts
│       │   ├── CandidateRepository.ts
│       │   ├── CompensationRepository.ts
│       │   ├── ComplianceRepository.ts
│       │   ├── ContributionRepository.ts
│       │   ├── DashboardLayoutRepository.ts
│       │   ├── DocumentRepository.ts
│       │   ├── EmployeeDocumentRepository.ts
│       │   ├── EmployeeRepository.ts
│       │   ├── EngagementRepository.ts
│       │   ├── FilingRepository.ts
│       │   ├── HolidayRepository.ts
│       │   ├── LabourHeadRepository.ts
│       │   ├── LeaveRepository.ts
│       │   ├── LotRepository.ts
│       │   ├── NotificationRepository.ts
│       │   ├── OrganizationRepository.ts
│       │   ├── PayAwardRepository.ts
│       │   ├── PayrollAnalyticsRepository.ts
│       │   ├── PayrollLoanRepository.ts
│       │   ├── PayrollMasterRepository.ts
│       │   ├── PayrollRunRepository.ts
│       │   ├── ProfileRepository.ts
│       │   ├── RateCardRepository.ts
│       │   ├── SalaryLineRepository.ts
│       │   ├── SalaryPeriodRepository.ts
│       │   ├── SchedulingRepository.ts
│       │   ├── SettingRepository.ts
│       │   ├── ShapeRepository.ts
│       │   ├── ShiftRepository.ts
│       │   ├── StatutoryRepository.ts
│       │   ├── TaxDeclarationRepository.ts
│       │   ├── TaxProofRepository.ts
│       │   ├── UserRepository.ts
│       │   └── VisitorRepository.ts
│       ├── routes/                # 23 route modules
│       │   ├── index.ts           # Main router
│       │   ├── auth.routes.ts
│       │   ├── dashboard.routes.ts
│       │   ├── floor.routes.ts
│       │   ├── ledger.routes.ts
│       │   ├── employee.routes.ts
│       │   ├── payroll.routes.ts
│       │   ├── compensation.routes.ts
│       │   ├── payroll-loans.routes.ts
│       │   ├── payroll-runs.routes.ts
│       │   ├── payroll-admin.routes.ts
│       │   ├── statutory.routes.ts
│       │   ├── compliance.routes.ts
│       │   ├── rate-card.routes.ts
│       │   ├── attendance.routes.ts
│       │   ├── leave.routes.ts
│       │   ├── advance.routes.ts
│       │   ├── candidate.routes.ts
│       │   ├── engagement.routes.ts
│       │   ├── hr-dashboard.routes.ts
│       │   ├── notification.routes.ts
│       │   ├── ess.routes.ts
│       │   ├── profile.routes.ts
│       │   ├── document.routes.ts
│       │   └── organization.routes.ts
│       ├── middleware/
│       │   ├── auth.ts            # JWT verification
│       │   ├── errorHandler.ts    # Global error handler
│       │   └── upload.ts          # Multer config
│       ├── database/
│       │   ├── migrate.ts         # Migration runner
│       │   ├── seed.ts            # Seeder runner
│       │   ├── migrations/        # 76 SQL files
│       │   └── seeders/           # Seed data
│       ├── types/                 # TypeScript types
│       └── utils/                 # Helpers
├── frontend/
│   ├── package.json
│   ├── tsconfig.json
│   ├── vite.config.ts
│   ├── index.html
│   └── src/
│       ├── api/                   # API client
│       ├── app/
│       │   └── App.tsx            # Main app with routing
│       ├── components/
│       │   ├── layout/            # Sidebar, Header
│       │   ├── ui/                # Reusable UI components
│       │   └── charts/            # Chart components
│       ├── contexts/
│       │   ├── AuthContext.tsx    # Auth state
│       │   └── AppContext.tsx     # Global app data (lots, periods, lines)
│       ├── constants/             # Frontend constants
│       ├── data/                  # Mock data, static data
│       ├── hooks/                 # Custom React hooks
│       ├── pages/                 # 20+ page components
│       │   ├── Attendance/
│       │   ├── Compliance/
│       │   ├── Dashboard/
│       │   ├── Documents/
│       │   ├── EmployeeProfile/
│       │   ├── Employees/
│       │   ├── FloorManager/
│       │   ├── HR/
│       │   ├── HRDashboard/
│       │   ├── Login/
│       │   ├── MasterData/
│       │   ├── MasterLedger/
│       │   ├── Organization/
│       │   ├── Payroll/
│       │   ├── PayrollEnterprise/
│       │   ├── RateCard/
│       │   └── Recruitment/
│       ├── styles/                # Global styles, Tailwind
│       ├── types/                 # Frontend types
│       └── vite-env.d.ts
├── shared/
│   ├── constants/
│   │   └── index.ts               # YIELD_TARGET_PCT, LOT_SLA_DAYS, etc.
│   ├── enums/
│   ├── types/
│   │   └── index.ts               # Shared TypeScript interfaces
│   └── utils/
├── database/
│   ├── connection/
│   ├── migrations/                # 76 SQL migration files
│   ├── schema/
│   └── seeders/
├── storage/
│   ├── exports/
│   ├── logs/
│   └── uploads/                   # Uploaded files (CSV, TXT)
├── scripts/
├── docs/
├── package.json                   # Root scripts
├── commit-exec-dash.bat
├── git-push-executive-dashboard.ps1
├── simple-commit.ps1
└── temp-git-commit.bat
```

---

## 🗄️ Database Schema

### Migration Timeline (76 Migrations)

| Phase                     | Migrations | Description                                                                                                                                                                                                                                               |
| ------------------------- | ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Core Manufacturing**    | 001–011    | Users, employees, labour heads, shapes, lots, rate cards, salary periods/lines, settings, migration tracker                                                                                                                                               |
| **HRMS Foundation**       | 012–020    | Shifts, leave types, holidays, attendance records, leave requests, advances, employee HRMS fields, documents                                                                                                                                              |
| **Extended HRMS**         | 021–044    | Candidates, ESS users, notifications, activity logs, announcements, tasks, tickets, expenses, assets, dashboard layouts, trainings, profile fields (family, education, skills, certifications, languages, experience, timeline), document categories, DMS |
| **Organization**          | 045–051    | Organization core, units, places, finance, job architecture, employee org links, governance                                                                                                                                                               |
| **Enterprise Attendance** | 052–059    | Attendance policies, shifts/scheduling, devices, location credentials, punches, enterprise attendance records, requests, breaks/overtime                                                                                                                  |
| **Compliance & Visitors** | 060        | Visitors, compliance audit                                                                                                                                                                                                                                |
| **Enterprise Payroll**    | 061–070    | Pay components, employee salary, pay cycles/runs, enterprise salary lines, tax management, variable pay, loans/reimbursements, settlements/benefits, bank/currency, payroll governance                                                                    |
| **Statutory Compliance**  | 071–076    | Statutory registrations, rules, contribution ledger, challans/filings, Form 16/proofs, compliance governance                                                                                                                                              |

### Key Tables

| Table                     | Purpose                                                           |
| ------------------------- | ----------------------------------------------------------------- |
| `users`                   | System users (admin, managers, HR)                                |
| `employees`               | Worker master data (empCode, grade, workerType, specialist, etc.) |
| `labour_heads`            | Manufacturing operations (Blocking, Polishing, etc.)              |
| `shapes`                  | Diamond shapes with category (ROUND/FANCY/BLOCKING)               |
| `lots`                    | **Core** — Diamond parcels issued to workers                      |
| `rate_card_rows`          | Per-carat rates by shape category, lab, carat range               |
| `salary_periods`          | Monthly pay periods (OPEN/LOCKED/PAID)                            |
| `salary_lines`            | Computed salary per employee per period                           |
| `attendance_records`      | Daily attendance (enterprise)                                     |
| `attendance_punches`      | Raw punch in/out from devices                                     |
| `leave_requests`          | Leave applications                                                |
| `advances`                | Salary advances                                                   |
| `pay_components`          | Earning/deduction components                                      |
| `employee_salary`         | Employee salary structure                                         |
| `pay_cycles` / `pay_runs` | Payroll processing cycles                                         |
| `statutory_registrations` | PF, ESI, PT registrations                                         |
| `contribution_ledger`     | Statutory contribution records                                    |
| `challans` / `filings`    | Challan generation & filing                                       |
| `organization_units`      | Departments, divisions                                            |
| `job_architecture`        | Grades, bands, designations                                       |

---

## 💎 Core Domain Concepts

### Lot Lifecycle

```
ISSUED → IN_PROGRESS → RECEIVED → VERIFIED
                    ↘ REWORK
                    ↘ LOST
```

| Status        | Description                                |
| ------------- | ------------------------------------------ |
| `ISSUED`      | Lot assigned to worker, not yet started    |
| `IN_PROGRESS` | Worker actively polishing                  |
| `RECEIVED`    | Worker returned lot, awaiting verification |
| `VERIFIED`    | QC passed, yield calculated                |
| `REWORK`      | Failed QC, sent back for re-polishing      |
| `LOST`        | Lot lost/damaged                           |

### Rate Card Structure

```
RateCardRow {
  shapeCategory: 'ROUND' | 'FANCY' | 'BLOCKING'
  lab: 'IGI' | 'GIA' | 'ANY'
  ctsMin: number      // Inclusive lower bound
  ctsMax: number      // Inclusive upper bound
  ratePerCt: number   // Rate per carat
  effectiveFrom: date // Rate validity
}
```

### Worker Types

| Type         | Description                        |
| ------------ | ---------------------------------- |
| `PIECE_RATE` | Paid per carat produced            |
| `DHAR`       | Daily hire rate (fixed daily wage) |
| `MAXI`       | Maximum rate category              |

### Salary Period States

```
OPEN → LOCKED → PAID
```

- **OPEN**: Lines can be edited, lots can be added
- **LOCKED**: No changes, verification in progress
- **PAID**: Disbursed, immutable

### Verification Flow (Salary Lines)

```
Created → Manager Verified → Account Verified → PAID
```

Both `managerVerified` and `accountVerified` must be `true` before payment.

---

## 🔌 API Routes

All routes prefixed with `/api`

### Authentication
| Method | Endpoint        | Description          |
| ------ | --------------- | -------------------- |
| POST   | `/auth/login`   | User login           |
| POST   | `/auth/refresh` | Refresh access token |
| GET    | `/auth/me`      | Current user profile |

### Manufacturing
| Method | Endpoint                  | Description        |
| ------ | ------------------------- | ------------------ |
| GET    | `/dashboard/kpis`         | Manufacturing KPIs |
| GET    | `/floor/lots`             | Floor lot board    |
| GET    | `/floor/lots/:id`         | Lot details        |
| POST   | `/floor/lots/:id/receive` | Receive lot        |
| POST   | `/floor/lots/:id/verify`  | Verify lot         |
| GET    | `/ledger`                 | Master ledger view |

### Employees
| Method | Endpoint              | Description      |
| ------ | --------------------- | ---------------- |
| GET    | `/employees`          | List employees   |
| POST   | `/employees`          | Create employee  |
| GET    | `/employees/:id`      | Employee details |
| PUT    | `/employees/:id`      | Update employee  |
| GET    | `/employees/:id/lots` | Employee's lots  |

### Payroll
| Method | Endpoint                                            | Description             |
| ------ | --------------------------------------------------- | ----------------------- |
| GET    | `/payroll/periods`                                  | Salary periods          |
| GET    | `/payroll/periods/:id/lines`                        | Salary lines for period |
| POST   | `/payroll/periods/:id/lines/:lineId/verify`         | Manager verify          |
| POST   | `/payroll/periods/:id/lines/:lineId/account-verify` | Account verify          |
| GET    | `/payroll/loans`                                    | Employee loans          |
| GET    | `/payroll/runs`                                     | Payroll runs            |

### Enterprise Payroll
| Method | Endpoint                        | Description                    |
| ------ | ------------------------------- | ------------------------------ |
| GET    | `/compensation/components`      | Pay components                 |
| GET    | `/compensation/employee-salary` | Employee salary structures     |
| GET    | `/payroll-runs`                 | Pay cycles & runs              |
| GET    | `/payroll-admin`                | Payroll governance             |
| GET    | `/statutory`                    | Statutory registrations, rules |
| GET    | `/compliance`                   | Compliance calendar, checks    |

### Rate Card
| Method | Endpoint           | Description      |
| ------ | ------------------ | ---------------- |
| GET    | `/rate-card`       | List rate cards  |
| POST   | `/rate-card`       | Create rate card |
| PUT    | `/rate-card/:id`   | Update rate card |
| GET    | `/rate-card/audit` | Audit log        |

### Attendance
| Method | Endpoint               | Description         |
| ------ | ---------------------- | ------------------- |
| GET    | `/attendance/records`  | Attendance records  |
| POST   | `/attendance/punch`    | Record punch        |
| GET    | `/attendance/policies` | Attendance policies |
| GET    | `/attendance/devices`  | Devices             |
| POST   | `/attendance/requests` | Attendance requests |

### Leave
| Method | Endpoint                      | Description    |
| ------ | ----------------------------- | -------------- |
| GET    | `/leave/types`                | Leave types    |
| GET    | `/leave/requests`             | Leave requests |
| POST   | `/leave/requests`             | Create request |
| PUT    | `/leave/requests/:id/approve` | Approve/reject |

### HR & Recruitment
| Method | Endpoint        | Description        |
| ------ | --------------- | ------------------ |
| GET    | `/candidates`   | Candidates         |
| POST   | `/candidates`   | Create candidate   |
| GET    | `/engagement`   | Engagement surveys |
| GET    | `/hr-dashboard` | HR analytics       |

### Organization
| Method | Endpoint                         | Description   |
| ------ | -------------------------------- | ------------- |
| GET    | `/organization/units`            | Org units     |
| GET    | `/organization/places`           | Locations     |
| GET    | `/organization/job-architecture` | Grades, bands |

### Documents & Profile
| Method | Endpoint      | Description          |
| ------ | ------------- | -------------------- |
| GET    | `/documents`  | Employee documents   |
| POST   | `/documents`  | Upload document      |
| GET    | `/profile/me` | Current user profile |
| PUT    | `/profile/me` | Update profile       |

### ESS (Employee Self-Service)
| Method | Endpoint          | Description      |
| ------ | ----------------- | ---------------- |
| GET    | `/ess/attendance` | My attendance    |
| GET    | `/ess/leave`      | My leave balance |
| GET    | `/ess/payslips`   | My payslips      |
| GET    | `/ess/documents`  | My documents     |

---

## 🖥️ Frontend Pages

| Page                  | Route                | Description                                |
| --------------------- | -------------------- | ------------------------------------------ |
| **Dashboard**         | `/`                  | Manufacturing KPIs, quick actions          |
| **FloorManager**      | `/floor`             | Live lot board, receive/verify, exceptions |
| **MasterLedger**      | `/ledger`            | Wide ledger view of all lots               |
| **Employees**         | `/employees`         | Employee directory, CRUD                   |
| **EmployeeProfile**   | `/hrprofile`         | Detailed employee profile                  |
| **Payroll**           | `/payroll`           | Period management, line verification       |
| **PayrollEnterprise** | `/payrollenterprise` | Enterprise payroll workspace               |
| **RateCard**          | `/rates`             | Rate card management                       |
| **MasterData**        | `/masterdata`        | Shapes, labour heads, settings             |
| **Attendance**        | `/attendance`        | Attendance records, policies               |
| **HR**                | `/hr`                | HR operations                              |
| **HRDashboard**       | `/hrdashboard`       | HR analytics                               |
| **Recruitment**       | `/recruitment`       | Candidate pipeline                         |
| **Compliance**        | `/compliance`        | Statutory compliance                       |
| **Documents**         | `/documents`         | Document management                        |
| **Organization**      | `/organization`      | Org structure                              |
| **Login**             | `/login`             | Authentication                             |

### State Management

- **AuthContext** — User session, login/logout, token refresh
- **AppContext** — Global data: `lots`, `salaryLines`, `salaryPeriods`, `loaded`, `error`, `refresh()`

### Key UI Patterns

- **Sidebar navigation** with badges (floor exceptions, pending payroll)
- **Sub-navigation** for complex workspaces (PayrollEnterprise, HRDashboard, Compliance)
- **Full-height pages** for FloorManager and MasterLedger (internal scrolling)
- **Error boundaries** with retry (loading screen, error screen, error banner)
- **Optimistic updates** with server reconciliation

---

## 🔐 Authentication & Authorization

### JWT Token Structure

```typescript
interface JWTPayload {
  userId: number;
  empCode?: string;      // For employee self-service
  role: string;          // 'ADMIN' | 'MANAGER' | 'HR' | 'ACCOUNTANT' | 'EMPLOYEE'
  iat: number;
  exp: number;
}
```

### Token Flow

1. **Login** → Returns `{ accessToken, refreshToken, user }`
2. **Access Token** — Short-lived (24h), sent in `Authorization: Bearer <token>`
3. **Refresh Token** — Longer-lived, used to obtain new access token
4. **ESS Tokens** — Employee-specific, scoped to self-service endpoints

### Role-Based Access

| Role         | Access                                                |
| ------------ | ----------------------------------------------------- |
| `ADMIN`      | Full system access                                    |
| `MANAGER`    | Manufacturing, payroll verification, team management  |
| `HR`         | Employee lifecycle, attendance, leave, recruitment    |
| `ACCOUNTANT` | Payroll processing, statutory, ledger                 |
| `EMPLOYEE`   | ESS only (own attendance, leave, payslips, documents) |

### Middleware

- `auth.ts` — Verifies JWT, attaches `req.user`
- Role checks in controllers/services as needed

---

## 🔄 Development Workflow

### Prerequisites

- Node.js 20+
- MySQL 8.0+
- Redis (for BullMQ queues)

### Initial Setup

```bash
# 1. Clone & install
cd diamond-manufacturing-erp
cd backend && npm install
cd ../frontend && npm install

# 2. Configure environment
cp backend/.env.example backend/.env   # Edit with your DB credentials

# 3. Database setup
cd backend && npm run db:setup   # Runs migrations + seeders

# 4. Start dev servers (two terminals)
cd backend && npm run dev        # http://localhost:3001
cd frontend && npm run dev       # http://localhost:5173
```

### Available Scripts

**Root (`package.json`):**
```json
{
  "dev": "cd frontend && npm run dev",
  "dev:server": "cd backend && npm run dev",
  "build": "cd frontend && npm run build",
  "build:backend": "cd backend && npm run build",
  "db:migrate": "cd backend && npm run migrate",
  "db:seed": "cd backend && npm run seed",
  "db:setup": "cd backend && npm run db:setup"
}
```

**Backend (`backend/package.json`):**
```json
{
  "dev": "tsx watch src/server.ts",
  "build": "tsc",
  "start": "node dist/server.js",
  "migrate": "tsx src/database/migrate.ts",
  "migrate:rollback": "tsx src/database/migrate.ts rollback",
  "seed": "tsx src/database/seed.ts",
  "db:setup": "npm run migrate && npm run seed",
  "typecheck": "tsc --noEmit"
}
```

**Frontend (`frontend/package.json`):**
```json
{
  "dev": "vite",
  "build": "vite build",
  "preview": "vite preview"
}
```

### Database Migrations

```bash
# Run pending migrations
cd backend && npm run migrate

# Rollback last migration
cd backend && npm run migrate:rollback

# Create new migration
# 1. Add SQL file to backend/src/database/migrations/NNN_description.sql
# 2. Run migrate
```

**Migration File Naming:** `NNN_description.sql` (e.g., `077_add_shift_templates.sql`)

### Adding a New Feature

1. **Backend:**
   - Create migration (if schema change)
   - Add repository (data access)
   - Add service (business logic)
   - Add controller (HTTP handling)
   - Add routes
   - Register in `routes/index.ts`

2. **Frontend:**
   - Add types in `shared/types/` or `frontend/src/types/`
   - Add API client method in `frontend/src/api/`
   - Create page component in `frontend/src/pages/`
   - Add route in `App.tsx`
   - Add sidebar navigation in `Sidebar.tsx`

3. **Shared:**
   - Add constants/enums/types to `shared/`

### Code Style

- **TypeScript** strict mode enabled
- **ESLint** + **Prettier** (configure in each package)
- **Conventional Commits** for git messages

---

## 🚀 Deployment

### Production Build

```bash
# Backend
cd backend && npm run build    # Outputs to dist/

# Frontend
cd frontend && npm run build   # Outputs to dist/
```

### Environment Variables (Production)

```env
# Backend (.env)
NODE_ENV=production
PORT=3001
DB_HOST=your-db-host
DB_PORT=3306
DB_USER=your-user
DB_PASSWORD=your-secure-password
DB_NAME=diamondmatrix_erp
JWT_SECRET=your-very-secure-random-secret
CORS_ORIGIN=https://your-domain.com
SMTP_HOST=smtp.your-provider.com
SMTP_PORT=587
SMTP_USER=your-smtp-user
SMTP_PASSWORD=your-smtp-password
ATTENDANCE_QR_SECRET=separate-qr-secret
ATTENDANCE_FACE_PROVIDER=your-provider
ATTENDANCE_FACE_API_URL=https://api.face-provider.com
ATTENDANCE_FACE_API_KEY=your-api-key
```

### Docker (Example)

```dockerfile
# Backend Dockerfile
FROM node:20-alpine
WORKDIR /app
COPY backend/package*.json ./
RUN npm ci --only=production
COPY backend/dist ./dist
EXPOSE 3001
CMD ["node", "dist/server.js"]
```

```dockerfile
# Frontend Dockerfile (nginx)
FROM nginx:alpine
COPY frontend/dist /usr/share/nginx/html
COPY frontend/nginx.conf /etc/nginx/conf.d/default.conf
EXPOSE 80
```

### Reverse Proxy (Nginx)

```nginx
server {
    listen 80;
    server_name your-domain.com;

    # Frontend
    location / {
        root /usr/share/nginx/html;
        try_files $uri $uri/ /index.html;
    }

    # Backend API
    location /api/ {
        proxy_pass http://localhost:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

---

## ⚙️ Environment Configuration

### Backend (`backend/src/config/env.ts`)

| Variable                         | Default                                            | Description               |
| -------------------------------- | -------------------------------------------------- | ------------------------- |
| `PORT`                           | `3001`                                             | Server port               |
| `NODE_ENV`                       | `development`                                      | Environment               |
| `DB_HOST`                        | `localhost`                                        | MySQL host                |
| `DB_PORT`                        | `3306`                                             | MySQL port                |
| `DB_USER`                        | `root`                                             | MySQL user                |
| `DB_PASSWORD`                    | `root`                                             | MySQL password            |
| `DB_NAME`                        | `diamondmatrix_erp`                                | Database name             |
| `JWT_SECRET`                     | `dev-secret`                                       | JWT signing secret        |
| `JWT_EXPIRES_IN`                 | `24h`                                              | Token expiry              |
| `CORS_ORIGIN`                    | `http://localhost:5173`                            | Frontend origin           |
| `UPLOAD_DIR`                     | `storage/uploads`                                  | File upload directory     |
| `MAX_UPLOAD_MB`                  | `5`                                                | Max upload size           |
| `SMTP_HOST`                      | —                                                  | SMTP host (optional)      |
| `SMTP_PORT`                      | `587`                                              | SMTP port                 |
| `SMTP_SECURE`                    | `false`                                            | Use TLS                   |
| `SMTP_USER`                      | —                                                  | SMTP username             |
| `SMTP_PASSWORD`                  | —                                                  | SMTP password             |
| `SMTP_FROM`                      | `DiamondMatrix ERP <no-reply@diamondmatrix.local>` | From address              |
| `ATTENDANCE_QR_SECRET`           | `JWT_SECRET`                                       | QR token signing key      |
| `ATTENDANCE_QR_ROTATION_SECONDS` | `60`                                               | QR code rotation interval |
| `ATTENDANCE_FACE_PROVIDER`       | —                                                  | Face provider name        |
| `ATTENDANCE_FACE_API_URL`        | —                                                  | Face API endpoint         |
| `ATTENDANCE_FACE_API_KEY`        | —                                                  | Face API key              |
| `ATTENDANCE_FACE_THRESHOLD`      | `85`                                               | Match threshold %         |
| `ATTENDANCE_DEFAULT_TIMEZONE`    | `Asia/Kolkata`                                     | Default timezone          |

### Frontend (`frontend/.env`)

| Variable       | Description                                              |
| -------------- | -------------------------------------------------------- |
| `VITE_API_URL` | Backend API base URL (e.g., `http://localhost:3001/api`) |

### Shared Constants (`shared/constants/index.ts`)

```typescript
export const YIELD_TARGET_PCT = 68;           // Target yield percentage
export const LOT_SLA_DAYS = 18;               // SLA days for lot completion
export const LEAKAGE_FLAG_THRESHOLD_PCT = 5.0; // Leakage alert threshold %
export const LEAKAGE_FLAG_WEIGHT_RATIO = 0.35; // Weight ratio for leakage
```

---

## 📝 Notes for Developers

### Important Patterns

1. **Decimal Numbers** — MySQL pool configured with `decimalNumbers: true` so `DECIMAL` columns return JS `number` (not string)
2. **Timezone** — Database connection uses `timezone: '+00:00'` (UTC); attendance uses `Asia/Kolkata` default
3. **QR Tokens** — Rotate every 60s; signed with dedicated secret (or JWT secret fallback)
4. **Face Recognition** — Pluggable provider; returns "unavailable" if not configured (fail-safe)
5. **Email** — Optional; if SMTP not configured, emails are logged as skipped but in-app notifications still deliver
6. **BullMQ** — Used for async jobs (payslip generation, challan filing, report generation)

### Common Tasks

| Task                   | Command                                                                     |
| ---------------------- | --------------------------------------------------------------------------- |
| Type check backend     | `cd backend && npm run typecheck`                                           |
| Run migrations         | `cd backend && npm run migrate`                                             |
| Seed database          | `cd backend && npm run seed`                                                |
| Full DB reset          | `cd backend && npm run migrate:rollback && npm run migrate && npm run seed` |
| Build frontend         | `cd frontend && npm run build`                                              |
| Preview frontend build | `cd frontend && npm run preview`                                            |

### Debugging

- **Backend logs** — Console output with `tsx watch`
- **Frontend** — React DevTools, Vite HMR
- **Database** — MySQL Workbench, `EXPLAIN` queries
- **Queue** — BullMQ dashboard (if enabled)

---

## 📚 Additional Resources

- [MySQL 8.0 Documentation](https://dev.mysql.com/doc/refman/8.0/en/)
- [Express.js Guide](https://expressjs.com/en/guide/routing.html)
- [React 19 Documentation](https://react.dev/)
- [Tailwind CSS 4](https://tailwindcss.com/docs)
- [BullMQ Patterns](https://docs.bullmq.io/)
- [jsonwebtoken](https://github.com/auth0/node-jsonwebtoken)

---

*Document generated: 2026-08-05*  
*Project: DiamondMatrix ERP v2.0*  
*Last updated: Initial creation*