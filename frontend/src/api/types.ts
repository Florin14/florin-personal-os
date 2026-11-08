import type { components } from './schema';

type Schemas = components['schemas'];

export type AuthState = Schemas['AuthStateResponse'];
export type User = Schemas['UserOut'];
export type SessionInfo = Schemas['SessionOut'];
export type TotpEnrollment = Schemas['TotpEnrollmentResponse'];
export type Workspace = Schemas['WorkspaceOut'];
export type Health = Schemas['HealthResponse'];
export type SystemInfo = Schemas['SystemInfoResponse'];
