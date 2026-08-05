-- One row per review instance: self, manager, peer, subordinate (direct report),
-- customer or external stakeholder. Together the rows for one employee in one
-- cycle form the 360. Customer/external reviews have no employee reviewer; they
-- are recorded by HR on the stakeholder's behalf with the name captured here.
-- Anonymity contract: when is_anonymous is true the reviewer columns are never
-- exposed outside HR/admin - enforced in the service layer, not by dropping data.
CREATE TABLE IF NOT EXISTS perf_reviews (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  cycle_id INT UNSIGNED NOT NULL,
  employee_id INT UNSIGNED NOT NULL,
  review_type ENUM('SELF', 'MANAGER', 'PEER', 'SUBORDINATE', 'CUSTOMER', 'EXTERNAL') NOT NULL,
  reviewer_employee_id INT UNSIGNED NULL,
  reviewer_user_id INT UNSIGNED NULL,
  external_reviewer_name VARCHAR(160) NULL,
  template_id INT UNSIGNED NULL,
  status ENUM('REQUESTED', 'IN_PROGRESS', 'SUBMITTED', 'ACKNOWLEDGED', 'DECLINED') NOT NULL DEFAULT 'REQUESTED',
  is_anonymous BOOLEAN NOT NULL DEFAULT false,
  overall_rating DECIMAL(4, 2) NULL,
  achievements TEXT NULL,
  challenges TEXT NULL,
  learnings TEXT NULL,
  development_notes TEXT NULL,
  due_date DATE NULL,
  submitted_at DATETIME NULL,
  acknowledged_at DATETIME NULL,
  requested_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (reviewer_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (reviewer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (template_id) REFERENCES review_templates(id) ON DELETE SET NULL,
  FOREIGN KEY (requested_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_perf_reviews_subject (employee_id, cycle_id, review_type),
  INDEX idx_perf_reviews_reviewer (reviewer_employee_id, status),
  INDEX idx_perf_reviews_cycle (cycle_id, status),
  INDEX idx_perf_reviews_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Answers to the template's questions, one row per question.
CREATE TABLE IF NOT EXISTS review_responses (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  review_id INT UNSIGNED NOT NULL,
  section VARCHAR(120) NULL,
  question VARCHAR(500) NOT NULL,
  response_text TEXT NULL,
  rating DECIMAL(4, 2) NULL,
  competency_id INT UNSIGNED NULL,
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES perf_reviews(id) ON DELETE CASCADE,
  INDEX idx_review_responses_review (review_id, sort_order)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supporting documents attached to a review (self-review evidence etc.).
CREATE TABLE IF NOT EXISTS review_attachments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  review_id INT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  file_path VARCHAR(500) NOT NULL,
  mime_type VARCHAR(120) NULL,
  file_size INT UNSIGNED NULL,
  uploaded_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (review_id) REFERENCES perf_reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (uploaded_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_review_attachments_review (review_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Competency framework. levels_json optionally holds per-level descriptors
-- (1..rating scale) so assessments have anchored definitions.
CREATE TABLE IF NOT EXISTS competencies (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  category ENUM('TECHNICAL', 'FUNCTIONAL', 'LEADERSHIP', 'BEHAVIORAL') NOT NULL DEFAULT 'TECHNICAL',
  description VARCHAR(500) NULL,
  levels_json JSON NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_competencies_active (is_active, category)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A competency rating, either inside a review (review_id set) or from a
-- standalone assessment (review_id null, cycle_id gives the context).
CREATE TABLE IF NOT EXISTS competency_ratings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  competency_id INT UNSIGNED NOT NULL,
  cycle_id INT UNSIGNED NULL,
  review_id INT UNSIGNED NULL,
  rating DECIMAL(4, 2) NOT NULL,
  rated_by_type ENUM('SELF', 'MANAGER', 'PEER', 'OTHER') NOT NULL DEFAULT 'MANAGER',
  rated_by INT UNSIGNED NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (competency_id) REFERENCES competencies(id) ON DELETE CASCADE,
  FOREIGN KEY (cycle_id) REFERENCES perf_cycles(id) ON DELETE SET NULL,
  FOREIGN KEY (review_id) REFERENCES perf_reviews(id) ON DELETE CASCADE,
  FOREIGN KEY (rated_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_competency_ratings_employee (employee_id, cycle_id),
  INDEX idx_competency_ratings_competency (competency_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
