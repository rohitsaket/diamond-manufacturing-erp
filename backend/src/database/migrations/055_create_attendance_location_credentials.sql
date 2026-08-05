-- Geofences. A circle (centre plus radius) is the common case and is what the
-- validator uses by default. `polygon` holds an optional GeoJSON-style ring of
-- [lng, lat] pairs for sites a circle cannot describe -- when present it wins.
CREATE TABLE IF NOT EXISTS geofences (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(150) NOT NULL,
  company_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  location_id INT UNSIGNED NULL,
  fence_type ENUM('CIRCLE', 'POLYGON') NOT NULL DEFAULT 'CIRCLE',
  center_lat DECIMAL(10, 7) NULL,
  center_lng DECIMAL(10, 7) NULL,
  radius_m INT UNSIGNED NOT NULL DEFAULT 200,
  polygon JSON NULL,
  address VARCHAR(255) NULL,
  allow_methods VARCHAR(255) NOT NULL DEFAULT 'WEB,MOBILE,KIOSK,QR,NFC',
  enforce_on_in BOOLEAN NOT NULL DEFAULT true,
  enforce_on_out BOOLEAN NOT NULL DEFAULT false,
  max_accuracy_m INT UNSIGNED NOT NULL DEFAULT 100,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_geofence_code (code),
  INDEX idx_geofence_branch (branch_id),
  INDEX idx_geofence_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE attendance_devices ADD CONSTRAINT fk_device_geofence FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE SET NULL;

-- Restricts an employee to specific fences. No rows for an employee means any
-- active fence in scope is acceptable.
CREATE TABLE IF NOT EXISTS employee_geofences (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  geofence_id INT UNSIGNED NOT NULL,
  effective_from DATE NULL,
  effective_to DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_employee_geofence (employee_id, geofence_id),
  INDEX idx_empgeo_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Kiosk QR codes. A rotating token is re-issued every `rotation_seconds` so a
-- screenshot stops working -- the server checks the HMAC and the expiry, which
-- is why nothing here needs the device to be online.
CREATE TABLE IF NOT EXISTS qr_tokens (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  token VARCHAR(120) NOT NULL,
  device_id INT UNSIGNED NULL,
  geofence_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  is_static BOOLEAN NOT NULL DEFAULT false,
  rotation_seconds INT UNSIGNED NOT NULL DEFAULT 60,
  issued_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  max_uses INT UNSIGNED NULL,
  used_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_used_at TIMESTAMP NULL,
  status ENUM('ACTIVE', 'EXPIRED', 'REVOKED') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (device_id) REFERENCES attendance_devices(id) ON DELETE CASCADE,
  FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_qr_token (token),
  INDEX idx_qr_expires (expires_at),
  INDEX idx_qr_device (device_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS nfc_cards (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  card_uid VARCHAR(64) NOT NULL,
  card_type ENUM('NFC', 'RFID', 'SMART_CARD', 'MIFARE', 'HID') NOT NULL DEFAULT 'NFC',
  employee_id INT UNSIGNED NULL,
  card_number VARCHAR(64) NULL,
  issued_on DATE NULL,
  expires_on DATE NULL,
  status ENUM('ACTIVE', 'INACTIVE', 'LOST', 'DAMAGED', 'EXPIRED', 'RETURNED') NOT NULL DEFAULT 'ACTIVE',
  reported_lost_at TIMESTAMP NULL,
  last_used_at TIMESTAMP NULL,
  use_count INT UNSIGNED NOT NULL DEFAULT 0,
  notes VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_card_uid (card_uid),
  INDEX idx_card_employee (employee_id),
  INDEX idx_card_status (status),
  INDEX idx_card_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Face enrolment records the fact of enrolment and where the biometric template
-- lives with the provider. No template is stored here -- the provider seam owns
-- matching, and with no provider configured verification reports unavailable
-- rather than silently passing.
CREATE TABLE IF NOT EXISTS face_enrollments (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,
  provider VARCHAR(60) NOT NULL DEFAULT 'NONE',
  external_ref VARCHAR(191) NULL,
  images_count INT UNSIGNED NOT NULL DEFAULT 0,
  quality_score DECIMAL(5, 2) NULL,
  enrolled_at TIMESTAMP NULL,
  last_verified_at TIMESTAMP NULL,
  verification_count INT UNSIGNED NOT NULL DEFAULT 0,
  status ENUM('ACTIVE', 'PENDING', 'FAILED', 'REVOKED', 'NOT_CONFIGURED') NOT NULL DEFAULT 'PENDING',
  status_note VARCHAR(255) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_face_employee (employee_id),
  INDEX idx_face_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- IP allow/deny for browser punches. DENY is evaluated before ALLOW.
CREATE TABLE IF NOT EXISTS attendance_ip_rules (
  id INT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) NOT NULL,
  name VARCHAR(120) NOT NULL,
  rule_type ENUM('ALLOW', 'DENY') NOT NULL DEFAULT 'ALLOW',
  cidr VARCHAR(64) NULL,
  ip_from VARCHAR(64) NULL,
  ip_to VARCHAR(64) NULL,
  company_id INT UNSIGNED NULL,
  branch_id INT UNSIGNED NULL,
  status ENUM('ACTIVE', 'INACTIVE') NOT NULL DEFAULT 'ACTIVE',
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,
  FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL,
  FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,
  UNIQUE KEY uk_ip_rule_code (code),
  INDEX idx_ip_rule_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
