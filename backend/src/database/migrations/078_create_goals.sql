-- One table models goals AND OKRs. kind distinguishes a plain GOAL, an OKR
-- OBJECTIVE, and a KEY_RESULT (whose parent_goal_id points at its objective).
-- parent_goal_id also gives goal cascading/alignment: an individual goal can
-- point at a team goal, which points at a department goal, and so on.
CREATE TABLE IF NOT EXISTS perf_goals (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cycle_id INT UNSIGNED NOT NULL,
  kind ENUM('GOAL', 'OBJECTIVE', 'KEY_RESULT') NOT NULL DEFAULT 'GOAL',
  scope ENUM('INDIVIDUAL', 'TEAM', 'DEPARTMENT', 'ORGANIZATION') NOT NULL DEFAULT 'INDIVIDUAL',
  employee_id INT UNSIGNED NULL,
  team_id INT UNSIGNED NULL,
  department_id INT UNSIGNED NULL,
  parent_goal_id INT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  description TEXT NULL,
  category VARCHAR(60) NULL,
  metric_name VARCHAR(160) NULL,
  metric_unit VARCHAR(30) NULL,
  start_value DECIMAL(14, 2) NULL,
  target_value DECIMAL(14, 2) NULL,
  current_value DECIMAL(14, 2) NULL,
  weightage_pct DECIMAL(5, 2) NOT NULL DEFAULT 100.00,
  progress_pct DECIMAL(5, 2) NOT NULL DEFAULT 0.00,
  progress_mode ENUM('MANUAL', 'METRIC', 'MILESTONES', 'CHILDREN') NOT NULL DEFAULT 'MANUAL',
  status ENUM('DRAFT', 'PENDING_APPROVAL', 'ACTIVE', 'COMPLETED', 'CANCELLED', 'REJECTED') NOT NULL DEFAULT 'DRAFT',
  priority ENUM('LOW', 'MEDIUM', 'HIGH', 'CRITICAL') NOT NULL DEFAULT 'MEDIUM',
  visibility ENUM('PRIVATE', 'MANAGER', 'ORGANIZATION') NOT NULL DEFAULT 'MANAGER',
  due_date DATE NULL,
  completed_at DATETIME NULL,
  approved_by INT UNSIGNED NULL,
  approved_at DATETIME NULL,
  template_id INT UNSIGNED NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (team_id) REFERENCES teams(id) ON DELETE SET NULL,
  FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL,
  FOREIGN KEY (parent_goal_id) REFERENCES perf_goals(id) ON DELETE SET NULL,
  FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_perf_goals_cycle (cycle_id, scope, status),
  INDEX idx_perf_goals_employee (employee_id, cycle_id),
  INDEX idx_perf_goals_parent (parent_goal_id),
  INDEX idx_perf_goals_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS goal_milestones (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  goal_id INT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  due_date DATE NULL,
  status ENUM('PENDING', 'COMPLETED', 'MISSED') NOT NULL DEFAULT 'PENDING',
  completed_at DATETIME NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (goal_id) REFERENCES perf_goals(id) ON DELETE CASCADE,
  INDEX idx_goal_milestones_goal (goal_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Progress check-ins, comments and status/approval events on a goal, in one
-- append-only stream. This is the goal history the module exposes.
CREATE TABLE IF NOT EXISTS goal_updates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  goal_id INT UNSIGNED NOT NULL,
  update_type ENUM('PROGRESS', 'COMMENT', 'STATUS', 'APPROVAL') NOT NULL DEFAULT 'PROGRESS',
  progress_pct DECIMAL(5, 2) NULL,
  current_value DECIMAL(14, 2) NULL,
  note VARCHAR(1000) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (goal_id) REFERENCES perf_goals(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_goal_updates_goal (goal_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS goal_templates (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  kind ENUM('GOAL', 'OBJECTIVE', 'KEY_RESULT') NOT NULL DEFAULT 'GOAL',
  scope ENUM('INDIVIDUAL', 'TEAM', 'DEPARTMENT', 'ORGANIZATION') NOT NULL DEFAULT 'INDIVIDUAL',
  category VARCHAR(60) NULL,
  title_template VARCHAR(255) NOT NULL,
  description_template TEXT NULL,
  metric_name VARCHAR(160) NULL,
  metric_unit VARCHAR(30) NULL,
  suggested_weightage_pct DECIMAL(5, 2) NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_goal_templates_active (is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
