-- Generic multi-level approval workflow, reusable across payroll entities.
CREATE TABLE IF NOT EXISTS approval_workflows (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  entity_type ENUM(
    'PAYROLL_RUN', 'SALARY_REVISION', 'BONUS', 'INCENTIVE', 'LOAN',
    'REIMBURSEMENT', 'FINAL_SETTLEMENT', 'OVERTIME', 'TAX_DECLARATION'
  ) NOT NULL,
-- Optional threshold: amounts at or above this use this workflow.
  min_amount DECIMAL(14, 2) NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_workflows_entity (entity_type, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_workflow_steps (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id INT UNSIGNED NOT NULL,
  step_order INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  approver_role ENUM(
    'PAYROLL_EXECUTIVE', 'HR', 'FINANCE', 'DEPARTMENT_HEAD', 'CFO', 'CEO', 'SUPER_ADMIN'
  ) NOT NULL,
-- Maps the business role onto the application roles that may act on it.
  allowed_user_roles VARCHAR(200) NOT NULL DEFAULT 'admin',
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  can_skip_if_below DECIMAL(14, 2) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES approval_workflows(id) ON DELETE CASCADE,
  UNIQUE KEY uk_workflow_step (workflow_id, step_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  workflow_id INT UNSIGNED NULL,
  entity_type VARCHAR(40) NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  amount DECIMAL(14, 2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  current_step INT UNSIGNED NOT NULL DEFAULT 1,
  status ENUM('PENDING', 'APPROVED', 'REJECTED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  requested_by INT UNSIGNED NULL,
  completed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (workflow_id) REFERENCES approval_workflows(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_approval_entity (entity_type, entity_id),
  INDEX idx_approval_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS approval_actions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_id INT UNSIGNED NOT NULL,
  step_order INT UNSIGNED NOT NULL,
  approver_role VARCHAR(40) NULL,
  action ENUM('APPROVED', 'REJECTED', 'DELEGATED', 'COMMENTED') NOT NULL,
  acted_by INT UNSIGNED NULL,
  acted_at DATETIME NOT NULL,
  comments VARCHAR(1000) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (request_id) REFERENCES approval_requests(id) ON DELETE CASCADE,
  FOREIGN KEY (acted_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_approval_actions_request (request_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Payroll audit trail with before/after values and request context.
CREATE TABLE IF NOT EXISTS payroll_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(60) NOT NULL,
  entity_id INT UNSIGNED NULL,
  employee_id INT UNSIGNED NULL,
  period_id INT UNSIGNED NULL,
  run_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  field_name VARCHAR(80) NULL,
  previous_value VARCHAR(500) NULL,
  new_value VARCHAR(500) NULL,
  actor_user_id INT UNSIGNED NULL,
  actor_name VARCHAR(160) NULL,
  actor_role VARCHAR(40) NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(400) NULL,
  device VARCHAR(120) NULL,
  browser VARCHAR(120) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_payroll_audit_entity (entity_type, entity_id),
  INDEX idx_payroll_audit_period (period_id),
  INDEX idx_payroll_audit_created (created_at),
  INDEX idx_payroll_audit_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Background jobs. Runs in-process by default; a Redis/BullMQ worker can claim
-- the same rows when configured, so the two modes share one source of truth.
CREATE TABLE IF NOT EXISTS background_jobs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_type VARCHAR(60) NOT NULL,
  payload_json MEDIUMTEXT NULL,
  status ENUM('QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED') NOT NULL DEFAULT 'QUEUED',
  progress_pct TINYINT UNSIGNED NOT NULL DEFAULT 0,
  progress_message VARCHAR(255) NULL,
  result_json MEDIUMTEXT NULL,
  error_message VARCHAR(1000) NULL,
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  max_attempts INT UNSIGNED NOT NULL DEFAULT 3,
  run_after DATETIME NULL,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_jobs_status (status, run_after),
  INDEX idx_jobs_type (job_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
