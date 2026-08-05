-- One approval chain definition per request type and scope. Levels are walked
-- in ascending order -- level 1 must clear before level 2 is asked.
CREATE TABLE IF NOT EXISTS attendance_approval_workflows (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_type ENUM('REGULARIZATION', 'MISSED_PUNCH', 'CORRECTION', 'OVERTIME', 'SHIFT_CHANGE', 'SHIFT_SWAP', 'REMOTE_WORK', 'ON_DUTY', 'BREAK_EXTENSION', 'COMP_OFF', 'EARLY_EXIT', 'LATE_ARRIVAL') NOT NULL,
  company_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  department_id INT UNSIGNED NULL,
  level INT UNSIGNED NOT NULL DEFAULT 1,
  approver_type ENUM('REPORTING_MANAGER', 'DEPARTMENT_HEAD', 'BRANCH_MANAGER', 'HR', 'ADMIN', 'SPECIFIC_EMPLOYEE', 'ROLE') NOT NULL,
  approver_employee_id INT UNSIGNED NULL,
  approver_role VARCHAR(40) NULL,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  sla_hours INT UNSIGNED NOT NULL DEFAULT 48,
  auto_escalate BOOLEAN NOT NULL DEFAULT false,
  escalate_to_type ENUM('DEPARTMENT_HEAD', 'HR', 'ADMIN', 'SPECIFIC_EMPLOYEE') NULL,
  escalate_to_employee_id INT UNSIGNED NULL,
  auto_approve_after_hours INT UNSIGNED NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE CASCADE,
  FOREIGN KEY (approver_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (escalate_to_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_workflow_type (request_type, status),
  INDEX idx_workflow_scope (company_id, branch_id, department_id),
  INDEX idx_workflow_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Every attendance change an employee can ask for, in one table. current_value
-- and requested_value are JSON so a shift swap and a missed punch can share the
-- same approval machinery without a column per request type.
CREATE TABLE IF NOT EXISTS attendance_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_no VARCHAR(40) NOT NULL,
  request_type ENUM('REGULARIZATION', 'MISSED_PUNCH', 'CORRECTION', 'OVERTIME', 'SHIFT_CHANGE', 'SHIFT_SWAP', 'REMOTE_WORK', 'ON_DUTY', 'BREAK_EXTENSION', 'COMP_OFF', 'EARLY_EXIT', 'LATE_ARRIVAL') NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  att_date DATE NOT NULL,
  to_date DATE NULL,
  attendance_id INT UNSIGNED NULL,
  current_value JSON NULL,
  requested_value JSON NULL,
  requested_hours DECIMAL(5, 2) NULL,
  reason TEXT NULL,
  attachment_path VARCHAR(500) NULL,

  -- Shift swap needs the other party to agree before any manager sees it.
  counterparty_employee_id INT UNSIGNED NULL,
  counterparty_response ENUM('NOT_REQUIRED', 'PENDING', 'ACCEPTED', 'DECLINED') NOT NULL DEFAULT 'NOT_REQUIRED',
  counterparty_responded_at TIMESTAMP NULL,

  status ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'CANCELLED', 'ESCALATED', 'APPLIED', 'EXPIRED') NOT NULL DEFAULT 'PENDING',
  current_level INT UNSIGNED NOT NULL DEFAULT 1,
  total_levels INT UNSIGNED NOT NULL DEFAULT 1,
  submitted_at TIMESTAMP NULL,
  decided_at TIMESTAMP NULL,
  applied_at TIMESTAMP NULL,
  due_at TIMESTAMP NULL,
  decision_note TEXT NULL,
  company_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  department_id INT UNSIGNED NULL,
  raised_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (counterparty_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (attendance_id) REFERENCES attendance_records(id) ON DELETE SET NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (raised_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_att_request_no (request_no),
  INDEX idx_att_req_employee (employee_id, att_date),
  INDEX idx_att_req_status (status, request_type),
  INDEX idx_att_req_date (att_date),
  INDEX idx_att_req_due (due_at),
  INDEX idx_att_req_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE attendance_records ADD CONSTRAINT fk_att_regularized_req FOREIGN KEY (regularized_request_id) REFERENCES attendance_requests(id) ON DELETE SET NULL;
ALTER TABLE employee_shift_assignments ADD CONSTRAINT fk_esa_request FOREIGN KEY (request_id) REFERENCES attendance_requests(id) ON DELETE SET NULL;

-- One row per level per request, written up front as PENDING so the queue for
-- an approver is a plain indexed read rather than a workflow replay.
CREATE TABLE IF NOT EXISTS attendance_request_approvals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  level INT UNSIGNED NOT NULL,
  approver_type ENUM('REPORTING_MANAGER', 'DEPARTMENT_HEAD', 'BRANCH_MANAGER', 'HR', 'ADMIN', 'SPECIFIC_EMPLOYEE', 'ROLE') NOT NULL,
  approver_employee_id INT UNSIGNED NULL,
  approver_role VARCHAR(40) NULL,
  decision ENUM('PENDING', 'APPROVED', 'REJECTED', 'SKIPPED', 'ESCALATED', 'AUTO_APPROVED') NOT NULL DEFAULT 'PENDING',
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  comments TEXT NULL,
  delegated_from_employee_id INT UNSIGNED NULL,
  due_at TIMESTAMP NULL,
  escalated_at TIMESTAMP NULL,
  escalated_to_employee_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES attendance_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (approver_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (delegated_from_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (escalated_to_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_request_level (request_id, level),
  INDEX idx_approval_approver (approver_employee_id, decision),
  INDEX idx_approval_pending (decision, due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Cover for an approver who is away. request_types is a CSV of types, empty
-- meaning all of them.
CREATE TABLE IF NOT EXISTS approval_delegations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_employee_id INT UNSIGNED NOT NULL,
  to_employee_id INT UNSIGNED NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  request_types VARCHAR(255) NULL,
  reason VARCHAR(255) NULL,
  status ENUM('ACTIVE', 'CANCELLED', 'EXPIRED') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (from_employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (to_employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_delegation_from (from_employee_id, from_date, to_date),
  INDEX idx_delegation_status (status),
  INDEX idx_delegation_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
