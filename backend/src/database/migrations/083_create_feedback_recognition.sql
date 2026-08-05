-- Continuous feedback: instant feedback, appreciation, coaching notes,
-- suggestions and improvement notes between people, outside any cycle.
CREATE TABLE IF NOT EXISTS continuous_feedback (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  to_employee_id INT UNSIGNED NOT NULL,
  from_employee_id INT UNSIGNED NULL,
  from_user_id INT UNSIGNED NULL,
  feedback_type ENUM('FEEDBACK', 'APPRECIATION', 'COACHING', 'SUGGESTION', 'IMPROVEMENT') NOT NULL DEFAULT 'FEEDBACK',
  message TEXT NOT NULL,
  visibility ENUM('PRIVATE', 'MANAGER', 'PUBLIC') NOT NULL DEFAULT 'MANAGER',
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  related_goal_id INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (to_employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (from_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (from_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (related_goal_id) REFERENCES perf_goals(id) ON DELETE SET NULL,
  INDEX idx_feedback_to (to_employee_id, created_at),
  INDEX idx_feedback_type (feedback_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Recognition awards. Monetary awards link to the existing payroll pay_awards
-- row that actually pays out; points feed the reward ledger.
CREATE TABLE IF NOT EXISTS recognitions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  award_type ENUM('SPOT', 'ACHIEVEMENT', 'MILESTONE', 'SERVICE', 'TEAM', 'CUSTOM') NOT NULL DEFAULT 'SPOT',
  title VARCHAR(160) NOT NULL,
  citation VARCHAR(1000) NULL,
  points INT UNSIGNED NOT NULL DEFAULT 0,
  monetary_amount DECIMAL(12, 2) NULL,
  pay_award_id INT UNSIGNED NULL,
  cycle_id INT UNSIGNED NULL,
  is_public BOOLEAN NOT NULL DEFAULT true,
  awarded_by INT UNSIGNED NULL,
  awarded_at DATE NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (pay_award_id) REFERENCES pay_awards(id) ON DELETE SET NULL,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE SET NULL,
  FOREIGN KEY (awarded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_recognitions_employee (employee_id, awarded_at),
  INDEX idx_recognitions_type (award_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Signed reward-point ledger: EARNED entries are positive, REDEEMED/EXPIRED
-- negative, ADJUSTED either. Balance is the sum; the service never lets a
-- redemption push the balance below zero.
CREATE TABLE IF NOT EXISTS reward_ledger (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  entry_type ENUM('EARNED', 'REDEEMED', 'ADJUSTED', 'EXPIRED') NOT NULL,
  points INT NOT NULL,
  recognition_id INT UNSIGNED NULL,
  redemption_id INT UNSIGNED NULL,
  reference VARCHAR(160) NULL,
  note VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (recognition_id) REFERENCES recognitions(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_reward_ledger_employee (employee_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS reward_redemptions (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  points INT UNSIGNED NOT NULL,
  reward_item VARCHAR(160) NOT NULL,
  status ENUM('REQUESTED', 'APPROVED', 'REJECTED', 'FULFILLED') NOT NULL DEFAULT 'REQUESTED',
  note VARCHAR(500) NULL,
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  decided_by INT UNSIGNED NULL,
  decided_at DATETIME NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (decided_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_redemptions_employee (employee_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Performance audit trail, same shape as payroll_audit_logs: who, what,
-- previous/new values, and the request context.
CREATE TABLE IF NOT EXISTS perf_audit_logs (
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
  INDEX idx_perf_audit_entity (entity_type, entity_id),
  INDEX idx_perf_audit_created (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
