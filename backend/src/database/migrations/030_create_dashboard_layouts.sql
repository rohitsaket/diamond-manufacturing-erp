-- Create per-user dashboard layout storage (drag, resize, hide, multiple layouts)
CREATE TABLE IF NOT EXISTS dashboard_layouts (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  user_id INT UNSIGNED NOT NULL,
  dashboard_key VARCHAR(50) NOT NULL,
  layout_name VARCHAR(100) NOT NULL DEFAULT 'Default',
  is_active BOOLEAN NOT NULL DEFAULT true,
  layout_json MEDIUMTEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  UNIQUE KEY uk_dashboard_layout (user_id, dashboard_key, layout_name),
  INDEX idx_dashboard_layouts_user (user_id, dashboard_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
