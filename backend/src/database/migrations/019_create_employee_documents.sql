-- Create employee documents table (KYC and HR document store)
CREATE TABLE IF NOT EXISTS employee_documents (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  doc_type ENUM('AADHAAR', 'PAN', 'BANK_PASSBOOK', 'PHOTO', 'AGREEMENT', 'CERTIFICATE', 'OTHER') NOT NULL,
  title VARCHAR(255) NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INT UNSIGNED NOT NULL,
  verified BOOLEAN NOT NULL DEFAULT false,
  verified_by INT UNSIGNED NULL,
  verified_at DATETIME NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (verified_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_documents_employee (employee_id),
  INDEX idx_documents_verified (verified),
  INDEX idx_documents_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
