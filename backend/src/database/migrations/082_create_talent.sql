-- The appraisal record for one employee in one cycle: component scores, the
-- rating as it moves through calibration, and the letter that comes out the end.
CREATE TABLE IF NOT EXISTS appraisals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cycle_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  goal_score DECIMAL(6, 2) NULL,
  kra_score DECIMAL(6, 2) NULL,
  kpi_score DECIMAL(6, 2) NULL,
  competency_score DECIMAL(6, 2) NULL,
  total_score DECIMAL(6, 2) NULL,
  self_rating DECIMAL(4, 2) NULL,
  manager_rating DECIMAL(4, 2) NULL,
  calibrated_rating DECIMAL(4, 2) NULL,
  final_rating DECIMAL(4, 2) NULL,
  rating_label VARCHAR(60) NULL,
  salary_increase_pct DECIMAL(5, 2) NULL,
  promotion_recommended BOOLEAN NOT NULL DEFAULT false,
  status ENUM('PENDING', 'IN_REVIEW', 'CALIBRATED', 'FINALIZED', 'LETTER_ISSUED', 'ACKNOWLEDGED') NOT NULL DEFAULT 'PENDING',
  remarks TEXT NULL,
  letter_number VARCHAR(60) NULL,
  letter_generated_at DATETIME NULL,
  finalized_by INT UNSIGNED NULL,
  finalized_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (finalized_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_appraisal (cycle_id, employee_id),
  INDEX idx_appraisals_status (status),
  INDEX idx_appraisals_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Promotion cases. Grade uses the employees.grade string convention; role and
-- position changes point into the existing job architecture.
CREATE TABLE IF NOT EXISTS promotions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  appraisal_id INT UNSIGNED NULL,
  from_grade VARCHAR(20) NULL,
  to_grade VARCHAR(20) NULL,
  from_role_id INT UNSIGNED NULL,
  to_role_id INT UNSIGNED NULL,
  from_position_id INT UNSIGNED NULL,
  to_position_id INT UNSIGNED NULL,
  salary_impact_pct DECIMAL(5, 2) NULL,
  salary_impact_amount DECIMAL(12, 2) NULL,
  effective_date DATE NULL,
  justification TEXT NULL,
  status ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'EFFECTED') NOT NULL DEFAULT 'DRAFT',
  letter_number VARCHAR(60) NULL,
  letter_generated_at DATETIME NULL,
  requested_by INT UNSIGNED NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  effected_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (appraisal_id) REFERENCES appraisals(id) ON DELETE SET NULL,
  FOREIGN KEY (from_role_id) REFERENCES job_roles(id) ON DELETE SET NULL,
  FOREIGN KEY (to_role_id) REFERENCES job_roles(id) ON DELETE SET NULL,
  FOREIGN KEY (from_position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (to_position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_promotions_employee (employee_id, status),
  INDEX idx_promotions_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 9-box talent assessment: performance x potential per employee per cycle.
-- box_position is 1..9 (row-major: 1 = low/low, 9 = high/high).
CREATE TABLE IF NOT EXISTS talent_assessments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cycle_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  performance_score DECIMAL(4, 2) NOT NULL,
  potential_score DECIMAL(4, 2) NOT NULL,
  box_position TINYINT UNSIGNED NOT NULL,
  is_hipo BOOLEAN NOT NULL DEFAULT false,
  attrition_risk ENUM('LOW', 'MEDIUM', 'HIGH') NULL,
  assessment_note VARCHAR(1000) NULL,
  assessed_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (assessed_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_talent_assessment (cycle_id, employee_id),
  INDEX idx_talent_box (cycle_id, box_position)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS talent_pools (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  pool_type ENUM('HIPO', 'LEADERSHIP', 'CRITICAL_SKILL', 'SUCCESSOR', 'CUSTOM') NOT NULL DEFAULT 'CUSTOM',
  description VARCHAR(500) NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_talent_pools_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS talent_pool_members (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pool_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  note VARCHAR(500) NULL,
  added_by INT UNSIGNED NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  removed_at DATETIME NULL,
  FOREIGN KEY (pool_id) REFERENCES talent_pools(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (added_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_pool_member (pool_id, employee_id),
  INDEX idx_pool_members_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Succession planning for a position or role; candidates ranked by readiness.
CREATE TABLE IF NOT EXISTS succession_plans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  position_id INT UNSIGNED NULL,
  role_id INT UNSIGNED NULL,
  incumbent_employee_id INT UNSIGNED NULL,
  criticality ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  risk_of_loss ENUM('LOW', 'MEDIUM', 'HIGH') NOT NULL DEFAULT 'LOW',
  status ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  notes VARCHAR(1000) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (role_id) REFERENCES job_roles(id) ON DELETE SET NULL,
  FOREIGN KEY (incumbent_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_succession_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS succession_candidates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  readiness ENUM('READY_NOW', 'READY_1_YEAR', 'READY_2_YEARS', 'DEVELOPMENT_NEEDED') NOT NULL DEFAULT 'DEVELOPMENT_NEEDED',
  ranking TINYINT UNSIGNED NULL,
  development_note VARCHAR(1000) NULL,
  added_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES succession_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uk_succession_candidate (plan_id, employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Calibration meetings and the rating adjustments they made. committee_json
-- holds the member list; adjustments keep before/after for the audit trail.
CREATE TABLE IF NOT EXISTS calibration_sessions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cycle_id INT UNSIGNED NOT NULL,
  name VARCHAR(160) NOT NULL,
  session_date DATE NULL,
  department_id INT UNSIGNED NULL,
  status ENUM('SCHEDULED', 'IN_PROGRESS', 'COMPLETED') NOT NULL DEFAULT 'SCHEDULED',
  committee_json JSON NULL,
  notes VARCHAR(1000) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_calibration_cycle (cycle_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS calibration_adjustments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  session_id INT UNSIGNED NOT NULL,
  appraisal_id INT UNSIGNED NOT NULL,
  previous_rating DECIMAL(4, 2) NULL,
  adjusted_rating DECIMAL(4, 2) NOT NULL,
  reason VARCHAR(500) NULL,
  adjusted_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (session_id) REFERENCES calibration_sessions(id) ON DELETE CASCADE,
  FOREIGN KEY (appraisal_id) REFERENCES appraisals(id) ON DELETE CASCADE,
  FOREIGN KEY (adjusted_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_calibration_adj_session (session_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
