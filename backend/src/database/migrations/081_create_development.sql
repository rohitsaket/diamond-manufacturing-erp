-- Individual Development Plans. target_role_id points into the existing job
-- architecture (job_roles) so a plan can aim at a real next role; items can link
-- to the existing trainings table instead of duplicating a training catalogue.
CREATE TABLE IF NOT EXISTS development_plans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  cycle_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  career_goal VARCHAR(500) NULL,
  target_role_id INT UNSIGNED NULL,
  mentor_employee_id INT UNSIGNED NULL,
  status ENUM('DRAFT', 'ACTIVE', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  start_date DATE NULL,
  end_date DATE NULL,
  progress_pct DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  review_notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE SET NULL,
  FOREIGN KEY (target_role_id) REFERENCES job_roles(id) ON DELETE SET NULL,
  FOREIGN KEY (mentor_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_dev_plans_employee (employee_id, status),
  INDEX idx_dev_plans_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS development_plan_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id INT UNSIGNED NOT NULL,
  item_type ENUM('TRAINING', 'CERTIFICATION', 'MENTORING', 'PROJECT', 'READING', 'OTHER') NOT NULL DEFAULT 'TRAINING',
  title VARCHAR(255) NOT NULL,
  description VARCHAR(1000) NULL,
  training_id INT UNSIGNED NULL,
  due_date DATE NULL,
  status ENUM('PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  completed_at DATETIME NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES development_plans(id) ON DELETE CASCADE,
  FOREIGN KEY (training_id) REFERENCES trainings(id) ON DELETE SET NULL,
  INDEX idx_dev_plan_items_plan (plan_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Performance Improvement Plans.
CREATE TABLE IF NOT EXISTS pips (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  cycle_id INT UNSIGNED NULL,
  reason TEXT NOT NULL,
  start_date DATE NOT NULL,
  end_date DATE NOT NULL,
  status ENUM('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'EXTENDED', 'CLOSED_SUCCESSFUL', 'CLOSED_UNSUCCESSFUL', 'WITHDRAWN', 'ESCALATED') NOT NULL DEFAULT 'DRAFT',
  outcome_note TEXT NULL,
  closed_at DATETIME NULL,
  opened_by INT UNSIGNED NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE SET NULL,
  FOREIGN KEY (opened_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_pips_employee (employee_id, status),
  INDEX idx_pips_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pip_objectives (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pip_id INT UNSIGNED NOT NULL,
  objective VARCHAR(500) NOT NULL,
  success_criteria VARCHAR(500) NULL,
  status ENUM('PENDING', 'ON_TRACK', 'AT_RISK', 'MET', 'NOT_MET') NOT NULL DEFAULT 'PENDING',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (pip_id) REFERENCES pips(id) ON DELETE CASCADE,
  INDEX idx_pip_objectives_pip (pip_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Scheduled check-in meetings during a PIP with the recorded outcome of each.
CREATE TABLE IF NOT EXISTS pip_reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  pip_id INT UNSIGNED NOT NULL,
  review_date DATE NOT NULL,
  progress ENUM('ON_TRACK', 'AT_RISK', 'OFF_TRACK') NOT NULL DEFAULT 'ON_TRACK',
  summary TEXT NULL,
  next_steps VARCHAR(1000) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (pip_id) REFERENCES pips(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_pip_reviews_pip (pip_id, review_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
