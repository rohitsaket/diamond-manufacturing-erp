-- KPI library. auto_source names a computation the engine can fill from live
-- ERP data (lot production, attendance); NONE means values are entered manually.
-- formula reuses the safe payrollMath expression parser, never eval.
CREATE TABLE IF NOT EXISTS kpi_library (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  category ENUM('PRODUCTION', 'QUALITY', 'ATTENDANCE', 'FINANCE', 'PEOPLE', 'CUSTOM') NOT NULL DEFAULT 'CUSTOM',
  unit VARCHAR(30) NULL,
  direction ENUM('HIGHER_BETTER', 'LOWER_BETTER', 'TARGET_BAND') NOT NULL DEFAULT 'HIGHER_BETTER',
  formula VARCHAR(500) NULL,
  auto_source ENUM('NONE', 'PRODUCTION_PIECES', 'PRODUCTION_VALUE', 'ATTENDANCE_PCT', 'OT_HOURS') NOT NULL DEFAULT 'NONE',
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_kpi_library_active (is_active, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A KPI assigned to an employee, team, department or the whole organization for
-- one cycle. No unique key on the nullable scope columns (MySQL does not dedupe
-- NULLs in unique keys); the service checks for duplicates instead.
CREATE TABLE IF NOT EXISTS kpi_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kpi_id INT UNSIGNED NOT NULL,
  cycle_id INT UNSIGNED NOT NULL,
  scope ENUM('INDIVIDUAL', 'TEAM', 'DEPARTMENT', 'ORGANIZATION') NOT NULL DEFAULT 'INDIVIDUAL',
  employee_id INT UNSIGNED NULL,
  team_id INT UNSIGNED NULL,
  department_id INT UNSIGNED NULL,
  weightage_pct DECIMAL(5, 2) NOT NULL DEFAULT 100.00,
  target_value DECIMAL(14, 2) NULL,
  threshold_value DECIMAL(14, 2) NULL,
  stretch_value DECIMAL(14, 2) NULL,
  actual_value DECIMAL(14, 2) NULL,
  achievement_pct DECIMAL(7, 2) NULL,
  score DECIMAL(6, 2) NULL,
  last_computed_at DATETIME NULL,
  status ENUM('ACTIVE', 'CLOSED') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (kpi_id) REFERENCES kpi_library(id) ON DELETE CASCADE,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_kpi_assign_cycle (cycle_id, scope, status),
  INDEX idx_kpi_assign_employee (employee_id, cycle_id),
  INDEX idx_kpi_assign_kpi (kpi_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Month-by-month tracked values behind an assignment; the assignment's
-- actual_value is the aggregate the engine maintains.
CREATE TABLE IF NOT EXISTS kpi_values (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assignment_id INT UNSIGNED NOT NULL,
  period_key VARCHAR(7) NOT NULL,
  value DECIMAL(14, 2) NOT NULL,
  source ENUM('MANUAL', 'AUTO') NOT NULL DEFAULT 'MANUAL',
  note VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (assignment_id) REFERENCES kpi_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_kpi_value_period (assignment_id, period_key),
  INDEX idx_kpi_values_period (period_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kra_library (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  department_id INT UNSIGNED NULL,
  default_weightage_pct DECIMAL(5, 2) NOT NULL DEFAULT 25.00,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_kra_library_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A KRA assigned to an employee for a cycle, scored on the cycle's rating scale
-- by the employee, then the manager, then finalized.
CREATE TABLE IF NOT EXISTS employee_kras (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  kra_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  cycle_id INT UNSIGNED NOT NULL,
  weightage_pct DECIMAL(5, 2) NOT NULL DEFAULT 25.00,
  self_score DECIMAL(4, 2) NULL,
  manager_score DECIMAL(4, 2) NULL,
  final_score DECIMAL(4, 2) NULL,
  remarks VARCHAR(1000) NULL,
  status ENUM('ASSIGNED', 'SELF_SCORED', 'REVIEWED', 'FINALIZED') NOT NULL DEFAULT 'ASSIGNED',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (kra_id) REFERENCES kra_library(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_employee_kra (kra_id, employee_id, cycle_id),
  INDEX idx_employee_kras_employee (employee_id, cycle_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
