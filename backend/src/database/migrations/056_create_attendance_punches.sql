-- Raw punch event stream. attendance_records stays the one-row-per-day summary
-- that payroll and the register read -- this table is the evidence behind it,
-- so a day can always be recomputed and every figure traced to an event.
--
-- Scale note: at 100k employees and four punches a day this grows by ~146M rows
-- a year. The indexes below cover every read path in the module. Beyond that,
-- the next step is RANGE partitioning on punch_date by month, which in InnoDB
-- means dropping the foreign keys below -- a deliberate trade, not a default.
CREATE TABLE IF NOT EXISTS attendance_punches (
  id BIGINT UNSIGNED AUTO_INCREMENT PRIMARY KEY,
  employee_id INT UNSIGNED NOT NULL,

  -- punch_at is the absolute instant. punch_date/punch_time are the values in
  -- the employee's own timezone, which is what a register for a Dubai branch
  -- has to show even when the server runs in IST.
  punch_at DATETIME NOT NULL,
  punch_date DATE NOT NULL,
  punch_time TIME NOT NULL,
  timezone VARCHAR(64) NOT NULL DEFAULT 'Asia/Kolkata',
  utc_offset_minutes SMALLINT NOT NULL DEFAULT 330,

  punch_type ENUM('IN', 'OUT', 'BREAK_IN', 'BREAK_OUT') NOT NULL,
  capture_method ENUM('WEB', 'MOBILE', 'KIOSK', 'BIOMETRIC', 'FACE', 'QR', 'NFC', 'RFID', 'PALM', 'IRIS', 'MANUAL', 'IMPORT', 'AUTO', 'API') NOT NULL DEFAULT 'WEB',
  work_mode ENUM('OFFICE', 'REMOTE', 'HYBRID', 'CLIENT_SITE', 'FIELD', 'WORK_SITE', 'BUSINESS_TRAVEL') NOT NULL DEFAULT 'OFFICE',

  device_id INT UNSIGNED NULL,
  device_punch_ref VARCHAR(80) NULL,
  shift_id INT UNSIGNED NULL,
  project_ref VARCHAR(100) NULL,

  -- Location
  latitude DECIMAL(10, 7) NULL,
  longitude DECIMAL(10, 7) NULL,
  accuracy_m INT UNSIGNED NULL,
  geofence_id INT UNSIGNED NULL,
  geo_status ENUM('NOT_REQUIRED', 'INSIDE', 'OUTSIDE', 'NO_FIX', 'LOW_ACCURACY') NOT NULL DEFAULT 'NOT_REQUIRED',
  distance_m INT UNSIGNED NULL,
  address_label VARCHAR(255) NULL,

  -- Client fingerprint
  ip_address VARCHAR(64) NULL,
  user_agent VARCHAR(500) NULL,
  browser VARCHAR(80) NULL,
  os VARCHAR(80) NULL,

  -- Credential evidence
  nfc_card_id INT UNSIGNED NULL,
  qr_token_id BIGINT UNSIGNED NULL,
  photo_path VARCHAR(500) NULL,
  face_verified BOOLEAN NOT NULL DEFAULT false,
  face_match_score DECIMAL(5, 2) NULL,
  liveness_passed BOOLEAN NULL,
  face_provider_note VARCHAR(255) NULL,

  -- Offline capture: the client mints client_punch_id so a replayed batch is a
  -- no-op rather than a duplicate day.
  client_punch_id VARCHAR(80) NULL,
  is_offline BOOLEAN NOT NULL DEFAULT false,
  captured_at DATETIME NULL,
  synced_at TIMESTAMP NULL,
  sync_log_id BIGINT UNSIGNED NULL,

  status ENUM('ACCEPTED', 'REJECTED', 'PENDING', 'DUPLICATE') NOT NULL DEFAULT 'ACCEPTED',
  reject_reason VARCHAR(255) NULL,
  is_manual_entry BOOLEAN NOT NULL DEFAULT false,
  remarks VARCHAR(255) NULL,

  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  deleted_at TIMESTAMP NULL,

  FOREIGN KEY (employee_id) REFERENCES employees(id) ON DELETE CASCADE,
  FOREIGN KEY (device_id) REFERENCES attendance_devices(id) ON DELETE SET NULL,
  FOREIGN KEY (shift_id) REFERENCES shifts(id) ON DELETE SET NULL,
  FOREIGN KEY (geofence_id) REFERENCES geofences(id) ON DELETE SET NULL,
  FOREIGN KEY (nfc_card_id) REFERENCES nfc_cards(id) ON DELETE SET NULL,
  FOREIGN KEY (qr_token_id) REFERENCES qr_tokens(id) ON DELETE SET NULL,
  FOREIGN KEY (sync_log_id) REFERENCES device_sync_logs(id) ON DELETE SET NULL,
  FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE SET NULL,

  UNIQUE KEY uk_punch_client_id (employee_id, client_punch_id),
  UNIQUE KEY uk_punch_device_ref (device_id, device_punch_ref),
  INDEX idx_punch_emp_date (employee_id, punch_date, punch_time),
  INDEX idx_punch_date (punch_date),
  INDEX idx_punch_at (punch_at),
  INDEX idx_punch_device_time (device_id, punch_at),
  INDEX idx_punch_status (status),
  INDEX idx_punch_method (capture_method),
  INDEX idx_punch_deleted (deleted_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
