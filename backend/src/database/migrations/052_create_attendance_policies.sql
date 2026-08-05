-- Attendance policies: the rule set the punch engine evaluates against.
-- Scoped rows (company/branch/department/employee) let one deployment run
-- different working-hour rules per country or site. The most specific
-- matching row wins, broken by `priority` then by id.
CREATE TABLE IF NOT EXISTS attendance_policies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  description TEXT NULL,
  company_id INT UNSIGNED NULL,
  is_default BOOLEAN NOT NULL DEFAULT false,
  priority INT NOT NULL DEFAULT 100,

  -- Working hours
  working_hours_per_day DECIMAL(4, 2) NOT NULL DEFAULT 8.00,
  full_day_hours DECIMAL(4, 2) NOT NULL DEFAULT 8.00,
  half_day_hours DECIMAL(4, 2) NOT NULL DEFAULT 4.00,
  min_hours_for_present DECIMAL(4, 2) NOT NULL DEFAULT 4.00,
  max_hours_per_day DECIMAL(4, 2) NOT NULL DEFAULT 12.00,
  max_hours_per_week DECIMAL(5, 2) NOT NULL DEFAULT 48.00,

  -- Grace / late / early exit
  grace_minutes INT UNSIGNED NOT NULL DEFAULT 15,
  late_after_minutes INT UNSIGNED NOT NULL DEFAULT 15,
  late_penalty_type ENUM('NONE', 'WARN', 'HALF_DAY', 'DEDUCT_HOURS', 'ABSENT') NOT NULL DEFAULT 'WARN',
  late_penalty_after_count INT UNSIGNED NOT NULL DEFAULT 3,
  max_late_per_month INT UNSIGNED NOT NULL DEFAULT 3,
  early_exit_grace_minutes INT UNSIGNED NOT NULL DEFAULT 15,
  early_exit_penalty_type ENUM('NONE', 'WARN', 'HALF_DAY', 'DEDUCT_HOURS') NOT NULL DEFAULT 'WARN',

  -- Half day and weekly off
  half_day_enabled BOOLEAN NOT NULL DEFAULT true,
  week_off_days VARCHAR(20) NOT NULL DEFAULT '0',
  alternate_week_off VARCHAR(20) NULL,
  week_off_paid BOOLEAN NOT NULL DEFAULT true,
  holiday_paid BOOLEAN NOT NULL DEFAULT true,
  sandwich_leave_rule BOOLEAN NOT NULL DEFAULT false,

  -- Overtime
  ot_enabled BOOLEAN NOT NULL DEFAULT true,
  ot_requires_approval BOOLEAN NOT NULL DEFAULT true,
  ot_min_minutes INT UNSIGNED NOT NULL DEFAULT 30,
  ot_rounding_minutes INT UNSIGNED NOT NULL DEFAULT 15,
  ot_max_hours_per_day DECIMAL(4, 2) NOT NULL DEFAULT 4.00,
  ot_max_hours_per_month DECIMAL(6, 2) NOT NULL DEFAULT 50.00,
  ot_multiplier_weekday DECIMAL(4, 2) NOT NULL DEFAULT 1.00,
  ot_multiplier_weekoff DECIMAL(4, 2) NOT NULL DEFAULT 2.00,
  ot_multiplier_holiday DECIMAL(4, 2) NOT NULL DEFAULT 2.00,
  ot_multiplier_night DECIMAL(4, 2) NOT NULL DEFAULT 1.50,

  -- Automation
  auto_absent_if_no_punch BOOLEAN NOT NULL DEFAULT true,
  auto_punch_out_enabled BOOLEAN NOT NULL DEFAULT false,
  auto_punch_out_after_hours DECIMAL(4, 2) NULL,
  auto_mark_week_off BOOLEAN NOT NULL DEFAULT true,
  auto_mark_holiday BOOLEAN NOT NULL DEFAULT true,

  -- Capture restrictions
  allowed_capture_methods VARCHAR(255) NOT NULL DEFAULT 'WEB,MOBILE,KIOSK,BIOMETRIC,QR,NFC,MANUAL,IMPORT',
  require_geofence BOOLEAN NOT NULL DEFAULT false,
  require_photo BOOLEAN NOT NULL DEFAULT false,
  require_face_match BOOLEAN NOT NULL DEFAULT false,
  allow_remote_punch BOOLEAN NOT NULL DEFAULT true,
  allow_offline_punch BOOLEAN NOT NULL DEFAULT true,
  offline_max_age_hours INT UNSIGNED NOT NULL DEFAULT 72,
  restrict_ip BOOLEAN NOT NULL DEFAULT false,
  max_punches_per_day INT UNSIGNED NOT NULL DEFAULT 20,
  min_minutes_between_punches INT UNSIGNED NOT NULL DEFAULT 1,

  -- Compliance
  min_rest_hours_between_shifts DECIMAL(4, 2) NOT NULL DEFAULT 11.00,
  max_consecutive_work_days INT UNSIGNED NOT NULL DEFAULT 6,
  mandatory_break_after_hours DECIMAL(4, 2) NULL,

  -- Regularization
  regularization_enabled BOOLEAN NOT NULL DEFAULT true,
  regularization_window_days INT UNSIGNED NOT NULL DEFAULT 7,
  max_regularizations_per_month INT UNSIGNED NOT NULL DEFAULT 3,

  effective_from DATE NULL,
  effective_to DATE NULL,
  status ENUM('ACTIVE', 'INACTIVE', 'DRAFT') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_attendance_policy_code (code),
  INDEX idx_att_policy_company (company_id),
  INDEX idx_att_policy_status (status),
  INDEX idx_att_policy_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which employees a policy applies to. A NULL scope_id on a COMPANY-scoped row
-- means "every company", which is how the default policy is expressed.
CREATE TABLE IF NOT EXISTS attendance_policy_assignments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  policy_id INT UNSIGNED NOT NULL,
  scope_type ENUM('GLOBAL', 'COMPANY', 'BRANCH', 'DEPARTMENT', 'DIVISION', 'TEAM', 'JOB_GRADE', 'EMPLOYEE', 'WORKER_TYPE') NOT NULL,
  scope_id INT UNSIGNED NULL,
  scope_value VARCHAR(50) NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (policy_id) REFERENCES attendance_policies(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_att_policy_assign_scope (scope_type, scope_id),
  INDEX idx_att_policy_assign_policy (policy_id),
  INDEX idx_att_policy_assign_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Break catalogue. `is_paid` decides whether the minutes are subtracted from
-- worked hours when the punch engine closes out a day.
CREATE TABLE IF NOT EXISTS break_types (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  name VARCHAR(100) NOT NULL,
  company_id INT UNSIGNED NULL,
  is_paid BOOLEAN NOT NULL DEFAULT false,
  default_minutes INT UNSIGNED NOT NULL DEFAULT 30,
  max_minutes INT UNSIGNED NOT NULL DEFAULT 60,
  max_per_day INT UNSIGNED NOT NULL DEFAULT 1,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  is_mandatory BOOLEAN NOT NULL DEFAULT false,
  earliest_start TIME NULL,
  latest_end TIME NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_break_type_code (code),
  INDEX idx_break_type_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
