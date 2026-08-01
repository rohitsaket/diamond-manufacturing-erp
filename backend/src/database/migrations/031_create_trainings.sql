-- Create training programs and enrollment tracking
CREATE TABLE IF NOT EXISTS trainings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  trainer VARCHAR(255) NULL,
  start_date DATE NOT NULL,
  end_date DATE NULL,
  status ENUM('PLANNED', 'ONGOING', 'COMPLETED', 'CANCELLED') NOT NULL DEFAULT 'PLANNED',
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_trainings_status (status),
  INDEX idx_trainings_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS training_enrollments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  training_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  status ENUM('ENROLLED', 'ATTENDED', 'COMPLETED', 'DROPPED') NOT NULL DEFAULT 'ENROLLED',
  score DECIMAL(5, 2) NULL,
  completed_at DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (training_id) REFERENCES trainings(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  UNIQUE KEY uk_training_employee (training_id, employee_id),
  INDEX idx_enrollments_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
