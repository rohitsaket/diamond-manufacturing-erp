import { Request, Response } from 'express';
import { EmployeeService } from '../services/EmployeeService';
import { EmployeeDocumentService } from '../services/EmployeeDocumentService';

/** Shared id guard for the `/:id/...` routes. */
function parseEmployeeId(req: Request, res: Response): number | null {
  const id = Number(req.params.id);
  if (!Number.isFinite(id)) {
    res.status(400).json({ error: 'Invalid employee id' });
    return null;
  }
  return id;
}

export class EmployeeController {
  private service = new EmployeeService();
  private documentService = new EmployeeDocumentService();

  findAll = async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, workStatus } = req.query as Record<string, string>;
      const employees = await this.service.findAll(
        search,
        workStatus,
      );
      res.json(employees);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  findById = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const employee = await this.service.findById(id);
      if (!employee) {
        res.status(404).json({ error: 'Employee not found' });
        return;
      }
      res.json(employee);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  getLots = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const lots = await this.service.getEmployeeLots(id);
      res.json(lots);
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  // ---------------------------------------------------------------------------
  // Profile / KYC
  // ---------------------------------------------------------------------------

  getProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      res.json(await this.service.getProfile(id));
    } catch (err: any) {
      const status = err.message === 'Employee not found' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  };

  /** Core profile aggregate: personal, contact, employment, org, bank, payroll. */
  getFullProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseEmployeeId(req, res);
      if (id === null) return;
      res.json(await this.service.getFullProfile(id));
    } catch (err: any) {
      const status = err.message === 'Employee not found' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  };

  getEmploymentDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseEmployeeId(req, res);
      if (id === null) return;
      res.json(await this.service.getEmploymentDetails(id));
    } catch (err: any) {
      const status = err.message === 'Employee not found' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  };

  getOrganizationDetails = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseEmployeeId(req, res);
      if (id === null) return;
      res.json(await this.service.getOrganizationDetails(id));
    } catch (err: any) {
      const status = err.message === 'Employee not found' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  };

  getCompleteness = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseEmployeeId(req, res);
      if (id === null) return;
      res.json(await this.service.getProfileCompleteness(id));
    } catch (err: any) {
      const status = err.message === 'Employee not found' ? 404 : 500;
      res.status(status).json({ error: err.message });
    }
  };

  /** Lightweight people directory (staff only). */
  getDirectory = async (req: Request, res: Response): Promise<void> => {
    try {
      const { search, department, branch, employmentType, workStatus } = req.query as Record<string, string>;
      res.json(await this.service.getDirectory({ search, department, branch, employmentType, workStatus }));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  uploadPhoto = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseEmployeeId(req, res);
      if (id === null) return;
      if (!req.file) {
        res.status(400).json({ error: 'No file was uploaded' });
        return;
      }
      const profile = await this.service.updatePhoto(id, req.file, req.user!.userId, req.user!.name);
      res.json(profile);
    } catch (err: any) {
      const status = err.message === 'Employee not found' ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  };

  create = async (req: Request, res: Response): Promise<void> => {
    try {
      const profile = await this.service.create(req.body, req.user!.userId, req.user!.name);
      res.status(201).json(profile);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };

  updateProfile = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const profile = await this.service.updateProfile(id, req.body, req.user!.userId, req.user!.name);
      res.json(profile);
    } catch (err: any) {
      const status = err.message === 'Employee not found' ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  };

  markResigned = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      const { resignedAt } = req.body ?? {};
      if (!resignedAt) {
        res.status(400).json({ error: 'A resignation date is required' });
        return;
      }
      res.json(await this.service.markResigned(id, resignedAt, req.user!.userId, req.user!.name));
    } catch (err: any) {
      const status = err.message === 'Employee not found' ? 404 : 400;
      res.status(status).json({ error: err.message });
    }
  };

  // ---------------------------------------------------------------------------
  // Documents
  // ---------------------------------------------------------------------------

  listDocuments = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      res.json(await this.documentService.list(id));
    } catch (err: any) {
      res.status(500).json({ error: err.message });
    }
  };

  uploadDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const id = parseInt(req.params.id as string);
      if (!req.file) {
        res.status(400).json({ error: 'No file was uploaded' });
        return;
      }
      const { docType, title } = req.body ?? {};
      const doc = await this.documentService.add(
        id,
        req.file,
        docType,
        title,
        req.user!.userId,
      );
      res.status(201).json(doc);
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };

  verifyDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const docId = parseInt(req.params.docId as string);
      await this.documentService.verify(docId, req.user!.userId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };

  deleteDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const docId = parseInt(req.params.docId as string);
      await this.documentService.remove(docId);
      res.json({ success: true });
    } catch (err: any) {
      res.status(400).json({ error: err.message });
    }
  };

  /** Streams the file through the API so KYC documents stay behind authentication. */
  downloadDocument = async (req: Request, res: Response): Promise<void> => {
    try {
      const docId = parseInt(req.params.docId as string);
      const file = await this.documentService.getDownload(docId);
      res.setHeader('Content-Type', file.mimeType);
      res.setHeader('Content-Disposition', `inline; filename="${file.fileName.replace(/"/g, '')}"`);
      res.sendFile(file.absolutePath);
    } catch (err: any) {
      res.status(404).json({ error: err.message });
    }
  };
}
