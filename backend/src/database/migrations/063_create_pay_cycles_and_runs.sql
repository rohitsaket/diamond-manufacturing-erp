-- Pay cycles / payroll calendars and the run engine.
CREATE TABLE IF NOT EXISTS pay_cycles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  frequency ENUM('MONTHLY', 'WEEKLY', 'BI_WEEKLY', 'DAILY', 'SEMI_MONTHLY') NOT NULL DEFAULT 'MONTHLY',
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  country CHAR(2) NOT NULL DEFAULT 'IN',
  company VARCHAR(160) NULL,
  branch VARCHAR(120) NULL,
-- Day the cycle starts; 1 = 1st of month, or 0-6 for weekly (0 = Sunday).
  cycle_start_day TINYINT UNSIGNED NOT NULL DEFAULT 1,
  cutoff_day TINYINT UNSIGNED NULL,
  pay_day TINYINT UNSIGNED NULL,
  rounding_mode ENUM('NONE', 'NEAREST', 'UP', 'DOWN') NOT NULL DEFAULT 'NEAREST',
  rounding_precision TINYINT UNSIGNED NOT NULL DEFAULT 0,
-- Denominator for per-day pay: calendar days, working days, or a fixed number.
  lop_basis ENUM('CALENDAR_DAYS', 'WORKING_DAYS', 'FIXED_DAYS') NOT NULL DEFAULT 'CALENDAR_DAYS',
  fixed_days_per_month TINYINT UNSIGNED NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_pay_cycles_active (is_active),
  INDEX idx_pay_cycles_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Extend the existing salary_periods rather than replacing it, so every
-- current period, salary line and payroll screen keeps working unchanged.
ALTER TABLE salary_periods ADD COLUMN cycle_id INT UNSIGNED NULL;
ALTER TABLE salary_periods ADD COLUMN currency CHAR(3) NOT NULL DEFAULT 'INR';
ALTER TABLE salary_periods ADD COLUMN country CHAR(2) NOT NULL DEFAULT 'IN';
ALTER TABLE salary_periods ADD COLUMN company VARCHAR(160) NULL;
ALTER TABLE salary_periods ADD COLUMN branch VARCHAR(120) NULL;
ALTER TABLE salary_periods ADD COLUMN pay_date DATE NULL;
ALTER TABLE salary_periods ADD COLUMN approval_status ENUM('DRAFT', 'PENDING', 'APPROVED', 'REJECTED') NOT NULL DEFAULT 'DRAFT';
ALTER TABLE salary_periods ADD CONSTRAINT fk_periods_cycle FOREIGN KEY (cycle_id) REFERENCES pay_cycles(id) ON DELETE SET NULL;
ALTER TABLE salary_periods ADD INDEX idx_periods_cycle (cycle_id);

-- A payroll run is one execution over a period. Several runs can target the
-- same period: the regular run, an off-cycle bonus run, a retro correction.
CREATE TABLE IF NOT EXISTS payroll_runs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  period_id INT UNSIGNED NOT NULL,
  run_type ENUM(
    'REGULAR', 'OFF_CYCLE', 'RETRO', 'ARREARS', 'FINAL_SETTLEMENT', 'BONUS', 'SIMULATION'
  ) NOT NULL DEFAULT 'REGULAR',
  status ENUM(
    'DRAFT', 'QUEUED', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED',
    'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'LOCKED', 'PAID'
  ) NOT NULL DEFAULT 'DRAFT',
  label VARCHAR(200) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
-- A simulation never writes salary_lines; it reports figures only.
  is_simulation BOOLEAN NOT NULL DEFAULT false,
  employee_filter_json TEXT NULL,
  total_employees INT UNSIGNED NOT NULL DEFAULT 0,
  processed_employees INT UNSIGNED NOT NULL DEFAULT 0,
  failed_employees INT UNSIGNED NOT NULL DEFAULT 0,
  total_gross DECIMAL(16, 2) NOT NULL DEFAULT 0,
  total_deductions DECIMAL(16, 2) NOT NULL DEFAULT 0,
  total_net DECIMAL(16, 2) NOT NULL DEFAULT 0,
  total_employer_cost DECIMAL(16, 2) NOT NULL DEFAULT 0,
  started_at DATETIME NULL,
  finished_at DATETIME NULL,
  duration_ms INT UNSIGNED NULL,
  error_message VARCHAR(1000) NULL,
  warnings_json MEDIUMTEXT NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (period_id) REFERENCES salary_periods(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_runs_period (period_id, run_type),
  INDEX idx_runs_status (status),
  INDEX idx_runs_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Per-employee failures during a run, so a single bad record never aborts payroll.
CREATE TABLE IF NOT EXISTS payroll_run_errors (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  run_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NULL,
  severity ENUM('WARNING', 'ERROR') NOT NULL DEFAULT 'ERROR',
  code VARCHAR(60) NULL,
  message VARCHAR(1000) NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (run_id) REFERENCES payroll_runs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_run_errors_run (run_id, severity)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
