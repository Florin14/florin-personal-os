import type { components } from './schema';

type Schemas = components['schemas'];

export type AuthState = Schemas['AuthStateResponse'];
export type User = Schemas['UserOut'];
export type SessionInfo = Schemas['SessionOut'];
export type TotpEnrollment = Schemas['TotpEnrollmentResponse'];
export type Workspace = Schemas['WorkspaceOut'];
export type Health = Schemas['HealthResponse'];
export type SystemInfo = Schemas['SystemInfoResponse'];

export type Approval = Schemas['ApprovalOut'];
export type ApprovalStatus = Approval['status'];
export type Notification = Schemas['NotificationOut'];
export type AuditRecord = Schemas['AuditRecordOut'];
export type Job = Schemas['JobOut'];
export type JobStats = Schemas['JobStatsOut'];
export type Automation = Schemas['AutomationOut'];
export type AutomationVersion = Schemas['VersionOut'];
export type Execution = Schemas['ExecutionOut'];
export type ExecutionDetail = Schemas['ExecutionDetailOut'];
export type ExecutionStatus = Execution['status'];
export type StepRun = Schemas['StepOut'];
export type ActionInfo = Schemas['ActionOut'];
export type Controls = Schemas['ControlsOut'];
