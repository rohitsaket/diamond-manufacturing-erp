-- Job requisitions: the approved hiring demand an internal job posting hangs
-- off. Links to the budgeted positions table where one exists.
CREATE TABLE IF NOT EXISTS job_requisitions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  req_code VARCHAR(30) NOT NULL UNIQUE,
  requisition_type ENUM('NEW_POSITION', 'REPLACEMENT', 'EXPANSION') NOT NULL DEFAULT 'NEW_POSITION',
  title VARCHAR(255) NOT NULL,
  position_id INT UNSIGNED NULL,
  department_id INT UNSIGNED NULL,
  job_role_id INT UNSIGNED NULL,
  headcount INT UNSIGNED NOT NULL DEFAULT 1,
  replacement_for_employee_id INT UNSIGNED NULL,
  justification TEXT NULL,
  budget_amount DECIMAL(14, 2) NULL,
  budget_approved BOOLEAN NOT NULL DEFAULT false,
  budget_approved_by INT UNSIGNED NULL,
  budget_approved_at DATETIME NULL,
  status ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED', 'FULFILLED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  requested_by INT UNSIGNED NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (job_role_id) REFERENCES job_roles(id) ON DELETE SET NULL,
  FOREIGN KEY (replacement_for_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (budget_approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_requisitions_status (status),
  INDEX idx_requisitions_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Internal job postings for the talent marketplace. Distinct from the existing
-- external job_openings table (which keeps working unchanged); opening_id
-- optionally bridges an internal posting to an external opening.
-- eligibility_rules holds the whole rules object as JSON:
-- {minTenureMonths, allowedGrades[], minPerformanceRating, requiredSkills[],
--  requiredCertifications[], maxNoticeDays} - the service evaluates it per
-- applicant and stores the outcome on the application.
CREATE TABLE IF NOT EXISTS internal_jobs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_code VARCHAR(30) NOT NULL UNIQUE,
  requisition_id INT UNSIGNED NULL,
  opening_id INT UNSIGNED NULL,
  template_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  category VARCHAR(60) NULL,
  department_id INT UNSIGNED NULL,
  team_id INT UNSIGNED NULL,
  job_role_id INT UNSIGNED NULL,
  grade VARCHAR(20) NULL,
  location VARCHAR(160) NULL,
  work_mode ENUM('ONSITE', 'REMOTE', 'HYBRID') NOT NULL DEFAULT 'ONSITE',
  employment_type ENUM('FULL_TIME', 'PART_TIME', 'GIG', 'SHORT_TERM') NOT NULL DEFAULT 'FULL_TIME',
  openings INT UNSIGNED NOT NULL DEFAULT 1,
  salary_range_min DECIMAL(12, 2) NULL,
  salary_range_max DECIMAL(12, 2) NULL,
  eligibility_rules JSON NULL,
  is_featured BOOLEAN NOT NULL DEFAULT false,
  is_confidential BOOLEAN NOT NULL DEFAULT false,
  visibility ENUM('ALL', 'DEPARTMENT') NOT NULL DEFAULT 'ALL',
  visibility_department_id INT UNSIGNED NULL,
  status ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'PUBLISHED', 'PAUSED', 'EXPIRED', 'ARCHIVED', 'FILLED', 'CANCELLED') NOT NULL DEFAULT 'DRAFT',
  publish_at DATETIME NULL,
  expires_at DATETIME NULL,
  published_at DATETIME NULL,
  filled_at DATETIME NULL,
  hiring_manager_employee_id INT UNSIGNED NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (requisition_id) REFERENCES job_requisitions(id) ON DELETE SET NULL,
  FOREIGN KEY (opening_id) REFERENCES job_openings(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (job_role_id) REFERENCES job_roles(id) ON DELETE SET NULL,
  FOREIGN KEY (visibility_department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (hiring_manager_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_internal_jobs_status (status, publish_at, expires_at),
  INDEX idx_internal_jobs_dept (department_id),
  INDEX idx_internal_jobs_featured (is_featured),
  INDEX idx_internal_jobs_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS internal_job_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  title_template VARCHAR(255) NOT NULL,
  description_template TEXT NULL,
  category VARCHAR(60) NULL,
  work_mode ENUM('ONSITE', 'REMOTE', 'HYBRID') NOT NULL DEFAULT 'ONSITE',
  employment_type ENUM('FULL_TIME', 'PART_TIME', 'GIG', 'SHORT_TERM') NOT NULL DEFAULT 'FULL_TIME',
  eligibility_rules JSON NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_job_templates_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Saved and favourite jobs, one row per employee per job.
CREATE TABLE IF NOT EXISTS saved_jobs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  job_id INT UNSIGNED NOT NULL,
  is_favorite BOOLEAN NOT NULL DEFAULT false,
  saved_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (job_id) REFERENCES internal_jobs(id) ON DELETE CASCADE,
  UNIQUE KEY uk_saved_job (employee_id, job_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
