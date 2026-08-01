-- Create rate card audit log table (track all rate changes)
CREATE TABLE IF NOT EXISTS rate_card_audit_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  rate_card_row_id INT UNSIGNED NULL,
  actor VARCHAR(255) NOT NULL,
  change_description TEXT NOT NULL,
  change_type ENUM('increase', 'decrease', 'bulk') NOT NULL,
  old_rate DECIMAL(12, 2) NULL,
  new_rate DECIMAL(12, 2) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (rate_card_row_id) REFERENCES rate_card_rows(id) ON DELETE SET NULL,
  INDEX idx_audit_created (created_at),
  INDEX idx_audit_type (change_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
