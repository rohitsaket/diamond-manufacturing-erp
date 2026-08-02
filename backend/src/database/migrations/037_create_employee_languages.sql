-- Language proficiency
CREATE TABLE IF NOT EXISTS employee_languages (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  language VARCHAR(80) NOT NULL,
  can_read BOOLEAN NOT NULL DEFAULT false,
  can_write BOOLEAN NOT NULL DEFAULT false,
  can_speak BOOLEAN NOT NULL DEFAULT false,
  proficiency ENUM('BASIC', 'CONVERSATIONAL', 'PROFICIENT', 'FLUENT', 'NATIVE') NOT NULL DEFAULT 'CONVERSATIONAL',
  is_native BOOLEAN NOT NULL DEFAULT false,
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_employee_language (employee_id, language),
  INDEX idx_languages_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
