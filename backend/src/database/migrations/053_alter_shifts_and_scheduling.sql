-- Extend the existing shifts table rather than replacing it. Every original
-- column keeps its meaning: `week_off_day` still holds the primary weekly off
-- and everything already reading it continues to work. `week_off_days` is the
-- additive multi-day form, consulted first when it is populated.
ALTER TABLE shifts ADD COLUMN code VARCHAR(40) NULL AFTER id;
ALTER TABLE shifts ADD COLUMN company_id INT UNSIGNED NULL AFTER name;
ALTER TABLE shifts ADD COLUMN branch_id INT UNSIGNED NULL AFTER company_id;
ALTER TABLE shifts ADD COLUMN shift_type ENUM('FIXED', 'FLEXIBLE', 'ROTATIONAL', 'NIGHT', 'SPLIT', 'OPEN') NOT NULL DEFAULT 'FIXED' AFTER branch_id;
ALTER TABLE shifts ADD COLUMN crosses_midnight BOOLEAN NOT NULL DEFAULT false AFTER end_time;
ALTER TABLE shifts ADD COLUMN is_night_shift BOOLEAN NOT NULL DEFAULT false AFTER crosses_midnight;
ALTER TABLE shifts ADD COLUMN second_start_time TIME NULL AFTER is_night_shift;
ALTER TABLE shifts ADD COLUMN second_end_time TIME NULL AFTER second_start_time;
ALTER TABLE shifts ADD COLUMN flexible_core_start TIME NULL AFTER second_end_time;
ALTER TABLE shifts ADD COLUMN flexible_core_end TIME NULL AFTER flexible_core_start;
ALTER TABLE shifts ADD COLUMN flexible_min_hours DECIMAL(4, 2) NULL AFTER flexible_core_end;
ALTER TABLE shifts ADD COLUMN full_day_hours DECIMAL(4, 2) NULL AFTER flexible_min_hours;
ALTER TABLE shifts ADD COLUMN half_day_hours DECIMAL(4, 2) NULL AFTER full_day_hours;
ALTER TABLE shifts ADD COLUMN week_off_days VARCHAR(20) NULL AFTER week_off_day;
ALTER TABLE shifts ADD COLUMN ot_eligible BOOLEAN NOT NULL DEFAULT true AFTER week_off_days;
ALTER TABLE shifts ADD COLUMN timezone VARCHAR(64) NULL AFTER ot_eligible;
ALTER TABLE shifts ADD COLUMN color VARCHAR(20) NULL AFTER timezone;
ALTER TABLE shifts ADD COLUMN max_employees INT UNSIGNED NULL AFTER color;
ALTER TABLE shifts ADD COLUMN status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE' AFTER max_employees;

ALTER TABLE shifts ADD UNIQUE KEY uk_shifts_code (code);
ALTER TABLE shifts ADD INDEX idx_shifts_type (shift_type);
ALTER TABLE shifts ADD INDEX idx_shifts_branch (branch_id);
ALTER TABLE shifts ADD CONSTRAINT fk_shifts_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE shifts ADD CONSTRAINT fk_shifts_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;

-- A rotation pattern is a repeating cycle of shift codes. `pattern` holds a
-- JSON array whose length must equal cycle_days, e.g. ["MORNING","MORNING","NIGHT","OFF"].
CREATE TABLE IF NOT EXISTS shift_rotation_patterns (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(120) NOT NULL,
  company_id INT UNSIGNED NULL,
  description TEXT NULL,
  cycle_days INT UNSIGNED NOT NULL,
  pattern JSON NOT NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_rotation_code (code),
  INDEX idx_rotation_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Effective-dated shift assignment. employees.shift_id stays authoritative for
-- everything already reading it -- this table answers "which shift on date X",
-- which a single column cannot, and is what the roster generator reads.
CREATE TABLE IF NOT EXISTS employee_shift_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  shift_id INT UNSIGNED NULL,
  rotation_pattern_id INT UNSIGNED NULL,
  rotation_anchor_date DATE NULL,
  rotation_offset INT UNSIGNED NOT NULL DEFAULT 0,
  effective_from DATE NOT NULL,
  effective_to DATE NULL,
  is_primary BOOLEAN NOT NULL DEFAULT true,
  assignment_reason VARCHAR(255) NULL,
  request_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
  FOREIGN KEY (rotation_pattern_id) REFERENCES shift_rotation_patterns(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_esa_employee_dates (employee_id, effective_from, effective_to),
  INDEX idx_esa_shift (shift_id),
  INDEX idx_esa_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A roster is a published plan for a date range. Entries are the per-day cells.
CREATE TABLE IF NOT EXISTS rosters (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  company_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  department_id INT UNSIGNED NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  status ENUM('DRAFT', 'PUBLISHED', 'LOCKED', 'ARCHIVED') NOT NULL DEFAULT 'DRAFT',
  notes TEXT NULL,
  published_by INT UNSIGNED NULL,
  published_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (published_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_roster_code (code),
  INDEX idx_roster_dates (from_date, to_date),
  INDEX idx_roster_status (status),
  INDEX idx_roster_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS roster_entries (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  roster_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  work_date DATE NOT NULL,
  shift_id INT UNSIGNED NULL,
  is_week_off BOOLEAN NOT NULL DEFAULT false,
  is_holiday BOOLEAN NOT NULL DEFAULT false,
  is_leave BOOLEAN NOT NULL DEFAULT false,
  planned_hours DECIMAL(4, 2) NULL,
  location_id INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (roster_id) REFERENCES rosters(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  UNIQUE KEY uk_roster_entry (roster_id, employee_id, work_date),
  INDEX idx_roster_entry_emp_date (employee_id, work_date),
  INDEX idx_roster_entry_date (work_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
