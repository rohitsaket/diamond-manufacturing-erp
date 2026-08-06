-- Separation cases: one row per exit, whatever the type. Resignations start
-- as employee-submitted DRAFTs; other types are opened by HR. The case is the
-- container every other offboarding table hangs off.
CREATE TABLE IF NOT EXISTS separations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  sep_code VARCHAR(30) NOT NULL UNIQUE,
  employee_id INT UNSIGNED NOT NULL,
  separation_type ENUM('RESIGNATION', 'RETIREMENT', 'TERMINATION', 'LAYOFF', 'CONTRACT_END', 'ABSCONDING', 'DEATH_IN_SERVICE', 'MUTUAL', 'ENTITY_TRANSFER') NOT NULL DEFAULT 'RESIGNATION',
  status ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'WITHDRAWN', 'IN_NOTICE', 'CLEARANCE', 'SETTLEMENT', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  reason TEXT NULL,
  resignation_date DATE NULL,
  notice_days INT UNSIGNED NULL,
  notice_start DATE NULL,
  notice_end DATE NULL,
  last_working_day DATE NULL,
  early_release_requested BOOLEAN NOT NULL DEFAULT false,
  early_release_date DATE NULL,
  early_release_reason VARCHAR(500) NULL,
  early_release_approved_by INT UNSIGNED NULL,
  notice_buyout_days INT UNSIGNED NULL,
  notice_buyout_amount DECIMAL(12, 2) NULL,
  notice_waived BOOLEAN NOT NULL DEFAULT false,
  notice_waiver_reason VARCHAR(500) NULL,
  garden_leave BOOLEAN NOT NULL DEFAULT false,
  manager_reviewed_by INT UNSIGNED NULL,
  manager_reviewed_at DATETIME NULL,
  manager_note VARCHAR(1000) NULL,
  hr_reviewed_by INT UNSIGNED NULL,
  hr_reviewed_at DATETIME NULL,
  hr_note VARCHAR(1000) NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  rejection_reason VARCHAR(500) NULL,
  withdrawn_at DATETIME NULL,
  withdraw_reason VARCHAR(500) NULL,
  rehire_eligible BOOLEAN NULL,
  rehire_note VARCHAR(500) NULL,
  completed_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (early_release_approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (manager_reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (hr_reviewed_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_separations_employee (employee_id, status),
  INDEX idx_separations_status (status, separation_type),
  INDEX idx_separations_lwd (last_working_day),
  INDEX idx_separations_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only case timeline: submissions, reviews, stage moves, clearances.
CREATE TABLE IF NOT EXISTS separation_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  separation_id INT UNSIGNED NOT NULL,
  event VARCHAR(80) NOT NULL,
  note VARCHAR(1000) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (separation_id) REFERENCES separations(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_separation_events (separation_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notice period rules by worker type (grade override optional). Editable
-- configuration, not legal advice.
CREATE TABLE IF NOT EXISTS notice_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  worker_type ENUM('PIECE_RATE', 'DHAR', 'MAXI') NULL,
  grade VARCHAR(20) NULL,
  notice_days INT UNSIGNED NOT NULL DEFAULT 30,
  buyout_allowed BOOLEAN NOT NULL DEFAULT true,
  buyout_rate_basis ENUM('PER_DAY_GROSS', 'PER_DAY_BASIC') NOT NULL DEFAULT 'PER_DAY_GROSS',
  description VARCHAR(255) NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_notice_rules_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
