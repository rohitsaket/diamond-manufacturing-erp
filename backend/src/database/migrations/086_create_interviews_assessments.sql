-- Interview rounds per application. No calendar or video-conference
-- integration exists in this deployment: meeting_link is a manually pasted
-- URL and scheduling exports a standards-based .ics file instead.
CREATE TABLE IF NOT EXISTS interview_rounds (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  application_id INT UNSIGNED NOT NULL,
  round_no TINYINT UNSIGNED NOT NULL DEFAULT 1,
  round_type ENUM('HR_SCREENING', 'TECHNICAL', 'MANAGER', 'PANEL', 'FINAL') NOT NULL DEFAULT 'HR_SCREENING',
  scheduled_at DATETIME NOT NULL,
  duration_minutes INT UNSIGNED NOT NULL DEFAULT 30,
  mode ENUM('IN_PERSON', 'PHONE', 'VIDEO') NOT NULL DEFAULT 'IN_PERSON',
  location VARCHAR(160) NULL,
  meeting_link VARCHAR(500) NULL,
  panel_json JSON NULL,
  status ENUM('SCHEDULED', 'RESCHEDULED', 'COMPLETED', 'CANCELLED', 'NO_SHOW') NOT NULL DEFAULT 'SCHEDULED',
  reschedule_reason VARCHAR(500) NULL,
  outcome ENUM('PENDING', 'PASS', 'FAIL', 'ON_HOLD') NOT NULL DEFAULT 'PENDING',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (application_id) REFERENCES internal_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_interviews_application (application_id, round_no),
  INDEX idx_interviews_schedule (scheduled_at, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One feedback row per interviewer per round; scorecard_json holds
-- [{criterion, score, comment}].
CREATE TABLE IF NOT EXISTS interview_feedback (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  round_id INT UNSIGNED NOT NULL,
  interviewer_employee_id INT UNSIGNED NULL,
  interviewer_user_id INT UNSIGNED NULL,
  scorecard_json JSON NULL,
  overall_score DECIMAL(4, 2) NULL,
  recommendation ENUM('STRONG_YES', 'YES', 'NEUTRAL', 'NO', 'STRONG_NO') NULL,
  comments TEXT NULL,
  submitted_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (round_id) REFERENCES interview_rounds(id) ON DELETE CASCADE,
  FOREIGN KEY (interviewer_employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (interviewer_user_id) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_feedback_round (round_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Assessment catalogue. Assessments are recorded and scored by assessors in
-- this system; online test delivery does not exist in this deployment.
CREATE TABLE IF NOT EXISTS assessments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(30) NOT NULL UNIQUE,
  name VARCHAR(160) NOT NULL,
  assessment_type ENUM('TECHNICAL', 'APTITUDE', 'CODING', 'BEHAVIORAL', 'LEADERSHIP', 'SKILL') NOT NULL DEFAULT 'SKILL',
  description VARCHAR(1000) NULL,
  max_score DECIMAL(6, 2) NOT NULL DEFAULT 100.00,
  pass_score DECIMAL(6, 2) NULL,
  duration_minutes INT UNSIGNED NULL,
  is_active BOOLEAN NOT NULL DEFAULT true,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  INDEX idx_assessments_active (is_active, assessment_type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS assessment_results (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  assessment_id INT UNSIGNED NOT NULL,
  application_id INT UNSIGNED NULL,
  employee_id INT UNSIGNED NOT NULL,
  score DECIMAL(6, 2) NULL,
  result ENUM('PENDING', 'PASS', 'FAIL') NOT NULL DEFAULT 'PENDING',
  notes VARCHAR(1000) NULL,
  assessed_by INT UNSIGNED NULL,
  assessed_at DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (assessment_id) REFERENCES assessments(id) ON DELETE CASCADE,
  FOREIGN KEY (application_id) REFERENCES internal_applications(id) ON DELETE CASCADE,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (assessed_by) REFERENCES users(id) ON DELETE SET NULL,
  INDEX idx_assessment_results_app (application_id),
  INDEX idx_assessment_results_employee (employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
