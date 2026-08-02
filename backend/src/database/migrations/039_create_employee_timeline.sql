-- Career timeline: promotions, transfers, salary revisions, awards and actions
CREATE TABLE IF NOT EXISTS employee_timeline (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  event_type ENUM(
    'JOINED', 'CONFIRMED', 'PROMOTION', 'TRANSFER', 'SALARY_REVISION',
    'AWARD', 'DISCIPLINARY', 'PERFORMANCE_REVIEW', 'TRAINING', 'EXIT', 'OTHER'
  ) NOT NULL,
  event_date DATE NOT NULL,
  title VARCHAR(200) NOT NULL,
  details TEXT NULL,
  from_value VARCHAR(160) NULL,
  to_value VARCHAR(160) NULL,
  amount DECIMAL(12, 2) NULL,
  rating DECIMAL(4, 2) NULL,
  document_id INT UNSIGNED NULL,
  recorded_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (document_id) REFERENCES employee_documents(id) ON DELETE SET NULL,
  FOREIGN KEY (recorded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_timeline_employee (employee_id, event_date),
  INDEX idx_timeline_type (event_type),
  INDEX idx_timeline_deleted_at (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
