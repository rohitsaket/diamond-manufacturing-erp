-- Exit letters: acceptance, experience, relieving, recommendation, clearance
-- certificate. verify_token backs the QR verification (HMAC, same pattern as
-- payslips); there is no X.509 digital signature in this deployment.
CREATE TABLE IF NOT EXISTS exit_letters (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  separation_id INT UNSIGNED NOT NULL,
  letter_type ENUM('ACCEPTANCE', 'EXPERIENCE', 'RELIEVING', 'RECOMMENDATION', 'CLEARANCE_CERT') NOT NULL,
  letter_number VARCHAR(60) NOT NULL UNIQUE,
  verify_token VARCHAR(128) NULL,
  status ENUM('DRAFT', 'ISSUED', 'EMAILED') NOT NULL DEFAULT 'DRAFT',
  generated_by INT UNSIGNED NULL,
  generated_at DATETIME NULL,
  emailed_at DATETIME NULL,
  email_error VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (separation_id) REFERENCES separations(id) ON DELETE CASCADE,
  FOREIGN KEY (generated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_exit_letter (separation_id, letter_type),
  INDEX idx_exit_letters_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Alumni registry: one row per exited employee. Boomerang tracking links the
-- new employee row when a rehire happens.
CREATE TABLE IF NOT EXISTS alumni (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  separation_id INT UNSIGNED NULL,
  exit_date DATE NULL,
  last_grade VARCHAR(20) NULL,
  last_department VARCHAR(120) NULL,
  contact_email VARCHAR(255) NULL,
  contact_phone VARCHAR(20) NULL,
  rehire_eligible BOOLEAN NULL,
  rehire_restriction_note VARCHAR(500) NULL,
  is_boomerang BOOLEAN NOT NULL DEFAULT false,
  rehired_employee_id INT UNSIGNED NULL,
  rehired_at DATE NULL,
  in_alumni_network BOOLEAN NOT NULL DEFAULT false,
  notes VARCHAR(1000) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (separation_id) REFERENCES separations(id) ON DELETE SET NULL,
  FOREIGN KEY (rehired_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  UNIQUE KEY uk_alumni_employee (employee_id),
  INDEX idx_alumni_rehire (rehire_eligible)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Rehire decisions on alumni: an explicit reviewed verdict with its reason.
CREATE TABLE IF NOT EXISTS rehire_reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  alumni_id INT UNSIGNED NOT NULL,
  decision ENUM('ELIGIBLE', 'RESTRICTED', 'BLOCKED') NOT NULL,
  reason VARCHAR(1000) NULL,
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (alumni_id) REFERENCES alumni(id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_rehire_reviews (alumni_id, decided_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Offboarding audit trail, same shape as the other module audit tables.
CREATE TABLE IF NOT EXISTS exit_audit_logs (
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
  INDEX idx_exit_audit_entity (entity_type, entity_id),
  INDEX idx_exit_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
