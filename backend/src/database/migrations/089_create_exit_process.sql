-- Exit interviews (HR and manager rounds) for a separation case.
CREATE TABLE IF NOT EXISTS exit_interviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  separation_id INT UNSIGNED NOT NULL,
  interview_type ENUM('HR', 'MANAGER') NOT NULL DEFAULT 'HR',
  scheduled_at DATETIME NULL,
  interviewer_user_id INT UNSIGNED NULL,
  status ENUM('PENDING', 'SCHEDULED', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PENDING',
  summary TEXT NULL,
  key_reasons VARCHAR(1000) NULL,
  would_recommend_company BOOLEAN NULL,
  completed_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (separation_id) REFERENCES separations(id) ON DELETE CASCADE,
  FOREIGN KEY (interviewer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_exit_interviews_sep (separation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Configurable exit survey questions.
CREATE TABLE IF NOT EXISTS exit_survey_questions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  question VARCHAR(500) NOT NULL,
  kind ENUM('TEXT', 'RATING', 'CHOICE') NOT NULL DEFAULT 'RATING',
  choices_json JSON NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_survey_questions_active (is_active, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Survey answers. Anonymity contract: when the employee opts for anonymous
-- feedback the service stores separation_id NULL and keeps only the
-- department and a tenure band for analytics - the link to the person is
-- genuinely not stored, not merely hidden.
CREATE TABLE IF NOT EXISTS exit_survey_responses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  separation_id INT UNSIGNED NULL,
  department_id INT UNSIGNED NULL,
  tenure_band VARCHAR(20) NULL,
  question_id INT UNSIGNED NOT NULL,
  response_text TEXT NULL,
  rating DECIMAL(4, 2) NULL,
  choice VARCHAR(160) NULL,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (separation_id) REFERENCES separations(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (question_id) REFERENCES exit_survey_questions(id) ON DELETE CASCADE,
  INDEX idx_survey_responses_question (question_id),
  INDEX idx_survey_responses_sep (separation_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Departmental clearances with their task lists.
CREATE TABLE IF NOT EXISTS clearances (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  separation_id INT UNSIGNED NOT NULL,
  department ENUM('HR', 'IT', 'FINANCE', 'ADMIN', 'SECURITY', 'MANAGER', 'PROJECT', 'FACILITY', 'LEGAL') NOT NULL,
  status ENUM('PENDING', 'IN_PROGRESS', 'CLEARED', 'BLOCKED') NOT NULL DEFAULT 'PENDING',
  note VARCHAR(1000) NULL,
  cleared_by INT UNSIGNED NULL,
  cleared_at DATETIME NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (separation_id) REFERENCES separations(id) ON DELETE CASCADE,
  FOREIGN KEY (cleared_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_clearance (separation_id, department),
  INDEX idx_clearances_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS clearance_tasks (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  clearance_id INT UNSIGNED NOT NULL,
  task VARCHAR(255) NOT NULL,
  status ENUM('PENDING', 'DONE', 'NA') NOT NULL DEFAULT 'PENDING',
  note VARCHAR(500) NULL,
  done_by INT UNSIGNED NULL,
  done_at DATETIME NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (clearance_id) REFERENCES clearances(id) ON DELETE CASCADE,
  FOREIGN KEY (done_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_clearance_tasks (clearance_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Asset returns: one row per open assignment from the existing assets module.
-- Verifying a return also closes asset_assignments.returned_on.
CREATE TABLE IF NOT EXISTS asset_returns (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  separation_id INT UNSIGNED NOT NULL,
  asset_assignment_id INT UNSIGNED NOT NULL,
  return_condition ENUM('PENDING', 'GOOD', 'DAMAGED', 'LOST') NOT NULL DEFAULT 'PENDING',
  damage_note VARCHAR(500) NULL,
  damage_charge DECIMAL(12, 2) NULL,
  returned_at DATETIME NULL,
  verified_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (separation_id) REFERENCES separations(id) ON DELETE CASCADE,
  FOREIGN KEY (asset_assignment_id) REFERENCES asset_assignments(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_asset_return (separation_id, asset_assignment_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Knowledge transfer and handover: one plan per case, itemised.
CREATE TABLE IF NOT EXISTS kt_plans (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  separation_id INT UNSIGNED NOT NULL,
  successor_employee_id INT UNSIGNED NULL,
  status ENUM('DRAFT', 'IN_PROGRESS', 'COMPLETED', 'APPROVED') NOT NULL DEFAULT 'DRAFT',
  note VARCHAR(1000) NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uk_kt_plan (separation_id),
  FOREIGN KEY (separation_id) REFERENCES separations(id) ON DELETE CASCADE,
  FOREIGN KEY (successor_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS kt_items (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  plan_id INT UNSIGNED NOT NULL,
  item_type ENUM('SESSION', 'DOCUMENT', 'PROJECT_HANDOVER', 'CLIENT_HANDOVER', 'TEAM_HANDOVER', 'RESPONSIBILITY') NOT NULL DEFAULT 'SESSION',
  title VARCHAR(255) NOT NULL,
  description VARCHAR(1000) NULL,
  due_date DATE NULL,
  status ENUM('PENDING', 'IN_PROGRESS', 'DONE') NOT NULL DEFAULT 'PENDING',
  completed_at DATETIME NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (plan_id) REFERENCES kt_plans(id) ON DELETE CASCADE,
  INDEX idx_kt_items (plan_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Access revocation checklist. is_internal marks entries this HRMS can revoke
-- itself (its own login, attendance device enrollments); everything else is a
-- recorded manual step - no directory or SaaS integration exists.
CREATE TABLE IF NOT EXISTS access_revocations (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  separation_id INT UNSIGNED NOT NULL,
  system_name VARCHAR(80) NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  status ENUM('PENDING', 'REVOKED', 'NA') NOT NULL DEFAULT 'PENDING',
  note VARCHAR(500) NULL,
  revoked_by INT UNSIGNED NULL,
  revoked_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (separation_id) REFERENCES separations(id) ON DELETE CASCADE,
  FOREIGN KEY (revoked_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_access_revocation (separation_id, system_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
