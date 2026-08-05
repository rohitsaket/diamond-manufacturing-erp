-- Performance cycles: the time containers every goal, review and appraisal hangs off.
-- A cycle carries its own stage windows (goal setting, self review, manager review,
-- calibration) so the UI can show a review calendar without a separate table.
CREATE TABLE IF NOT EXISTS perf_cycles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  cycle_type ENUM('ANNUAL', 'HALF_YEARLY', 'QUARTERLY', 'MONTHLY', 'PROBATION', 'PROJECT', 'CUSTOM') NOT NULL DEFAULT 'ANNUAL',
  financial_year VARCHAR(9) NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  goal_setting_start DATE NULL,
  goal_setting_end DATE NULL,
  self_review_start DATE NULL,
  self_review_end DATE NULL,
  manager_review_start DATE NULL,
  manager_review_end DATE NULL,
  calibration_start DATE NULL,
  calibration_end DATE NULL,
  status ENUM('DRAFT', 'GOAL_SETTING', 'ACTIVE', 'SELF_REVIEW', 'MANAGER_REVIEW', 'CALIBRATION', 'CLOSED') NOT NULL DEFAULT 'DRAFT',
  is_template BOOLEAN NOT NULL DEFAULT false,
  description VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_perf_cycles_status (status),
  INDEX idx_perf_cycles_fy (financial_year),
  INDEX idx_perf_cycles_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Review form templates. sections_json holds an ordered list of sections, each with
-- questions of kind TEXT | RATING | COMPETENCY, so forms are configurable without schema changes.
CREATE TABLE IF NOT EXISTS review_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  applies_to ENUM('SELF', 'MANAGER', 'PEER', 'SUBORDINATE', 'CUSTOMER', 'EXTERNAL', 'ALL') NOT NULL DEFAULT 'ALL',
  rating_scale TINYINT UNSIGNED NOT NULL DEFAULT 5,
  sections_json JSON NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_review_templates_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Additive: performance events need their own notification category.
ALTER TABLE notifications MODIFY category ENUM('LEAVE', 'ATTENDANCE', 'PAYROLL', 'TRAINING', 'POLICY', 'SECURITY', 'SYSTEM', 'RECRUITMENT', 'EXPENSE', 'TASK', 'HELPDESK', 'ASSET', 'PERFORMANCE') NOT NULL DEFAULT 'SYSTEM';
