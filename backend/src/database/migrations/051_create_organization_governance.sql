-- Matrix / dotted-line reporting alongside the primary reporting_manager_id.
CREATE TABLE IF NOT EXISTS reporting_relationships (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  manager_employee_id INT UNSIGNED NOT NULL,
  relationship_type ENUM('DIRECT', 'MATRIX', 'FUNCTIONAL', 'ADMINISTRATIVE', 'DOTTED_LINE', 'ESCALATION', 'DELEGATION') NOT NULL DEFAULT 'MATRIX',
  context VARCHAR(160) NULL,
  allocation_pct DECIMAL(5, 2) NULL,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  is_primary BOOLEAN NOT NULL DEFAULT false,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (manager_employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_reporting_employee (employee_id, relationship_type),
  INDEX idx_reporting_manager (manager_employee_id),
  INDEX idx_reporting_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Configurable approval workflow for structural change.
CREATE TABLE IF NOT EXISTS org_change_requests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  request_type ENUM(
    'COMPANY_CREATE', 'DEPARTMENT_CREATE', 'BRANCH_APPROVAL', 'TEAM_CREATE',
    'POSITION_APPROVAL', 'ORG_CHANGE', 'TRANSFER', 'RESTRUCTURE'
  ) NOT NULL,
  entity_type VARCHAR(40) NULL,
  entity_id INT UNSIGNED NULL,
  employee_id INT UNSIGNED NULL,
  title VARCHAR(200) NOT NULL,
  justification TEXT NULL,
  proposed_json MEDIUMTEXT NULL,
  current_json MEDIUMTEXT NULL,
  effective_date DATE NULL,
  status ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED', 'APPLIED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  requested_by INT UNSIGNED NULL,
  decided_by INT UNSIGNED NULL,
  decided_at DATETIME NULL,
  decision_note VARCHAR(500) NULL,
  applied_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orgchange_status (status),
  INDEX idx_orgchange_type (request_type),
  INDEX idx_orgchange_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL,
  entity_id INT UNSIGNED NULL,
  entity_name VARCHAR(200) NULL,
  action ENUM('CREATE', 'UPDATE', 'DELETE', 'RESTORE', 'ACTIVATE', 'DEACTIVATE', 'REPARENT', 'TRANSFER', 'ASSIGN', 'UNASSIGN', 'IMPORT', 'APPROVE', 'REJECT') NOT NULL,
  actor_user_id INT UNSIGNED NULL,
  actor_name VARCHAR(160) NULL,
  actor_role VARCHAR(40) NULL,
  summary VARCHAR(500) NULL,
  previous_value TEXT NULL,
  new_value TEXT NULL,
  ip_address VARCHAR(45) NULL,
  device VARCHAR(80) NULL,
  browser VARCHAR(80) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_orgaudit_entity (entity_type, entity_id, created_at),
  INDEX idx_orgaudit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Organization-level policies and calendars.
CREATE TABLE IF NOT EXISTS org_policies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  policy_type ENUM('WORKING_HOURS', 'LEAVE', 'ATTENDANCE', 'PAYROLL', 'TRAVEL', 'EXPENSE', 'SECURITY', 'OTHER') NOT NULL,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(200) NOT NULL,
  body TEXT NULL,
  config_json MEDIUMTEXT NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  document_id INT UNSIGNED NULL,
  status ENUM('ACTIVE', 'INACTIVE', 'DRAFT') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_org_policy (company_id, branch_id, code),
  INDEX idx_orgpolicy_type (policy_type),
  INDEX idx_orgpolicy_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scope holidays to a company / branch / region. All three NULL keeps the
-- current meaning: the holiday applies to everyone.
--
-- `holidays.holiday_date` carries a plain UNIQUE today, which would stop two
-- branches observing different holidays on the same day. Replacing it with a
-- composite over nullable columns would not work — MySQL lets NULLs repeat in
-- a unique key, which would silently break the ON DUPLICATE KEY UPDATE upsert
-- that HolidayRepository.create and the holiday seeder rely on. A stored
-- generated scope key keeps every value non-null, so company-wide rows still
-- collapse to one row per date exactly as before.
ALTER TABLE holidays ADD COLUMN company_id INT UNSIGNED NULL;
ALTER TABLE holidays ADD COLUMN branch_id INT UNSIGNED NULL;
ALTER TABLE holidays ADD COLUMN region_id INT UNSIGNED NULL;
ALTER TABLE holidays ADD COLUMN scope_key VARCHAR(40) GENERATED ALWAYS AS (CONCAT(COALESCE(company_id, 0), '-', COALESCE(branch_id, 0), '-', COALESCE(region_id, 0))) STORED;
-- RESTRICT rather than CASCADE/SET NULL: MySQL refuses a referential action
-- that would modify a column feeding a stored generated column. Blocking the
-- delete is also the safer behaviour — scoped holidays must be reassigned
-- deliberately rather than vanishing with their company.
ALTER TABLE holidays ADD CONSTRAINT fk_holidays_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE RESTRICT;
ALTER TABLE holidays ADD CONSTRAINT fk_holidays_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE RESTRICT;
ALTER TABLE holidays ADD CONSTRAINT fk_holidays_region FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE RESTRICT;
ALTER TABLE holidays DROP INDEX holiday_date;
ALTER TABLE holidays ADD UNIQUE KEY uk_holiday_date_scope (holiday_date, scope_key);
ALTER TABLE holidays ADD INDEX idx_holidays_scope (company_id, branch_id, region_id);
