import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Plus, Pencil, Trash2, Search, FileUp, FileDown, RefreshCw } from 'lucide-react';
import {
  TableShell,
  LoadingBlock,
  EmptyBlock,
  ErrorBlock,
  INPUT_CLS,
  BTN_PRIMARY,
  BTN_SECONDARY,
} from '../../components/common/HrmsUI';
import { ModalShell } from '../../components/common/ModalShell';
import { orgApi, ORG_ENTITIES, type OrgEntitySlug } from '../../api/organization';
import { tokenStore } from '../../api/client';
import { ORG_ENTITY_LABELS } from '../../types/organization';
import { useApp } from '../../contexts/AppContext';
import {
  EntityIcon,
  OrgStatusChip,
  HeadcountPill,
  EntityFormModal,
  errMsg,
  type FieldDescriptor,
  type SelectOption,
} from './orgUi';

// ---------------------------------------------------------------------------
// Generic row + CRUD shapes
// ---------------------------------------------------------------------------

export interface EntityRow {
  id: number;
  code?: string | null;
  name?: string | null;
  title?: string | null;
  status?: string | null;
  headcount?: number | null;
  vacancies?: number | null;
  [key: string]: unknown;
}

interface GenericCrud {
  list: (params?: Record<string, unknown>) => Promise<EntityRow[]>;
  get: (id: number) => Promise<EntityRow>;
  create: (body: Record<string, unknown>) => Promise<EntityRow>;
  update: (id: number, body: Record<string, unknown>) => Promise<EntityRow>;
  remove: (id: number) => Promise<{ success: boolean }>;
}

/** The typed per-entity accessors all share this shape at runtime. */
const asCrud = (accessor: unknown): GenericCrud => accessor as GenericCrud;

const CRUD: Record<OrgEntitySlug, GenericCrud> = {
  companies: asCrud(orgApi.companies),
  'legal-entities': asCrud(orgApi.legalEntities),
  regions: asCrud(orgApi.regions),
  'business-units': asCrud(orgApi.businessUnits),
  divisions: asCrud(orgApi.divisions),
  departments: asCrud(orgApi.departments),
  branches: asCrud(orgApi.branches),
  locations: asCrud(orgApi.locations),
  'cost-center-groups': asCrud(orgApi.costCenterGroups),
  'cost-centers': asCrud(orgApi.costCenters),
  teams: asCrud(orgApi.teams),
  'job-families': asCrud(orgApi.jobFamilies),
  'job-functions': asCrud(orgApi.jobFunctions),
  'job-grades': asCrud(orgApi.jobGrades),
  'job-levels': asCrud(orgApi.jobLevels),
  'job-roles': asCrud(orgApi.jobRoles),
  positions: asCrud(orgApi.positions),
};

export const orgCrud = CRUD;

// ---------------------------------------------------------------------------
// Field descriptors — one map, seventeen forms
// ---------------------------------------------------------------------------

type OptionSource = OrgEntitySlug | 'employees';

interface FieldSpec extends Omit<FieldDescriptor, 'options' | 'numeric'> {
  options?: SelectOption[];
  /** Load the option list lazily from another entity (or the workforce). */
  optionsFrom?: OptionSource;
}

const opts = (...values: string[]): SelectOption[] =>
  values.map((v) => ({ value: v, label: v.charAt(0) + v.slice(1).toLowerCase().replace(/_/g, ' ') }));

const STATUS_BASIC = opts('ACTIVE', 'INACTIVE');
const CODE_NAME: FieldSpec[] = [
  { key: 'code', label: 'Code', type: 'text', required: true, hint: 'Unique, short, uppercase' },
  { key: 'name', label: 'Name', type: 'text', required: true },
];
const CURRENCY: FieldSpec = { key: 'currency', label: 'Currency', type: 'text', placeholder: 'INR' };

const ENTITY_FORMS: Record<OrgEntitySlug, FieldSpec[]> = {
  companies: [
    ...CODE_NAME,
    { key: 'shortName', label: 'Short name', type: 'text' },
    { key: 'parentCompanyId', label: 'Parent company', type: 'select', optionsFrom: 'companies' },
    {
      key: 'companyType',
      label: 'Company type',
      type: 'select',
      options: opts('HOLDING', 'SUBSIDIARY', 'BRANCH_OFFICE', 'FRANCHISE', 'JOINT_VENTURE', 'STANDALONE'),
    },
    { key: 'industryType', label: 'Industry', type: 'text' },
    { key: 'registrationNo', label: 'Registration no.', type: 'text' },
    { key: 'cin', label: 'CIN', type: 'text' },
    { key: 'gstin', label: 'GSTIN', type: 'text' },
    { key: 'pan', label: 'PAN', type: 'text' },
    { key: 'tan', label: 'TAN', type: 'text' },
    { key: 'incorporatedOn', label: 'Incorporated on', type: 'date' },
    { key: 'fiscalYearStartMonth', label: 'Fiscal year starts (month)', type: 'number', hint: '1 = January' },
    { key: 'baseCurrency', label: 'Base currency', type: 'text', placeholder: 'INR' },
    { key: 'defaultTimezone', label: 'Timezone', type: 'text', placeholder: 'Asia/Kolkata' },
    { key: 'country', label: 'Country', type: 'text', placeholder: 'India' },
    { key: 'contactEmail', label: 'Contact email', type: 'text' },
    { key: 'contactPhone', label: 'Contact phone', type: 'text' },
    { key: 'website', label: 'Website', type: 'text' },
    { key: 'corporateAddress', label: 'Corporate address', type: 'textarea' },
    { key: 'isPayrollCompany', label: 'Runs payroll', type: 'toggle' },
    { key: 'status', label: 'Status', type: 'select', options: opts('ACTIVE', 'INACTIVE', 'DISSOLVED') },
  ],
  'legal-entities': [
    ...CODE_NAME,
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    {
      key: 'entityType',
      label: 'Entity type',
      type: 'select',
      options: opts('PRIVATE_LIMITED', 'PUBLIC_LIMITED', 'LLP', 'PARTNERSHIP', 'PROPRIETORSHIP', 'TRUST', 'OTHER'),
    },
    { key: 'registrationNo', label: 'Registration no.', type: 'text' },
    { key: 'taxId', label: 'Tax ID', type: 'text' },
    { key: 'gstin', label: 'GSTIN', type: 'text' },
    { key: 'country', label: 'Country', type: 'text', placeholder: 'India' },
    { key: 'state', label: 'State', type: 'text' },
    CURRENCY,
    { key: 'registeredAddress', label: 'Registered address', type: 'textarea' },
    { key: 'isPayrollEntity', label: 'Payroll entity', type: 'toggle' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  regions: [
    ...CODE_NAME,
    {
      key: 'regionType',
      label: 'Region type',
      type: 'select',
      options: opts('GLOBAL', 'COUNTRY', 'STATE', 'ZONE', 'TERRITORY', 'SALES', 'OPERATIONAL'),
    },
    { key: 'parentRegionId', label: 'Parent region', type: 'select', optionsFrom: 'regions' },
    { key: 'country', label: 'Country', type: 'text' },
    { key: 'headEmployeeId', label: 'Regional head', type: 'select', optionsFrom: 'employees' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  'business-units': [
    ...CODE_NAME,
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    { key: 'parentBusinessUnitId', label: 'Parent business unit', type: 'select', optionsFrom: 'business-units' },
    { key: 'headEmployeeId', label: 'Head', type: 'select', optionsFrom: 'employees' },
    { key: 'annualBudget', label: 'Annual budget', type: 'number' },
    { key: 'budgetCurrency', label: 'Budget currency', type: 'text', placeholder: 'INR' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  divisions: [
    ...CODE_NAME,
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    { key: 'businessUnitId', label: 'Business unit', type: 'select', optionsFrom: 'business-units' },
    { key: 'parentDivisionId', label: 'Parent division', type: 'select', optionsFrom: 'divisions' },
    {
      key: 'divisionType',
      label: 'Division type',
      type: 'select',
      options: opts('FUNCTIONAL', 'OPERATIONAL', 'SUPPORT', 'SHARED_SERVICE'),
    },
    { key: 'headEmployeeId', label: 'Head', type: 'select', optionsFrom: 'employees' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  departments: [
    ...CODE_NAME,
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    { key: 'divisionId', label: 'Division', type: 'select', optionsFrom: 'divisions' },
    { key: 'parentDepartmentId', label: 'Parent department', type: 'select', optionsFrom: 'departments' },
    { key: 'costCenterId', label: 'Cost centre', type: 'select', optionsFrom: 'cost-centers' },
    { key: 'headEmployeeId', label: 'Department head', type: 'select', optionsFrom: 'employees' },
    { key: 'plannedHeadcount', label: 'Planned headcount', type: 'number' },
    { key: 'annualBudget', label: 'Annual budget', type: 'number' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'objectives', label: 'Objectives', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  branches: [
    ...CODE_NAME,
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    { key: 'regionId', label: 'Region', type: 'select', optionsFrom: 'regions' },
    {
      key: 'branchType',
      label: 'Branch type',
      type: 'select',
      options: opts('HEAD_OFFICE', 'CORPORATE', 'FACTORY', 'SALES', 'WAREHOUSE', 'SERVICE', 'REMOTE'),
    },
    { key: 'managerEmployeeId', label: 'Branch manager', type: 'select', optionsFrom: 'employees' },
    { key: 'city', label: 'City', type: 'text' },
    { key: 'state', label: 'State', type: 'text' },
    { key: 'country', label: 'Country', type: 'text', placeholder: 'India' },
    { key: 'postalCode', label: 'Postal code', type: 'text' },
    { key: 'timezone', label: 'Timezone', type: 'text', placeholder: 'Asia/Kolkata' },
    CURRENCY,
    { key: 'language', label: 'Language', type: 'text' },
    { key: 'contactEmail', label: 'Contact email', type: 'text' },
    { key: 'contactPhone', label: 'Contact phone', type: 'text' },
    { key: 'openedOn', label: 'Opened on', type: 'date' },
    { key: 'address', label: 'Address', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: opts('ACTIVE', 'INACTIVE', 'CLOSED') },
  ],
  locations: [
    ...CODE_NAME,
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    { key: 'branchId', label: 'Branch', type: 'select', optionsFrom: 'branches' },
    {
      key: 'locationType',
      label: 'Location type',
      type: 'select',
      options: opts('OFFICE', 'WORK_SITE', 'PLANT', 'WAREHOUSE', 'MANUFACTURING_UNIT', 'REMOTE', 'CLIENT_SITE'),
    },
    { key: 'city', label: 'City', type: 'text' },
    { key: 'country', label: 'Country', type: 'text', placeholder: 'India' },
    { key: 'timezone', label: 'Timezone', type: 'text' },
    { key: 'capacity', label: 'Seat capacity', type: 'number' },
    { key: 'address', label: 'Address', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  'cost-center-groups': [
    ...CODE_NAME,
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  'cost-centers': [
    ...CODE_NAME,
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    { key: 'groupId', label: 'Group', type: 'select', optionsFrom: 'cost-center-groups' },
    {
      key: 'centerType',
      label: 'Centre type',
      type: 'select',
      options: opts('COST', 'PROFIT', 'EXPENSE', 'INVESTMENT'),
    },
    { key: 'parentCostCenterId', label: 'Parent cost centre', type: 'select', optionsFrom: 'cost-centers' },
    { key: 'ownerEmployeeId', label: 'Owner', type: 'select', optionsFrom: 'employees' },
    { key: 'departmentId', label: 'Department', type: 'select', optionsFrom: 'departments' },
    { key: 'branchId', label: 'Branch', type: 'select', optionsFrom: 'branches' },
    { key: 'glAccount', label: 'GL account', type: 'text' },
    { key: 'annualBudget', label: 'Annual budget', type: 'number' },
    { key: 'budgetCurrency', label: 'Budget currency', type: 'text', placeholder: 'INR' },
    { key: 'fiscalYear', label: 'Fiscal year', type: 'text', placeholder: '2026-27' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  teams: [
    ...CODE_NAME,
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    { key: 'departmentId', label: 'Department', type: 'select', optionsFrom: 'departments' },
    {
      key: 'teamType',
      label: 'Team type',
      type: 'select',
      options: opts('FUNCTIONAL', 'CROSS_FUNCTIONAL', 'PROJECT', 'SHIFT', 'OTHER'),
    },
    { key: 'leadEmployeeId', label: 'Team lead', type: 'select', optionsFrom: 'employees' },
    { key: 'capacity', label: 'Capacity', type: 'number' },
    { key: 'startDate', label: 'Start date', type: 'date' },
    { key: 'endDate', label: 'End date', type: 'date' },
    { key: 'objectives', label: 'Objectives', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: opts('ACTIVE', 'INACTIVE', 'COMPLETED') },
  ],
  'job-families': [
    ...CODE_NAME,
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  'job-functions': [
    ...CODE_NAME,
    { key: 'jobFamilyId', label: 'Job family', type: 'select', optionsFrom: 'job-families', required: true },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  'job-grades': [
    ...CODE_NAME,
    { key: 'rankOrder', label: 'Rank order', type: 'number', hint: 'Lower ranks sort first' },
    { key: 'minSalary', label: 'Minimum salary', type: 'number' },
    { key: 'maxSalary', label: 'Maximum salary', type: 'number' },
    CURRENCY,
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  'job-levels': [
    ...CODE_NAME,
    { key: 'rankOrder', label: 'Rank order', type: 'number' },
    {
      key: 'careerStage',
      label: 'Career stage',
      type: 'select',
      options: opts('ENTRY', 'JUNIOR', 'MID', 'SENIOR', 'LEAD', 'MANAGEMENT', 'EXECUTIVE'),
    },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  'job-roles': [
    ...CODE_NAME,
    { key: 'jobFunctionId', label: 'Job function', type: 'select', optionsFrom: 'job-functions' },
    { key: 'jobGradeId', label: 'Job grade', type: 'select', optionsFrom: 'job-grades' },
    { key: 'jobLevelId', label: 'Job level', type: 'select', optionsFrom: 'job-levels' },
    { key: 'description', label: 'Description', type: 'textarea' },
    { key: 'responsibilities', label: 'Responsibilities', type: 'textarea' },
    { key: 'status', label: 'Status', type: 'select', options: STATUS_BASIC },
  ],
  positions: [
    { key: 'code', label: 'Code', type: 'text', required: true },
    { key: 'title', label: 'Title', type: 'text', required: true },
    { key: 'companyId', label: 'Company', type: 'select', optionsFrom: 'companies', required: true },
    { key: 'jobRoleId', label: 'Job role', type: 'select', optionsFrom: 'job-roles' },
    { key: 'departmentId', label: 'Department', type: 'select', optionsFrom: 'departments' },
    { key: 'branchId', label: 'Branch', type: 'select', optionsFrom: 'branches' },
    { key: 'costCenterId', label: 'Cost centre', type: 'select', optionsFrom: 'cost-centers' },
    { key: 'reportsToPositionId', label: 'Reports to', type: 'select', optionsFrom: 'positions' },
    { key: 'jobGradeId', label: 'Job grade', type: 'select', optionsFrom: 'job-grades' },
    { key: 'jobLevelId', label: 'Job level', type: 'select', optionsFrom: 'job-levels' },
    { key: 'headcountBudgeted', label: 'Budgeted headcount', type: 'number' },
    { key: 'budgetAmount', label: 'Budget amount', type: 'number' },
    {
      key: 'employmentType',
      label: 'Employment type',
      type: 'select',
      options: opts('PERMANENT', 'CONTRACT', 'PROBATION', 'TRAINEE', 'CONSULTANT'),
    },
    { key: 'effectiveFrom', label: 'Effective from', type: 'date' },
    { key: 'effectiveTo', label: 'Effective to', type: 'date' },
    { key: 'status', label: 'Status', type: 'select', options: opts('OPEN', 'FILLED', 'ON_HOLD', 'CLOSED') },
  ],
};

// ---------------------------------------------------------------------------
// Per-entity presentation config
// ---------------------------------------------------------------------------

interface RelationColumn {
  header: string;
  idField: string;
  source: OrgEntitySlug;
}

interface EntityConfig {
  label: string;
  plural: string;
  icon: string;
  nameField: 'name' | 'title';
  statuses: string[];
  relation?: RelationColumn;
  showHeadcount: boolean;
}

const CONFIG: Record<OrgEntitySlug, EntityConfig> = {
  companies: {
    label: ORG_ENTITY_LABELS.company,
    plural: 'Companies',
    icon: 'company',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE', 'DISSOLVED'],
    relation: { header: 'Parent company', idField: 'parentCompanyId', source: 'companies' },
    showHeadcount: true,
  },
  'legal-entities': {
    label: ORG_ENTITY_LABELS.legal_entity,
    plural: 'Legal entities',
    icon: 'legal_entity',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Company', idField: 'companyId', source: 'companies' },
    showHeadcount: false,
  },
  regions: {
    label: ORG_ENTITY_LABELS.region,
    plural: 'Regions',
    icon: 'region',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Parent region', idField: 'parentRegionId', source: 'regions' },
    showHeadcount: true,
  },
  'business-units': {
    label: ORG_ENTITY_LABELS.business_unit,
    plural: 'Business units',
    icon: 'business_unit',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Company', idField: 'companyId', source: 'companies' },
    showHeadcount: true,
  },
  divisions: {
    label: ORG_ENTITY_LABELS.division,
    plural: 'Divisions',
    icon: 'division',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Business unit', idField: 'businessUnitId', source: 'business-units' },
    showHeadcount: true,
  },
  departments: {
    label: ORG_ENTITY_LABELS.department,
    plural: 'Departments',
    icon: 'department',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Division', idField: 'divisionId', source: 'divisions' },
    showHeadcount: true,
  },
  branches: {
    label: ORG_ENTITY_LABELS.branch,
    plural: 'Branches',
    icon: 'branch',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE', 'CLOSED'],
    relation: { header: 'Region', idField: 'regionId', source: 'regions' },
    showHeadcount: true,
  },
  locations: {
    label: ORG_ENTITY_LABELS.location,
    plural: 'Locations',
    icon: 'location',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Branch', idField: 'branchId', source: 'branches' },
    showHeadcount: true,
  },
  'cost-center-groups': {
    label: 'Cost centre group',
    plural: 'Cost centre groups',
    icon: 'cost_center',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Company', idField: 'companyId', source: 'companies' },
    showHeadcount: false,
  },
  'cost-centers': {
    label: ORG_ENTITY_LABELS.cost_center,
    plural: 'Cost centres',
    icon: 'cost_center',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Group', idField: 'groupId', source: 'cost-center-groups' },
    showHeadcount: true,
  },
  teams: {
    label: ORG_ENTITY_LABELS.team,
    plural: 'Teams',
    icon: 'team',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE', 'COMPLETED'],
    relation: { header: 'Department', idField: 'departmentId', source: 'departments' },
    showHeadcount: false,
  },
  'job-families': {
    label: 'Job family',
    plural: 'Job families',
    icon: 'position',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    showHeadcount: false,
  },
  'job-functions': {
    label: 'Job function',
    plural: 'Job functions',
    icon: 'position',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Job family', idField: 'jobFamilyId', source: 'job-families' },
    showHeadcount: false,
  },
  'job-grades': {
    label: 'Job grade',
    plural: 'Job grades',
    icon: 'position',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    showHeadcount: false,
  },
  'job-levels': {
    label: 'Job level',
    plural: 'Job levels',
    icon: 'position',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    showHeadcount: false,
  },
  'job-roles': {
    label: 'Job role',
    plural: 'Job roles',
    icon: 'position',
    nameField: 'name',
    statuses: ['ACTIVE', 'INACTIVE'],
    relation: { header: 'Job function', idField: 'jobFunctionId', source: 'job-functions' },
    showHeadcount: false,
  },
  positions: {
    label: ORG_ENTITY_LABELS.position,
    plural: 'Positions',
    icon: 'position',
    nameField: 'title',
    statuses: ['OPEN', 'FILLED', 'ON_HOLD', 'CLOSED'],
    relation: { header: 'Department', idField: 'departmentId', source: 'departments' },
    showHeadcount: true,
  },
};

const MAX_ROWS = 500;

const rowLabel = (row: EntityRow, nameField: 'name' | 'title'): string =>
  String(row[nameField] ?? row.name ?? row.title ?? `#${row.id}`);

// ---------------------------------------------------------------------------
// CSV helpers
// ---------------------------------------------------------------------------

/** RFC-4180-ish parser: handles quoted cells, escaped quotes and CRLF. */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = '';
  let inQuotes = false;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    if (inQuotes) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          cell += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cell += ch;
      }
      continue;
    }
    if (ch === '"') inQuotes = true;
    else if (ch === ',') {
      row.push(cell);
      cell = '';
    } else if (ch === '\n') {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = '';
    } else if (ch !== '\r') {
      cell += ch;
    }
  }
  if (cell !== '' || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

/**
 * The export endpoint needs the bearer token, so a plain `<a href>` 401s.
 * Fetch it, hand the blob to the browser, then release the object URL.
 */
export async function downloadCsv(url: string, filename: string): Promise<void> {
  let res: Response;
  try {
    res = await fetch(url, { headers: { Authorization: `Bearer ${tokenStore.get() ?? ''}` } });
  } catch {
    throw new Error('Cannot reach the server. Is the backend running?');
  }
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { error?: string };
    throw new Error(body.error ?? `Export failed (${res.status})`);
  }
  const objectUrl = URL.createObjectURL(await res.blob());
  try {
    const a = document.createElement('a');
    a.href = objectUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
  } finally {
    window.setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
  }
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

/** Generic list + create/edit/delete over every organization entity type. */
export function OrgEntityManager({ canEdit }: { canEdit: boolean }) {
  const { employees } = useApp();

  const [entity, setEntity] = useState<OrgEntitySlug>('companies');
  const [rows, setRows] = useState<EntityRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState('');

  const [editing, setEditing] = useState<EntityRow | null>(null);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [importOpen, setImportOpen] = useState(false);
  const [exporting, setExporting] = useState(false);

  const [options, setOptions] = useState<Record<string, SelectOption[]>>({});
  const pending = useRef<Set<string>>(new Set());

  const config = CONFIG[entity];

  // -- data ------------------------------------------------------------------

  const load = useCallback(() => {
    setLoading(true);
    setError(null);
    CRUD[entity]
      .list({})
      .then((data) => setRows(Array.isArray(data) ? data : []))
      .catch((err: unknown) => setError(errMsg(err, 'Could not load this entity')))
      .finally(() => setLoading(false));
  }, [entity]);

  useEffect(() => {
    load();
  }, [load]);

  // -- lazy option lists ------------------------------------------------------

  const employeeOptions = useMemo<SelectOption[]>(
    () =>
      employees.map((e) => ({
        value: e.id,
        label: `${e.empCode} · ${e.fullName}`,
      })),
    [employees],
  );

  const loadOptions = useCallback(
    (slug: OrgEntitySlug) => {
      if (options[slug] || pending.current.has(slug)) return;
      pending.current.add(slug);
      CRUD[slug]
        .list({})
        .then((data) => {
          const list = (Array.isArray(data) ? data : []).map((r) => ({
            value: r.id,
            label: `${r.code ? `${r.code} · ` : ''}${rowLabel(r, CONFIG[slug].nameField)}`,
          }));
          setOptions((prev) => ({ ...prev, [slug]: list }));
        })
        .catch(() => setOptions((prev) => ({ ...prev, [slug]: [] })))
        .finally(() => pending.current.delete(slug));
    },
    [options],
  );

  // Pull in whatever the current entity's form and relation column reference.
  useEffect(() => {
    const needed = new Set<OrgEntitySlug>();
    for (const spec of ENTITY_FORMS[entity]) {
      if (spec.optionsFrom && spec.optionsFrom !== 'employees') needed.add(spec.optionsFrom);
    }
    if (config.relation) needed.add(config.relation.source);
    needed.forEach((slug) => loadOptions(slug));
  }, [entity, config, loadOptions]);

  const optionLabel = useCallback(
    (source: OrgEntitySlug, id: unknown): string => {
      if (id === null || id === undefined || id === '') return '—';
      const list = options[source];
      if (!list) return '…';
      const hit = list.find((o) => String(o.value) === String(id));
      return hit ? hit.label : `#${String(id)}`;
    },
    [options],
  );

  const fields = useMemo<FieldDescriptor[]>(
    () =>
      ENTITY_FORMS[entity].map((spec) => {
        if (spec.type !== 'select') return { ...spec };
        const list =
          spec.options ??
          (spec.optionsFrom === 'employees' ? employeeOptions : options[spec.optionsFrom ?? ''] ?? []);
        return { ...spec, options: list, numeric: spec.optionsFrom !== undefined };
      }),
    [entity, options, employeeOptions],
  );

  // -- filtering --------------------------------------------------------------

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rows.filter((r) => {
      if (statusFilter && String(r.status ?? '') !== statusFilter) return false;
      if (!q) return true;
      return `${r.code ?? ''} ${rowLabel(r, config.nameField)}`.toLowerCase().includes(q);
    });
  }, [rows, query, statusFilter, config]);

  const capped = filtered.slice(0, MAX_ROWS);

  // -- mutations --------------------------------------------------------------

  const submit = (values: Record<string, unknown>) => {
    setSaving(true);
    const action = editing ? CRUD[entity].update(editing.id, values) : CRUD[entity].create(values);
    action
      .then(() => {
        setEditing(null);
        setCreating(false);
        setOptions((prev) => {
          const next = { ...prev };
          delete next[entity];
          return next;
        });
        load();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not save this record')))
      .finally(() => setSaving(false));
  };

  const remove = (row: EntityRow) => {
    const name = rowLabel(row, config.nameField);
    if (!window.confirm(`Delete ${config.label.toLowerCase()} "${name}"? This cannot be undone.`)) return;
    CRUD[entity]
      .remove(row.id)
      .then(() => load())
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not delete this record')));
  };

  const exportCsv = () => {
    setExporting(true);
    downloadCsv(orgApi.exportUrl(entity), `${entity}.csv`)
      .catch((err: unknown) => window.alert(errMsg(err, 'Could not export this entity')))
      .finally(() => setExporting(false));
  };

  // -- render -----------------------------------------------------------------

  const headers = ['Code', 'Name', ...(config.relation ? [config.relation.header] : []), 'Headcount', 'Status', ''];

  return (
    <div className="space-y-3">
      {/* Entity picker */}
      <div className="bg-bg-card border border-border-default rounded-md p-3">
        <p className="text-[10px] uppercase tracking-wider text-text-muted font-medium mb-2">Entity type</p>
        <div className="flex flex-wrap gap-1.5">
          {ORG_ENTITIES.map((slug) => {
            const active = slug === entity;
            return (
              <button
                key={slug}
                type="button"
                aria-pressed={active}
                onClick={() => {
                  setEntity(slug);
                  setQuery('');
                  setStatusFilter('');
                }}
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium border transition-all ${
                  active
                    ? 'bg-primary-light border-primary/30 text-primary'
                    : 'border-border-default text-text-muted hover:border-text-muted'
                }`}
              >
                <EntityIcon
                  entityType={CONFIG[slug].icon}
                  size={14}
                  className={active ? 'text-primary' : 'text-text-muted'}
                />
                {CONFIG[slug].plural}
              </button>
            );
          })}
        </div>
      </div>

      {/* Toolbar */}
      <div className="bg-bg-card border border-border-default rounded-md p-3 flex flex-wrap items-center gap-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-text-muted" />
          <input
            className={`${INPUT_CLS} pl-8`}
            placeholder={`Search ${config.plural.toLowerCase()}…`}
            aria-label={`Search ${config.plural}`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <select
          className={`${INPUT_CLS} w-auto min-w-[140px]`}
          aria-label="Filter by status"
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
        >
          <option value="">All statuses</option>
          {config.statuses.map((s) => (
            <option key={s} value={s}>
              {s.charAt(0) + s.slice(1).toLowerCase().replace(/_/g, ' ')}
            </option>
          ))}
        </select>

        <button type="button" className={BTN_SECONDARY} onClick={load} aria-label="Reload the list">
          <RefreshCw size={14} className={loading ? 'animate-spin' : ''} />
        </button>
        <button type="button" className={BTN_SECONDARY} onClick={exportCsv} disabled={exporting}>
          <span className="inline-flex items-center gap-1.5">
            <FileDown size={14} /> {exporting ? 'Exporting…' : 'Export'}
          </span>
        </button>
        {canEdit && (
          <>
            <button type="button" className={BTN_SECONDARY} onClick={() => setImportOpen(true)}>
              <span className="inline-flex items-center gap-1.5">
                <FileUp size={14} /> Import
              </span>
            </button>
            <button type="button" className={BTN_PRIMARY} onClick={() => setCreating(true)}>
              <span className="inline-flex items-center gap-1.5">
                <Plus size={14} /> New {config.label.toLowerCase()}
              </span>
            </button>
          </>
        )}
      </div>

      {error && <ErrorBlock message={error} />}

      {loading ? (
        <LoadingBlock label={`Loading ${config.plural.toLowerCase()}…`} />
      ) : filtered.length === 0 ? (
        <div className="bg-bg-card border border-border-default rounded-md">
          <EmptyBlock
            message={`No ${config.plural.toLowerCase()} found`}
            hint={query || statusFilter ? 'Try clearing the filters.' : undefined}
          />
        </div>
      ) : (
        <>
          <TableShell headers={headers}>
            {capped.map((row) => (
              <tr key={row.id} className="hover:bg-bg-hover transition-colors">
                <td className="px-3 py-2 text-text-muted text-[11px] font-mono whitespace-nowrap">
                  {row.code ?? '—'}
                </td>
                <td className="px-3 py-2">
                  <span className="inline-flex items-center gap-2">
                    <EntityIcon entityType={config.icon} size={14} />
                    <span className="text-text-primary text-sm">{rowLabel(row, config.nameField)}</span>
                  </span>
                </td>
                {config.relation && (
                  <td className="px-3 py-2 text-text-secondary text-xs">
                    {optionLabel(config.relation.source, row[config.relation.idField])}
                  </td>
                )}
                <td className="px-3 py-2">
                  {config.showHeadcount ? (
                    <HeadcountPill count={Number(row.headcount ?? 0)} vacancies={Number(row.vacancies ?? 0)} />
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </td>
                <td className="px-3 py-2">
                  <OrgStatusChip status={row.status} />
                </td>
                <td className="px-3 py-2 text-right whitespace-nowrap">
                  {canEdit ? (
                    <span className="inline-flex items-center gap-2">
                      <button
                        type="button"
                        aria-label={`Edit ${rowLabel(row, config.nameField)}`}
                        onClick={() => setEditing(row)}
                        className="text-text-muted hover:text-primary transition-colors"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        type="button"
                        aria-label={`Delete ${rowLabel(row, config.nameField)}`}
                        onClick={() => remove(row)}
                        className="text-text-muted hover:text-danger transition-colors"
                      >
                        <Trash2 size={14} />
                      </button>
                    </span>
                  ) : (
                    <span className="text-text-muted text-xs">—</span>
                  )}
                </td>
              </tr>
            ))}
          </TableShell>
          <p className="text-text-muted text-[11px]">
            Showing {capped.length} of {filtered.length}
            {filtered.length > MAX_ROWS && ` — the list is capped at ${MAX_ROWS} rows, narrow the search to see more.`}
          </p>
        </>
      )}

      {(creating || editing) && (
        <EntityFormModal
          title={editing ? `Edit ${config.label.toLowerCase()}` : `New ${config.label.toLowerCase()}`}
          subtitle={editing ? rowLabel(editing, config.nameField) : config.plural}
          fields={fields}
          initial={editing}
          submitting={saving}
          onClose={() => {
            setCreating(false);
            setEditing(null);
          }}
          onSubmit={submit}
        />
      )}

      {importOpen && (
        <ImportModal
          entity={entity}
          label={config.plural}
          onClose={() => setImportOpen(false)}
          onImported={load}
        />
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// CSV import
// ---------------------------------------------------------------------------

interface ImportResult {
  created: number;
  updated: number;
  failed: { row: number; reason: string }[];
}

function ImportModal({
  entity,
  label,
  onClose,
  onImported,
}: {
  entity: OrgEntitySlug;
  label: string;
  onClose: () => void;
  onImported: () => void;
}) {
  const [fileName, setFileName] = useState('');
  const [headers, setHeaders] = useState<string[]>([]);
  const [parsed, setParsed] = useState<Record<string, unknown>[]>([]);
  const [parseError, setParseError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ImportResult | null>(null);

  const onFile = (file: File | undefined) => {
    setResult(null);
    setParseError(null);
    setHeaders([]);
    setParsed([]);
    if (!file) return;
    setFileName(file.name);
    file
      .text()
      .then((text) => {
        const grid = parseCsv(text);
        if (grid.length < 2) {
          setParseError('The file needs a header row and at least one data row.');
          return;
        }
        const keys = grid[0].map((h) => h.trim());
        const body = grid.slice(1).map((cells) => {
          const obj: Record<string, unknown> = {};
          keys.forEach((k, i) => {
            if (!k) return;
            const raw = (cells[i] ?? '').trim();
            obj[k] = raw === '' ? null : raw;
          });
          return obj;
        });
        setHeaders(keys);
        setParsed(body);
      })
      .catch((err: unknown) => setParseError(errMsg(err, 'Could not read that file')));
  };

  const runImport = () => {
    if (parsed.length === 0) return;
    setBusy(true);
    orgApi
      .bulkImport(entity, parsed)
      .then((res) => {
        setResult(res);
        onImported();
      })
      .catch((err: unknown) => window.alert(errMsg(err, 'The import failed')))
      .finally(() => setBusy(false));
  };

  const preview = parsed.slice(0, 8);

  return (
    <ModalShell
      title={`Import ${label.toLowerCase()}`}
      subtitle="CSV with a header row — column names must match the API field names"
      onClose={onClose}
      maxWidth="max-w-3xl"
      footer={
        <div className="flex items-center justify-between gap-2">
          <span className="text-text-muted text-[11px]">
            {parsed.length > 0 ? `${parsed.length} row${parsed.length === 1 ? '' : 's'} ready` : 'No file chosen'}
          </span>
          <span className="flex items-center gap-2">
            <button type="button" className={BTN_SECONDARY} onClick={onClose} disabled={busy}>
              Close
            </button>
            <button
              type="button"
              className={BTN_PRIMARY}
              onClick={runImport}
              disabled={busy || parsed.length === 0}
            >
              {busy ? 'Importing…' : 'Import'}
            </button>
          </span>
        </div>
      }
    >
      <div className="space-y-4">
        <div>
          <label className="block text-[10px] uppercase tracking-wider text-text-muted font-medium mb-1">
            CSV file
          </label>
          <input
            type="file"
            accept=".csv,text/csv"
            aria-label="Choose a CSV file"
            className="block w-full text-xs text-text-secondary file:mr-3 file:px-3 file:py-1.5 file:rounded-md file:border file:border-border-default file:bg-bg-secondary file:text-text-secondary file:text-xs"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          {fileName && <p className="text-text-muted text-[11px] mt-1">{fileName}</p>}
        </div>

        {parseError && <ErrorBlock message={parseError} />}

        {preview.length > 0 && (
          <div>
            <p className="text-text-secondary text-xs mb-2">
              Preview — first {preview.length} of {parsed.length} rows
            </p>
            <div className="rounded-md border border-border-default overflow-x-auto">
              <table className="w-full">
                <thead className="bg-bg-secondary">
                  <tr>
                    {headers.map((h) => (
                      <th
                        key={h}
                        className="px-2 py-1.5 text-left text-[10px] font-semibold text-text-muted uppercase tracking-wider whitespace-nowrap"
                      >
                        {h}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border-light">
                  {preview.map((r, i) => (
                    <tr key={i}>
                      {headers.map((h) => (
                        <td key={h} className="px-2 py-1.5 text-text-primary text-[11px] whitespace-nowrap">
                          {r[h] === null || r[h] === undefined ? '—' : String(r[h])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {result && (
          <div className="space-y-2">
            <div className="flex items-center gap-2 flex-wrap text-xs">
              <span className="px-2 py-1 rounded-md bg-success-light text-success border border-success/30">
                {result.created} created
              </span>
              <span className="px-2 py-1 rounded-md bg-info-light text-info border border-info/30">
                {result.updated} updated
              </span>
              <span
                className={`px-2 py-1 rounded-md border ${
                  result.failed.length > 0
                    ? 'bg-danger-light text-danger border-danger/30'
                    : 'bg-bg-hover text-text-secondary border-border-default'
                }`}
              >
                {result.failed.length} failed
              </span>
            </div>
            {result.failed.length > 0 && (
              <div className="rounded-md border border-border-default divide-y divide-border-light max-h-48 overflow-y-auto scrollbar-thin">
                {result.failed.map((f) => (
                  <p key={f.row} className="px-3 py-1.5 text-[11px] text-text-secondary">
                    <span className="text-text-muted font-mono mr-2">row {f.row}</span>
                    {f.reason}
                  </p>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </ModalShell>
  );
}
