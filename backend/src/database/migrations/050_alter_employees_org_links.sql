-- Link employees to the normalized organization. The existing free-text
-- columns (company, business_unit, division, department, section, team,
-- branch, region, legal_entity, cost_center) are deliberately kept so every
-- current query, report and screen keeps working while the ids fill in.
ALTER TABLE employees ADD COLUMN company_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN legal_entity_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN business_unit_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN division_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN department_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN branch_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN location_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN region_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN cost_center_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN position_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN job_role_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN job_grade_id INT UNSIGNED NULL;
ALTER TABLE employees ADD COLUMN job_level_id INT UNSIGNED NULL;

ALTER TABLE employees ADD CONSTRAINT fk_emp_company FOREIGN KEY (company_id) REFERENCES companies(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_legal_entity FOREIGN KEY (legal_entity_id) REFERENCES legal_entities(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_business_unit FOREIGN KEY (business_unit_id) REFERENCES business_units(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_division FOREIGN KEY (division_id) REFERENCES divisions(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_department FOREIGN KEY (department_id) REFERENCES departments(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_branch FOREIGN KEY (branch_id) REFERENCES branches(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_location FOREIGN KEY (location_id) REFERENCES locations(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_region FOREIGN KEY (region_id) REFERENCES regions(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_cost_center FOREIGN KEY (cost_center_id) REFERENCES cost_centers(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_position FOREIGN KEY (position_id) REFERENCES positions(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_job_role FOREIGN KEY (job_role_id) REFERENCES job_roles(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_job_grade FOREIGN KEY (job_grade_id) REFERENCES job_grades(id) ON DELETE SET NULL;
ALTER TABLE employees ADD CONSTRAINT fk_emp_job_level FOREIGN KEY (job_level_id) REFERENCES job_levels(id) ON DELETE SET NULL;

ALTER TABLE employees ADD INDEX idx_emp_company_id (company_id);
ALTER TABLE employees ADD INDEX idx_emp_department_id (department_id);
ALTER TABLE employees ADD INDEX idx_emp_branch_id (branch_id);
ALTER TABLE employees ADD INDEX idx_emp_position_id (position_id);
ALTER TABLE employees ADD INDEX idx_emp_cost_center_id (cost_center_id);
