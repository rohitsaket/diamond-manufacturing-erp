-- Audit trail for every action taken on a document.
CREATE TABLE IF NOT EXISTS document_audit_logs (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id INT UNSIGNED NULL,
  employee_id INT UNSIGNED NULL,
  actor_user_id INT UNSIGNED NULL,
  actor_name VARCHAR(160) NULL,
  actor_role VARCHAR(40) NULL,
  action ENUM(
    'UPLOAD', 'REPLACE', 'VIEW', 'DOWNLOAD', 'PRINT', 'EDIT', 'DELETE', 'RESTORE',
    'SHARE', 'SHARE_ACCESS', 'VERIFY', 'UNVERIFY', 'REVIEW', 'APPROVE', 'REJECT',
    'ARCHIVE', 'LOCK', 'UNLOCK', 'SIGN', 'VERSION_RESTORE', 'OCR', 'SCAN', 'EXPIRE'
  ) NOT NULL,
  detail VARCHAR(500) NULL,
  previous_value TEXT NULL,
  new_value TEXT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(400) NULL,
  device VARCHAR(80) NULL,
  browser VARCHAR(80) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES employee_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_docaudit_document (document_id, created_at),
  INDEX idx_docaudit_employee (employee_id, created_at),
  INDEX idx_docaudit_action (action, created_at),
  INDEX idx_docaudit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Time-limited share links. The token is stored hashed so a database read
-- cannot be replayed as a working link.
CREATE TABLE IF NOT EXISTS document_shares (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL UNIQUE,
  created_by INT UNSIGNED NULL,
  recipient_note VARCHAR(200) NULL,
  expires_at DATETIME NOT NULL,
  max_downloads INT UNSIGNED NULL,
  download_count INT UNSIGNED NOT NULL DEFAULT 0,
  allow_download BOOLEAN NOT NULL DEFAULT true,
  watermark BOOLEAN NOT NULL DEFAULT true,
  allowed_ip VARCHAR(45) NULL,
  revoked_at DATETIME NULL,
  last_accessed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (document_id) REFERENCES employee_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_docshare_document (document_id),
  INDEX idx_docshare_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Reviewer notes and employee replies on a document.
CREATE TABLE IF NOT EXISTS document_comments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  document_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  author_name VARCHAR(160) NULL,
  body VARCHAR(1000) NOT NULL,
  is_internal BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (document_id) REFERENCES employee_documents(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_doccomment_document (document_id),
  INDEX idx_doccomment_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
