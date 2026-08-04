-- Recurring compliance obligations and the calendar generated from them.
CREATE TABLE IF NOT EXISTS compliance_obligations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(200) NOT NULL,
  category ENUM('PF', 'ESI', 'PT', 'LWF', 'TDS', 'LABOUR_LAW', 'GRATUITY', 'BONUS', 'OTHER') NOT NULL,
  obligation_type ENUM('PAYMENT', 'RETURN', 'REGISTER', 'RENEWAL', 'DISCLOSURE') NOT NULL DEFAULT 'RETURN',
  frequency ENUM('MONTHLY', 'QUARTERLY', 'HALF_YEARLY', 'ANNUAL', 'ONE_TIME') NOT NULL DEFAULT 'MONTHLY',
  country CHAR(2) NOT NULL DEFAULT 'IN',
  state_code VARCHAR(10) NULL,
  authority VARCHAR(160) NULL,
-- Day of the month the filing is due, and how many months after the period end.
  due_day TINYINT UNSIGNED NULL,
  due_month_offset TINYINT UNSIGNED NOT NULL DEFAULT 1,
  reminder_days_before INT UNSIGNED NOT NULL DEFAULT 7,
  penalty_note VARCHAR(500) NULL,
  reference_url VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_obligations_category (category, is_active),
  INDEX idx_obligations_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A concrete dated instance of an obligation.
CREATE TABLE IF NOT EXISTS compliance_calendar (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  obligation_id INT UNSIGNED NOT NULL,
  financial_year VARCHAR(9) NOT NULL,
  period_label VARCHAR(40) NOT NULL,
  month_key VARCHAR(7) NULL,
  quarter TINYINT UNSIGNED NULL,
  state_code VARCHAR(10) NULL,
  due_date DATE NOT NULL,
  original_due_date DATE NULL,
-- Government extensions move the date, so the original is kept for the record.
  extension_reason VARCHAR(255) NULL,
  status ENUM('UPCOMING', 'DUE_SOON', 'OVERDUE', 'COMPLETED', 'NOT_APPLICABLE', 'WAIVED') NOT NULL DEFAULT 'UPCOMING',
  filing_id INT UNSIGNED NULL,
  challan_id INT UNSIGNED NULL,
  completed_on DATE NULL,
  completed_by INT UNSIGNED NULL,
  owner_user_id INT UNSIGNED NULL,
  reminder_sent_at DATETIME NULL,
  remarks VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (obligation_id) REFERENCES compliance_obligations(id) ON DELETE CASCADE,
  FOREIGN KEY (filing_id) REFERENCES regulatory_filings(id) ON DELETE SET NULL,
  FOREIGN KEY (challan_id) REFERENCES statutory_challans(id) ON DELETE SET NULL,
  FOREIGN KEY (completed_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_calendar_entry (obligation_id, financial_year, period_label, state_code),
  INDEX idx_calendar_due (due_date, status),
  INDEX idx_calendar_fy (financial_year)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit and inspection.
CREATE TABLE IF NOT EXISTS compliance_audits (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(200) NOT NULL,
  audit_type ENUM('INTERNAL', 'EXTERNAL', 'STATUTORY', 'INSPECTION') NOT NULL DEFAULT 'INTERNAL',
  scope VARCHAR(500) NULL,
  financial_year VARCHAR(9) NULL,
  auditor_name VARCHAR(200) NULL,
  authority VARCHAR(200) NULL,
  planned_on DATE NULL,
  started_on DATE NULL,
  completed_on DATE NULL,
  status ENUM('PLANNED', 'IN_PROGRESS', 'FINDINGS_ISSUED', 'CLOSED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED',
  overall_rating ENUM('COMPLIANT', 'MINOR_ISSUES', 'MAJOR_ISSUES', 'NON_COMPLIANT') NULL,
  summary TEXT NULL,
  document_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (document_id) REFERENCES employee_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_audits_status (status),
  INDEX idx_audits_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compliance_findings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  audit_id INT UNSIGNED NULL,
  finding_no VARCHAR(40) NULL,
  category ENUM('PF', 'ESI', 'PT', 'LWF', 'TDS', 'LABOUR_LAW', 'GRATUITY', 'BONUS', 'MINIMUM_WAGE', 'OTHER') NOT NULL,
  severity ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  affected_count INT UNSIGNED NOT NULL DEFAULT 0,
  financial_impact DECIMAL(14, 2) NULL,
-- Findings raised automatically by the compliance checker carry a rule code.
  rule_code VARCHAR(60) NULL,
  is_automated BOOLEAN NOT NULL DEFAULT false,
  status ENUM('OPEN', 'IN_PROGRESS', 'RESOLVED', 'ACCEPTED_RISK', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  identified_on DATE NOT NULL,
  due_date DATE NULL,
  owner_user_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (audit_id) REFERENCES compliance_audits(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_findings_status (status, severity),
  INDEX idx_findings_category (category),
  INDEX idx_findings_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compliance_actions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  finding_id INT UNSIGNED NOT NULL,
  action_text VARCHAR(1000) NOT NULL,
  action_type ENUM('CORRECTIVE', 'PREVENTIVE') NOT NULL DEFAULT 'CORRECTIVE',
  owner_user_id INT UNSIGNED NULL,
  due_date DATE NULL,
  status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  completed_on DATE NULL,
  evidence_document_id INT UNSIGNED NULL,
  remarks VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (finding_id) REFERENCES compliance_findings(id) ON DELETE CASCADE,
  FOREIGN KEY (owner_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (evidence_document_id) REFERENCES employee_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_actions_finding (finding_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reusable checklist templates and their per-run results.
CREATE TABLE IF NOT EXISTS compliance_checklist_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE,
  category ENUM('PF', 'ESI', 'PT', 'LWF', 'TDS', 'LABOUR_LAW', 'GRATUITY', 'BONUS', 'MINIMUM_WAGE', 'OTHER') NOT NULL,
  title VARCHAR(255) NOT NULL,
  description VARCHAR(1000) NULL,
  severity ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
-- Automated checks map to a rule the compliance engine can evaluate in SQL.
  rule_code VARCHAR(60) NULL,
  is_automated BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  display_order INT UNSIGNED NOT NULL DEFAULT 100,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS compliance_check_results (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  checklist_item_id INT UNSIGNED NOT NULL,
  audit_id INT UNSIGNED NULL,
  period_id INT UNSIGNED NULL,
  financial_year VARCHAR(9) NULL,
  result ENUM('PASS', 'FAIL', 'WARNING', 'NOT_APPLICABLE', 'MANUAL_REVIEW') NOT NULL,
  affected_count INT UNSIGNED NOT NULL DEFAULT 0,
  detail VARCHAR(1000) NULL,
  evidence_json TEXT NULL,
  finding_id INT UNSIGNED NULL,
  checked_at DATETIME NOT NULL,
  checked_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (checklist_item_id) REFERENCES compliance_checklist_items(id) ON DELETE CASCADE,
  FOREIGN KEY (audit_id) REFERENCES compliance_audits(id) ON DELETE SET NULL,
  FOREIGN KEY (period_id) REFERENCES salary_periods(id) ON DELETE SET NULL,
  FOREIGN KEY (finding_id) REFERENCES compliance_findings(id) ON DELETE SET NULL,
  FOREIGN KEY (checked_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_check_results_item (checklist_item_id, checked_at),
  INDEX idx_check_results_result (result)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
