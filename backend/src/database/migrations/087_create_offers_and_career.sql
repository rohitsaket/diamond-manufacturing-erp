-- Internal offers: transfer, promotion, salary revision or gig assignment.
-- Acceptance is a click-to-accept recorded with the authenticated user, time
-- and IP - an audit-backed acknowledgement, not a cryptographic signature.
CREATE TABLE IF NOT EXISTS internal_offers (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  offer_code VARCHAR(30) NOT NULL UNIQUE,
  application_id INT UNSIGNED NOT NULL,
  offer_type ENUM('INTERNAL_TRANSFER', 'PROMOTION', 'SALARY_REVISION', 'GIG_ASSIGNMENT') NOT NULL DEFAULT 'INTERNAL_TRANSFER',
  title VARCHAR(255) NOT NULL,
  to_department_id INT UNSIGNED NULL,
  to_team_id INT UNSIGNED NULL,
  to_role_id INT UNSIGNED NULL,
  to_position_id INT UNSIGNED NULL,
  to_grade VARCHAR(20) NULL,
  salary_revision_pct DECIMAL(5, 2) NULL,
  salary_revision_amount DECIMAL(12, 2) NULL,
  effective_date DATE NULL,
  valid_until DATE NULL,
  terms TEXT NULL,
  letter_number VARCHAR(60) NULL,
  letter_generated_at DATETIME NULL,
  status ENUM('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'RELEASED', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN', 'EFFECTED') NOT NULL DEFAULT 'DRAFT',
  released_at DATETIME NULL,
  responded_at DATETIME NULL,
  response_note VARCHAR(1000) NULL,
  accepted_by_user_id INT UNSIGNED NULL,
  acceptance_ip VARCHAR(64) NULL,
  effected_at DATETIME NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (application_id) REFERENCES internal_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (to_department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (to_team_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (to_role_id) REFERENCES job_roles(id) ON DELETE SET NULL,
  FOREIGN KEY (to_position_id) REFERENCES positions(id) ON DELETE SET NULL,
  FOREIGN KEY (accepted_by_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_offers_application (application_id),
  INDEX idx_offers_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One career-interests row per employee, driving the rule-based job matching.
CREATE TABLE IF NOT EXISTS career_interests (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  preferred_roles JSON NULL,
  preferred_departments JSON NULL,
  work_mode_preference ENUM('ANY', 'ONSITE', 'REMOTE', 'HYBRID') NOT NULL DEFAULT 'ANY',
  willing_to_relocate BOOLEAN NOT NULL DEFAULT false,
  open_to_gigs BOOLEAN NOT NULL DEFAULT true,
  career_statement VARCHAR(1000) NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_career_interest (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recruitment audit trail, same shape as perf_audit_logs.
CREATE TABLE IF NOT EXISTS rec_audit_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  entity_type VARCHAR(40) NOT NULL,
  entity_id INT UNSIGNED NOT NULL,
  action VARCHAR(60) NOT NULL,
  user_id INT UNSIGNED NULL,
  user_role VARCHAR(20) NULL,
  previous_value JSON NULL,
  new_value JSON NULL,
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(255) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_rec_audit_entity (entity_type, entity_id),
  INDEX idx_rec_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
