-- Upgrade employee_documents into a DMS record. Every existing column stays;
-- these are additive so current rows and endpoints keep working.
ALTER TABLE employee_documents ADD COLUMN document_type_id INT UNSIGNED NULL;
ALTER TABLE employee_documents ADD COLUMN status ENUM(
  'DRAFT', 'UPLOADED', 'PENDING_REVIEW', 'PENDING_VERIFICATION', 'APPROVED',
  'REJECTED', 'EXPIRED', 'RENEWED', 'ARCHIVED', 'DELETED'
) NOT NULL DEFAULT 'UPLOADED';

-- Versioning: every replace creates a new row; the previous one is retained.
ALTER TABLE employee_documents ADD COLUMN version INT UNSIGNED NOT NULL DEFAULT 1;
ALTER TABLE employee_documents ADD COLUMN is_current_version BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE employee_documents ADD COLUMN root_document_id INT UNSIGNED NULL;
ALTER TABLE employee_documents ADD COLUMN replaced_by_id INT UNSIGNED NULL;

-- Integrity and de-duplication.
ALTER TABLE employee_documents ADD COLUMN file_hash CHAR(64) NULL;
ALTER TABLE employee_documents ADD COLUMN integrity_checked_at DATETIME NULL;
ALTER TABLE employee_documents ADD COLUMN integrity_ok BOOLEAN NULL;

-- Storage abstraction: which driver holds the bytes, and the key within it.
ALTER TABLE employee_documents ADD COLUMN storage_driver VARCHAR(20) NOT NULL DEFAULT 'local';
ALTER TABLE employee_documents ADD COLUMN storage_key VARCHAR(500) NULL;
ALTER TABLE employee_documents ADD COLUMN is_encrypted BOOLEAN NOT NULL DEFAULT false;

-- Processing pipelines that depend on optional external tooling.
ALTER TABLE employee_documents ADD COLUMN ocr_status ENUM('NOT_RUN', 'PENDING', 'DONE', 'FAILED', 'UNSUPPORTED') NOT NULL DEFAULT 'NOT_RUN';
ALTER TABLE employee_documents ADD COLUMN ocr_text MEDIUMTEXT NULL;
ALTER TABLE employee_documents ADD COLUMN virus_scan_status ENUM('NOT_RUN', 'PENDING', 'CLEAN', 'INFECTED', 'FAILED') NOT NULL DEFAULT 'NOT_RUN';
ALTER TABLE employee_documents ADD COLUMN virus_scan_detail VARCHAR(255) NULL;
ALTER TABLE employee_documents ADD COLUMN thumbnail_key VARCHAR(500) NULL;

-- Document metadata.
ALTER TABLE employee_documents ADD COLUMN doc_number VARCHAR(120) NULL;
ALTER TABLE employee_documents ADD COLUMN issuing_authority VARCHAR(200) NULL;
ALTER TABLE employee_documents ADD COLUMN issued_on DATE NULL;
ALTER TABLE employee_documents ADD COLUMN tags VARCHAR(500) NULL;
ALTER TABLE employee_documents ADD COLUMN notes TEXT NULL;

-- Review / approval trail (verification columns already exist).
ALTER TABLE employee_documents ADD COLUMN reviewed_by INT UNSIGNED NULL;
ALTER TABLE employee_documents ADD COLUMN reviewed_at DATETIME NULL;
ALTER TABLE employee_documents ADD COLUMN approved_by INT UNSIGNED NULL;
ALTER TABLE employee_documents ADD COLUMN approved_at DATETIME NULL;
ALTER TABLE employee_documents ADD COLUMN rejected_reason VARCHAR(500) NULL;

-- Lock, archive and retention.
ALTER TABLE employee_documents ADD COLUMN is_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE employee_documents ADD COLUMN locked_by INT UNSIGNED NULL;
ALTER TABLE employee_documents ADD COLUMN locked_at DATETIME NULL;
ALTER TABLE employee_documents ADD COLUMN archived_at DATETIME NULL;
ALTER TABLE employee_documents ADD COLUMN retention_until DATE NULL;
ALTER TABLE employee_documents ADD COLUMN deleted_by INT UNSIGNED NULL;
ALTER TABLE employee_documents ADD COLUMN upload_ip VARCHAR(45) NULL;

ALTER TABLE employee_documents ADD CONSTRAINT fk_docs_type FOREIGN KEY (document_type_id) REFERENCES document_types(id) ON DELETE SET NULL;
ALTER TABLE employee_documents ADD CONSTRAINT fk_docs_reviewed_by FOREIGN KEY (reviewed_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE employee_documents ADD CONSTRAINT fk_docs_approved_by FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE employee_documents ADD CONSTRAINT fk_docs_locked_by FOREIGN KEY (locked_by) REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE employee_documents ADD CONSTRAINT fk_docs_deleted_by FOREIGN KEY (deleted_by) REFERENCES users(id) ON DELETE SET NULL;

ALTER TABLE employee_documents ADD INDEX idx_docs_status (status);
ALTER TABLE employee_documents ADD INDEX idx_docs_type_id (document_type_id);
ALTER TABLE employee_documents ADD INDEX idx_docs_hash (file_hash);
ALTER TABLE employee_documents ADD INDEX idx_docs_expiry (expires_on);
ALTER TABLE employee_documents ADD INDEX idx_docs_current (employee_id, is_current_version, deleted_at);
ALTER TABLE employee_documents ADD INDEX idx_docs_root (root_document_id);

-- Existing rows are already the current version of their own lineage, and
-- verified ones are effectively approved.
UPDATE employee_documents SET root_document_id = id WHERE root_document_id IS NULL;
UPDATE employee_documents SET storage_key = file_path WHERE storage_key IS NULL;
UPDATE employee_documents SET status = 'APPROVED', approved_at = verified_at, approved_by = verified_by WHERE verified = true;
