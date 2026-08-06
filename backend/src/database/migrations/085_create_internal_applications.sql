-- Internal applications. eligibility_result stores the rule-by-rule evaluation
-- that ran at submit time ([{rule, pass, detail}]); an HR override keeps the
-- original result and records why it was bypassed.
CREATE TABLE IF NOT EXISTS internal_applications (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  status ENUM('DRAFT', 'SUBMITTED', 'UNDER_REVIEW', 'SHORTLISTED', 'ASSESSMENT', 'INTERVIEW', 'SELECTED', 'OFFERED', 'HIRED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'DRAFT',
  cover_letter TEXT NULL,
  resume_document_id INT UNSIGNED NULL,
  profile_snapshot JSON NULL,
  expected_notice_days INT UNSIGNED NULL,
  eligibility_result JSON NULL,
  eligibility_passed BOOLEAN NULL,
  eligibility_override BOOLEAN NOT NULL DEFAULT false,
  override_reason VARCHAR(500) NULL,
  override_by INT UNSIGNED NULL,
  submitted_at DATETIME NULL,
  withdrawn_at DATETIME NULL,
  withdraw_reason VARCHAR(500) NULL,
  decided_at DATETIME NULL,
  decision_note VARCHAR(1000) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (job_id) REFERENCES internal_jobs(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (resume_document_id) REFERENCES employee_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (override_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_application (job_id, employee_id),
  INDEX idx_applications_status (status),
  INDEX idx_applications_employee (employee_id, status),
  INDEX idx_applications_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only status timeline for every application.
CREATE TABLE IF NOT EXISTS application_stage_events (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id INT UNSIGNED NOT NULL,
  from_status VARCHAR(20) NULL,
  to_status VARCHAR(20) NOT NULL,
  note VARCHAR(1000) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES internal_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_stage_events_application (application_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supporting documents uploaded with an application.
CREATE TABLE IF NOT EXISTS application_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id INT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NULL,
  file_size INT UNSIGNED NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (application_id) REFERENCES internal_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_application_docs (application_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Referrals: internal (referred_employee_id) or external (name/phone/email).
-- An accepted internal referral becomes an internal application; an accepted
-- external referral becomes a row in the existing candidates pipeline.
-- Rewards flow through the performance module's recognition + points ledger.
CREATE TABLE IF NOT EXISTS referrals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  job_id INT UNSIGNED NULL,
  referrer_employee_id INT UNSIGNED NOT NULL,
  referred_employee_id INT UNSIGNED NULL,
  external_name VARCHAR(160) NULL,
  external_phone VARCHAR(20) NULL,
  external_email VARCHAR(255) NULL,
  note VARCHAR(1000) NULL,
  status ENUM('SUBMITTED', 'UNDER_REVIEW', 'ACCEPTED', 'HIRED', 'REJECTED', 'WITHDRAWN') NOT NULL DEFAULT 'SUBMITTED',
  application_id INT UNSIGNED NULL,
  candidate_id INT UNSIGNED NULL,
  reward_points INT UNSIGNED NOT NULL DEFAULT 0,
  reward_recognition_id INT UNSIGNED NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (job_id) REFERENCES internal_jobs(id) ON DELETE SET NULL,
  FOREIGN KEY (referrer_employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (referred_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (application_id) REFERENCES internal_applications(id) ON DELETE SET NULL,
  FOREIGN KEY (candidate_id) REFERENCES candidates(id) ON DELETE SET NULL,
  FOREIGN KEY (reward_recognition_id) REFERENCES recognitions(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_referrals_referrer (referrer_employee_id, status),
  INDEX idx_referrals_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
