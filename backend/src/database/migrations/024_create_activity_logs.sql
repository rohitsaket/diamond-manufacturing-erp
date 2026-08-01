-- Create activity feed / audit timeline table
CREATE TABLE IF NOT EXISTS activity_logs (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  actor_user_id INT UNSIGNED NULL,
  actor_name VARCHAR(255) NULL,
  employee_id INT UNSIGNED NULL,
  entity_type VARCHAR(60) NOT NULL,
  entity_id INT UNSIGNED NULL,
  action VARCHAR(60) NOT NULL,
  summary VARCHAR(500) NOT NULL,
  meta_json TEXT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  INDEX idx_activity_created (created_at),
  INDEX idx_activity_employee (employee_id, created_at),
  INDEX idx_activity_entity (entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
