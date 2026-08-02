-- Configurable document type master. Replaces the frozen `doc_type` enum as the
-- source of truth while that column stays in place for backward compatibility.
CREATE TABLE IF NOT EXISTS document_types (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(60) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  category ENUM(
    'GOVERNMENT_ID', 'PERSONAL', 'EDUCATION', 'CERTIFICATION', 'EMPLOYMENT',
    'EXPERIENCE', 'PAYROLL_FINANCE', 'MEDICAL', 'IMMIGRATION', 'COMPLIANCE',
    'SIGNATURE', 'HR_FORM', 'ASSET', 'LEGAL', 'EMPLOYEE_GENERATED', 'OTHER'
  ) NOT NULL DEFAULT 'OTHER',
  description VARCHAR(500) NULL,
  country VARCHAR(2) NULL,
  legacy_doc_type VARCHAR(40) NULL,
  is_mandatory BOOLEAN NOT NULL DEFAULT false,
  requires_expiry BOOLEAN NOT NULL DEFAULT false,
  requires_verification BOOLEAN NOT NULL DEFAULT true,
  requires_approval BOOLEAN NOT NULL DEFAULT false,
  allows_multiple BOOLEAN NOT NULL DEFAULT false,
  retention_months INT UNSIGNED NULL,
  renewal_reminder_days INT UNSIGNED NOT NULL DEFAULT 30,
  max_file_mb INT UNSIGNED NOT NULL DEFAULT 5,
  is_confidential BOOLEAN NOT NULL DEFAULT false,
  sort_order INT UNSIGNED NOT NULL DEFAULT 100,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_doctypes_category (category),
  INDEX idx_doctypes_country (country),
  INDEX idx_doctypes_mandatory (is_mandatory, is_active),
  INDEX idx_doctypes_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Which document types are required for whom (country / employment type / grade).
CREATE TABLE IF NOT EXISTS document_requirements (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_type_id INT UNSIGNED NOT NULL,
  country VARCHAR(2) NULL,
  employment_type VARCHAR(40) NULL,
  worker_type VARCHAR(40) NULL,
  grade VARCHAR(20) NULL,
  department VARCHAR(100) NULL,
  is_mandatory BOOLEAN NOT NULL DEFAULT true,
  due_days_after_joining INT UNSIGNED NULL,
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (document_type_id) REFERENCES document_types(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_docreq_type (document_type_id),
  INDEX idx_docreq_scope (country, employment_type, worker_type),
  INDEX idx_docreq_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
