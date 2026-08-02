-- Per-employee profile preferences (privacy, notifications, locale, security)
CREATE TABLE IF NOT EXISTS employee_settings (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL UNIQUE,
  profile_visibility ENUM('EVERYONE', 'TEAM', 'HR_ONLY') NOT NULL DEFAULT 'TEAM',
  show_contact_to_peers BOOLEAN NOT NULL DEFAULT true,
  show_birthday BOOLEAN NOT NULL DEFAULT true,
  notify_leave BOOLEAN NOT NULL DEFAULT true,
  notify_payroll BOOLEAN NOT NULL DEFAULT true,
  notify_attendance BOOLEAN NOT NULL DEFAULT true,
  notify_announcements BOOLEAN NOT NULL DEFAULT true,
  notify_email BOOLEAN NOT NULL DEFAULT true,
  language VARCHAR(10) NOT NULL DEFAULT 'en',
  theme ENUM('light', 'dark', 'system') NOT NULL DEFAULT 'system',
  date_format VARCHAR(20) NOT NULL DEFAULT 'DD-MM-YYYY',
  two_factor_enabled BOOLEAN NOT NULL DEFAULT false,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
