-- Job architecture: family > function > role, with grades, levels and career paths.
CREATE TABLE IF NOT EXISTS job_families (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_jobfamily_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_functions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_family_id INT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  description VARCHAR(500) NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (job_family_id) REFERENCES job_families(id) ON DELETE CASCADE,
  INDEX idx_jobfunction_family (job_family_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_grades (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  rank_order INT UNSIGNED NOT NULL DEFAULT 1,
  min_salary DECIMAL(14, 2) NULL,
  max_salary DECIMAL(14, 2) NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  description VARCHAR(500) NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_jobgrade_rank (rank_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_levels (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  rank_order INT UNSIGNED NOT NULL DEFAULT 1,
  career_stage ENUM('ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'MANAGEMENT', 'EXECUTIVE') NOT NULL DEFAULT 'MID',
  description VARCHAR(500) NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_joblevel_rank (rank_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS job_roles (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_function_id INT UNSIGNED NULL,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  job_grade_id INT UNSIGNED NULL,
  job_level_id INT UNSIGNED NULL,
  description TEXT NULL,
  responsibilities TEXT NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (job_function_id) REFERENCES job_functions(id) ON DELETE SET NULL,
  FOREIGN KEY (job_grade_id) REFERENCES job_grades(id) ON DELETE SET NULL,
  FOREIGN KEY (job_level_id) REFERENCES job_levels(id) ON DELETE SET NULL,
  INDEX idx_jobrole_function (job_function_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Career progression: from one role to the next.
CREATE TABLE IF NOT EXISTS career_paths (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  from_role_id INT UNSIGNED NOT NULL,
  to_role_id INT UNSIGNED NOT NULL,
  typical_years DECIMAL(4, 1) NULL,
  notes VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (from_role_id) REFERENCES job_roles(id) ON DELETE CASCADE,
  FOREIGN KEY (to_role_id) REFERENCES job_roles(id) ON DELETE CASCADE,
  UNIQUE KEY uk_career_path (from_role_id, to_role_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A position is a budgeted seat: it may be filled or vacant.
CREATE TABLE IF NOT EXISTS positions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  company_id INT UNSIGNED NOT NULL,
  code VARCHAR(30) NOT NULL UNIQUE,
  title VARCHAR(160) NOT NULL,
  job_role_id INT UNSIGNED NULL,
  department_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  cost_center_id INT UNSIGNED NULL,
  reports_to_position_id INT UNSIGNED NULL,
  job_grade_id INT UNSIGNED NULL,
  job_level_id INT UNSIGNED NULL,
  headcount_budgeted INT UNSIGNED NOT NULL DEFAULT 1,
  budget_amount DECIMAL(14, 2) NULL,
  employment_type ENUM('PERMANENT', 'CONTRACT', 'PROBATION', 'TRAINEE', 'CONSULTANT') NULL,
  status ENUM('OPEN', 'FILLED', 'ON_HOLD', 'CLOSED') NOT NULL DEFAULT 'OPEN',
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE CASCADE,
  FOREIGN KEY (job_role_id) REFERENCES job_roles(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id) ON DELETE SET NULL,
  FOREIGN KEY (reports_to_position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (job_grade_id) REFERENCES job_grades(id) ON DELETE SET NULL,
  FOREIGN KEY (job_level_id) REFERENCES job_levels(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_positions_company (company_id),
  INDEX idx_positions_department (department_id),
  INDEX idx_positions_status (status),
  INDEX idx_positions_reports_to (reports_to_position_id),
  INDEX idx_positions_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
