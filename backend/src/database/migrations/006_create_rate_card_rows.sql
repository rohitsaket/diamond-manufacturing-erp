-- Create rate card rows table (effective-dated labour rates)
CREATE TABLE IF NOT EXISTS rate_card_rows (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  shape_category ENUM('ROUND', 'FANCY', 'BLOCKING') NOT NULL,
  lab ENUM('IGI', 'GIA', 'ANY') NOT NULL,
  cts_min DECIMAL(12, 4) NOT NULL,
  cts_max DECIMAL(12, 4) NOT NULL,
  rate_per_ct DECIMAL(12, 2) NOT NULL,
  effective_from DATE NOT NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_rate_card_effective (effective_from),
  INDEX idx_rate_card_category_lab (shape_category, lab),
  INDEX idx_rate_card_weight_range (cts_min, cts_max),
  INDEX idx_rate_card_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
