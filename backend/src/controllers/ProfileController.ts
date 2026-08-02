import { Request, Response } from 'express';
import { ProfileService } from '../services/ProfileService';

/**
 * Employee-profile sub-resources. Every handler follows the house pattern:
 * validate ids up front (400), let the service raise business-rule errors and
 * report them as 500 with the raw message, and return payloads unwrapped.
 */
export class ProfileController {
  private service = new ProfileService();

  /** Positive integer or null; used for both `:id` and `:itemId`. */
  private toId(value: unknown): number | null {
    const id = parseInt(String(value ?? ''), 10);
    return Number.isFinite(id) && id > 0 ? id : null;
  }

  // =========================================================================
  // Family
  // =========================================================================
  listFamily = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.listFamily(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createFamily = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      const created = await this.service.createFamily(
        id,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateFamily = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid family member id is required' });
        return;
      }
      const updated = await this.service.updateFamily(
        itemId,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteFamily = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid family member id is required' });
        return;
      }
      await this.service.deleteFamily(itemId, req.user!.userId, req.user!.name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Education
  // =========================================================================
  listEducation = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.listEducation(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createEducation = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      const created = await this.service.createEducation(
        id,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateEducation = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid education id is required' });
        return;
      }
      const updated = await this.service.updateEducation(
        itemId,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteEducation = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid education id is required' });
        return;
      }
      await this.service.deleteEducation(itemId, req.user!.userId, req.user!.name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Certifications
  // =========================================================================
  listCertifications = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.listCertifications(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createCertification = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      const created = await this.service.createCertification(
        id,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateCertification = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid certification id is required' });
        return;
      }
      const updated = await this.service.updateCertification(
        itemId,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteCertification = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid certification id is required' });
        return;
      }
      await this.service.deleteCertification(itemId, req.user!.userId, req.user!.name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Languages
  // =========================================================================
  listLanguages = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.listLanguages(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createLanguage = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      const created = await this.service.createLanguage(
        id,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateLanguage = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid language id is required' });
        return;
      }
      const updated = await this.service.updateLanguage(
        itemId,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteLanguage = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid language id is required' });
        return;
      }
      await this.service.deleteLanguage(itemId, req.user!.userId, req.user!.name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Prior experience
  // =========================================================================
  listExperience = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.listExperience(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createExperience = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      const created = await this.service.createExperience(
        id,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateExperience = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid experience id is required' });
        return;
      }
      const updated = await this.service.updateExperience(
        itemId,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteExperience = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid experience id is required' });
        return;
      }
      await this.service.deleteExperience(itemId, req.user!.userId, req.user!.name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  totalExperience = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.getExperienceSummary(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Career timeline
  // =========================================================================
  listTimeline = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.listTimeline(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createTimeline = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      const created = await this.service.createTimeline(
        id,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateTimeline = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid timeline event id is required' });
        return;
      }
      const updated = await this.service.updateTimeline(
        itemId,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteTimeline = async (req: Request, res: Response): Promise<void> => {
    try {
      const itemId = this.toId(req.params.itemId);
      if (itemId === null) {
        res.status(400).json({ error: 'A valid timeline event id is required' });
        return;
      }
      await this.service.deleteTimeline(itemId, req.user!.userId, req.user!.name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Skills
  // =========================================================================
  listSkills = async (req: Request, res: Response): Promise<void> => {
    try {
      const { category } = req.query as Record<string, string>;
      res.json(await this.service.listSkills(category));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  createSkill = async (req: Request, res: Response): Promise<void> => {
    try {
      const created = await this.service.createSkill(
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.status(201).json(created);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  listEmployeeSkills = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.listEmployeeSkills(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  setEmployeeSkill = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      const saved = await this.service.setEmployeeSkill(
        id,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.json(saved);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  deleteEmployeeSkill = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      const skillId = this.toId(req.params.skillId);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      if (skillId === null) {
        res.status(400).json({ error: 'A valid skill id is required' });
        return;
      }
      await this.service.deleteEmployeeSkill(id, skillId, req.user!.userId, req.user!.name);
      res.json({ success: true });
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getSkillGap = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.getSkillGap(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Settings
  // =========================================================================
  getSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.getSettings(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  updateSettings = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      const updated = await this.service.updateSettings(
        id,
        req.body ?? {},
        req.user!.userId,
        req.user!.name,
      );
      res.json(updated);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // =========================================================================
  // Org chart
  // =========================================================================
  getOrgChart = async (_req: Request, res: Response): Promise<void> => {
    try {
      res.json(await this.service.getOrgChart());
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getOrgChartFor = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.getOrgChartFor(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getReportingChain = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = this.toId(req.params.id);
      if (id === null) {
        res.status(400).json({ error: 'A valid employee id is required' });
        return;
      }
      res.json(await this.service.getReportingChain(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };
}
