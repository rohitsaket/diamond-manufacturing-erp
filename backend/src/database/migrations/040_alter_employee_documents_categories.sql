-- Widen document categories to cover the full profile document set.
-- Existing values are preserved so current rows stay valid.
ALTER TABLE employee_documents MODIFY COLUMN doc_type ENUM(
  'AADHAAR', 'PAN', 'BANK_PASSBOOK', 'PHOTO', 'AGREEMENT', 'CERTIFICATE', 'OTHER',
  'PASSPORT', 'VISA', 'DRIVING_LICENSE', 'VOTER_ID',
  'ADDRESS_PROOF', 'EDUCATION', 'EXPERIENCE', 'MEDICAL', 'EMPLOYMENT', 'FAMILY'
) NOT NULL;

ALTER TABLE employee_documents ADD COLUMN category ENUM(
  'IDENTITY', 'ADDRESS', 'EDUCATION', 'EXPERIENCE', 'BANK', 'MEDICAL', 'EMPLOYMENT', 'FAMILY', 'OTHER'
) NOT NULL DEFAULT 'OTHER';
ALTER TABLE employee_documents ADD COLUMN expires_on DATE NULL;
ALTER TABLE employee_documents ADD INDEX idx_documents_category (category);
