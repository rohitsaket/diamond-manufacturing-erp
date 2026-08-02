import { Router } from 'express';
import { ProfileController } from '../controllers/ProfileController';
import { authenticate, allowSelfOrStaff, requireRole, requireStaff } from '../middleware/auth';

const router = Router();
const ctrl = new ProfileController();

/**
 * Employee-profile sub-resources, mounted at `/profile`.
 *
 * Reads on `/:id/...` use `allowSelfOrStaff('id')` so a worker can open their
 * own profile; writes are restricted to admin/hr/manager. The one exception is
 * `/:id/settings` — personal preferences belong to the employee, so the same
 * self-or-staff rule governs both reading and writing them.
 *
 * Literal paths (`/skills`, `/org-chart`, and the `/<section>/:itemId` item
 * routes) are declared first so `/:id/...` never swallows them.
 */

// --- Skill master data ------------------------------------------------------
router.get('/skills', authenticate, requireStaff, ctrl.listSkills);
router.post('/skills', authenticate, requireRole('admin', 'hr'), ctrl.createSkill);

// --- Org chart --------------------------------------------------------------
router.get('/org-chart', authenticate, requireStaff, ctrl.getOrgChart);
router.get('/org-chart/:id', authenticate, requireStaff, ctrl.getOrgChartFor);

// --- Item-level writes (single row addressed by its own id) -----------------
router.put('/family/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateFamily);
router.delete('/family/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.deleteFamily);

router.put('/education/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateEducation);
router.delete('/education/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.deleteEducation);

router.put('/certifications/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateCertification);
router.delete('/certifications/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.deleteCertification);

router.put('/languages/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateLanguage);
router.delete('/languages/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.deleteLanguage);

router.put('/experience/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateExperience);
router.delete('/experience/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.deleteExperience);

router.put('/timeline/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.updateTimeline);
router.delete('/timeline/:itemId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.deleteTimeline);

// --- Family -----------------------------------------------------------------
router.get('/:id/family', authenticate, allowSelfOrStaff('id'), ctrl.listFamily);
router.post('/:id/family', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createFamily);

// --- Education --------------------------------------------------------------
router.get('/:id/education', authenticate, allowSelfOrStaff('id'), ctrl.listEducation);
router.post('/:id/education', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createEducation);

// --- Certifications ---------------------------------------------------------
router.get('/:id/certifications', authenticate, allowSelfOrStaff('id'), ctrl.listCertifications);
router.post('/:id/certifications', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createCertification);

// --- Languages --------------------------------------------------------------
router.get('/:id/languages', authenticate, allowSelfOrStaff('id'), ctrl.listLanguages);
router.post('/:id/languages', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createLanguage);

// --- Prior experience -------------------------------------------------------
router.get('/:id/experience/total', authenticate, allowSelfOrStaff('id'), ctrl.totalExperience);
router.get('/:id/experience', authenticate, allowSelfOrStaff('id'), ctrl.listExperience);
router.post('/:id/experience', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createExperience);

// --- Career timeline --------------------------------------------------------
router.get('/:id/timeline', authenticate, allowSelfOrStaff('id'), ctrl.listTimeline);
router.post('/:id/timeline', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.createTimeline);

// --- Skills -----------------------------------------------------------------
router.get('/:id/skill-gap', authenticate, allowSelfOrStaff('id'), ctrl.getSkillGap);
router.get('/:id/skills', authenticate, allowSelfOrStaff('id'), ctrl.listEmployeeSkills);
router.put('/:id/skills', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.setEmployeeSkill);
router.delete('/:id/skills/:skillId', authenticate, requireRole('admin', 'hr', 'manager'), ctrl.deleteEmployeeSkill);

// --- Preferences (the employee's own to manage) -----------------------------
router.get('/:id/settings', authenticate, allowSelfOrStaff('id'), ctrl.getSettings);
router.put('/:id/settings', authenticate, allowSelfOrStaff('id'), ctrl.updateSettings);

// --- Reporting chain --------------------------------------------------------
router.get('/:id/reporting-chain', authenticate, allowSelfOrStaff('id'), ctrl.getReportingChain);

export default router;
